import path from 'node:path';
import { opendir } from 'node:fs/promises';
import type { SearchRequest, SearchBatch, FileEntry } from '../domain/contracts';
import { absolute, entry } from './filesystem';

export class Search {
  private requests = new Map<string, AbortController>();
  constructor(private emit: (batch: SearchBatch) => void) {}
  cancel(id: string): void {
    this.requests.get(id)?.abort();
  }
  close(): void {
    for (const controller of this.requests.values()) controller.abort();
    this.requests.clear();
  }
  start(request: SearchRequest): void {
    this.cancel(request.id);
    const abort = new AbortController();
    this.requests.set(request.id, abort);
    void this.walk({ ...request, root: absolute(request.root) }, abort).finally(() => {
      if (this.requests.get(request.id) === abort) this.requests.delete(request.id);
    });
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
            if (child.name.normalize('NFC').toLocaleLowerCase().includes(query)) {
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
