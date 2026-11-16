export interface CheckedFolder {
  directory: boolean;
  path?: string;
  unavailable?: boolean;
}

export const folderCheckLimit = 40;
export const folderCheckConcurrency = 2;
export const folderCheckAbandonedLimit = 2;
export const folderCheckTimeout = 150;

export class FolderCheckTimeout extends Error {
  constructor() {
    super('Some folders could not be checked. Try again.');
  }
}

/** Timed-out reads retain a separate allowance, so a sleeping disk cannot occupy every lane. */
export class FolderCheckPool {
  private running = new Map<string, { work: Promise<CheckedFolder>; abandoned: boolean }>();
  private waiters = new Set<() => void>();
  private generation = 0;

  clear(): void {
    this.generation++;
  }

  async run(
    path: string,
    check: (path: string) => Promise<CheckedFolder>,
    signal: AbortSignal,
  ): Promise<CheckedFolder> {
    const deadline = performance.now() + folderCheckTimeout;
    const generation = this.generation;
    while (!signal.aborted && generation === this.generation) {
      const existing = this.running.get(path);
      if (existing) {
        if (existing.abandoned) throw new FolderCheckTimeout();
        return existing.work;
      }
      const tasks = [...this.running.values()];
      const active = tasks.filter((task) => !task.abandoned).length;
      if (active < folderCheckConcurrency && tasks.length < folderCheckConcurrency + folderCheckAbandonedLimit) {
        const task = { work: undefined as unknown as Promise<CheckedFolder>, abandoned: false };
        let timer: ReturnType<typeof setTimeout>;
        const raw = Promise.resolve().then(() => check(path));
        const done = () => {
          clearTimeout(timer);
          if (this.running.get(path) === task) this.running.delete(path);
          for (const waiter of this.waiters) waiter();
        };
        task.work = new Promise<CheckedFolder>((resolve, reject) => {
          timer = setTimeout(() => {
            task.abandoned = true;
            for (const waiter of this.waiters) waiter();
            reject(new FolderCheckTimeout());
          }, folderCheckTimeout);
          raw.then(resolve, reject).finally(done);
        });
        this.running.set(path, task);
        return task.work;
      }
      const remaining = deadline - performance.now();
      if (remaining <= 0) break;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let resume: (() => void) | undefined;
      const ready = await new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), remaining);
        resume = () => resolve(true);
        this.waiters.add(resume);
      });
      clearTimeout(timer);
      if (resume) this.waiters.delete(resume);
      if (!ready) break;
    }
    throw new FolderCheckTimeout();
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
      return await pool.run(path, check, signal);
    } catch (error) {
      if (error instanceof FolderCheckTimeout) {
        skipped.add(folderVolume(path) ?? '/');
        options.onIncomplete?.();
      }
      return undefined;
    }
  };
  const result = () => candidates.filter((path) => present.has(path)).slice(0, limit);
  await Promise.all(
    Array.from({ length: folderCheckConcurrency }, async () => {
      while (!signal.aborted && cursor < candidates.length && present.size < limit && checks < budget) {
        const path = candidates[cursor++]!;
        const volume = folderVolume(path);
        if (skipped.has(volume ?? '/')) continue;
        if (volume) {
          let mounted = volumes.get(volume);
          if (!mounted) {
            mounted = inspect(volume);
            volumes.set(volume, mounted);
          }
          if (!(await mounted)?.directory || skipped.has(volume)) continue;
        }
        const value = await inspect(path);
        if (signal.aborted) break;
        if (value) {
          options.onResult?.(path, value);
          if (value.unavailable) options.onIncomplete?.();
          if (value.directory) {
            present.add(path);
            options.onUpdate?.(result());
          }
        }
      }
    }),
  );
  if (cursor < candidates.length && present.size < limit) options.onIncomplete?.();
  return signal.aborted ? [] : result();
}
