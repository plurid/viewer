import { readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { entry, absolute } from '../files/filesystem';
import { fileCoordination } from '../files/file-coordination';
import { contentHash } from '../files/content-hash';
import {
  compareEntries,
  type ComparisonResult,
  type ComparisonRow,
} from '../../domain/comparison/folders';
import { sourceVersion, sameSourceVersion } from '../../domain/files/inspection';
import type { FileEntry } from '../../domain/contracts';
import { errorMessage } from '../../domain/errors';
/** Bounded traversal never follows child symlinks or presents offline paths as equal. */
export class Comparisons {
  private running = new Map<string, AbortController>();
  constructor(private access: (files: readonly string[]) => Promise<void>) {}
  cancel(id: string) {
    this.running.get(id)?.abort();
  }
  async run(id: string, left: string, right: string, hashes = false): Promise<ComparisonResult> {
    if (this.running.has(id)) throw new Error('This comparison is already running.');
    if (this.running.size >= 2) throw new Error('Wait for another comparison to finish.');
    // Registered before any await, so a cancellation that arrives early is not lost.
    const abort = new AbortController();
    this.running.set(id, abort);
    let before: [FileEntry, FileEntry];
    try {
      await this.access([left, right]);
      left = await realpath(absolute(left));
      right = await realpath(absolute(right));
      before = await Promise.all([entry(left), entry(right)]);
      if (before[0].directory !== before[1].directory)
        throw new Error('Compare two folders or two files.');
      abort.signal.throwIfAborted();
    } catch (error) {
      this.running.delete(id);
      throw error;
    }
    const timer = setTimeout(
      () => abort.abort(new Error('Comparison exceeded its time budget.')),
      120000,
    );
    const result: ComparisonResult = {
      id,
      left,
      right,
      rows: [],
      coverage: 'complete',
      hashes,
      errors: [],
      created: Date.now(),
    };
    const incomplete = new Set<string>();
    try {
      const scan = async (root: string): Promise<Map<string, FileEntry>> => {
        const found = new Map<string, FileEntry>();
        if (!before[0].directory) {
          found.set('.', await entry(root));
          return found;
        }
        const queue = [{ file: root, depth: 0 }];
        // Subfolders are appended while this loop runs; `for…of` visits them too.
        for (const { file, depth } of queue) {
          abort.signal.throwIfAborted();
          try {
            await this.access([file]);
            const names = await fileCoordination.run(
              [{ path: file, mode: 'read' }],
              () => readdir(fileCoordination.path(file)),
              abort.signal,
            );
            for (const name of names) {
              if (found.size >= 10000 || queue.length >= 10001) {
                result.coverage = 'partial';
                incomplete.add(root);
                return found;
              }
              const child = path.join(file, name),
                relative = path.relative(root, child);
              try {
                await this.access([child]);
                const item = await entry(child);
                found.set(relative, item);
                if (item.kind === 'directory' && depth < 64)
                  queue.push({ file: child, depth: depth + 1 });
                else if (item.kind === 'directory') {
                  result.coverage = 'partial';
                  incomplete.add(root);
                }
              } catch (error) {
                result.errors.push({ path: child, message: errorMessage(error) });
                result.coverage = 'partial';
                incomplete.add(root);
              }
            }
          } catch (error) {
            abort.signal.throwIfAborted();
            result.errors.push({ path: file, message: errorMessage(error) });
            result.coverage = 'partial';
            incomplete.add(root);
          }
        }
        return found;
      };
      const a = await scan(left),
        b = await scan(right);
      const digest = (item: FileEntry) => contentHash(item, this.access, abort.signal);
      for (const key of [...new Set([...a.keys(), ...b.keys()])].sort()) {
        abort.signal.throwIfAborted();
        const row: ComparisonRow = {
          path: key,
          left: a.get(key),
          right: b.get(key),
          status: 'unknown',
        };
        try {
          if (hashes) {
            if (row.left?.kind === 'file') row.leftHash = await digest(row.left);
            if (row.right?.kind === 'file') row.rightHash = await digest(row.right);
          }
          row.status = compareEntries(row.left, row.right, row.leftHash, row.rightHash);
          if (row.status === 'unknown')
            row.reason =
              'Symlinks, special files or unavailable content require separate inspection.';
        } catch (error) {
          abort.signal.throwIfAborted();
          row.reason = errorMessage(error);
          result.coverage = 'partial';
        }
        if (
          (!row.left &&
            (incomplete.has(left) ||
              result.errors.some(
                (issue) =>
                  key === path.relative(left, issue.path) ||
                  key.startsWith(path.relative(left, issue.path) + path.sep),
              ))) ||
          (!row.right &&
            (incomplete.has(right) ||
              result.errors.some(
                (issue) =>
                  key === path.relative(right, issue.path) ||
                  key.startsWith(path.relative(right, issue.path) + path.sep),
              )))
        ) {
          row.status = 'unknown';
          row.reason = 'The other location could not be read.';
        }
        result.rows.push(row);
      }
      await this.access([left, right]);
      if (before[0].directory)
        for (const [index, root] of [left, right].entries()) {
          const prior = before[index];
          if (prior && !sameSourceVersion(sourceVersion(prior), sourceVersion(await entry(root)))) {
            result.coverage = 'partial';
            result.errors.push({
              path: root,
              message:
                'Folder membership changed during comparison. Compare it again before reconciling.',
            });
          }
        }
      return result;
    } finally {
      clearTimeout(timer);
      this.running.delete(id);
    }
  }
  close() {
    for (const abort of this.running.values()) abort.abort();
  }
}
