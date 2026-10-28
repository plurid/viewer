import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import {
  speechProviderSchema,
  speechProviderIdentity,
  metaLanguageBias,
  type SpeechProvider,
  type SpeechProviderRequest,
  type SpeechProvidersSnapshot,
  type SpeechProviderCheck,
} from '../../domain/speech/providers';
import type { SpeechLanguage, SpeechTranscript } from '../../domain/speech/recognition';
import { DocumentStore } from '../persistence/document-store';
import type { Credentials } from '../models/providers';
import { HostedTranscription } from './transcription';
import { SpeechProviderChecks } from './provider-check';
import { providerAbort, waitForProvider } from '../models/provider-response';

const documentSchema = z
  .object({
    version: z.literal(1),
    providers: z.array(speechProviderSchema).max(8),
    consents: z.record(z.uuid(), z.string().max(8192)),
  })
  .strict()
  .refine(
    (value) => new Set(value.providers.map((item) => item.id)).size === value.providers.length,
    'Speech provider IDs must be unique.',
  );
type ProviderDocument = z.infer<typeof documentSchema>;
export interface SpeechProviderLease {
  provider: SpeechProvider;
  revision: number;
}
interface Ports {
  confirm(provider: SpeechProvider): Promise<boolean>;
  changed(): void;
  invalidated(id: string): void;
}
/** Private endpoint/model-bound authority. Configuration, credentials and a microphone grant
 * cannot independently authorize sending a recording. No automatic retries or fallback. */
export class SpeechProviders {
  private store: DocumentStore<ProviderDocument>;
  private loaded?: Promise<ProviderDocument>;
  private writes: Promise<void> = Promise.resolve();
  private revisions = new Map<string, number>();
  private blocked = new Map<string, number>();
  private active = new Map<AbortController, string>();
  private checks = new Map<string, SpeechProviderCheck>();
  private checking = new Map<string, AbortController>();
  private closed = false;
  constructor(
    directory: string,
    private credentials: Pick<Credentials, 'load' | 'get' | 'set' | 'ids'>,
    private ports: Ports,
    private transport = new HostedTranscription(),
    private checker = new SpeechProviderChecks(),
  ) {
    this.store = new DocumentStore(path.join(directory, 'speech-providers-v1.json'), (value) =>
      documentSchema.parse(value),
    );
  }
  private state() {
    return (this.loaded ??= this.store
      .load()
      .then((value) => value ?? { version: 1 as const, providers: [], consents: {} })
      .catch((error) => {
        this.loaded = undefined;
        throw error;
      }));
  }
  private keyID(provider: SpeechProvider): string {
    return createHash('sha256')
      .update(JSON.stringify([provider.id, provider.kind, provider.endpoint]))
      .digest('hex');
  }
  private async provider(id: string): Promise<SpeechProvider> {
    const provider = (await this.state()).providers.find((item) => item.id === id);
    if (!provider) throw new Error('Choose a saved speech provider in Settings → Speech.');
    return structuredClone(provider);
  }
  private invalidate(id: string, clearCheck = true): number {
    const revision = (this.revisions.get(id) ?? 0) + 1;
    this.revisions.set(id, revision);
    this.blocked.set(id, revision);
    if (clearCheck) this.checks.delete(id);
    for (const [controller, owner] of this.active) if (owner === id) controller.abort();
    this.ports.invalidated(id);
    return revision;
  }
  private mutate(
    id: string,
    change: (document: ProviderDocument) => Promise<ProviderDocument>,
    revoke: boolean | ((document: ProviderDocument) => boolean) = false,
    clearCheck = true,
  ): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Speech providers are closed.'));
    const revision = this.invalidate(id, clearCheck);
    const work = this.writes
      .catch(() => {})
      .then(async () => {
        if (this.closed) throw new Error('Speech providers are closed.');
        let current = await this.state();
        // Revoke durably before changing a key. A credential write or later save can
        // fail; restarting must not revive the previous grant with a replacement key.
        if ((typeof revoke === 'function' ? revoke(current) : revoke) && current.consents[id]) {
          current = structuredClone(current);
          delete current.consents[id];
          await this.store.save(current);
          this.loaded = Promise.resolve(current);
        }
        const next = documentSchema.parse(await change(structuredClone(current)));
        await this.store.save(next);
        this.loaded = Promise.resolve(next);
        if (this.blocked.get(id) === revision) this.blocked.delete(id);
      })
      .finally(() => this.ports.changed());
    this.writes = work;
    return work;
  }
  async status(): Promise<SpeechProvidersSnapshot> {
    const state = await this.state();
    await this.credentials.load();
    const keys = new Set(this.credentials.ids());
    return {
      providers: state.providers.map((provider) => ({
        ...provider,
        hasKey: keys.has(this.keyID(provider)),
        allowed:
          !this.closed &&
          !this.blocked.has(provider.id) &&
          state.consents[provider.id] === speechProviderIdentity(provider),
        check: this.checks.get(provider.id),
      })),
    };
  }
  async request(request: SpeechProviderRequest): Promise<void> {
    if (request.kind === 'provider-check') {
      await this.check(request.id);
      return;
    }
    if (request.kind === 'provider-save') {
      const provider = speechProviderSchema.parse(request.provider);
      await this.mutate(
        provider.id,
        async (state) => {
          const previous = state.providers.find((item) => item.id === provider.id);
          if (!previous && state.providers.length >= 8)
            throw new Error('Speech supports up to eight providers.');
          const changed =
            previous && speechProviderIdentity(previous) !== speechProviderIdentity(provider);
          if (changed) {
            delete state.consents[provider.id];
            if (this.keyID(previous) !== this.keyID(provider))
              await this.credentials.set(this.keyID(previous), '');
          }
          state.providers = [
            ...state.providers.filter((item) => item.id !== provider.id),
            provider,
          ];
          return state;
        },
        (state) => {
          const previous = state.providers.find((item) => item.id === provider.id);
          return (
            !!previous && speechProviderIdentity(previous) !== speechProviderIdentity(provider)
          );
        },
      );
      return;
    }
    const provider = await this.provider(request.id);
    if (request.kind === 'provider-consent' && request.allow) {
      await this.credentials.load();
      if (!this.credentials.ids().includes(this.keyID(provider)))
        throw new Error('Save this provider’s API key before allowing recordings.');
      const revision = this.revisions.get(provider.id) ?? 0,
        identity = speechProviderIdentity(provider);
      if (!(await this.ports.confirm(structuredClone(provider)))) return;
      const current = await this.provider(provider.id);
      if (
        this.closed ||
        this.blocked.has(provider.id) ||
        (this.revisions.get(provider.id) ?? 0) !== revision ||
        speechProviderIdentity(current) !== identity
      )
        throw new Error(
          'The speech provider changed while permission was being reviewed. Review it again.',
        );
      await this.mutate(
        provider.id,
        async (state) => {
          if (
            speechProviderIdentity(state.providers.find((item) => item.id === provider.id)!) !==
            identity
          )
            throw new Error('The speech provider changed.');
          state.consents[provider.id] = identity;
          return state;
        },
        false,
        false,
      );
      return;
    }
    await this.mutate(
      provider.id,
      async (state) => {
        const current = state.providers.find((item) => item.id === provider.id);
        if (!current || speechProviderIdentity(current) !== speechProviderIdentity(provider))
          throw new Error('The speech provider changed. Retry the action.');
        delete state.consents[provider.id];
        if (request.kind === 'provider-key')
          await this.credentials.set(this.keyID(provider), request.key);
        if (request.kind === 'provider-remove') {
          await this.credentials.set(this.keyID(provider), '');
          state.providers = state.providers.filter((item) => item.id !== provider.id);
        }
        return state;
      },
      true,
      request.kind !== 'provider-consent',
    );
  }
  async check(id: string, outer?: AbortSignal): Promise<void> {
    if (this.closed) throw new Error('Speech providers are closed.');
    this.checking.get(id)?.abort();
    const controller = new AbortController(),
      signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(15000),
        ...(outer ? [outer] : []),
      ]);
    this.checking.set(id, controller);
    this.active.set(controller, id);
    this.checks.delete(id);
    this.ports.changed();
    try {
      await waitForProvider(this.writes, signal);
      const provider = await waitForProvider(this.provider(id), signal),
        lease = { provider, revision: this.revisions.get(id) ?? 0 };
      this.checkIdentity(await waitForProvider(this.state(), signal), lease);
      let key: string;
      try {
        key = await waitForProvider(this.credentials.get(this.keyID(provider)), signal);
      } catch {
        if (signal.aborted) throw providerAbort(signal);
        throw new Error(
          'The stored speech key could not be read. Save the key again in Settings → Speech.',
        );
      }
      this.checkIdentity(await waitForProvider(this.state(), signal), lease);
      signal.throwIfAborted();
      const result = await this.checker.check(provider, key, signal);
      this.checkIdentity(await waitForProvider(this.state(), signal), lease);
      signal.throwIfAborted();
      this.checks.set(id, result);
    } finally {
      this.active.delete(controller);
      if (this.checking.get(id) === controller) this.checking.delete(id);
      this.ports.changed();
    }
  }
  async prepare(id: string | undefined, language: SpeechLanguage): Promise<SpeechProviderLease> {
    await this.writes;
    const provider = await this.provider(id ?? '');
    if (provider.kind === 'meta') metaLanguageBias(language);
    const lease = { provider, revision: this.revisions.get(provider.id) ?? 0 };
    await this.assertCurrent(lease);
    await this.credentials.load();
    if (!this.credentials.ids().includes(this.keyID(provider)))
      throw new Error('Save this speech provider’s API key in Settings → Speech.');
    return lease;
  }
  private async assertCurrent(lease: SpeechProviderLease): Promise<void> {
    this.checkCurrent(await this.state(), lease);
  }
  private checkCurrent(state: ProviderDocument, lease: SpeechProviderLease): void {
    this.checkIdentity(state, lease);
    if (state.consents[lease.provider.id] !== speechProviderIdentity(lease.provider))
      throw new Error('Allow this endpoint and model to receive recordings in Settings → Speech.');
  }
  private checkIdentity(state: ProviderDocument, lease: SpeechProviderLease): void {
    const id = lease.provider.id,
      identity = speechProviderIdentity(lease.provider);
    if (
      this.closed ||
      this.blocked.has(id) ||
      (this.revisions.get(id) ?? 0) !== lease.revision ||
      !state.providers.some((item) => speechProviderIdentity(item) === identity)
    )
      throw new Error('Allow this endpoint and model to receive recordings in Settings → Speech.');
  }
  async transcribe(
    lease: SpeechProviderLease,
    pcm: Uint8Array,
    language: SpeechLanguage,
    signal: AbortSignal,
  ): Promise<SpeechTranscript> {
    await this.writes;
    await this.assertCurrent(lease);
    signal.throwIfAborted();
    const key = await this.credentials.get(this.keyID(lease.provider));
    const current = await this.state();
    this.checkCurrent(current, lease);
    signal.throwIfAborted();
    // No await between the final authority check and registering the cancellable upload.
    const controller = new AbortController();
    this.active.set(controller, lease.provider.id);
    try {
      const result = await this.transport.transcribe(
        lease.provider,
        key,
        pcm,
        language,
        AbortSignal.any([signal, controller.signal]),
      );
      controller.signal.throwIfAborted();
      await this.assertCurrent(lease);
      signal.throwIfAborted();
      return result;
    } finally {
      this.active.delete(controller);
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const controller of this.active.keys()) controller.abort();
    await this.writes.catch(() => {});
    await this.store.flush();
  }
}
