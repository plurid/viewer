/**
 * On a volume without a Trash, as many network shares are, nothing is ever deleted. Move to Trash
 * refuses; the person's save or Replace keeps the previous version beside it under a free name and
 * says so; an agent's Replace refuses. The trash port reports such a volume as ENOTSUP, and only
 * that failure counts as one.
 */
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationJob, OperationRequest } from '../src/domain/contracts';
import { Operations, type OperationActor } from '../src/desktop/operations/operations';
import { entry } from '../src/desktop/files/filesystem';
import { sourceVersion } from '../src/domain/files/inspection';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string, destination: string, operations: Operations;
let refusal: NodeJS.ErrnoException;
const trash = vi.fn(async (_file: string) => {
  throw refusal;
});
beforeEach(async () => {
  root = await temporaryRoot('viewer-no-trash-');
  destination = path.join(root, 'Share');
  await mkdir(destination);
  refusal = Object.assign(new Error('The volume does not support the Trash.'), {
    code: 'ENOTSUP',
  });
  trash.mockClear();
  operations = new Operations(trash, () => undefined);
});
afterEach(async () => {
  await operations.close();
  await trashTemporary(root);
});

async function settled(id: string): Promise<OperationJob> {
  await vi.waitFor(
    () => {
      const job = operations.all().find((item) => item.id === id)!;
      expect(['completed', 'failed', 'cancelled', 'collision']).toContain(job.status);
    },
    { timeout: 10000, interval: 10 },
  );
  return operations.all().find((item) => item.id === id)!;
}
/** A copy over an existing item, answered Replace at its prompt. */
async function replaced(request: OperationRequest, actor: OperationActor = 'person') {
  const id = operations.start(request, actor);
  expect((await settled(id)).status).toBe('collision');
  operations.resolve(id, 'replace', false);
  await vi.waitFor(() =>
    expect(operations.all().find((item) => item.id === id)!.status).not.toBe('collision'),
  );
  return settled(id);
}

describe('a volume without a Trash', () => {
  it('refuses Move to Trash and leaves the item where it is', async () => {
    const file = path.join(destination, 'Budget.xlsx');
    await writeFile(file, 'figures', { flag: 'wx' });
    const job = await settled(operations.start({ kind: 'trash', sources: [file] }));
    expect(job.status).toBe('failed');
    expect(job.errors[0]?.message).toBe(
      'Budget.xlsx was not moved: this volume has no Trash, and Viewer never deletes items.',
    );
    expect(await readFile(file, 'utf8')).toBe('figures');
  });

  it('keeps the previous version beside a saved text file, and says so', async () => {
    const file = path.join(destination, 'Notes.md');
    await writeFile(file, 'before', { flag: 'wx' });
    const job = await operations.writeText(file, 'after', {
      version: sourceVersion(await entry(file)),
    });
    expect(job.status).toBe('completed');
    expect(await readFile(file, 'utf8')).toBe('after');
    const kept = path.join(destination, 'Notes (previous).md');
    expect(await readFile(kept, 'utf8')).toBe('before');
    expect(job.errors).toEqual([
      {
        path: kept,
        message:
          'This volume has no Trash, so the previous version was kept beside it as Notes (previous).md.',
      },
    ]);
  });

  it('keeps each replaced item beside its replacement under a free name', async () => {
    const source = path.join(root, 'Report.pdf');
    await writeFile(source, 'new', { flag: 'wx' });
    await writeFile(path.join(destination, 'Report.pdf'), 'old', { flag: 'wx' });
    await writeFile(path.join(destination, 'Report (previous).pdf'), 'older', { flag: 'wx' });
    const job = await replaced({ kind: 'copy', sources: [source], destination });
    expect(job.status).toBe('completed');
    expect(await readFile(path.join(destination, 'Report.pdf'), 'utf8')).toBe('new');
    expect(await readFile(path.join(destination, 'Report (previous).pdf'), 'utf8')).toBe('older');
    expect(await readFile(path.join(destination, 'Report (previous 2).pdf'), 'utf8')).toBe('old');
    expect(job.errors[0]?.message).toMatch(/kept beside it as Report \(previous 2\)\.pdf\.$/);
  });

  it('refuses an agent’s Replace, changing nothing', async () => {
    const source = path.join(root, 'Report.pdf');
    await writeFile(source, 'new', { flag: 'wx' });
    await writeFile(path.join(destination, 'Report.pdf'), 'old', { flag: 'wx' });
    const job = await replaced({ kind: 'copy', sources: [source], destination }, 'agent');
    expect(job.status).toBe('failed');
    expect(job.errors[0]?.message).toBe(
      'Report.pdf was not replaced: this volume has no Trash, and agents replace items only by moving them to the Trash.',
    );
    expect(await readFile(path.join(destination, 'Report.pdf'), 'utf8')).toBe('old');
    // the private stage stays under the test removal policy; nothing beside the item was made
    const visible = (await readdir(destination)).filter((name) => !name.startsWith('.viewer-'));
    expect(visible).toEqual(['Report.pdf']);
  });

  it('does not mistake another Trash failure for a volume without one', async () => {
    refusal = Object.assign(new Error('The Trash is not available right now.'), { code: 'EIO' });
    const source = path.join(root, 'Report.pdf');
    await writeFile(source, 'new', { flag: 'wx' });
    await writeFile(path.join(destination, 'Report.pdf'), 'old', { flag: 'wx' });
    const job = await replaced({ kind: 'copy', sources: [source], destination });
    expect(job.status).toBe('failed');
    expect(job.errors[0]?.message).toBe('The Trash is not available right now.');
    expect(await readFile(path.join(destination, 'Report.pdf'), 'utf8')).toBe('old');
    await expect(lstat(path.join(destination, 'Report (previous).pdf'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
