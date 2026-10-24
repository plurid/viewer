import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher as RecursiveWatcher } from 'chokidar';

export interface DirectoryWatch {
  close(): Promise<void>;
}

/** macOS directory watches use FSEvents, without opening every descendant file.
 * Shallow plane watches need only one directory handle on every platform.
 * Linux retains Chokidar's recursive normalization until its native backend is verified. */
export function watchDirectory(
  folder: string,
  options: {
    recursive?: boolean;
    ignored?(file: string): boolean;
    changed(file: string): void;
    failed(error: Error): void;
  },
): DirectoryWatch {
  let native: FSWatcher | undefined;
  let fallback: RecursiveWatcher | undefined;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closing) return closing;
    // Mark ownership retired before either backend can emit another event.
    closing = Promise.resolve();
    native?.close();
    return (closing = fallback?.close() ?? closing);
  };
  const failed = (error: unknown) => {
    if (closing) return;
    // A partially initialized recursive watch must release its handles too.
    void close();
    options.failed(error instanceof Error ? error : new Error(String(error)));
  };
  const changed = (file: string) => {
    if (closing || options.ignored?.(file)) return;
    const relative = path.relative(folder, file);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
      return;
    options.changed(file);
  };
  try {
    if (!options.recursive || process.platform === 'darwin' || process.platform === 'win32') {
      native = watch(folder, { recursive: options.recursive ?? false }, (_event, filename) => {
        // Missing filenames are a request to reconcile the directory, never to
        // ignore a change. Index updates infer additions/removals from disk.
        changed(filename ? path.resolve(folder, filename) : folder);
      });
      native.on('error', failed);
    } else {
      fallback = chokidar.watch(folder, {
        ignoreInitial: true,
        followSymlinks: false,
        ignored: options.ignored,
        awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
      });
      fallback.on('all', (_event, file) => changed(file));
      fallback.on('error', failed);
    }
  } catch (error) {
    // Callers install shared ownership immediately after this function returns.
    queueMicrotask(() => failed(error));
  }
  return { close };
}
