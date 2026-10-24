import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { lstat, stat, realpath } from 'node:fs/promises';
import { macFiles, type FileAccessIntent, type MacFiles } from '../native/macos-files';

type Binding = Pick<
  MacFiles,
  'coordinateStart' | 'coordinateCancel' | 'coordinateEnd' | 'coordinateSameItem'
>;
interface Claim {
  intents: FileAccessIntent[];
  canonical: Promise<string[]>;
  resolved: Map<string, string>;
  depth: number;
  purpose: string;
  abort: AbortController;
  done: Promise<void>;
}
const contains = (parent: string, file: string) => {
  const relative = path.relative(parent, file);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
  );
};
async function canonical(file: string): Promise<string> {
  try {
    return await realpath(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || path.dirname(file) === file)
      return file;
    return path.join(await canonical(path.dirname(file)), path.basename(file));
  }
}
const canonicalItem = async (file: string) =>
  path.join(await canonical(path.dirname(file)), path.basename(file));
async function sameItem(original: string, returned: string, native: Binding): Promise<boolean> {
  const actual = await canonicalItem(returned);
  if (actual === original) return true;
  if (actual.normalize('NFC') !== original.normalize('NFC')) return false;
  // APFS/HFS may return decomposed Unicode. Accept that spelling only when
  // both names still identify the same item, preserving a symlink as the leaf.
  const [before, after] = await Promise.all([
    lstat(original).catch(() => null),
    lstat(returned).catch(() => null),
  ]);
  if (before && after) return before.dev === after.dev && before.ino === after.ino;
  return native.coordinateSameItem(original, returned);
}

/** OS coordination complements native permission; it never grants access.
 * Content claims live until readers/streams/writers close. Folder metadata does
 * not request a download. A moved URL is rejected before any captured mutation.
 */
export class FileCoordination {
  private active = new Map<string, Claim>();
  private context = new AsyncLocalStorage<Claim>();
  private closed = false;
  constructor(
    private native: (() => Binding) | undefined = process.platform === 'darwin'
      ? macFiles
      : undefined,
    private waitMilliseconds = 120000,
  ) {}
  purpose(): string | undefined {
    return this.context.getStore()?.purpose;
  }
  path(file: string): string {
    return this.context.getStore()?.resolved.get(path.resolve(file)) ?? file;
  }
  async acquire(intents: FileAccessIntent[], signal?: AbortSignal) {
    if (this.closed) throw new Error('File coordination has closed.');
    signal?.throwIfAborted();
    if (!this.native || !intents.length)
      return {
        signal,
        path: (file: string) => file,
        release: async () => {},
        run: <T>(work: () => Promise<T>) => work(),
      };
    if (intents.length > 2 || this.active.size >= 128)
      throw new Error('Too many pending file provider requests.');
    const normalized = intents.map((intent) => {
      if (!path.isAbsolute(intent.path) || intent.path.includes('\0'))
        throw new Error('Choose an absolute file coordination path.');
      return { ...intent, path: path.resolve(intent.path) };
    });
    if (
      normalized.length === 2 &&
      normalized.every((intent) => ['read', 'metadata'].includes(intent.mode))
    )
      throw new Error(
        'Coordinate independent readers separately or declare a source/destination pair.',
      );
    const parent = this.context.getStore();
    if (
      parent &&
      normalized.every((intent) =>
        parent.intents.some(
          (outer) =>
            (outer.path === intent.path || parent.resolved.get(outer.path) === intent.path) &&
            (outer.mode === intent.mode || outer.mode === 'write'),
        ),
      )
    ) {
      parent.abort.signal.throwIfAborted();
      return {
        signal: parent.abort.signal,
        path: (file: string) => parent.resolved.get(path.resolve(file)) ?? file,
        release: async () => {},
        run: <T>(work: () => Promise<T>) => work(),
      };
    }
    // A case-only rename needs one private intermediate path. Reuse its purpose
    // and bound that extra claim; unbounded nesting can exhaust accessor threads.
    if (parent && parent.depth >= 1)
      throw new Error('Declare all coordinated file paths before starting the operation.');
    if (parent)
      signal = signal ? AbortSignal.any([signal, parent.abort.signal]) : parent.abort.signal;
    // NSFileCoordinator can wait for a FIFO writer before our descriptor reader
    // runs. Reject existing special sources before entering that native wait.
    // A missing provider item may still materialize in its accessor; the reader
    // must validate its opened descriptor as well.
    for (const intent of normalized.filter((intent) => intent.mode === 'read')) {
      let info = await lstat(intent.path).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      });
      if (info?.isSymbolicLink())
        info = await stat(intent.path).catch((error) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw error;
        });
      if (info && !info.isFile() && !info.isDirectory())
        throw new Error('File content coordination requires a regular file, folder or link.');
    }
    if (this.closed) throw new Error('File coordination has closed.');
    if (this.active.size >= 128) throw new Error('Too many pending file provider requests.');
    signal?.throwIfAborted();
    const id = randomUUID(),
      native = this.native(),
      abort = new AbortController();
    let settled!: () => void;
    const claim: Claim = {
      intents: normalized,
      canonical: Promise.all(normalized.map((intent) => canonicalItem(intent.path))),
      resolved: new Map(),
      depth: parent ? parent.depth + 1 : 0,
      purpose: parent?.purpose ?? 'com.pluridviewer.app.' + id,
      abort,
      done: new Promise<void>((resolve) => {
        settled = resolve;
      }),
    };
    this.active.set(id, claim);
    const cancel = () => {
      abort.abort(signal?.reason);
    };
    signal?.addEventListener('abort', cancel, { once: true });
    const nativeCancel = () => native.coordinateCancel(id);
    abort.signal.addEventListener('abort', nativeCancel, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, this.waitMilliseconds);
    let released: Promise<void> | undefined;
    const release = () =>
      (released ??= (async () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        abort.signal.removeEventListener('abort', nativeCancel);
        try {
          await native.coordinateEnd(id);
        } finally {
          this.active.delete(id);
          settled();
        }
      })());
    try {
      abort.signal.throwIfAborted();
      const paths = await native.coordinateStart(id, normalized, claim.purpose, !!parent);
      clearTimeout(timer);
      if (timedOut)
        throw new Error(
          'The file provider did not make this item available in time. Check its connection, then retry.',
        );
      abort.signal.throwIfAborted();
      if (paths.length !== normalized.length)
        throw new Error(
          'The item moved while waiting for its file provider. Refresh the folder and retry.',
        );
      const originals = await claim.canonical;
      for (const [index, returned] of paths.entries()) {
        const file = path.resolve(returned);
        const requested = normalized[index],
          original = originals[index];
        // Anything that cannot be matched to its request counts as moved.
        if (
          !requested ||
          (file !== requested.path && !(original && (await sameItem(original, file, native))))
        )
          throw new Error(
            'The item moved while waiting for its file provider. Refresh the folder and retry.',
          );
        claim.resolved.set(requested.path, file);
      }
      abort.signal.throwIfAborted();
      return {
        signal: abort.signal,
        path: (file: string) => claim.resolved.get(path.resolve(file)) ?? file,
        release,
        run: <T>(work: () => Promise<T>) => this.context.run(claim, work),
      };
    } catch (error) {
      await release();
      if (timedOut)
        throw new Error(
          'The file provider did not make this item available in time. Check its connection, then retry.',
        );
      throw error;
    }
  }
  async run<T>(
    intents: FileAccessIntent[],
    work: (signal?: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const claim = await this.acquire(intents, signal);
    try {
      return await claim.run(() => work(claim.signal));
    } finally {
      await claim.release();
    }
  }
  async quiesce(root?: string): Promise<void> {
    const claims = [...this.active.values()],
      normalized = root && path.resolve(root),
      actual = normalized && (await canonical(normalized));
    const pending: Claim[] = [];
    for (const claim of claims) {
      const aliases = await claim.canonical;
      if (
        !normalized ||
        claim.intents.some((intent) => contains(normalized, intent.path)) ||
        aliases.some((file) => contains(actual!, file))
      )
        pending.push(claim);
    }
    for (const claim of pending) claim.abort.abort();
    await Promise.all(pending.map((claim) => claim.done));
  }
  async close(): Promise<void> {
    this.closed = true;
    await this.quiesce();
  }
}
export const fileCoordination = new FileCoordination();
