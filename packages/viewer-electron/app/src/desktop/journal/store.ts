import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import {
  journalQuerySchema,
  journalRecordSchema,
  matchesJournal,
  type JournalPage,
  type JournalQuery,
  type JournalRecord,
  type JournalStatus,
} from '../../domain/journal/events';

type EventInput = Omit<
  JournalRecord,
  'version' | 'id' | 'sessionID' | 'sequence' | 'at' | 'producer' | 'level'
>;

export interface JournalLimits {
  bytes: number;
  records: number;
  pending: number;
}

const defaultLimits: JournalLimits = { bytes: 8 * 1024 * 1024, records: 10_000, pending: 256 };

/** Append-only projection. A damaged/full store is preserved and never blocks the observed action. */
export class JournalStore {
  readonly file: string;
  private readonly sessionID = randomUUID();
  private generation = randomUUID();
  private readonly limits: JournalLimits;
  private readonly ready: Promise<void>;
  private handle?: FileHandle;
  private identity?: string;
  private records: JournalRecord[] = [];
  private pending: { record: JournalRecord; line: string }[] = [];
  private bytes = 0;
  private latest = 0;
  private dropped = 0;
  private state: JournalStatus['state'] = 'ready';
  private writing?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private notifying?: ReturnType<typeof setTimeout>;
  private closed = false;
  private clearing?: Promise<boolean>;

  constructor(
    directory: string,
    private readonly changed: () => void = () => {},
    limits: Partial<JournalLimits> = {},
  ) {
    this.file = path.join(directory, 'events.jsonl');
    this.limits = { ...defaultLimits, ...limits };
    this.ready = this.load().catch(() => {
      this.state = 'unavailable';
    });
  }

  private async load(): Promise<void> {
    const directory = path.dirname(this.file);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    const expected = path.join(await realpath(path.dirname(directory)), path.basename(directory));
    if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(directory)) !== expected)
      throw new Error('Journal directory must be a private ordinary directory.');
    this.handle = await open(
      this.file,
      constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const file = await this.handle.stat();
      if (!file.isFile() || file.nlink !== 1 || file.mode & 0o077 || file.size > this.limits.bytes)
        throw new Error('Journal file is not a private bounded regular file.');
      this.identity = `${file.dev}:${file.ino}`;
      this.bytes = file.size;
      const buffer = Buffer.alloc(file.size);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await this.handle.read(
          buffer,
          offset,
          buffer.length - offset,
          offset,
        );
        if (!bytesRead) throw new Error('Journal changed while reading.');
        offset += bytesRead;
      }
      const text = buffer.toString('utf8');
      for (const line of text.split('\n').slice(0, -1)) {
        if (this.records.length >= this.limits.records || line.length > 4096)
          throw new Error('Journal exceeds its record limit.');
        const record = journalRecordSchema.parse(JSON.parse(line));
        if (record.sequence <= this.latest) throw new Error('Journal sequence is damaged.');
        this.records.push(record);
        this.latest = record.sequence;
      }
      if (text && !text.endsWith('\n')) throw new Error('Journal has an incomplete final record.');
      await this.checkFile();
      if (this.bytes >= this.limits.bytes || this.records.length >= this.limits.records)
        this.state = 'full';
    } catch (error) {
      await this.handle.close();
      this.handle = undefined;
      throw error;
    }
  }

  private async checkFile(): Promise<void> {
    const file = await lstat(this.file);
    if (
      !file.isFile() ||
      file.isSymbolicLink() ||
      file.nlink !== 1 ||
      `${file.dev}:${file.ino}` !== this.identity ||
      file.size !== this.bytes ||
      file.mode & 0o077
    )
      throw new Error('Journal file changed. It was preserved.');
  }

  /** Input is copied and validated synchronously; no renderer can append to this service. */
  record(input: EventInput): void {
    if (this.closed) return;
    try {
      if (this.state !== 'ready' || this.pending.length >= this.limits.pending) {
        this.dropped += 1;
        this.notify();
        return;
      }
      // Sequence assignment waits for load, so startup and restored history cannot collide.
      const record = journalRecordSchema.parse({
        ...input,
        version: 1,
        id: randomUUID(),
        sessionID: this.sessionID,
        sequence: 1,
        at: Date.now(),
        producer: 'desktop',
        level: input.phase === 'failed' ? 'error' : input.phase === 'waiting' ? 'warning' : 'info',
      });
      const line = JSON.stringify(record) + '\n';
      this.pending.push({ record, line });
      if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = undefined;
          void this.flush();
        }, 30);
        this.timer.unref();
      }
    } catch {
      this.dropped += 1;
      this.notify();
    }
  }

  private notify(): void {
    if (this.notifying || this.closed) return;
    this.notifying = setTimeout(() => {
      this.notifying = undefined;
      try {
        this.changed();
      } catch {
        /* A broken observer cannot stop ingestion. */
      }
    }, 100);
    this.notifying.unref();
  }

  status(): JournalStatus {
    return {
      generation: this.generation,
      latest: this.latest,
      stored: this.records.length,
      bytes: this.bytes,
      byteLimit: this.limits.bytes,
      recordLimit: this.limits.records,
      dropped: this.dropped,
      state: this.state,
    };
  }

  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    return (this.writing ??= this.drain().finally(() => {
      this.writing = undefined;
    }));
  }

  private async drain(): Promise<void> {
    await this.ready;
    while (this.pending.length) {
      const batch = this.pending.splice(0);
      for (const item of batch) {
        if (this.state !== 'ready' || !this.handle) {
          this.dropped += 1;
          continue;
        }
        item.record.sequence = this.latest + 1;
        item.line = JSON.stringify(item.record) + '\n';
        const size = Buffer.byteLength(item.line);
        if (this.bytes + size > this.limits.bytes || this.records.length >= this.limits.records) {
          this.state = 'full';
          this.dropped += 1;
          continue;
        }
        try {
          await this.checkFile();
          await this.handle.writeFile(item.line);
          this.bytes += size;
          this.latest = item.record.sequence;
          this.records.push(item.record);
        } catch {
          // A partial append is kept for inspection; never append behind a damaged tail.
          this.state = 'unavailable';
          this.dropped += 1;
        }
      }
      this.notify();
    }
  }

  async query(input: JournalQuery): Promise<JournalPage> {
    const query = journalQuerySchema.parse(input);
    await this.ready;
    const through = Math.min(query.through ?? this.latest, this.latest);
    const records: JournalRecord[] = [];
    let matched = 0;
    let older = false;
    for (let index = this.records.length - 1; index >= 0; index -= 1) {
      const record = this.records[index]!;
      if (record.sequence > through || !matchesJournal(record, query.filter)) continue;
      matched += 1;
      if (query.before !== undefined && record.sequence >= query.before) continue;
      if (records.length < query.limit) records.push(record);
      else older = true;
    }
    return {
      records: structuredClone(records),
      through,
      matched,
      status: this.status(),
      ...(older ? { nextBefore: records.at(-1)!.sequence } : {}),
    };
  }

  /** The caller supplies native exact-file review and identity-checked OS Trash. */
  clear(reviewAndTrash: (file: string) => Promise<boolean>): Promise<boolean> {
    if (this.closed || this.clearing) return Promise.reject(new Error('Journal is busy.'));
    return (this.clearing = this.clearRecords(reviewAndTrash).finally(() => {
      this.clearing = undefined;
    }));
  }

  private async clearRecords(reviewAndTrash: (file: string) => Promise<boolean>): Promise<boolean> {
    await this.flush();
    if (this.closed || this.state === 'clearing') throw new Error('Journal is busy.');
    const before = this.state;
    this.state = 'clearing';
    this.notify();
    try {
      await this.handle?.close();
      this.handle = undefined;
      if (!(await reviewAndTrash(this.file))) {
        this.records = [];
        this.latest = 0;
        await this.load();
        this.state = before;
        return false;
      }
      this.records = [];
      this.bytes = 0;
      this.dropped = 0;
      this.generation = randomUUID();
      await this.load();
      this.state = 'ready';
      return true;
    } catch (error) {
      this.state = 'unavailable';
      throw error;
    } finally {
      this.notify();
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.notifying) clearTimeout(this.notifying);
    await this.clearing?.catch(() => {});
    await this.flush();
    await this.handle?.close();
    this.handle = undefined;
  }
}
