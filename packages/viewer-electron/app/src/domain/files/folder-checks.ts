export interface CheckedFolder {
  directory: boolean;
  path?: string;
  unavailable?: boolean;
  timedOut?: boolean;
}

export const folderCheckLimit = 40;
export const folderCheckConcurrency = 2;
// Reserving space for six unreturned reads leaves two lanes after four stalled reads.
export const folderCheckOutstandingLimit = 6;
export const folderCheckTimeout = 150;

export class FolderCheckTimeout extends Error {
  constructor() {
    super('Some folders could not be checked. Try again.');
  }
}

/** Timed-out reads retain a separate allowance, so a sleeping disk cannot occupy every lane. */
export class FolderCheckBusy extends Error {
  constructor() {
    super('Some folders could not be checked. Try again.');
  }
}
export class FolderCheckCancelled extends Error {
  constructor() {
    super('Folder checking cancelled.');
  }
}

export class FolderCheckPool {
  private running = new Map<
    string,
    { work: Promise<CheckedFolder>; abandoned: boolean; failure?: Error }
  >();
  private waiters = new Set<() => void>();
  private generation = 0;

  constructor(private options: { timeout?: false } = {}) {}

  clear(): void {
    this.generation++;
    for (const waiter of this.waiters) waiter();
  }

  async run(
    path: string,
    check: (path: string) => Promise<CheckedFolder>,
    signal: AbortSignal,
  ): Promise<CheckedFolder> {
    const generation = this.generation;
    while (!signal.aborted && generation === this.generation) {
      const existing = this.running.get(path);
      if (existing) {
        if (existing.abandoned) throw existing.failure ?? new FolderCheckBusy();
        return existing.work;
      }
      const active = [...this.running.values()].filter((task) => !task.abandoned).length;
      if (active < folderCheckConcurrency && this.running.size < folderCheckOutstandingLimit) {
        const task = {
          work: undefined as unknown as Promise<CheckedFolder>,
          abandoned: false,
          failure: undefined as Error | undefined,
        };
        let timer: ReturnType<typeof setTimeout> | undefined;
        let abort: (() => void) | undefined;
        const raw = Promise.resolve().then(() => {
          if (signal.aborted) throw new FolderCheckCancelled();
          return check(path);
        });
        task.work = new Promise<CheckedFolder>((resolve, reject) => {
          const abandon = (error: Error) => {
            task.abandoned = true;
            task.failure = error;
            for (const waiter of this.waiters) waiter();
            reject(error);
          };
          if (this.options.timeout !== false)
            timer = setTimeout(() => abandon(new FolderCheckTimeout()), folderCheckTimeout);
          abort = () => abandon(new FolderCheckCancelled());
          signal.addEventListener('abort', abort, { once: true });
          raw.then(resolve, reject).finally(() => {
            clearTimeout(timer);
            if (abort) signal.removeEventListener('abort', abort);
            if (this.running.get(path) === task) this.running.delete(path);
            for (const waiter of this.waiters) waiter();
          });
        });
        this.running.set(path, task);
        return task.work;
      }
      if (!active && this.running.size >= folderCheckOutstandingLimit) throw new FolderCheckBusy();
      let resume: (() => void) | undefined;
      let abort: (() => void) | undefined;
      try {
        await new Promise<void>((resolve) => {
          resume = resolve;
          abort = resolve;
          this.waiters.add(resume);
          signal.addEventListener('abort', abort, { once: true });
        });
      } finally {
        if (resume) this.waiters.delete(resume);
        if (abort) signal.removeEventListener('abort', abort);
      }
    }
    throw new FolderCheckCancelled();
  }
}

export function folderVolume(path: string): string | undefined {
  return /^(\/Volumes\/[^/]+)(?:\/|$)/.exec(path)?.[1];
}

/** Scan past unavailable volumes and publish successes without waiting for slower siblings. */
export async function checkFolderCandidates(
  paths: readonly string[],
  check: (path: string) => Promise<CheckedFolder>,
  signal: AbortSignal,
  options: {
    limit?: number;
    checks?: number;
    pool?: FolderCheckPool;
    onResult?(path: string, value: CheckedFolder): void;
    onUpdate?(paths: string[]): void;
    onIncomplete?(): void;
  } = {},
): Promise<string[]> {
  const candidates = paths.slice(0, 500);
  const present = new Set<string>();
  const settled = new Set<string>();
  let released = false;
  const skipped = new Set<string>();
  const volumes = new Map<string, Promise<CheckedFolder | undefined>>();
  const pool = options.pool ?? new FolderCheckPool();
  let cursor = 0;
  let checks = 0;
  const limit = options.limit ?? 8;
  const budget = options.checks ?? folderCheckLimit;
  const inspect = async (path: string) => {
    if (signal.aborted || checks >= budget) return undefined;
    checks++;
    try {
      const value = await pool.run(path, check, signal);
      if (value.unavailable) options.onIncomplete?.();
      return value;
    } catch (error) {
      const volume = folderVolume(path);
      if (error instanceof FolderCheckTimeout && volume) skipped.add(volume);
      options.onIncomplete?.();
      return undefined;
    }
  };
  const result = () => candidates.filter((path) => present.has(path)).slice(0, limit);
  const publish = () => {
    const boundary = released
      ? candidates.length
      : candidates.findIndex((path) => !settled.has(path));
    const prefix = boundary < 0 ? candidates : candidates.slice(0, boundary);
    options.onUpdate?.(prefix.filter((path) => present.has(path)).slice(0, limit));
  };
  const release = setTimeout(() => {
    released = true;
    publish();
  }, folderCheckTimeout);
  await Promise.all(
    Array.from({ length: folderCheckConcurrency }, async () => {
      while (
        !signal.aborted &&
        cursor < candidates.length &&
        present.size < limit &&
        checks < budget
      ) {
        const path = candidates[cursor++]!;
        const volume = folderVolume(path);
        if (volume && skipped.has(volume)) {
          settled.add(path);
          publish();
          continue;
        }
        if (volume) {
          let mounted = volumes.get(volume);
          if (!mounted) {
            mounted = inspect(volume);
            volumes.set(volume, mounted);
          }
          if (!(await mounted)?.directory || skipped.has(volume)) {
            settled.add(path);
            publish();
            continue;
          }
        }
        const value = await inspect(path);
        if (signal.aborted) break;
        if (value) {
          options.onResult?.(path, value);
          if (value.unavailable) options.onIncomplete?.();
          if (value.timedOut && volume) skipped.add(volume);
          if (value.directory) {
            present.add(path);
            settled.add(path);
            publish();
          }
        }
        settled.add(path);
        publish();
      }
    }),
  );
  clearTimeout(release);
  if (cursor < candidates.length && present.size < limit) options.onIncomplete?.();
  return signal.aborted ? [] : result();
}
