import { lstat, opendir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { FolderSizeTask } from '../domain/metadata';
import { absolute } from './filesystem';

/** Read-only logical contents sizes. Never opens file contents or follows symbolic links. */
export class FolderSizes {
  private tasks = new Map<string, FolderSizeTask>();
  private active = new Map<string, AbortController>();
  constructor(private emit: (task: FolderSizeTask) => void) {}
  start(sources: string[]): FolderSizeTask {
    const paths = [...new Set(sources.map(absolute))].sort();
    for (const task of this.tasks.values()) {
      if (
        task.status === 'running' &&
        task.paths.length === paths.length &&
        task.paths.every((file, index) => file === paths[index])
      )
        return { ...task };
    }
    if (this.active.size >= 2)
      throw new Error('Finish or cancel an existing size calculation first.');
    const chosen = new Set(paths);
    const roots = paths.filter((file) => {
      for (
        let parent = path.dirname(file);
        parent !== path.dirname(parent);
        parent = path.dirname(parent)
      )
        if (chosen.has(parent)) return false;
      return !chosen.has(path.parse(file).root) || file === path.parse(file).root;
    });
    const task: FolderSizeTask = {
      id: randomUUID(),
      paths,
      status: 'running',
      bytes: 0,
      files: 0,
      folders: 0,
      skipped: 0,
    };
    const abort = new AbortController();
    this.tasks.set(task.id, task);
    this.active.set(task.id, abort);
    this.emit({ ...task });
    void this.measure(task, roots, abort.signal);
    for (const [id, item] of this.tasks) {
      if (this.tasks.size <= 64) break;
      if (item.status !== 'running') this.tasks.delete(id);
    }
    return { ...task };
  }
  get(id: string): FolderSizeTask {
    const task = this.tasks.get(id);
    if (!task) throw new Error('This size calculation is no longer available.');
    return { ...task };
  }
  cancel(id: string) {
    this.active.get(id)?.abort();
  }
  close() {
    for (const abort of this.active.values()) abort.abort();
  }
  private async measure(task: FolderSizeTask, roots: string[], signal: AbortSignal) {
    let last = performance.now();
    const progress = () => {
      if (performance.now() - last >= 100) {
        last = performance.now();
        this.emit({ ...task });
      }
    };
    const directories: string[] = [];
    const inspect = async (file: string) => {
      if (signal.aborted) return;
      try {
        const info = await lstat(file);
        if (signal.aborted) return;
        if (info.isDirectory()) {
          task.folders++;
          directories.push(file);
        } else if (info.isFile() || info.isSymbolicLink()) {
          task.files++;
          task.bytes += info.size;
        } else task.skipped++;
      } catch {
        if (signal.aborted) return;
        task.skipped++;
      }
      progress();
    };
    try {
      for (const root of roots) await inspect(root);
      while (directories.length) {
        signal.throwIfAborted();
        const folder = directories.pop()!;
        try {
          const directory = await opendir(folder);
          let batch: Promise<void>[] = [];
          for await (const item of directory) {
            signal.throwIfAborted();
            batch.push(inspect(path.join(folder, item.name)));
            if (batch.length === 8) {
              await Promise.all(batch);
              batch = [];
            }
          }
          await Promise.all(batch);
        } catch (error) {
          if (signal.aborted) throw error;
          task.skipped++;
        }
      }
      signal.throwIfAborted();
      task.status = 'completed';
      task.measuredAt = Date.now();
    } catch (error) {
      task.status = signal.aborted ? 'cancelled' : 'failed';
      if (!signal.aborted) task.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.active.delete(task.id);
      this.emit({ ...task });
    }
  }
}
