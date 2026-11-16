import path from 'node:path';

type MetadataKind = 'folder' | 'access-list';
interface OutstandingRead {
  kind: MetadataKind;
  promise: Promise<unknown>;
}
function limited<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(Object.assign(new Error('Sharing metadata timed out.'), { code: 'ETIMEDOUT' })),
        milliseconds,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Timeouts cannot release libuv workers, so retain outstanding work until it really finishes. */
export class SharingMetadata {
  private pending = new Map<string, OutstandingRead>();
  private queue: (() => void)[] = [];
  private active = 0;
  constructor(
    private readonly milliseconds = 700,
    private readonly maximum = 2,
  ) {}
  read<T>(kind: MetadataKind, file: string, work: () => Promise<T>): Promise<T> {
    const key = path.resolve(file);
    const existing = this.pending.get(key);
    if (existing) {
      if (existing.kind === kind) return limited(existing.promise as Promise<T>, this.milliseconds);
      let waiting = true;
      const next = existing.promise.then(() => {
        if (!waiting)
          throw Object.assign(new Error('Sharing metadata timed out.'), { code: 'ETIMEDOUT' });
        return this.read(kind, key, work);
      });
      return limited(next, this.milliseconds).finally(() => {
        waiting = false;
      });
    }
    let started = false;
    let begin: () => void;
    let cancel: (error: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
      cancel = reject;
      begin = () => {
        started = true;
        this.active++;
        void Promise.resolve().then(work).then(resolve, reject);
      };
    }).finally(() => {
      this.pending.delete(key);
      if (started) this.active--;
      this.drain();
    });
    this.pending.set(key, { kind, promise });
    this.queue.push(begin!);
    this.drain();
    return limited(promise, this.milliseconds).catch((error: unknown) => {
      if (!started) {
        this.queue = this.queue.filter((item) => item !== begin);
        cancel(error);
      }
      throw error;
    });
  }
  private drain(): void {
    while (this.active < this.maximum && this.queue.length) this.queue.shift()!();
  }
}
