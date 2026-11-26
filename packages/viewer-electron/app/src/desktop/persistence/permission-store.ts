import { randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { inspectReviewedFile, verifyReviewedFile } from '../native/reviewed-file';
import { syncParentDirectory } from './directory-sync';
import { DocumentStore } from './document-store';

/** A damaged grant list confers no access. Keep its bytes before the first explicit repair. */
export class PermissionStore<T extends { version: 1 }> extends DocumentStore<T> {
  private revision: string | null = null;
  private unreadable = false;
  private pendingSync = false;

  constructor(
    file: string,
    private parse: (value: unknown) => T,
  ) {
    super(file, parse);
  }

  override async load(): Promise<T | null> {
    try {
      const snapshot = await super.loadSnapshot();
      this.revision = snapshot.revision;
      this.unreadable = false;
      return snapshot.value;
    } catch {
      this.unreadable = true;
      return null;
    }
  }

  /** A failed directory sync can leave a published withdrawal. The next edit must start
   * from those bytes before it constructs its replacement list. */
  async settlePublished(): Promise<T | undefined> {
    if (!this.pendingSync) return;
    await syncParentDirectory(this.file);
    const current = await super.loadSnapshot();
    if (current.revision !== this.revision)
      throw new Error('Permissions changed on disk. Reopen Viewer before changing them.');
    this.pendingSync = false;
    return current.value ?? undefined;
  }

  override async save(input: T): Promise<void> {
    let expected = this.revision;
    if (this.unreadable) {
      const original = await inspectReviewedFile(this.file, 16_000_000);
      let value: unknown;
      try {
        value = JSON.parse(original.bytes.toString('utf8'));
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
      if (
        value &&
        typeof value === 'object' &&
        'version' in value &&
        typeof value.version === 'number' &&
        value.version > 1
      )
        throw new Error(
          'These permissions were saved by a newer Viewer. Open them with that version.',
        );
      let recovered: T | undefined;
      try {
        recovered = this.parse(value);
      } catch {
        // An invalid document can be replaced once an exact recovery copy is durable.
      }
      if (recovered)
        throw new Error(
          'The saved permissions can be read again. Reopen Viewer before changing them.',
        );
      const backup = await open(this.file + '.before-repair-' + randomUUID() + '.bak', 'wx', 0o600);
      try {
        await backup.writeFile(original.bytes);
        await backup.sync();
      } finally {
        await backup.close();
      }
      await syncParentDirectory(this.file);
      await verifyReviewedFile(original.reviewed, 16_000_000);
      expected = original.reviewed.sha256;
    }
    await super.save(input, expected, (revision) => {
      this.pendingSync = true;
      this.revision = revision;
      this.unreadable = false;
    });
    this.pendingSync = false;
  }
}
