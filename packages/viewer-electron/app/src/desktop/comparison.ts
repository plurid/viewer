import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { entry, absolute } from './filesystem';
import { fileCoordination } from './file-coordination';
import { compareEntries, type ComparisonResult, type ComparisonRow } from '../domain/comparison';
import { sourceVersion, sameSourceVersion } from '../domain/inspection';
import type { FileEntry } from '../domain/contracts';
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
    await this.access([left, right]);
    left = await realpath(absolute(left));
    right = await realpath(absolute(right));
    const before = await Promise.all([entry(left), entry(right)]);
    if (before[0].directory !== before[1].directory)
      throw new Error('Compare two folders or two files.');
    const abort = new AbortController();
    this.running.set(id, abort);
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
        for (let index = 0; index < queue.length; index++) {
          const { file, depth } = queue[index];
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
                result.errors.push({ path: child, message: (error as Error).message });
                result.coverage = 'partial';
                incomplete.add(root);
              }
            }
          } catch (error) {
            abort.signal.throwIfAborted();
            result.errors.push({ path: file, message: (error as Error).message });
            result.coverage = 'partial';
            incomplete.add(root);
          }
        }
        return found;
      };
      const a = await scan(left),
        b = await scan(right);
      const digest = async (item: FileEntry) => {
        await this.access([item.path]);
        return fileCoordination.run(
          [{ path: item.path, mode: 'read' }],
          async () => {
            const handle = await open(
              fileCoordination.path(item.path),
              constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
            );
            try {
              const info = await handle.stat();
              if (!info.isFile()) throw new Error('A regular file is required for hashing.');
              const hash = createHash('sha256'),
                buffer = Buffer.alloc(256 * 1024);
              let offset = 0;
              while (offset < info.size) {
                abort.signal.throwIfAborted();
                const { bytesRead } = await handle.read(
                  buffer,
                  0,
                  Math.min(buffer.length, info.size - offset),
                  offset,
                );
                if (!bytesRead) throw new Error('The file changed during hashing.');
                hash.update(buffer.subarray(0, bytesRead));
                offset += bytesRead;
              }
              const after = await handle.stat();
              if (
                info.mtimeMs !== after.mtimeMs ||
                info.size !== after.size ||
                info.ctimeMs !== after.ctimeMs
              )
                throw new Error('The file changed during hashing.');
              await this.access([item.path]);
              if (!sameSourceVersion(sourceVersion(item), sourceVersion(await entry(item.path))))
                throw new Error('The source changed. Compare it again.');
              return hash.digest('hex');
            } finally {
              await handle.close();
            }
          },
          abort.signal,
        );
      };
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
          row.reason = (error as Error).message;
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
        for (const [index, root] of [left, right].entries())
          if (!sameSourceVersion(sourceVersion(before[index]), sourceVersion(await entry(root)))) {
            result.coverage = 'partial';
            result.errors.push({
              path: root,
              message:
                'Folder membership changed during comparison. Compare it again before reconciling.',
            });
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
