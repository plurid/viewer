import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  symlink,
  writeFile,
} from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { OperationJob, OperationProgress, OperationRequest } from '../src/domain/contracts';
import { temporaryRoot, trashTemporary, trashFixtureEntry } from '../tools/temporary';
const exdev = vi.hoisted(() => ({ source: '', race: '', noLinks: false, foreign: '' }));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  const paths = await import('node:path');
  // Items whose real location is inside `exdev.foreign` report another device, as if
  // that folder were a second volume.
  const elsewhere = async (info: Stats, real: () => Promise<string>) => {
    if (!exdev.foreign) return info;
    const resolved = await real().catch(() => '');
    if (resolved === exdev.foreign || resolved.startsWith(exdev.foreign + paths.sep)) info.dev += 1;
    return info;
  };
  return {
    ...actual,
    lstat: async (file: string) =>
      elsewhere(await actual.lstat(file), async () =>
        paths.join(await actual.realpath(paths.dirname(file)), paths.basename(file)),
      ),
    stat: async (file: string) => elsewhere(await actual.stat(file), () => actual.realpath(file)),
    rename: async (source: string, destination: string) => {
      if (source === exdev.source) {
        exdev.source = '';
        throw Object.assign(new Error('Cross-device link'), { code: 'EXDEV' });
      }
      return actual.rename(source, destination);
    },
    link: async (source: string, destination: string) => {
      if (source === exdev.source) {
        exdev.source = '';
        throw Object.assign(new Error('Cross-device link'), { code: 'EXDEV' });
      }
      if (destination === exdev.race) {
        exdev.race = '';
        await actual.writeFile(destination, 'concurrent writer', { flag: 'wx' });
      }
      if (exdev.noLinks)
        throw Object.assign(new Error('Hard links are unsupported'), { code: 'EOPNOTSUPP' });
      return actual.link(source, destination);
    },
  };
});
// Publication uses renameatx_np on macOS. Inject failures at that same boundary
// so collision and cross-volume tests still exercise the native path.
vi.mock('../src/desktop/macos-files', async (original) => {
  const actual = await original<typeof import('../src/desktop/macos-files')>();
  const spelling = (file: string) => file.replace(/^\/private\/var\//, '/var/').normalize('NFC');
  return {
    ...actual,
    macFiles: () => {
      const native = actual.macFiles();
      return Object.defineProperty(Object.create(native), 'renameExclusive', {
        value: async (source: string, destination: string, purpose?: string) => {
          if (exdev.source && spelling(source) === spelling(exdev.source)) {
            exdev.source = '';
            throw Object.assign(new Error('Cross-device link'), { code: 'EXDEV' });
          }
          if (exdev.race && spelling(destination) === spelling(exdev.race)) {
            exdev.race = '';
            await writeFile(destination, 'concurrent writer', { flag: 'wx' });
          }
          return native.renameExclusive(source, destination, purpose);
        },
      });
    },
  };
});
// A folder named "many items" is over the proof's 10,000-item limit, without writing them all.
vi.mock('../src/desktop/operation-journal', async (original) => {
  const actual = await original<typeof import('../src/desktop/operation-journal')>();
  const paths = await import('node:path');
  return {
    ...actual,
    outputProof: async (file: string) =>
      paths.basename(file) === 'many items' ? undefined : actual.outputProof(file),
  };
});
import { Operations } from '../src/desktop/operations';
import { ProtectedPaths } from '../src/desktop/protected-paths';
import { OperationLog, operationJournal, outputProof } from '../src/desktop/operation-journal';
import { entry } from '../src/desktop/filesystem';
import { sourceVersion } from '../src/domain/inspection';
let root: string, destination: string, trash: string, operations: Operations;
beforeEach(async () => {
  root = await temporaryRoot('viewer-ops-');
  destination = path.join(root, 'destination');
  trash = path.join(root, 'trash');
  await mkdir(destination);
  await mkdir(trash);
  operations = new Operations(
    async (file) => {
      await rename(file, path.join(trash, path.basename(file) + '-' + crypto.randomUUID()));
    },
    () => undefined,
  );
});
afterEach(async () => {
  await operations.close();
  vi.restoreAllMocks();
  exdev.source = '';
  exdev.race = '';
  exdev.noLinks = false;
  exdev.foreign = '';
  await trashTemporary(root);
});
async function waitFor(
  id: string,
  condition: (job: OperationJob) => boolean = (job) =>
    ['completed', 'cancelled', 'failed'].includes(job.status),
): Promise<OperationJob> {
  await vi.waitFor(
    () => {
      const job = operations.all().find((item) => item.id === id)!;
      expect(condition(job)).toBe(true);
    },
    { timeout: 10000, interval: 10 },
  );
  return operations.all().find((item) => item.id === id)!;
}
async function run(request: OperationRequest) {
  return waitFor(operations.start(request));
}
describe('file operation queue', () => {
  it('reports a failed final receipt save while preserving the completed copy', async () => {
    const dataPath = path.join(root, 'private');
    const source = path.join(root, 'original.txt');
    await writeFile(source, 'original');
    const record = OperationLog.prototype.record;
    vi.spyOn(OperationLog.prototype, 'record').mockImplementation(function (
      this: OperationLog,
      receipt,
    ) {
      if (receipt.job.status === 'completed')
        return Promise.reject(new Error('Generated final receipt write failure'));
      return record.call(this, receipt);
    });
    operations = new Operations(
      async () => {},
      () => {},
      undefined,
      undefined,
      undefined,
      dataPath,
    );
    const id = operations.start({ kind: 'copy', sources: [source], destination });
    await waitFor(id);
    await operations.close();
    const job = operations.all().find((item) => item.id === id)!;
    expect(job.status).toBe('failed');
    expect(job.errors.at(-1)?.message).toContain('receipts could not be saved');
    expect(job.completed).toEqual([
      { source, destination: path.join(destination, 'original.txt') },
    ]);
    expect(await readFile(source, 'utf8')).toBe('original');
    expect(await readFile(path.join(destination, 'original.txt'), 'utf8')).toBe('original');
  });
  it.each([false, true])(
    'preserves known failure history and eligible Undo across restart (partial: %s)',
    async (partial) => {
      const dataPath = path.join(root, 'private');
      const source = path.join(root, 'original.txt');
      const missing = path.join(root, 'removed-before-copy.txt');
      await writeFile(source, 'original');
      const restore = () =>
        new Operations(
          async (file) => rename(file, path.join(trash, crypto.randomUUID())),
          () => {},
          undefined,
          undefined,
          undefined,
          dataPath,
        );
      operations = restore();
      const job = await run({
        kind: 'copy',
        sources: partial ? [source, missing] : [missing],
        destination,
      });
      expect(job.status).toBe(partial ? 'completed' : 'failed');
      expect(job.errorCount).toBe(1);
      expect(job.undoable).toBe(partial);
      await operations.close();
      operations = restore();
      await operations.load();
      const restored = operations.all().find((item) => item.id === job.id)!;
      expect(restored.status).toBe(job.status);
      expect(restored.errors).toEqual(job.errors);
      expect(restored.errorCount).toBe(job.errorCount);
      expect(restored.undoable).toBe(partial);
      if (partial) {
        await operations.undo(job.id);
        await expect(lstat(path.join(destination, 'original.txt'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
      }
      expect(await readFile(source, 'utf8')).toBe('original');
    },
  );
  it('reports an interrupted Undo as recovery instead of replaying an ambiguous receipt', async () => {
    const dataPath = path.join(root, 'private'),
      source = path.join(root, 'original.txt');
    await writeFile(source, 'original');
    operations = new Operations(
      async () => {},
      () => {},
      undefined,
      undefined,
      undefined,
      dataPath,
    );
    const copied = await run({ kind: 'copy', sources: [source], destination });
    await operations.close();
    const journal = new OperationLog(dataPath),
      [receipt] = (await journal.load()).receipts;
    receipt.intent = { source: path.join(destination, 'original.txt') };
    await journal.compact(receipt);
    operations = new Operations(
      async () => {},
      () => {},
      undefined,
      undefined,
      undefined,
      dataPath,
    );
    await operations.load();
    expect(operations.all()[0]).toMatchObject({
      status: 'failed',
      undoable: false,
      recovery: { source: path.join(destination, 'original.txt') },
    });
    await expect(operations.undo(copied.id)).rejects.toThrow('cannot be undone');
    expect(await readFile(source, 'utf8')).toBe('original');
    expect(await readFile(path.join(destination, 'original.txt'), 'utf8')).toBe('original');
  });
  it('restores only Viewer-owned Trash receipts after restart and refuses a new original at the same path', async () => {
    const dataPath = path.join(root, 'private');
    const nativeTrash = async (file: string) => {
      const directory = (await lstat(file)).isDirectory(),
        target = path.join(trash, crypto.randomUUID());
      await rename(file, target);
      return { path: target, directory, bookmark: 'private-fixture-bookmark' };
    };
    operations = new Operations(nativeTrash, () => {}, undefined, undefined, undefined, dataPath);
    const source = path.join(root, 'important.txt');
    await writeFile(source, 'original');
    const job = await run({ kind: 'trash', sources: [source] });
    expect(job.undoable).toBe(true);
    expect(JSON.stringify(operations.all())).not.toContain('private-fixture-bookmark');
    await operations.close();
    operations = new Operations(nativeTrash, () => {}, undefined, undefined, undefined, dataPath);
    await operations.load();
    await writeFile(source, 'new work');
    await expect(operations.undo(job.id)).rejects.toThrow('already exists');
    expect(await readFile(source, 'utf8')).toBe('new work');
    await trashFixtureEntry(source);
    await operations.undo(job.id);
    expect(await readFile(source, 'utf8')).toBe('original');
  });
  it('Undo replacement removes the new copy before restoring the existing item from its private receipt', async () => {
    operations = new Operations(
      async (file) => {
        const target = path.join(trash, crypto.randomUUID()),
          directory = (await lstat(file)).isDirectory();
        await rename(file, target);
        return { path: target, directory };
      },
      () => {},
    );
    const source = path.join(root, 'one.txt'),
      target = path.join(destination, 'one.txt');
    await writeFile(source, 'new');
    await writeFile(target, 'old');
    const id = operations.start({ kind: 'copy', sources: [source], destination });
    await waitFor(id, (job) => job.status === 'collision');
    operations.resolve(id, 'replace', false);
    await waitFor(id);
    await operations.undo(id);
    expect(await readFile(target, 'utf8')).toBe('old');
    expect(await readFile(source, 'utf8')).toBe('new');
  });
  it('creates and extracts archives through durable, undoable jobs', async () => {
    const source = path.join(root, 'notes.txt');
    await writeFile(source, 'notes');
    const compressed = await run({
      kind: 'compress',
      sources: [source],
      destination,
      name: 'notes.zip',
    });
    expect(compressed.status).toBe('completed');
    const extracted = await run({
      kind: 'extract',
      sources: [path.join(destination, 'notes.zip')],
      destination,
    });
    expect(extracted.undoable).toBe(true);
    expect(await readFile(path.join(destination, 'notes', 'notes.txt'), 'utf8')).toBe('notes');
    await operations.undo(extracted.id);
    await expect(lstat(path.join(destination, 'notes'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(source, 'utf8')).toBe('notes');
  });
  it.runIf(process.platform === 'darwin')(
    'names an alias as Finder does: “name alias”, then “name alias 2”',
    async () => {
      // The alias took a duplicate's keep-both name, which always adds " copy" and read ".pdf alias"
      // as the extension: "Report copy.pdf alias".
      const source = path.join(root, 'Report.pdf');
      await writeFile(source, 'report');
      const first = await run({ kind: 'alias', sources: [source] });
      expect(first.status).toBe('completed');
      expect(first.completed[0]?.destination).toBe(path.join(root, 'Report.pdf alias'));
      const second = await run({ kind: 'alias', sources: [source] });
      expect(second.completed[0]?.destination).toBe(path.join(root, 'Report.pdf alias 2'));
    },
  );
  it('keeps private receipts across restart and undoes only an unchanged copy', async () => {
    const dataPath = path.join(root, 'private');
    const remove = async (file: string) => {
      await rename(file, path.join(trash, crypto.randomUUID()));
    };
    operations = new Operations(remove, () => {}, undefined, undefined, undefined, dataPath);
    const source = path.join(root, 'original.txt');
    await writeFile(source, 'original');
    const copied = await run({ kind: 'copy', sources: [source], destination });
    expect(copied.undoable).toBe(true);
    await operations.close();
    const logs = path.join(dataPath, 'operation-journal-v2');
    expect((await lstat(logs)).mode & 0o777).toBe(0o700);
    expect((await lstat(path.join(logs, copied.id + '.jsonl'))).mode & 0o777).toBe(0o600);
    operations = new Operations(remove, () => {}, undefined, undefined, undefined, dataPath);
    await operations.load();
    expect(operations.all().find((job) => job.id === copied.id)?.undoable).toBe(true);
    await operations.undo(copied.id);
    await expect(lstat(path.join(destination, 'original.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await readFile(source, 'utf8')).toBe('original');
  });
  it('journals every job of a batch larger than the retained history', async () => {
    const dataPath = path.join(root, 'private');
    operations = new Operations(
      async () => {},
      () => {},
      undefined,
      undefined,
      undefined,
      dataPath,
    );
    const sources: string[] = [];
    for (let index = 0; index < 102; index++) {
      const source = path.join(root, `file-${index}.txt`);
      await writeFile(source, String(index));
      sources.push(source);
    }
    // Queued together, as a reviewed plan starts one job per row; the first run first.
    const ids = sources.map((source) =>
      operations.start({ kind: 'copy', sources: [source], destination }),
    );
    for (const id of ids) await waitFor(id);
    await operations.close();
    operations = new Operations(
      async () => {},
      () => {},
      undefined,
      undefined,
      undefined,
      dataPath,
    );
    await operations.load();
    const restored = new Map(operations.all().map((job) => [job.id, job]));
    expect(ids.filter((id) => !restored.get(id)?.undoable)).toEqual([]);
  }, 60_000);
  it('keeps earlier completed jobs when a large batch is queued', async () => {
    const first = path.join(root, 'first.txt');
    await writeFile(first, 'first');
    const earlier = await run({ kind: 'copy', sources: [first], destination });
    const sources: string[] = [];
    for (let index = 0; index < 101; index++) {
      const source = path.join(root, `batch-${index}.txt`);
      await writeFile(source, String(index));
      sources.push(source);
    }
    const ids = sources.map((source) =>
      operations.start({ kind: 'copy', sources: [source], destination }),
    );
    expect(operations.all().find((job) => job.id === earlier.id)?.undoable).toBe(true);
    for (const id of ids) await waitFor(id);
  }, 60_000);
  it('refuses removal Undo when a copied folder gains a new child', async () => {
    const source = path.join(root, 'folder');
    await mkdir(source);
    await writeFile(path.join(source, 'one'), 'original');
    const job = await run({ kind: 'copy', sources: [source], destination });
    await writeFile(path.join(destination, 'folder', 'new'), 'user work');
    await expect(operations.undo(job.id)).rejects.toThrow('changed');
    expect(await readFile(path.join(destination, 'folder', 'new'), 'utf8')).toBe('user work');
  });
  it('restores interrupted receipts without retrying or deleting temporary files', async () => {
    const dataPath = path.join(root, 'private');
    const source = path.join(root, 'source'),
      staging = path.join(destination, '.viewer-transfer-owned');
    await writeFile(source, 'original');
    await writeFile(staging, 'partial');
    const id = crypto.randomUUID();
    await operationJournal(dataPath).save({
      version: 1,
      records: [
        {
          job: {
            id,
            revision: 1,
            kind: 'copy',
            status: 'running',
            sources: [source],
            destination,
            bytesDone: 3,
            bytesTotal: 8,
            itemsDone: 0,
            itemsTotal: 1,
            completed: [],
            errors: [],
            errorCount: 0,
            undoable: false,
          },
          request: { kind: 'copy', sources: [source], destination },
          undo: [],
          intent: { source, destination: path.join(destination, 'source'), staging },
        },
      ],
    });
    operations = new Operations(
      async () => {},
      () => {},
      undefined,
      undefined,
      undefined,
      dataPath,
    );
    await operations.load();
    expect(operations.all()[0]).toMatchObject({ status: 'failed', recovery: { source, staging } });
    expect(await readFile(source, 'utf8')).toBe('original');
    expect(await readFile(staging, 'utf8')).toBe('partial');
    await expect(lstat(path.join(destination, 'source'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('stops before changing files when the operation receipt cannot be saved', async () => {
    operations = new Operations(
      async () => {},
      () => {},
      undefined,
      undefined,
      undefined,
      path.join(root, 'private'),
    );
    const source = path.join(root, 'source');
    await writeFile(source, 'must stay');
    vi.spyOn(OperationLog.prototype, 'record').mockRejectedValue(
      Object.assign(new Error('Disk is full'), { code: 'ENOSPC' }),
    );
    const job = await run({ kind: 'rename', sources: [source], name: 'renamed' });
    expect(job.status).toBe('failed');
    expect(job.errors[0].message).toContain('receipts could not be saved');
    expect(await readFile(source, 'utf8')).toBe('must stay');
    await expect(lstat(path.join(root, 'renamed'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('streams exclusive copies and safe moves on volumes without hard-link support', async () => {
    exdev.noLinks = true;
    const source = path.join(root, 'external.txt');
    await writeFile(source, 'external disk');
    const copied = await run({ kind: 'copy', sources: [source], destination });
    expect(copied.status).toBe('completed');
    expect(await readFile(path.join(destination, 'external.txt'), 'utf8')).toBe('external disk');
    const renamed = await run({ kind: 'rename', sources: [source], name: 'renamed.txt' });
    expect(renamed.undoable).toBe(true);
    await operations.undo(renamed.id);
    expect(await readFile(source, 'utf8')).toBe('external disk');
  });
  it('copies every selected file and preserves symlinks', async () => {
    const sources = [path.join(root, 'one.txt'), path.join(root, 'two.txt')];
    await Promise.all(sources.map((file) => writeFile(file, path.basename(file))));
    await symlink('one.txt', path.join(root, 'alias'));
    sources.push(path.join(root, 'alias'));
    const job = await run({ kind: 'copy', sources, destination });
    expect(job.completed).toHaveLength(3);
    expect(job.errors).toEqual([]);
    expect(await readFile(path.join(destination, 'two.txt'), 'utf8')).toBe('two.txt');
    expect((await lstat(path.join(destination, 'alias'))).isSymbolicLink()).toBe(true);
  });
  it('waits for collision decisions and keeps both without losing either file', async () => {
    const source = path.join(root, 'one.txt');
    await writeFile(source, 'new');
    await writeFile(path.join(destination, 'one.txt'), 'old');
    const id = operations.start({ kind: 'copy', sources: [source], destination });
    await waitFor(id, (job) => job.status === 'collision');
    operations.resolve(id, 'keep-both', false);
    await waitFor(id);
    expect(await readFile(path.join(destination, 'one.txt'), 'utf8')).toBe('old');
    expect(await readFile(path.join(destination, 'one copy.txt'), 'utf8')).toBe('new');
  });
  it('replaces through Trash and applies a decision to remaining conflicts', async () => {
    const sources = [path.join(root, 'one.txt'), path.join(root, 'two.txt')];
    for (const source of sources) {
      await writeFile(source, 'new');
      await writeFile(path.join(destination, path.basename(source)), 'old');
    }
    const id = operations.start({ kind: 'copy', sources, destination });
    await waitFor(id, (job) => job.status === 'collision');
    operations.resolve(id, 'replace', true);
    const job = await waitFor(id);
    expect(job.completed).toHaveLength(2);
    expect(await readdir(trash)).toHaveLength(2);
    expect(await readFile(path.join(destination, 'two.txt'), 'utf8')).toBe('new');
  });
  it('renames Unicode and case-only names and safely undoes a move', async () => {
    const source = path.join(root, 'Résumé.txt');
    await writeFile(source, 'contents');
    const renamed = await run({ kind: 'rename', sources: [source], name: 'résumé.txt' });
    expect(renamed.status, JSON.stringify(renamed.errors)).toBe('completed');
    await operations.undo(renamed.id);
    expect(await readFile(source, 'utf8')).toBe('contents');
    await run({ kind: 'rename', sources: [source], name: 'résumé.txt' });
    const file = path.join(root, 'résumé.txt');
    const moved = await run({ kind: 'move', sources: [file], destination });
    expect(moved.undoable).toBe(true);
    await operations.undo(moved.id);
    expect(await readFile(file, 'utf8')).toBe('contents');
  });
  it('refuses undo when the destination contents changed', async () => {
    const source = path.join(root, 'file');
    await writeFile(source, 'old');
    const job = await run({ kind: 'move', sources: [source], destination });
    await writeFile(path.join(destination, 'file'), 'changed');
    await expect(operations.undo(job.id)).rejects.toThrow('changed');
  });
  it('stages cross-volume moves and removes the source only after a full copy', async () => {
    const source = path.join(root, 'file');
    await writeFile(source, 'cross volume');
    exdev.source = source;
    const job = await run({ kind: 'move', sources: [source], destination });
    expect(job.status).toBe('completed');
    expect(job.undoable).toBe(false);
    await expect(lstat(source)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(destination, 'file'), 'utf8')).toBe('cross volume');
  });
  it('copies when a transfer reaches a folder on another volume through a link', async () => {
    const volume = path.join(root, 'other-volume');
    await mkdir(volume);
    const linked = path.join(root, 'volume-link');
    await symlink(volume, linked);
    exdev.foreign = await realpath(volume);
    const source = path.join(root, 'report.txt');
    await writeFile(source, 'original');
    const job = await run({ kind: 'transfer', sources: [source], destination: linked });
    expect(job.status).toBe('completed');
    // As in Finder, a drop onto another volume copies, so the original stays.
    expect(await readFile(source, 'utf8')).toBe('original');
    expect(await readFile(path.join(volume, 'report.txt'), 'utf8')).toBe('original');
    expect(job.undoable).toBe(true);
  });
  it('moves when a transfer reaches a folder on the same volume through a link', async () => {
    const linked = path.join(root, 'destination-link');
    await symlink(destination, linked);
    const source = path.join(root, 'report.txt');
    await writeFile(source, 'original');
    const job = await run({ kind: 'transfer', sources: [source], destination: linked });
    expect(job.status).toBe('completed');
    await expect(lstat(source)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(destination, 'report.txt'), 'utf8')).toBe('original');
    expect(job.undoable).toBe(true);
  });
  it.skipIf(process.platform !== 'darwin')(
    'preserves macOS metadata during cross-volume transfers before removing the original',
    async () => {
      const source = path.join(root, 'tagged.txt');
      await writeFile(source, 'important');
      await promisify(execFile)('/usr/bin/xattr', [
        '-w',
        'com.plurid.viewer.fixture',
        'synthetic',
        source,
      ]);
      exdev.source = source;
      const job = await run({ kind: 'move', sources: [source], destination });
      expect(job.status).toBe('completed');
      const copied = path.join(destination, 'tagged.txt');
      expect(await readFile(copied, 'utf8')).toBe('important');
      expect(
        (
          await promisify(execFile)('/usr/bin/xattr', ['-p', 'com.plurid.viewer.fixture', copied])
        ).stdout.trim(),
      ).toBe('synthetic');
      await expect(lstat(source)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );
  it('keeps a concurrently created destination and leaves the source intact', async () => {
    const source = path.join(root, 'racing.txt');
    await writeFile(source, 'original');
    exdev.race = path.join(destination, 'racing.txt');
    const job = await run({ kind: 'move', sources: [source], destination });
    expect(job.status).toBe('failed');
    expect(await readFile(source, 'utf8')).toBe('original');
    expect(await readFile(path.join(destination, 'racing.txt'), 'utf8')).toBe('concurrent writer');
  });
  it('moves whole directories and rejects undo into an occupied folder', async () => {
    const source = path.join(root, 'folder');
    await mkdir(source);
    await writeFile(path.join(source, 'child.txt'), 'child');
    const job = await run({ kind: 'move', sources: [source], destination });
    expect(job.undoable).toBe(true);
    await mkdir(source);
    await expect(operations.undo(job.id)).rejects.toThrow('already exists');
    await trashFixtureEntry(source);
    await operations.undo(job.id);
    expect(await readFile(path.join(source, 'child.txt'), 'utf8')).toBe('child');
  });
  it('cancels an active copy and cleans only its staging files', async () => {
    const source = path.join(root, 'large.bin');
    await writeFile(source, Buffer.alloc(16 * 1024 * 1024, 7));
    let time = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (time += 100));
    operations = new Operations(
      async () => undefined,
      () => undefined,
      (job) => {
        if (job.bytesDone > 0) operations.cancel(job.id);
      },
    );
    const job = await run({ kind: 'copy', sources: [source], destination });
    expect(job.status).toBe('cancelled');
    expect(await readdir(destination)).toEqual([]);
    expect((await lstat(source)).size).toBe(16 * 1024 * 1024);
  });
  it('throttles small-file progress across the whole job and sends authoritative lifecycle snapshots', async () => {
    let time = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (time += 20));
    const snapshots: OperationJob[] = [];
    const updates: { progress: OperationProgress; time: number }[] = [];
    const revisions: number[] = [];
    operations = new Operations(
      async () => undefined,
      (job) => {
        snapshots.push(job);
        revisions.push(job.revision);
      },
      (progress) => {
        updates.push({ progress, time });
        revisions.push(progress.revision);
      },
    );
    const sources = Array.from({ length: 12 }, (_, index) => path.join(root, `small-${index}.txt`));
    await Promise.all(sources.map((source) => writeFile(source, 'synthetic')));
    const job = await run({ kind: 'copy', sources, destination });
    expect(snapshots.map((job) => job.status)).toEqual(['queued', 'running', 'completed']);
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.length).toBeLessThan(sources.length);
    for (let i = 1; i < updates.length; i++)
      expect(updates[i].time - updates[i - 1].time).toBeGreaterThanOrEqual(80);
    expect(revisions).toEqual(Array.from({ length: revisions.length }, (_, index) => index + 1));
    expect(updates[0].progress).not.toHaveProperty('completed');
    expect(updates[0].progress).not.toHaveProperty('sources');
    expect(job.completed).toHaveLength(12);
    expect(job).toMatchObject({ bytesDone: 108, itemsDone: 12, errorCount: 0 });
    expect(snapshots.at(-1)).toEqual(job);
    expect(await readFile(sources[0], 'utf8')).toBe('synthetic');
  });
  it('rejects copying a folder inside itself through a symlink', async () => {
    const folder = path.join(root, 'folder');
    await mkdir(folder);
    const alias = path.join(root, 'alias');
    await symlink(folder, alias);
    const job = await run({ kind: 'copy', sources: [folder], destination: alias });
    expect(job.status).toBe('failed');
    expect(job.errors[0].message).toContain('inside itself');
  });
  it('reports partial failures and processes every Trash selection', async () => {
    const first = path.join(root, 'first'),
      second = path.join(root, 'second');
    await writeFile(first, 'a');
    await writeFile(second, 'b');
    const job = await run({ kind: 'trash', sources: [first, path.join(root, 'missing'), second] });
    expect(job.completed).toHaveLength(2);
    expect(job.errors).toHaveLength(1);
    expect(await readdir(trash)).toHaveLength(2);
  });
});
describe('replace safety', () => {
  const caseInsensitive = async (folder: string) =>
    lstat(folder.toUpperCase().replace(root.toUpperCase(), root)).then(
      () => true,
      () => false,
    );
  const replaced = async (name: string) =>
    (await readdir(trash)).filter((entry) => entry.startsWith(name));
  it('never offers the source itself for Replace when its folder is reached through a link', async () => {
    const folder = path.join(root, 'Folder');
    await mkdir(folder);
    const source = path.join(folder, 'item.txt');
    await writeFile(source, 'only copy');
    const link = path.join(root, 'Folder link');
    await symlink(folder, link);
    const moved = await run({ kind: 'move', sources: [source], destination: link });
    expect(moved.status).toBe('failed');
    expect(moved.errors[0]?.message).toContain('same item');
    expect(await readFile(source, 'utf8')).toBe('only copy');
    const copied = await run({ kind: 'copy', sources: [source], destination: link });
    expect(copied.status, JSON.stringify(copied.errors)).toBe('completed');
    expect(await readFile(path.join(folder, 'item copy.txt'), 'utf8')).toBe('only copy');
    expect(await readdir(trash)).toEqual([]);
  });
  it('treats a case-variant folder spelling as the same item', async () => {
    const folder = path.join(root, 'folder');
    await mkdir(folder);
    if (!(await caseInsensitive(folder))) return;
    const source = path.join(folder, 'note.txt');
    await writeFile(source, 'only copy');
    const job = await run({
      kind: 'move',
      sources: [source],
      destination: path.join(root, 'FOLDER'),
    });
    expect(job.errors[0]?.message).toContain('same item');
    expect(await readFile(source, 'utf8')).toBe('only copy');
    expect(await readdir(trash)).toEqual([]);
  });
  it('does not offer Replace for a folder that contains the source', async () => {
    const inner = path.join(root, 'outer', 'outer');
    await mkdir(inner, { recursive: true });
    await writeFile(path.join(inner, 'keep.txt'), 'inner data');
    const id = operations.start({ kind: 'move', sources: [inner], destination: root });
    const pending = await waitFor(id, (job) => job.status === 'collision');
    expect(pending.collision?.replaceable).toBe(false);
    operations.resolve(id, 'replace', false);
    const job = await waitFor(id);
    expect(job.errors[0]?.message).toContain('contains the source');
    expect(await readFile(path.join(inner, 'keep.txt'), 'utf8')).toBe('inner data');
    expect(await readdir(trash)).toEqual([]);
  });
  it('keeps the existing item when its replacement cannot be produced', async () => {
    const archive = path.join(root, 'Broken.zip');
    await writeFile(archive, 'not a zip archive');
    const existing = path.join(destination, 'Broken');
    await mkdir(existing);
    await writeFile(path.join(existing, 'work.txt'), 'keep me');
    const id = operations.start({ kind: 'extract', sources: [archive], destination });
    await waitFor(id, (job) => job.status === 'collision');
    operations.resolve(id, 'replace', false);
    const job = await waitFor(id);
    expect(job.status).toBe('failed');
    expect(await readFile(path.join(existing, 'work.txt'), 'utf8')).toBe('keep me');
    expect(await replaced('Broken')).toEqual([]);
  });
  it('keeps an existing item that changed after Replace was chosen', async () => {
    const source = path.join(root, 'report.txt');
    await writeFile(source, 'incoming');
    const existing = path.join(destination, 'report.txt');
    await writeFile(existing, 'old');
    const id = operations.start({ kind: 'copy', sources: [source], destination });
    await waitFor(id, (job) => job.status === 'collision');
    await writeFile(existing, 'a newer save made while the prompt was open');
    operations.resolve(id, 'replace', false);
    const job = await waitFor(id);
    expect(job.errors[0]?.message).toContain('changed after Replace');
    expect(await readFile(existing, 'utf8')).toBe('a newer save made while the prompt was open');
    expect(await replaced('report')).toEqual([]);
  });
  it('does not let a new folder replace an existing item', async () => {
    const existing = path.join(destination, 'Projects');
    await mkdir(existing);
    await writeFile(path.join(existing, 'plan.txt'), 'work');
    const id = operations.start({ kind: 'mkdir', sources: [], destination, name: 'Projects' });
    const pending = await waitFor(id, (job) => job.status === 'collision');
    expect(pending.collision?.replaceable).toBe(false);
    operations.resolve(id, 'replace', false);
    await waitFor(id);
    expect(await readFile(path.join(existing, 'plan.txt'), 'utf8')).toBe('work');
    expect(await readdir(trash)).toEqual([]);
  });
  it('reports a completed Trash whose Undo record could not be kept', async () => {
    const source = path.join(root, 'old.txt');
    await writeFile(source, 'old');
    operations = new Operations(
      async (file) => {
        const target = path.join(trash, 'old.txt');
        await rename(file, target);
        return { path: target, directory: false };
      },
      () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      async () => {
        throw new Error('Generated bookmark failure');
      },
    );
    const job = await run({ kind: 'trash', sources: [source] });
    expect(job.status).toBe('completed');
    expect(job.completed).toHaveLength(1);
    expect(job.errors[0]?.message).toContain('Undo is unavailable');
  });
  it('says Undo is unavailable for a trashed folder too large to check before putting it back', async () => {
    // Over 10,000 items the folder cannot be proven unchanged, so it has no Undo; the job completed
    // without a word of it, as if Undo would bring the folder back.
    const source = path.join(root, 'many items');
    await mkdir(source);
    await writeFile(path.join(source, 'one.txt'), 'one');
    operations = new Operations(
      async (file) => {
        const target = path.join(trash, path.basename(file));
        await rename(file, target);
        return { path: target, directory: true };
      },
      () => {},
    );
    const job = await run({ kind: 'trash', sources: [source] });
    expect(job.status).toBe('completed');
    expect(job.completed).toHaveLength(1);
    expect(job.errors).toHaveLength(1);
    expect(job.errors[0]?.message).toContain('Undo is unavailable');
    expect(job.errors[0]?.message).toContain('10,000');
  });
  it('sets an unreadable operation journal aside and keeps working', async () => {
    const dataPath = path.join(root, 'private');
    await mkdir(dataPath);
    await writeFile(path.join(dataPath, 'operation-journal-v1.json'), '{ not json');
    const notices: string[] = [];
    operations = new Operations(
      async () => {},
      () => {},
      undefined,
      undefined,
      undefined,
      dataPath,
      undefined,
      (notice) => notices.push(notice),
    );
    const source = path.join(root, 'after.txt');
    await writeFile(source, 'works');
    const job = await run({ kind: 'copy', sources: [source], destination });
    expect(job.status).toBe('completed');
    expect(notices).toHaveLength(1);
    const kept = (await readdir(dataPath)).find((name) => name.includes('.unreadable-'));
    expect(await readFile(path.join(dataPath, kept!), 'utf8')).toBe('{ not json');
  });
  it('journals the hidden intermediate of a case-only rename before using it', async () => {
    const source = path.join(root, 'Case.txt');
    await writeFile(source, 'x');
    if (!(await caseInsensitive(source))) return;
    const staged: string[] = [];
    const record = OperationLog.prototype.record;
    vi.spyOn(OperationLog.prototype, 'record').mockImplementation(function (
      this: OperationLog,
      receipt,
    ) {
      if (receipt.intent?.staging) staged.push(receipt.intent.staging);
      return record.call(this, receipt);
    });
    operations = new Operations(
      async () => {},
      () => {},
      undefined,
      undefined,
      undefined,
      path.join(root, 'private'),
    );
    const job = await run({ kind: 'rename', sources: [source], name: 'case.txt' });
    expect(job.status, JSON.stringify(job.errors)).toBe('completed');
    expect(staged.some((file) => path.basename(file).startsWith('.viewer-rename-'))).toBe(true);
  });
  it('rejects reviewed versions that no longer match the operation sources', () => {
    expect(() =>
      operations.start({
        kind: 'trash',
        sources: [path.join(root, 'a.txt')],
        expectedSources: [
          {
            path: path.join(root, 'elsewhere.txt'),
            version: { identity: '1:1', modified: 0, size: 0 },
          },
        ],
      }),
    ).toThrow('no longer match');
  });
});
describe('protected folders', () => {
  it('refuses to trash, move or replace Home and its standard folders for any request', async () => {
    const home = path.join(root, 'home');
    const desktop = path.join(home, 'Desktop'),
      documents = path.join(home, 'Documents');
    await mkdir(desktop, { recursive: true });
    await mkdir(documents);
    await writeFile(path.join(desktop, 'note.txt'), 'inside is fine');
    operations = new Operations(
      async (file) => {
        await rename(file, path.join(trash, path.basename(file) + '-' + crypto.randomUUID()));
      },
      () => undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new ProtectedPaths(home),
    );
    const cases: [OperationRequest, string][] = [
      [{ kind: 'trash', sources: [desktop] }, desktop],
      [{ kind: 'trash', sources: [home] }, home],
      [{ kind: 'move', sources: [documents], destination }, documents],
      [{ kind: 'rename', sources: [documents], name: 'Old documents' }, documents],
    ];
    for (const [request, folder] of cases) {
      const job = await run(request);
      expect(job.errors[0]?.message, request.kind).toContain('protected folder');
      expect((await lstat(folder)).isDirectory()).toBe(true);
    }
    const replacement = path.join(root, 'Desktop');
    await mkdir(replacement);
    const id = operations.start({ kind: 'copy', sources: [replacement], destination: home });
    await waitFor(id, (job) => job.status === 'collision');
    operations.resolve(id, 'replace', false);
    expect((await waitFor(id)).errors[0]?.message).toContain('protected folder');
    expect(await readFile(path.join(desktop, 'note.txt'), 'utf8')).toBe('inside is fine');
    const inside = await run({ kind: 'trash', sources: [path.join(desktop, 'note.txt')] });
    expect(inside.status).toBe('completed');
  });
});
describe('file operation redo', () => {
  it('redoes an undone move as a new job and only for the items Undo restored', async () => {
    const source = path.join(root, 'draft.txt');
    await writeFile(source, 'draft');
    const moved = await run({ kind: 'move', sources: [source], destination });
    await operations.undo(moved.id);
    expect(operations.all().find((job) => job.id === moved.id)?.redoable).toBe(true);
    const again = await waitFor(operations.redo(moved.id));
    expect(again.status).toBe('completed');
    expect(await readFile(path.join(destination, 'draft.txt'), 'utf8')).toBe('draft');
    expect(() => operations.redo(moved.id)).toThrow('cannot be redone');
    // A file replaced at the restored path after Undo is not acted on.
    await operations.undo(again.id);
    await trashFixtureEntry(source);
    await writeFile(source, 'a different file now');
    const refused = await waitFor(operations.redo(again.id));
    expect(refused.errors[0]?.message).toContain('changed after review');
    expect(await readFile(source, 'utf8')).toBe('a different file now');
  });
  it('ends the redo offer when another operation starts', async () => {
    const source = path.join(root, 'note.txt');
    await writeFile(source, 'note');
    const copied = await run({ kind: 'copy', sources: [source], destination });
    await operations.undo(copied.id);
    expect(operations.all().find((job) => job.id === copied.id)?.redoable).toBe(true);
    await run({ kind: 'mkdir', sources: [], destination, name: 'Other' });
    expect(operations.all().find((job) => job.id === copied.id)?.redoable).toBe(false);
    expect(() => operations.redo(copied.id)).toThrow('cannot be redone');
  });
});
describe('reviewed work that waits (2026-10-20)', () => {
  /** A copy held at its collision prompt, which keeps the queue's current job busy. */
  async function held(name = 'held.txt') {
    const file = path.join(root, name);
    await writeFile(file, 'new');
    await writeFile(path.join(destination, name), 'old');
    const id = operations.start({ kind: 'copy', sources: [file], destination });
    await waitFor(id, (job) => job.status === 'collision');
    return id;
  }
  it.each(['copy', 'move'] as const)(
    'checks the reviewed source again once its collision is decided (%s)',
    async (kind) => {
      // A collision prompt can stay open indefinitely, and the source was checked only as its
      // item started: a file edited meanwhile was copied or moved.
      const source = path.join(root, 'a.txt');
      await writeFile(source, 'reviewed');
      await writeFile(path.join(destination, 'a.txt'), 'existing');
      const version = sourceVersion(await entry(source));
      const id = operations.start({
        kind,
        sources: [source],
        destination,
        expectedSources: [{ path: source, version }],
      });
      await waitFor(id, (job) => job.status === 'collision');
      await writeFile(source, 'edited after the review');
      operations.resolve(id, 'keep-both', false);
      const job = await waitFor(id);
      expect(job.errors[0]?.message).toContain('changed after review');
      expect(await readdir(destination)).toEqual(['a.txt']);
      expect(await readFile(source, 'utf8')).toBe('edited after the review');
    },
  );
  it.each(['cancelled', 'failed'] as const)(
    'does not offer again an Undo interrupted on a %s job',
    async (status) => {
      // A forward job clears its intent before its last record, so an intent beside a finished
      // status is an Undo's; only a completed job's was recognised.
      const dataPath = path.join(root, 'private'),
        source = path.join(root, 'original.txt');
      await writeFile(source, 'original');
      const restore = () =>
        new Operations(
          async () => {},
          () => {},
          undefined,
          undefined,
          undefined,
          dataPath,
        );
      operations = restore();
      const copied = await run({ kind: 'copy', sources: [source], destination });
      await operations.close();
      const journal = new OperationLog(dataPath),
        [receipt] = (await journal.load()).receipts;
      receipt.job.status = status;
      receipt.intent = { source: path.join(destination, 'original.txt') };
      await journal.compact(receipt);
      operations = restore();
      await operations.load();
      expect(operations.all()[0]).toMatchObject({ undoable: false });
      await expect(operations.undo(copied.id)).rejects.toThrow('cannot be undone');
    },
  );
  it("checks a reviewed folder's contents again inside the Trash it waited to run", async () => {
    // The agent's approval compared the folder's contents once. Queued behind other work, the
    // Trash ran later with the folder entry's version only, which a nested edit does not change.
    const folder = path.join(root, 'Folder');
    await mkdir(path.join(folder, 'inner'), { recursive: true });
    await writeFile(path.join(folder, 'inner', 'a.txt'), 'a');
    const holder = await held();
    const id = operations.start({
      kind: 'trash',
      sources: [folder],
      expectedSources: [{ path: folder, version: sourceVersion(await entry(folder)) }],
      expectedContents: [{ path: folder, proof: (await outputProof(folder))! }],
    });
    await writeFile(path.join(folder, 'inner', 'new.txt'), 'added after the approval');
    operations.resolve(holder, 'skip', false);
    const job = await waitFor(id);
    expect(job.status).toBe('failed');
    expect(job.errors[0]?.message).toContain('changed after review');
    expect((await lstat(folder)).isDirectory()).toBe(true);
    expect(await readdir(trash)).toEqual([]);
  });
  it('drops the Trash Undo of an item put back from the Trash', async () => {
    // Restored from the Trash browser, the item kept its job's Trash step: Undo stayed offered and
    // failed with a raw ENOENT, and the Trash still showed it as Viewer's.
    operations = new Operations(
      async (file) => {
        const directory = (await lstat(file)).isDirectory(),
          target = path.join(trash, crypto.randomUUID());
        await rename(file, target);
        return { path: target, directory };
      },
      () => {},
    );
    const source = path.join(root, 'restored.txt');
    await writeFile(source, 'original');
    const job = await run({ kind: 'trash', sources: [source] });
    expect(job.undoable).toBe(true);
    const [origin] = await operations.trashOrigins();
    await rename(origin!.file, source);
    await operations.trashRestored(origin!.file);
    expect(operations.all().find((item) => item.id === job.id)?.undoable).toBe(false);
    expect(await operations.trashOrigins()).toEqual([]);
  });
  it('lets an Eject or a revoke through while an unrelated job waits at its prompt', async () => {
    // quiesce waited for the whole queue, so an unanswered prompt anywhere held it.
    const holder = await held();
    const outcome = await Promise.race([
      operations.quiesce(path.join(root, 'elsewhere')).then(() => 'done'),
      new Promise((resolve) => setTimeout(() => resolve('blocked'), 300)),
    ]);
    expect(outcome).toBe('done');
    expect(operations.all().find((job) => job.id === holder)?.status).toBe('collision');
  });
  describe('an Undo beside a waiting prompt (2026-10-21)', () => {
    // Undo waited for the whole queue, so an unanswered prompt anywhere held every Undo behind it.
    let hold: { file: string; reached: boolean; release: () => void } | undefined;
    let released = Promise.resolve();
    /** Holds the next access check of `file`: an Undo's first step, once it has started. */
    const holdAt = (file: string) => {
      let release!: () => void;
      released = new Promise<void>((resolve) => {
        release = resolve;
      });
      hold = { file, reached: false, release };
      return hold;
    };
    beforeEach(async () => {
      await operations.close();
      hold = undefined;
      operations = new Operations(
        async (file) => {
          await rename(file, path.join(trash, path.basename(file) + '-' + crypto.randomUUID()));
        },
        () => undefined,
        undefined,
        undefined,
        async (files) => {
          if (!hold || !files.includes(hold.file)) return;
          hold.reached = true;
          await released;
        },
      );
    });
    const status = (id: string) => operations.all().find((job) => job.id === id)?.status;
    const settles = (work: Promise<unknown>, wait = 300) =>
      Promise.race([
        work.then(
          () => 'done',
          () => 'failed',
        ),
        new Promise((resolve) => setTimeout(() => resolve('waiting'), wait)),
      ]);
    /** A completed move in a folder of its own, which no held job involves. */
    async function elsewhere() {
      const folder = path.join(root, 'other');
      await mkdir(path.join(folder, 'moved'), { recursive: true });
      const original = path.join(folder, 'a.txt');
      await writeFile(original, 'a');
      const { id } = await run({
        kind: 'move',
        sources: [original],
        destination: path.join(folder, 'moved'),
      });
      return { id, original, moved: path.join(folder, 'moved', 'a.txt') };
    }
    it('runs an unrelated Undo while a job waits at its prompt; a related one waits', async () => {
      const near = path.join(root, 'near.txt');
      await writeFile(near, 'near');
      const related = await run({ kind: 'move', sources: [near], destination });
      const unrelated = await elsewhere();
      const holder = await held();
      expect(await settles(operations.undo(unrelated.id), 3000)).toBe('done');
      expect(await readFile(unrelated.original, 'utf8')).toBe('a');
      expect(status(holder)).toBe('collision');
      // it would put a file back into the folder the held job copies into
      const waiting = operations.undo(related.id);
      expect(await settles(waiting)).toBe('waiting');
      operations.resolve(holder, 'skip', false);
      await waiting;
      expect(await readFile(near, 'utf8')).toBe('near');
    });
    it('holds the answered job, and a job queued meanwhile, until the Undo ends', async () => {
      const unrelated = await elsewhere();
      const holder = await held();
      const gate = holdAt(unrelated.moved);
      const undoing = operations.undo(unrelated.id);
      await vi.waitFor(() => expect(gate.reached).toBe(true), { timeout: 3000 });
      const later = operations.start({ kind: 'mkdir', sources: [], destination, name: 'Later' });
      operations.resolve(holder, 'replace', false);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await readFile(path.join(destination, 'held.txt'), 'utf8')).toBe('old');
      expect(status(later)).toBe('queued');
      gate.release();
      await undoing;
      expect((await waitFor(holder)).status).toBe('completed');
      expect(await readFile(path.join(destination, 'held.txt'), 'utf8')).toBe('new');
      expect((await waitFor(later)).status).toBe('completed');
    });
    it('closes only once an Undo running beside a prompt has ended', async () => {
      const unrelated = await elsewhere();
      const holder = await held();
      const gate = holdAt(unrelated.moved);
      const undoing = operations.undo(unrelated.id);
      await vi.waitFor(() => expect(gate.reached).toBe(true), { timeout: 3000 });
      const closing = operations.close();
      expect(await settles(closing, 100)).toBe('waiting');
      gate.release();
      await Promise.all([closing, undoing]);
      expect(await readFile(unrelated.original, 'utf8')).toBe('a');
      expect(status(holder)).toBe('cancelled');
    });
    it('runs one Undo when it is asked for twice', async () => {
      const unrelated = await elsewhere();
      await Promise.all([operations.undo(unrelated.id), operations.undo(unrelated.id)]);
      expect(await readFile(unrelated.original, 'utf8')).toBe('a');
    });
    it('waits while a paused rename would write beside what the Undo puts back', async () => {
      const folder = path.join(root, 'folder');
      const away = path.join(root, 'away');
      await mkdir(folder);
      await mkdir(away);
      await writeFile(path.join(folder, 'sibling.txt'), 'sibling');
      const moved = await run({
        kind: 'move',
        sources: [path.join(folder, 'sibling.txt')],
        destination: away,
      });
      await writeFile(path.join(folder, 'x.txt'), 'x');
      await writeFile(path.join(folder, 'y.txt'), 'y');
      const renaming = operations.start({
        kind: 'rename',
        sources: [path.join(folder, 'x.txt')],
        name: 'y.txt',
      });
      await waitFor(renaming, (job) => job.status === 'collision');
      const waiting = operations.undo(moved.id);
      expect(await settles(waiting)).toBe('waiting');
      operations.resolve(renaming, 'skip', false);
      await waiting;
      expect(await readFile(path.join(folder, 'sibling.txt'), 'utf8')).toBe('sibling');
    });
  });
  it('counts what Quit would cancel, and says when it is done (2026-10-21)', async () => {
    // Quit asks before cancelling: a job waiting at its prompt counts until it is answered.
    const holder = await held();
    expect(operations.pendingCount()).toBe(1);
    let drained = false;
    const done = operations.drained().then(() => {
      drained = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(drained).toBe(false);
    operations.resolve(holder, 'skip', false);
    await done;
    expect(operations.pendingCount()).toBe(0);
  });
  it('still waits for a related job, which it cancels', async () => {
    const holder = await held();
    await operations.quiesce(root);
    expect(operations.all().find((job) => job.id === holder)?.status).toBe('cancelled');
  });
});
/**
 * SAVING TEXT (2026-10-23). An edited preview saves through the queue's own guarantees: the version a
 * save replaces goes to the Trash with an Undo step, and nothing is overwritten that was not checked.
 */
describe('saving text', () => {
  const receipts = async (file: string) => {
    const directory = (await lstat(file)).isDirectory(),
      target = path.join(trash, crypto.randomUUID());
    await rename(file, target);
    return { path: target, directory };
  };
  const version = async (file: string) => sourceVersion(await entry(file));
  beforeEach(() => {
    operations = new Operations(receipts, () => {});
  });
  it('moves the version it replaces to the Trash, and Undo puts it back', async () => {
    const file = path.join(root, 'notes.txt');
    await writeFile(file, 'before');
    const job = await operations.writeText(file, 'after', { version: await version(file) });
    expect(job).toMatchObject({ kind: 'rewrite', status: 'completed', undoable: true });
    expect(await readFile(file, 'utf8')).toBe('after');
    const trashed = await readdir(trash);
    expect(trashed).toHaveLength(1);
    expect(await readFile(path.join(trash, trashed[0]!), 'utf8')).toBe('before');
    await operations.undo(job.id);
    expect(await readFile(file, 'utf8')).toBe('before');
    // the saved version went to the Trash in its turn, rather than being deleted
    const after = await Promise.all(
      (await readdir(trash)).map((name) => readFile(path.join(trash, name), 'utf8')),
    );
    expect(after).toEqual(['after']);
    // the text is not kept, so nothing can run it again
    expect(operations.all().find((item) => item.id === job.id)?.redoable).toBeFalsy();
    expect(() => operations.redo(job.id)).toThrow('cannot be redone');
  });
  it('refuses a file that changed since it was read, and keeps it', async () => {
    const file = path.join(root, 'notes.txt');
    await writeFile(file, 'before');
    const read = await version(file);
    await writeFile(file, 'someone else');
    await expect(operations.writeText(file, 'after', { version: read })).rejects.toThrow('changed');
    expect(await readFile(file, 'utf8')).toBe('someone else');
    expect(await readdir(trash)).toEqual([]);
    // a hash that does not match is refused even when the version looks the same
    await expect(
      operations.writeText(file, 'after', { version: await version(file), sha256: '0'.repeat(64) }),
    ).rejects.toThrow('changed');
    expect(await readFile(file, 'utf8')).toBe('someone else');
  });
  it("keeps the file's permissions", async () => {
    const file = path.join(root, 'run.sh');
    await writeFile(file, 'echo one\n', { mode: 0o755 });
    await operations.writeText(file, 'echo two\n', { version: await version(file) });
    expect((await lstat(file)).mode & 0o777).toBe(0o755);
  });
  it('refuses a symbolic link, which would be replaced by a file', async () => {
    const file = path.join(root, 'target.txt'),
      link = path.join(root, 'link.txt');
    await writeFile(file, 'before');
    await symlink(file, link);
    await expect(
      operations.writeText(link, 'after', { version: sourceVersion(await entry(link)) }),
    ).rejects.toThrow('link');
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readFile(file, 'utf8')).toBe('before');
  });
  it('journals the hash of the text, never the text', async () => {
    const dataPath = path.join(root, 'private');
    operations = new Operations(receipts, () => {}, undefined, undefined, undefined, dataPath);
    const file = path.join(root, 'secret.txt');
    await writeFile(file, 'before');
    await operations.writeText(file, 'a private sentence', { version: await version(file) });
    await operations.close();
    const journal = (
      await Promise.all(
        (await readdir(dataPath, { recursive: true })).map((name) =>
          readFile(path.join(dataPath, name), 'utf8').catch(() => ''),
        ),
      )
    ).join('');
    expect(journal).toContain('textSHA256');
    expect(journal).not.toContain('a private sentence');
    // and the journal still loads
    operations = new Operations(receipts, () => {}, undefined, undefined, undefined, dataPath);
    await operations.load();
    expect(operations.all()[0]).toMatchObject({ kind: 'rewrite', status: 'completed' });
  });
  it('creates a new file with the text, which Undo moves to the Trash', async () => {
    const file = path.join(root, 'Untitled.txt');
    const job = await operations.writeText(file, 'scratch');
    expect(job).toMatchObject({ kind: 'mkfile', status: 'completed', undoable: true });
    expect(await readFile(file, 'utf8')).toBe('scratch');
    await expect(operations.writeText(file, 'again')).rejects.toThrow('exists');
    expect(await readFile(file, 'utf8')).toBe('scratch');
    await operations.undo(job.id);
    await expect(lstat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(trash)).toHaveLength(1);
  });
  it('is not held behind another job waiting at its prompt', async () => {
    const source = path.join(root, 'one.txt');
    await writeFile(source, 'new');
    await writeFile(path.join(destination, 'one.txt'), 'old');
    const waiting = operations.start({ kind: 'copy', sources: [source], destination });
    await waitFor(waiting, (job) => job.status === 'collision');
    const file = path.join(root, 'notes.txt');
    await writeFile(file, 'before');
    await operations.writeText(file, 'after', { version: await version(file) });
    expect(await readFile(file, 'utf8')).toBe('after');
    expect(operations.all().find((job) => job.id === waiting)?.status).toBe('collision');
    operations.cancel(waiting);
  });
  it('refuses text over the 4 MiB limit before touching anything', async () => {
    const file = path.join(root, 'notes.txt');
    await writeFile(file, 'before');
    await expect(
      operations.writeText(file, 'é'.repeat(2 * 1024 * 1024 + 1), {
        version: await version(file),
      }),
    ).rejects.toThrow('4 MiB');
    expect(await readFile(file, 'utf8')).toBe('before');
  });
  it('cannot be started as an ordinary operation', () => {
    expect(() => operations.start({ kind: 'rewrite', sources: [path.join(root, 'x')] })).toThrow(
      'Save',
    );
  });
});
