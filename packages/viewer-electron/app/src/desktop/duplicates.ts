import { readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { entry, absolute } from './filesystem';
import { fileCoordination } from './file-coordination';
import { contentHash } from './content-hash';
import { duplicateGroups, type DuplicateResult } from '../domain/duplicates';
import type { FileEntry } from '../domain/contracts';

const maximumFiles = 100_000;
const headBytes = 64 * 1024;

/**
 * Read-only duplicate detection. It never follows symbolic links, compares only
 * regular files of the same size, and confirms with full SHA-256 after a quick
 * comparison of their first 64 KB. It reports; it never removes anything.
 */
export class Duplicates {
  private running = new Map<string, AbortController>();
  constructor(private access: (files: readonly string[]) => Promise<void>) {}
  cancel(id: string): void {
    this.running.get(id)?.abort();
  }
  close(): void {
    for (const abort of this.running.values()) abort.abort();
  }
  async run(id: string, roots: readonly string[]): Promise<DuplicateResult> {
    if (this.running.has(id)) throw new Error('This search is already running.');
    if (this.running.size >= 1) throw new Error('Wait for the other duplicate search to finish.');
    // Registered before any await, so a cancellation that arrives early is not lost.
    const abort = new AbortController();
    this.running.set(id, abort);
    const timer = setTimeout(
      () => abort.abort(new Error('The duplicate search exceeded its time budget.')),
      300_000,
    );
    const result: DuplicateResult = {
      id,
      roots: [],
      groups: [],
      scanned: 0,
      coverage: 'complete',
      errors: [],
      created: Date.now(),
    };
    const fail = (file: string, error: unknown) => {
      abort.signal.throwIfAborted();
      if (result.errors.length < 1000)
        result.errors.push({ path: file, message: (error as Error).message });
      result.coverage = 'partial';
    };
    try {
      await this.access(roots);
      const canonical = [
        ...new Set(await Promise.all(roots.map((root) => realpath(absolute(root))))),
      ];
      abort.signal.throwIfAborted();
      result.roots = canonical;
      const bySize = new Map<number, FileEntry[]>();
      const queue = canonical.map((file) => ({ file, depth: 0 }));
      const visited = new Set<string>();
      for (let index = 0; index < queue.length; index++) {
        const { file, depth } = queue[index];
        abort.signal.throwIfAborted();
        try {
          await this.access([file]);
          const folder = await entry(file);
          // Overlapping roots, or a folder reached twice, are scanned once.
          if (visited.has(folder.identity)) continue;
          visited.add(folder.identity);
          const names = await fileCoordination.run(
            [{ path: file, mode: 'read' }],
            () => readdir(fileCoordination.path(file)),
            abort.signal,
          );
          for (const name of names) {
            if (result.scanned >= maximumFiles) {
              result.coverage = 'partial';
              break;
            }
            const child = path.join(file, name);
            try {
              const item = await entry(child);
              if (item.kind === 'directory') {
                if (depth < 64) queue.push({ file: child, depth: depth + 1 });
                else result.coverage = 'partial';
              } else if (item.kind === 'file' && item.size > 0) {
                result.scanned++;
                const same = bySize.get(item.size) ?? [];
                same.push(item);
                bySize.set(item.size, same);
              }
            } catch (error) {
              fail(child, error);
            }
          }
        } catch (error) {
          fail(file, error);
        }
      }
      const hashed: { file: FileEntry; hash: string }[] = [];
      for (const candidates of bySize.values()) {
        if (candidates.length < 2) continue;
        // A quick head comparison avoids reading files that already differ.
        const heads = new Map<string, FileEntry[]>();
        for (const file of candidates)
          try {
            const head =
              file.size <= headBytes
                ? await contentHash(file, this.access, abort.signal)
                : await contentHash(file, this.access, abort.signal, headBytes);
            heads.set(head, [...(heads.get(head) ?? []), file]);
          } catch (error) {
            fail(file.path, error);
          }
        for (const [head, files] of heads) {
          if (files.length < 2) continue;
          for (const file of files)
            try {
              hashed.push({
                file,
                hash:
                  file.size <= headBytes
                    ? head
                    : await contentHash(file, this.access, abort.signal),
              });
            } catch (error) {
              fail(file.path, error);
            }
        }
      }
      result.groups = duplicateGroups(hashed).slice(0, 5000);
      return result;
    } finally {
      clearTimeout(timer);
      this.running.delete(id);
    }
  }
}
