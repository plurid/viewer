interface PendingWrite<Value> {
  value: Value;
  revision: number;
  persisted: number;
  work?: Promise<void>;
}

/**
 * Owns dirty revisions independently of debounce timers. Flush joins existing writes and
 * includes edits received while they run; failures retain the latest retryable value.
 */
export class RevisionedWriteQueue<Key, Value> {
  private readonly pending = new Map<Key, PendingWrite<Value>>();
  private readonly removals = new Map<Key, Promise<void>>();

  constructor(private readonly write: (key: Key, value: Value) => Promise<void>) {}

  /** A retiring document cannot be resurrected by a stale component's final callback. */
  put(key: Key, value: Value): boolean {
    if (this.removals.has(key)) return false;
    const entry = this.pending.get(key);
    if (entry) {
      entry.value = value;
      entry.revision++;
    } else {
      this.pending.set(key, { value, revision: 1, persisted: 0 });
    }
    return true;
  }

  flushKey(key: Key): Promise<void> {
    const removal = this.removals.get(key);
    if (removal) return removal;
    const entry = this.pending.get(key);
    if (!entry) return Promise.resolve();
    if (entry.work) return entry.work;

    const work = Promise.resolve()
      .then(async () => {
        while (entry.persisted < entry.revision && !this.removals.has(key)) {
          const { value, revision } = entry;
          await this.write(key, value);
          entry.persisted = revision;
        }
      })
      .finally(() => {
        entry.work = undefined;
        if (entry.persisted === entry.revision && this.pending.get(key) === entry)
          this.pending.delete(key);
      });
    entry.work = work;
    return work;
  }

  async flush(): Promise<void> {
    // New documents and revisions may arrive while another document is being saved.
    while (this.pending.size || this.removals.size) {
      const keys = new Set([...this.pending.keys(), ...this.removals.keys()]);
      await Promise.all([...keys].map((key) => this.flushKey(key)));
    }
  }

  /** Serialize an explicit discard after any write already using the same document. */
  retire(key: Key, remove: () => Promise<void>): Promise<void> {
    const existing = this.removals.get(key);
    if (existing) return existing;
    const entry = this.pending.get(key);
    const work = Promise.resolve()
      .then(async () => {
        // A failed draft save does not prevent the person from choosing Don't Save.
        await entry?.work?.catch(() => {});
        await remove();
        if (this.pending.get(key) === entry) this.pending.delete(key);
      })
      .finally(() => {
        if (this.removals.get(key) === work) this.removals.delete(key);
      });
    this.removals.set(key, work);
    return work;
  }
}
