import type { SettingsPatch, SettingsSnapshot } from '../../../domain/services';
import type { SettingsChange } from '../../ui/settings/settings-edits';

interface SettingsWriter {
  current(): SettingsSnapshot | undefined;
  write(patches: SettingsPatch[], revision: number): Promise<SettingsSnapshot>;
  refresh(): Promise<SettingsSnapshot>;
  accept(snapshot: SettingsSnapshot): void;
  error(message: string): void;
}

/** Failed intents remain queued; only their successful durable write advances the queue. */
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
          const patches = this.pending[0]!(snapshot);
          if (patches.length)
            this.writer.accept(await this.writer.write(patches, snapshot.revision));
          this.pending.shift();
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
