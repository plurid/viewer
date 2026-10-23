/**
 * UNSAVED TEXT IS KEPT (2026-10-23). Scratch planes and unsaved edits live in Viewer's profile, one
 * document per buffer, until they are saved or explicitly discarded: never because nothing refers to
 * them any more.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TextBuffers, type TextBuffer } from '../src/desktop/text-buffers';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string, buffers: TextBuffers;
beforeEach(async () => {
  root = await temporaryRoot('viewer-buffers-');
  buffers = new TextBuffers(root);
});
afterEach(async () => {
  await buffers.close();
  await trashTemporary(root);
});
const scratch = (text: string, revision = 1): TextBuffer => ({
  id: '6f1c2c0a-6a43-4c51-9e3e-6f3f0d3b9a01',
  kind: 'scratch',
  title: 'Untitled 1',
  language: 'markdown',
  text,
  revision,
  updated: 1,
});

describe('text buffers', () => {
  it('keeps a buffer across a restart', async () => {
    await buffers.write(scratch('draft'));
    await buffers.close();
    buffers = new TextBuffers(root);
    expect(await buffers.read(scratch('').id)).toMatchObject({
      text: 'draft',
      title: 'Untitled 1',
    });
    expect(await buffers.list()).toEqual([
      expect.objectContaining({
        id: scratch('').id,
        kind: 'scratch',
        title: 'Untitled 1',
        bytes: 5,
      }),
    ]);
  });
  it('lists buffers without their text', async () => {
    await buffers.write(scratch('a private sentence'));
    expect(JSON.stringify(await buffers.list())).not.toContain('a private sentence');
  });
  it('ignores a write older than the one it holds', async () => {
    await buffers.write(scratch('newer', 3));
    await buffers.write(scratch('older', 2));
    expect((await buffers.read(scratch('').id))?.text).toBe('newer');
  });
  it('removes a buffer only when it is discarded', async () => {
    await buffers.write(scratch('draft'));
    await buffers.discard(scratch('').id);
    expect(await buffers.read(scratch('').id)).toBeNull();
    expect(await buffers.list()).toEqual([]);
  });
  it('keeps an unreadable buffer file, and reports it', async () => {
    const directory = path.join(root, 'text-buffers');
    await buffers.write(scratch('draft'));
    const damaged = path.join(directory, '0b6f3a52-0a8e-4c7e-8d0f-58f3f3b7f1c2.json');
    await writeFile(damaged, '{"not a buffer"');
    const listed = await buffers.list();
    expect(listed.map((buffer) => buffer.id)).toEqual([scratch('').id]);
    expect(buffers.problems()).toEqual([expect.stringContaining('could not be read')]);
    expect(await readFile(damaged, 'utf8')).toBe('{"not a buffer"');
    expect((await readdir(directory)).sort()).toHaveLength(2);
  });
  it('refuses text over the 4 MiB limit', async () => {
    await expect(buffers.write(scratch('é'.repeat(2 * 1024 * 1024 + 1)))).rejects.toThrow('4 MiB');
  });
});
