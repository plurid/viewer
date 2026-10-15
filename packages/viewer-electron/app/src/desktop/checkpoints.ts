import type { OperationJob } from '../domain/contracts';
import { randomUUID, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, opendir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { DocumentStore } from './document-store';
import { fileCoordination } from './file-coordination';
import { operationRoots, type Operations } from './operations';
import type { CheckpointEstimate, CheckpointRecord } from '../domain/change-plan';
import { removePrivateData } from './removal';
const recordSchema = z
  .object({
    id: z.uuid(),
    created: z.number().finite(),
    title: z.string().max(200),
    bytes: z.number().nonnegative(),
    roots: z
      .array(z.object({ path: z.string().max(32768), slot: z.string().regex(/^\d+$/) }).strict())
      .max(2000),
    scope: z.literal('contents-and-mode'),
    status: z.enum(['ready', 'failed']),
    manifestVersion: z.union([z.literal(1), z.literal(2)]).default(1),
  })
  .strict();
interface Item {
  file: string;
  relative: string;
  directory: boolean;
  mode: number;
  bytes: number;
  identity: string;
  modified: number;
  changed: number;
}
const snapshotPath = z
  .string()
  .min(1)
  .max(32768)
  .refine(
    (value) =>
      !path.isAbsolute(value) && !value.includes('\0') && !value.split(/[\\/]/).includes('..'),
  );
const treeItemSchema = z
  .object({
    file: z.string().min(1).max(32768),
    relative: z.string().min(1).max(32768),
    directory: z.boolean(),
    mode: z.number().int().min(0).max(0o777),
    bytes: z.number().finite().nonnegative(),
    identity: z.string().max(300),
    modified: z.number().finite(),
    changed: z.number().finite(),
  })
  .strict();
const treeManifestSchema = z
  .object({
    version: z.literal(2),
    entries: z
      .array(
        z
          .object({
            source: z.string().max(32768),
            snapshot: snapshotPath,
            hash: z.string().length(64).optional(),
            item: treeItemSchema,
          })
          .strict()
          .refine((value) => (value.item.directory ? !value.hash : !!value.hash)),
      )
      .max(10000),
  })
  .strict();
/** Version 1 manifests list file proofs only. */
const fileListManifestSchema = z
  .array(z.object({ snapshot: snapshotPath, hash: z.string().length(64) }).passthrough())
  .max(10000);
/** Recovery content lives in the app's private storage. Capturing never mutates sources. */
export class Checkpoints {
  private store: DocumentStore<CheckpointRecord[]>;
  private records: CheckpointRecord[] = [];
  private loaded?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private closed = false;
  constructor(
    private directory: string,
    private access: (paths: readonly string[]) => Promise<void>,
    private budget: () => number,
    private coordination: Pick<typeof fileCoordination, 'run'> = fileCoordination,
    private jobs: () => OperationJob[] = () => [],
  ) {
    this.store = new DocumentStore(path.join(directory, 'checkpoints-v1.json'), (value) =>
      z.array(recordSchema).max(100).parse(value),
    );
  }
  private load(): Promise<void> {
    return (this.loaded ??= this.store.load().then((records) => {
      this.records = records ?? [];
    }));
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Checkpoints have closed.'));
    if (this.pending >= 32) return Promise.reject(new Error('Too many checkpoint requests.'));
    this.pending++;
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        if (this.closed) throw new Error('Checkpoints have closed.');
        return work();
      })
      .finally(() => this.pending--);
    this.queue = task;
    return task;
  }
  async list() {
    await this.load();
    return {
      records: structuredClone(this.records),
      budgetBytes: this.budget(),
      usedBytes: this.records.reduce((sum, record) => sum + record.bytes, 0),
    };
  }
  private async items(root: string, signal?: AbortSignal): Promise<Item[]> {
    const pending = [{ file: root, relative: '.' }],
      items: Item[] = [];
    while (pending.length) {
      signal?.throwIfAborted();
      const current = pending.pop()!,
        info = await lstat(current.file);
      if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()))
        throw new Error(
          'A checkpoint cannot capture this symbolic link or special file: ' + current.file,
        );
      if (current.relative.split('/').length > 64 || items.length >= 10000)
        throw new Error('Checkpoint exceeds the 10,000 item or depth limit.');
      items.push({
        ...current,
        directory: info.isDirectory(),
        mode: info.mode & 0o777,
        bytes: info.isFile() ? info.size : 0,
        identity: info.dev + ':' + info.ino,
        modified: info.mtimeMs,
        changed: info.ctimeMs,
      });
      if (info.isDirectory()) {
        const reader = await opendir(current.file);
        for await (const child of reader) {
          if (items.length + pending.length >= 10000)
            throw new Error('Checkpoint exceeds the 10,000 item limit.');
          pending.push({
            file: path.join(current.file, child.name),
            relative: current.relative === '.' ? child.name : current.relative + '/' + child.name,
          });
        }
      }
    }
    return items;
  }
  async estimate(paths: string[]): Promise<CheckpointEstimate> {
    const roots = operationRoots(paths.map((file) => path.resolve(file)));
    await this.access(roots);
    const status = await this.list();
    let bytes = 4096 * (1 + roots.length),
      entries = 0;
    const issues: string[] = [];
    for (const root of roots) {
      try {
        const items = await this.coordination.run([{ path: root, mode: 'metadata' }], () =>
          this.items(root),
        );
        bytes += items.reduce(
          (sum, item) =>
            sum +
            (item.directory ? 4096 : Math.ceil(item.bytes / 4096) * 4096) +
            Math.ceil((Buffer.byteLength(JSON.stringify(item)) * 3) / 4096) * 4096,
          0,
        );
        entries += items.length;
        if (entries > 10000) throw new Error('Checkpoint exceeds the total 10,000 item limit.');
      } catch (error) {
        issues.push((error as Error).message);
      }
    }
    const availableBytes = Math.max(0, status.budgetBytes - status.usedBytes);
    if (bytes > availableBytes) issues.push('The checkpoint exceeds the remaining storage budget.');
    if (this.records.length >= 100)
      issues.push('Remove an older checkpoint before creating another.');
    return {
      bytes,
      entries,
      availableBytes,
      supported: !issues.length,
      issues,
      scope: 'contents-and-mode',
    };
  }
  create(title: string, paths: string[], signal?: AbortSignal): Promise<CheckpointRecord> {
    return this.serial(async () => {
      const roots = operationRoots(paths.map((file) => path.resolve(file)));
      if (!roots.length) throw new Error('Select at least one source for a checkpoint.');
      const estimate = await this.estimate(roots);
      if (!estimate.supported) throw new Error(estimate.issues.join('\n'));
      const id = randomUUID(),
        folder = path.join(this.directory, id);
      const record: CheckpointRecord = {
        id,
        created: Date.now(),
        title: title.slice(0, 200),
        bytes: 0,
        roots: roots.map((root, i) => ({ path: root, slot: String(i) })),
        scope: 'contents-and-mode',
        status: 'ready',
        manifestVersion: 2,
      };
      await mkdir(folder, { recursive: true, mode: 0o700 });
      try {
        const manifest: { source: string; snapshot: string; hash?: string; item: Item }[] = [];
        const directories: { target: string; mode: number }[] = [];
        for (const root of record.roots) {
          await this.access([root.path]);
          const items = await this.coordination.run(
            [{ path: root.path, mode: 'metadata' }],
            () => this.items(root.path, signal),
            signal,
          );
          for (const item of items) {
            signal?.throwIfAborted();
            const target = path.join(
              folder,
              root.slot,
              path.basename(root.path) || 'root',
              item.relative === '.' ? '' : item.relative,
            );
            if (item.directory) {
              await mkdir(target, { recursive: true, mode: 0o700 });
              directories.push({ target, mode: item.mode });
              manifest.push({ source: item.file, snapshot: path.relative(folder, target), item });
            } else {
              await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
              await this.coordination.run(
                [{ path: item.file, mode: 'read' }],
                async (coordinated) => {
                  await this.access([item.file]);
                  coordinated?.throwIfAborted();
                  const input = await open(
                    fileCoordination.path(item.file),
                    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
                  );
                  let output: Awaited<ReturnType<typeof open>> | undefined;
                  try {
                    const before = await input.stat();
                    if (
                      !before.isFile() ||
                      before.dev + ':' + before.ino !== item.identity ||
                      before.mtimeMs !== item.modified ||
                      before.ctimeMs !== item.changed ||
                      before.size !== item.bytes
                    )
                      throw new Error('A source changed before its checkpoint: ' + item.file);
                    output = await open(target, 'wx', 0o600);
                    const buffer = Buffer.alloc(1024 * 1024),
                      hash = createHash('sha256');
                    let position = 0;
                    for (;;) {
                      coordinated?.throwIfAborted();
                      signal?.throwIfAborted();
                      const { bytesRead } = await input.read(buffer, 0, buffer.length, position);
                      if (!bytesRead) break;
                      position += bytesRead;
                      record.bytes += bytesRead;
                      if (record.bytes > estimate.availableBytes)
                        throw new Error('The checkpoint exceeded its storage budget.');
                      const bytes = buffer.subarray(0, bytesRead);
                      hash.update(bytes);
                      let written = 0;
                      while (written < bytes.length)
                        written += (await output.write(bytes.subarray(written))).bytesWritten;
                    }
                    const after = await input.stat();
                    if (
                      after.size !== before.size ||
                      after.mtimeMs !== before.mtimeMs ||
                      after.ctimeMs !== before.ctimeMs
                    )
                      throw new Error('A source changed during its checkpoint: ' + item.file);
                    await output.sync();
                    manifest.push({
                      source: item.file,
                      snapshot: path.relative(folder, target),
                      hash: hash.digest('hex'),
                      item,
                    });
                  } finally {
                    await output?.close();
                    await input.close();
                  }
                },
                signal,
              );
            }
            if (!item.directory) await chmod(target, item.mode);
            if (manifest.length > 10000)
              throw new Error('Checkpoint exceeds the total 10,000 item limit.');
          }
        }
        const originals = new Map(manifest.map((proof) => [proof.source, proof.item]));
        for (const root of record.roots) {
          const current = await this.coordination.run(
            [{ path: root.path, mode: 'metadata' }],
            () => this.items(root.path, signal),
            signal,
          );
          for (const item of current) {
            const before = originals.get(item.file);
            if (
              !before ||
              before.identity !== item.identity ||
              before.bytes !== item.bytes ||
              before.directory !== item.directory ||
              before.mode !== item.mode ||
              before.modified !== item.modified ||
              before.changed !== item.changed
            )
              throw new Error(
                'A source tree changed before the checkpoint completed: ' + item.file,
              );
            originals.delete(item.file);
          }
        }
        if (originals.size)
          throw new Error('A source tree changed before the checkpoint completed.');
        for (const item of directories.reverse()) await chmod(item.target, item.mode);
        await new DocumentStore(path.join(folder, 'manifest.json'), (value) =>
          treeManifestSchema.parse(value),
        ).save({ version: 2, entries: manifest });
        record.bytes = await this.footprint(folder);
        if (record.bytes > estimate.availableBytes)
          throw new Error('The checkpoint exceeded its retained storage budget.');
        signal?.throwIfAborted();
        await this.access(roots);
        this.records.push(record);
        try {
          await this.store.save(this.records);
        } catch (error) {
          this.records = this.records.filter((record) => record.id !== id);
          throw error;
        }
        return structuredClone(record);
      } catch (error) {
        await this.drop(folder);
        throw error;
      }
    });
  }
  remove(id: string): Promise<void> {
    return this.serial(() => this.removeRecord(id));
  }
  private async removeRecord(id: string): Promise<void> {
    await this.load();
    const record = this.records.find((record) => record.id === id);
    if (!record) throw new Error('Checkpoint no longer exists.');
    const prefix = path.join(this.directory, record.id) + path.sep;
    if (
      this.jobs().some(
        (job) =>
          ['queued', 'running', 'collision'].includes(job.status) &&
          job.sources.some((file) => file.startsWith(prefix)),
      )
    )
      throw new Error('Wait for the checkpoint restore to finish before removing it.');
    const prior = record.status;
    record.status = 'failed';
    try {
      await this.store.save(this.records);
    } catch (error) {
      record.status = prior;
      throw error;
    }
    await this.drop(path.join(this.directory, record.id));
    const retained = this.records.filter((record) => record.id !== id);
    await this.store.save(retained);
    this.records = retained;
  }
  restore(id: string, destination: string, operations: Pick<Operations, 'start'>) {
    return this.serial(() => this.restoreRecord(id, destination, operations));
  }
  private async restoreRecord(
    id: string,
    destination: string,
    operations: Pick<Operations, 'start'>,
  ) {
    await this.load();
    await this.access([destination]);
    const record = this.records.find((record) => record.id === id && record.status === 'ready');
    if (!record) throw new Error('Checkpoint is unavailable.');
    const info = await lstat(destination);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error('Choose a regular restore folder.');
    const folder = path.join(this.directory, record.id);
    const manifest = await new DocumentStore(path.join(folder, 'manifest.json'), (value) =>
      record.manifestVersion === 2
        ? treeManifestSchema.parse(value)
        : { version: 1 as const, entries: fileListManifestSchema.parse(value) },
    ).load();
    if (!manifest) throw new Error('The checkpoint manifest is unavailable.');
    const known = new Map(manifest.entries.map((proof) => [proof.snapshot, proof]));
    if (known.size !== manifest.entries.length)
      throw new Error('Checkpoint manifest contains duplicate paths. No restore was started.');
    const remaining = new Set(known.keys());
    let count = 0;
    for (const root of record.roots) {
      const snapshot = path.join(folder, root.slot, path.basename(root.path) || 'root');
      for (const item of await this.items(snapshot)) {
        if (++count > 10000)
          throw new Error('Checkpoint tree changed beyond its retained item limit.');
        const key = path.relative(folder, item.file),
          proof = known.get(key);
        if (manifest.version === 1 && item.directory) continue;
        if (!proof) throw new Error('Checkpoint tree changed. No restore was started.');
        if (manifest.version === 2) {
          const tree = treeManifestSchema.shape.entries.element.parse(proof).item;
          if (
            tree.directory !== item.directory ||
            tree.mode !== item.mode ||
            tree.bytes !== item.bytes
          )
            throw new Error('Checkpoint tree or mode changed. No restore was started.');
        }
        remaining.delete(key);
      }
    }
    if (remaining.size) throw new Error('Checkpoint tree changed. No restore was started.');
    for (const proof of manifest.entries) {
      if (!proof.hash) continue;
      const input = await open(
        path.join(folder, proof.snapshot),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const info = await input.stat();
        if (!info.isFile() || info.size > record.bytes)
          throw new Error('A checkpoint file exceeds its recorded bounds.');
        const hash = createHash('sha256'),
          buffer = Buffer.alloc(1024 * 1024);
        let position = 0;
        for (;;) {
          const { bytesRead } = await input.read(buffer, 0, buffer.length, position);
          if (!bytesRead) break;
          position += bytesRead;
          if (position > info.size || position > record.bytes)
            throw new Error('Checkpoint contents changed during verification.');
          hash.update(buffer.subarray(0, bytesRead));
        }
        const after = await input.stat();
        if (
          hash.digest('hex') !== proof.hash ||
          after.size !== info.size ||
          after.mtimeMs !== info.mtimeMs ||
          after.ctimeMs !== info.ctimeMs
        )
          throw new Error('Checkpoint contents changed. No restore was started.');
      } finally {
        await input.close();
      }
    }
    await this.access([destination]);
    // Restore into a user-chosen folder; originals and later outputs stay untouched.
    const jobs = record.roots.map((root) =>
      operations.start({
        kind: 'copy',
        sources: [
          path.join(this.directory, record.id, root.slot, path.basename(root.path) || 'root'),
        ],
        destination,
      }),
    );
    return { jobs };
  }
  async close() {
    this.closed = true;
    await this.queue.catch(() => {});
    await this.store.flush();
  }
  private async footprint(folder: string): Promise<number> {
    const pending = [folder];
    let bytes = 0;
    while (pending.length) {
      const file = pending.pop()!,
        info = await lstat(file);
      if (info.isSymbolicLink()) throw new Error('Checkpoint storage contains an unexpected link.');
      bytes += info.isDirectory()
        ? Math.max(4096, info.blocks * 512)
        : Math.max(info.size, info.blocks * 512);
      if (info.isDirectory()) {
        const directory = await opendir(file);
        for await (const child of directory) pending.push(path.join(file, child.name));
      }
    }
    return bytes;
  }
  private async drop(folder: string): Promise<void> {
    const pending = [folder];
    while (pending.length) {
      const file = pending.pop()!,
        info = await lstat(file).catch(() => null);
      if (!info?.isDirectory() || info.isSymbolicLink()) continue;
      await chmod(file, 0o700);
      const directory = await opendir(file);
      for await (const child of directory)
        if (child.isDirectory()) pending.push(path.join(file, child.name));
    }
    await removePrivateData(this.directory, folder);
  }
}
