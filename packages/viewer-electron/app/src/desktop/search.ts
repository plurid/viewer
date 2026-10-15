import path from 'node:path';
import { opendir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import type { SearchRequest, SearchBatch, FileEntry } from '../domain/contracts';
import { absolute, entry } from './filesystem';

export class Search {
  private requests = new Map<string, AbortController>();
  private work = new Set<Promise<void>>();
  private closed = false;
  constructor(
    private emit: (batch: SearchBatch) => void,
    /** Spotlight lookup; absent where it cannot run (other platforms, the App Store build). */
    private spotlight:
      | ((root: string, query: string, signal: AbortSignal) => Promise<string[]>)
      | null = process.platform === 'darwin' && !process.mas ? spotlightNames : null,
  ) {}
  cancel(id: string): void {
    this.requests.get(id)?.abort();
  }
  async quiesce(): Promise<void> {
    for (const controller of this.requests.values()) controller.abort();
    await Promise.allSettled(this.work);
  }
  close(): Promise<void> {
    this.closed = true;
    return this.quiesce();
  }
  start(request: SearchRequest): void {
    if (this.closed) throw new Error('Folder search has closed.');
    this.cancel(request.id);
    const abort = new AbortController();
    this.requests.set(request.id, abort);
    const work = this.walk({ ...request, root: absolute(request.root) }, abort).finally(() => {
      if (this.requests.get(request.id) === abort) this.requests.delete(request.id);
      this.work.delete(work);
    });
    this.work.add(work);
    void work.catch(() => {});
  }
  private async walk(request: SearchRequest, abort: AbortController): Promise<void> {
    const queue = [request.root];
    const query = request.query.normalize('NFC').toLocaleLowerCase();
    let visited = 0,
      errors = 0,
      found = 0,
      truncated = false;
    let entries: FileEntry[] = [];
    let tick = Date.now();
    const flush = (done: boolean) => {
      this.emit({ id: request.id, entries, done, visited, errors, truncated });
      entries = [];
      tick = Date.now();
    };
    const matches = (name: string, relative: string) =>
      name.normalize('NFC').toLocaleLowerCase().includes(query) &&
      (request.showHidden || !relative.split(path.sep).some((part) => part.startsWith('.')));
    // Spotlight answers indexed folders almost at once; the walk below still completes the
    // list, because Spotlight cannot tell an unindexed folder from one without matches.
    const shown = new Set<string>();
    if (this.spotlight && query)
      try {
        for (const file of await this.spotlight(request.root, request.query, abort.signal)) {
          if (abort.signal.aborted || shown.size >= 2000) break;
          const relative = path.relative(request.root, file);
          if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
          if (!matches(path.basename(file), relative)) continue;
          try {
            entries.push(await entry(file));
            shown.add(file);
            found++;
          } catch {
            // The walk reports anything it cannot read.
          }
          if (entries.length >= 64) flush(false);
        }
        if (entries.length) flush(false);
      } catch {
        // Spotlight is only a shortcut; the walk is authoritative.
      }
    try {
      while (queue.length && !abort.signal.aborted) {
        const folder = queue.shift()!;
        try {
          const directory = await opendir(folder);
          for await (const child of directory) {
            if (abort.signal.aborted) break;
            if (!request.showHidden && child.name.startsWith('.')) continue;
            visited++;
            const file = path.join(folder, child.name);
            // Do not recurse through symlinks (cycles and unintended external trees).
            if (child.isDirectory()) queue.push(file);
            if (
              !shown.has(file) &&
              child.name.normalize('NFC').toLocaleLowerCase().includes(query)
            ) {
              try {
                entries.push(await entry(file));
                found++;
              } catch {
                errors++;
              }
            }
            if (entries.length >= 64 || Date.now() - tick > 150) flush(false);
            if (found >= 20000 || visited >= 500000) {
              truncated = true;
              queue.length = 0;
              break;
            }
          }
        } catch {
          errors++;
        }
      }
    } finally {
      flush(true);
    }
  }
}

/** File paths under `root` whose names contain `query`, from the Spotlight index. */
function spotlightNames(root: string, query: string, signal: AbortSignal): Promise<string[]> {
  return new Promise((resolve, reject) =>
    execFile(
      '/usr/bin/mdfind',
      ['-onlyin', root, '-name', query],
      { signal, timeout: 3000, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout.split('\n').filter(Boolean))),
    ),
  );
}
