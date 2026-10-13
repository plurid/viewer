import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const native = vi.hoisted(() => ({ thumbnail: vi.fn() }));
vi.mock('electron', () => ({ nativeImage: { createThumbnailFromPath: native.thumbnail } }));
import { Thumbnails } from '../src/desktop/thumbnails';

let root: string, first: string, second: string, thumbnails: Thumbnails;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'viewer-thumbnail-scopes-'));
  first = path.join(root, 'first');
  second = path.join(root, 'second');
  await Promise.all([mkdir(first), mkdir(second)]);
  await Promise.all([
    writeFile(path.join(first, 'image.png'), 'first'),
    writeFile(path.join(second, 'image.png'), 'second'),
  ]);
  native.thumbnail.mockReset();
  native.thumbnail.mockImplementation(async (file: string) => ({
    toDataURL: () => 'generated:' + file,
  }));
  thumbnails = new Thumbnails();
});
afterEach(async () => {
  await thumbnails.close();
  await rm(root, { recursive: true, force: true });
});
describe('thumbnail permission lifetime', () => {
  it('purges one folder while preserving an independent cached thumbnail', async () => {
    const a = path.join(first, 'image.png'),
      b = path.join(second, 'image.png');
    const firstValue = await thumbnails.get(a, 64);
    await thumbnails.get(b, 64);
    await thumbnails.quiesce(second);
    expect(await thumbnails.get(a, 64)).toBe(firstValue);
    expect(native.thumbnail).toHaveBeenCalledTimes(2);
    await thumbnails.get(b, 64);
    expect(native.thumbnail).toHaveBeenCalledTimes(3);
  });
  it('suppresses revoked bytes and lets an independent pending thumbnail finish', async () => {
    let resume!: () => void, entered!: () => void;
    const enteredNative = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    native.thumbnail.mockImplementationOnce(async (file: string) => {
      entered();
      await gate;
      return { toDataURL: () => 'generated:' + file };
    });
    const a = thumbnails.get(path.join(first, 'image.png'), 64);
    await enteredNative;
    const b = thumbnails.get(path.join(second, 'image.png'), 64);
    const drained = thumbnails.quiesce(second);
    resume();
    expect(await a).toContain(first);
    expect(await b).toBe('');
    await drained;
  });
});
