import path from 'node:path';
import { realpath } from 'node:fs/promises';

export function previewContains(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
  );
}

/** Each in-flight request remembers invalidated roots until its canonical paths
 * are known. A late symlink resolution cannot resurrect revoked preview bytes. */
export class PreviewScope {
  private paths = new Set<string>();
  private invalidated = new Set<string>();
  private expired = false;
  private pending = new Set<Promise<void>>();
  constructor(files: readonly string[]) {
    for (const file of files) this.paths.add(path.resolve(file));
  }
  add(file: string): void {
    this.paths.add(path.resolve(file));
    this.check();
  }
  invalidate(root?: string, canonical?: Promise<string | undefined>): void {
    if (root) this.invalidated.add(path.resolve(root));
    else this.expired = true;
    if (canonical) {
      const pending = canonical
        .then((actual) => {
          if (actual) this.invalidated.add(path.resolve(actual));
        })
        .finally(() => this.pending.delete(pending));
      this.pending.add(pending);
    }
    // Fail closed rather than retaining an unbounded invalidation history.
    if (this.invalidated.size > 128) this.expired = true;
  }
  async finish(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
    this.check();
  }
  check(): void {
    if (
      this.expired ||
      [...this.invalidated].some((root) =>
        [...this.paths].some((file) => previewContains(root, file)),
      )
    )
      throw new Error('This preview request has expired.');
  }
}

export class PreviewWork {
  private tasks = new Map<Promise<unknown>, PreviewScope>();
  private closed = false;
  track<T>(files: readonly string[], run: (scope: PreviewScope) => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Preview resources have closed.'));
    if (this.tasks.size >= 512)
      return Promise.reject(
        new Error('Too many preview requests. Close some previews and try again.'),
      );
    const scope = new PreviewScope(files);
    const task = run(scope)
      .then(async (value) => {
        await scope.finish();
        return value;
      })
      .finally(() => this.tasks.delete(task));
    this.tasks.set(task, scope);
    return task;
  }
  invalidate(root?: string): Promise<string | undefined> {
    const canonical = root ? realpath(root).catch(() => root) : Promise.resolve(undefined);
    for (const scope of this.tasks.values()) scope.invalidate(root, root ? canonical : undefined);
    return canonical;
  }
  async drain(): Promise<void> {
    // Canonical paths may still be resolving. Wait for the bounded requests,
    // preserving independent resources and streams throughout that wait.
    await Promise.allSettled([...this.tasks.keys()]);
  }
  stop(): void {
    this.closed = true;
    this.invalidate();
  }
}
