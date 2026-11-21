import type { SettingsPatch, SettingsSnapshot } from '../../../domain/services';
import type { SettingsChange } from '../../ui/settings/settings-edits';

interface SettingsWriter {
  current(): SettingsSnapshot | undefined;
  write(patches: SettingsPatch[], revision: number): Promise<SettingsSnapshot>;
  refresh(): Promise<SettingsSnapshot>;
  accept(snapshot: SettingsSnapshot): void;
  error(message: string): void;
}

const rejectedEditCodes = new Set(['SETTINGS_INVALID', 'SETTINGS_CONFLICT']);

function isRejectedEdit(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && rejectedEditCodes.has(code)) return true;
  return (error as { name?: unknown }).name === 'ZodError';
}

/** Failed I/O intents remain queued; rejected validation or conflict intents clear so later edits and close proceed. */
export class SettingsEditQueue {
  private readonly pending: SettingsChange[] = [];
  private writing?: Promise<void>;

  constructor(private readonly writer: SettingsWriter) {}

  enqueue(change: SettingsChange): void {
    this.pending.push(change);
    // Background edits report through the writer. An explicit close/quit flush still rejects.
    void this.flush().catch(() => {});
  }

  flush(): Promise<void> {
    if (this.writing) return this.writing;
    const work = Promise.resolve()
      .then(async () => {
        while (this.pending.length) {
          const snapshot = this.writer.current();
          if (!snapshot) throw new Error('Settings have not finished loading.');
          try {
            const patches = this.pending[0]!(snapshot);
            if (patches.length)
              this.writer.accept(await this.writer.write(patches, snapshot.revision));
            this.pending.shift();
          } catch (error) {
            if (isRejectedEdit(error)) this.pending.shift();
            throw error;
          }
        }
      })
      .catch(async (error) => {
        this.writer.error(error instanceof Error ? error.message : String(error));
        try {
          this.writer.accept(await this.writer.refresh());
        } catch {
          // The original write failure remains the reason this flush cannot acknowledge.
        }
        throw error;
      })
      .finally(() => {
        if (this.writing === work) this.writing = undefined;
      });
    this.writing = work;
    return work;
  }
}
