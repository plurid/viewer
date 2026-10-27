import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TextBuffers, type TextBuffer } from '../src/desktop/editing/text-buffers';
import type { ReviewedFile } from '../src/desktop/native/reviewed-file';
import * as directorySync from '../src/desktop/persistence/directory-sync';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string;
let buffers: TextBuffers;
const trash = vi.fn<(file: ReviewedFile) => Promise<void>>();
const draft: TextBuffer = {
  id: 'd4f6de5b-28fd-479e-8bc4-37866fef2d59',
  kind: 'scratch',
  text: 'Recoverable saved draft',
  revision: 1,
  updated: 1,
};
const file = () => path.join(root, 'text-buffers', draft.id + '.json');

beforeEach(async () => {
  root = await temporaryRoot('viewer-buffer-trash-');
  trash.mockReset().mockResolvedValue(undefined);
  buffers = new TextBuffers(root, trash);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await buffers.close();
  await trashTemporary(root);
});

describe('recoverable text-buffer retirement', () => {
  it('retries the same revision after a draft publication reports a durability failure', async () => {
    const sync = vi.spyOn(directorySync, 'syncParentDirectory');
    sync.mockRejectedValueOnce(new Error('Directory synchronization failed'));
    await expect(buffers.write(draft)).rejects.toThrow('synchronization failed');
    await expect(buffers.write(draft)).resolves.toBeUndefined();
    expect(sync).toHaveBeenCalledTimes(2);
    expect(await buffers.read(draft.id)).toEqual(draft);
  });

  it('does not let an older write replace an unacknowledged newer revision', async () => {
    const sync = vi.spyOn(directorySync, 'syncParentDirectory');
    sync.mockRejectedValueOnce(new Error('Directory synchronization failed'));
    const latest = { ...draft, text: 'Latest recoverable edit', revision: 2 };
    await expect(buffers.write(latest)).rejects.toThrow('synchronization failed');
    await buffers.write(draft);
    await buffers.write(latest);
    expect(sync).toHaveBeenCalledTimes(2);
    expect(await buffers.read(draft.id)).toEqual(latest);
  });

  it('delegates one exact private document and its inspected version to the Trash adapter', async () => {
    await buffers.write(draft);
    const bytes = await readFile(file());
    await buffers.discard(draft.id);
    expect(trash).toHaveBeenCalledExactlyOnceWith({
      path: file(),
      version: expect.objectContaining({ size: bytes.length }),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    // This adapter records the request without moving fixtures. No permanent-removal fallback runs.
    expect(await readFile(file())).toEqual(bytes);
  });

  it('keeps a failed retirement readable and retryable', async () => {
    await buffers.write(draft);
    trash.mockRejectedValueOnce(new Error('Trash unavailable'));
    await expect(buffers.discard(draft.id)).rejects.toThrow('Trash unavailable');
    expect(await buffers.read(draft.id)).toEqual(draft);
    expect(await buffers.list()).toHaveLength(1);
    await buffers.discard(draft.id);
    expect(trash).toHaveBeenCalledTimes(2);
  });

  it('does not ask to remove a buffer that has never reached disk', async () => {
    await buffers.discard(draft.id);
    expect(trash).not.toHaveBeenCalled();
  });

  it('refuses a symbolic link at the document', async () => {
    const target = path.join(root, 'other.json');
    await mkdir(path.dirname(file()));
    await writeFile(target, JSON.stringify(draft), { flag: 'wx' });
    await symlink(target, file());
    await expect(buffers.discard(draft.id)).rejects.toThrow();
    expect(trash).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual(draft);
  });

  it('refuses a linked private buffer directory', async () => {
    const target = path.join(root, 'Other');
    await mkdir(target);
    await symlink(target, path.dirname(file()));
    await writeFile(path.join(target, draft.id + '.json'), JSON.stringify(draft), { flag: 'wx' });
    await expect(buffers.discard(draft.id)).rejects.toThrow(/folder|directory/i);
    expect(trash).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(file(), 'utf8'))).toEqual(draft);
  });

  it('keeps unreadable documents instead of removing them', async () => {
    await mkdir(path.dirname(file()));
    await writeFile(file(), '{invalid', { flag: 'wx' });
    await expect(buffers.discard(draft.id)).rejects.toThrow();
    expect(trash).not.toHaveBeenCalled();
    expect(await readFile(file(), 'utf8')).toBe('{invalid');
  });

  it('serializes retirement with a later stale write and cannot resurrect that buffer', async () => {
    await buffers.write(draft);
    let release!: () => void;
    trash.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const retirement = buffers.discard(draft.id);
    await vi.waitFor(() => expect(release).toBeDefined());
    const late = buffers.write({ ...draft, text: 'Late stale revision', revision: 2 });
    const rejected = expect(late).rejects.toThrow(/discard|retir|Trash/i);
    release();
    await retirement;
    await rejected;
    expect(JSON.parse(await readFile(file(), 'utf8'))).toEqual(draft);
  });
});
