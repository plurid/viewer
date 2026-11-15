import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { lstat, rename } from 'node:fs/promises';
import {
  advanceTrial,
  licenseKeyText,
  licenseLimits,
  trialStatus,
} from '../../domain/license/license';
import type { LicenseStatus } from '../../domain/license/license';
import { DocumentStore } from '../persistence/document-store';
import { syncParentDirectory } from '../persistence/directory-sync';
import type { LicenseConfiguration } from '../release';
import { licenseEndpoint, readLicenseKey } from './signature';

export interface LicenseHost {
  configuration: LicenseConfiguration;
  store: boolean;
  open(url: string): Promise<void>;
  changed?(status: LicenseStatus): void;
  now?: () => number;
}

const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const stateSchema = z.object({
  version: z.literal(1),
  trial: z.object({ started: timestamp, seen: timestamp }),
  key: z.string().max(licenseLimits.key).optional(),
});
type LicenseState = z.infer<typeof stateSchema>;
const clockSaveInterval = 60 * 60 * 1000;

export class License {
  private readonly document: DocumentStore<LicenseState>;
  private readonly key?: KeyObject;
  private readonly purchaseURL?: string;
  private record?: LicenseState;
  private saved?: LicenseState;
  private writable = true;
  private current?: LicenseStatus;
  private reminderHidden = false;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    file: string,
    private readonly host: LicenseHost,
  ) {
    this.document = new DocumentStore(file, (value) => stateSchema.parse(value));
    if (host.store || !host.configuration.publicKey || !host.configuration.purchaseURL) return;
    try {
      const endpoint = licenseEndpoint(host.configuration);
      this.key = endpoint?.key;
      this.purchaseURL = endpoint?.purchaseURL.href;
    } catch {
      // An incomplete publisher configuration must never start a trial.
      this.key = undefined;
      this.purchaseURL = undefined;
    }
  }

  status(hideReminder = false): Promise<LicenseStatus | undefined> {
    return this.run(() => {
      if (this.key && hideReminder) this.reminderHidden = true;
      return this.read();
    });
  }

  enter(text: string): Promise<LicenseStatus | undefined> {
    return this.run(async () => {
      if (!this.key) return undefined;
      readLicenseKey(text, this.key);
      await this.read();
      this.requireWritable();
      const record = { ...this.record!, key: licenseKeyText(text) };
      if (record.key !== this.record!.key) await this.save(record);
      return this.read();
    });
  }

  remove(): Promise<LicenseStatus | undefined> {
    return this.run(async () => {
      if (!this.key) return undefined;
      await this.read();
      this.requireWritable();
      const record: LicenseState = { version: 1, trial: this.record!.trial };
      if (this.record!.key !== undefined) await this.save(record);
      return this.read();
    });
  }

  async buy(): Promise<void> {
    if (this.purchaseURL) await this.host.open(this.purchaseURL);
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.pending.catch(() => {}).then(task);
    this.pending = result;
    return result;
  }

  private requireWritable(): void {
    if (!this.writable)
      throw new Error(
        'The saved license record could not be preserved. Keep it for recovery before changing the license key.',
      );
  }

  private async load(): Promise<LicenseState | undefined> {
    try {
      this.saved = (await this.document.load()) ?? undefined;
      return this.saved;
    } catch {
      try {
        const info = await lstat(this.document.file);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unexpected license record.');
        const kept = `${this.document.file}.unreadable-${Date.now()}-${randomUUID()}`;
        await rename(this.document.file, kept);
        await syncParentDirectory(this.document.file);
      } catch {
        // An unreadable original is never replaced unless its recovery copy is safe.
        this.writable = false;
      }
      return undefined;
    }
  }

  private async save(record: LicenseState): Promise<void> {
    this.requireWritable();
    await this.document.save(record);
    this.saved = record;
    this.record = record;
  }

  private recordStatus(record: LicenseState): LicenseStatus {
    if (record.key && this.key) {
      try {
        return { kind: 'licensed', email: readLicenseKey(record.key, this.key).email };
      } catch {
        // Another build may still accept this key, so only explicit removal clears it.
      }
    }
    return trialStatus(record.trial, record.trial.seen);
  }

  private async read(): Promise<LicenseStatus | undefined> {
    if (!this.key) return undefined;
    if (!this.record) this.record = await this.load();
    const trial = advanceTrial(this.record?.trial, (this.host.now ?? Date.now)());
    const record: LicenseState = { ...this.record, version: 1, trial };
    let status = this.recordStatus(record);
    const changed =
      !this.saved ||
      record.key !== this.saved.key ||
      JSON.stringify(status) !== JSON.stringify(this.recordStatus(this.saved));
    const clockDue = !!this.saved && trial.seen - this.saved.trial.seen >= clockSaveInterval;
    if (this.writable && (changed || clockDue)) await this.save(record).catch(() => {});
    this.record = record;
    if (status.kind === 'trial-ended' && this.reminderHidden)
      status = { kind: 'trial-ended', reminderHidden: true };
    if (JSON.stringify(status) !== JSON.stringify(this.current)) {
      this.current = status;
      this.host.changed?.(status);
    }
    return status;
  }
}
