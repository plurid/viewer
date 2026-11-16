import path from 'node:path';

type MetadataKind = 'folder' | 'access-list';
interface OutstandingRead {
  kind: MetadataKind;
  promise: Promise<unknown>;
}
function limited<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([work, new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('Sharing metadata timed out.'), { code: 'ETIMEDOUT' })), milliseconds);
  })]).finally(() => clearTimeout(timer));
}

/** Timeouts cannot release libuv workers, so retain outstanding work until it really finishes. */
export class SharingMetadata {
  private pending = new Map<string, OutstandingRead>();
  constructor(private readonly milliseconds = 700, private readonly maximum = 2) {}
  read<T>(kind: MetadataKind, file: string, work: () => Promise<T>): Promise<T> {
    const key = path.resolve(file);
    const existing = this.pending.get(key);
    if (existing) {
      return limited(existing.kind === kind
        ? existing.promise as Promise<T>
        : existing.promise.then(() => this.read(kind, key, work)), this.milliseconds);
    }
    if (this.pending.size >= this.maximum)
      return Promise.reject(Object.assign(new Error('Sharing metadata reads are busy.'), { code: 'EBUSY' }));
    const promise = Promise.resolve().then(work).finally(() => { this.pending.delete(key); });
    this.pending.set(key, { kind, promise });
    return limited(promise, this.milliseconds);
  }
}
