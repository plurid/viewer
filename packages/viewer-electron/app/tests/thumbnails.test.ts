import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const native = vi.hoisted(() => ({ thumbnail: vi.fn(), fromBuffer: vi.fn() }));
vi.mock('electron', () => ({
  nativeImage: {
    createThumbnailFromPath: native.thumbnail,
    createFromBuffer: native.fromBuffer,
  },
}));
import { Thumbnails } from '../src/desktop/previews/thumbnails';
import { cameraRawFormats } from '../src/domain/previews/images/rendered';

let root: string, first: string, second: string, thumbnails: Thumbnails;
beforeEach(async () => {
  root = await temporaryRoot('viewer-thumbnail-scopes-');
  first = path.join(root, 'first');
  second = path.join(root, 'second');
  await Promise.all([mkdir(first), mkdir(second)]);
  await Promise.all([
    writeFile(path.join(first, 'image.png'), 'first'),
    writeFile(path.join(second, 'image.png'), 'second'),
  ]);
  native.thumbnail.mockReset();
  native.fromBuffer.mockReset();
  native.thumbnail.mockImplementation(async (file: string) => ({
    toDataURL: () => 'generated:' + file,
  }));
  thumbnails = new Thumbnails();
});
afterEach(async () => {
  await thumbnails.close();
  await trashTemporary(root);
});
describe('thumbnail permission lifetime', () => {
  it('keeps every supported camera RAW thumbnail out of the shared macOS service', async () => {
    const data = Buffer.from('isolated camera JPEG');
    const release = vi.fn();
    const read = vi.fn(async () => ({
      value: { data, extension: 'jpg' as const, kind: 'camera' as const, decoder: 'test' },
      release,
    }));
    const resize = vi.fn(() => ({ toDataURL: () => 'data:image/png;base64,isolated' }));
    native.fromBuffer.mockReturnValue({
      isEmpty: () => false,
      getSize: () => ({ width: 800, height: 400 }),
      resize,
    });
    const isolated = new Thumbnails({ read });
    try {
      for (const format of cameraRawFormats) {
        const file = path.join(first, 'camera.' + format.toUpperCase());
        await writeFile(file, 'camera bytes');
        expect(await isolated.get(file, 128)).toBe('data:image/png;base64,isolated');
        expect(read).toHaveBeenLastCalledWith(file, 'camera', expect.any(AbortSignal));
      }
      expect(native.thumbnail).not.toHaveBeenCalled();
      expect(native.fromBuffer).toHaveBeenCalledWith(data);
      expect(release).toHaveBeenCalledTimes(cameraRawFormats.length);
      expect(resize).toHaveBeenCalledWith({ width: 128, height: 64 });
    } finally {
      await isolated.close();
    }
  });

  it('never falls back to the shared thumbnail service when the RAW decoder is unavailable or fails', async () => {
    const file = path.join(first, 'camera.NEF');
    await writeFile(file, 'camera bytes');
    expect(await thumbnails.get(file, 128)).toBe('');
    const isolated = new Thumbnails({
      read: vi.fn(async () => {
        throw new Error('Decoder timed out');
      }),
    });
    try {
      expect(await isolated.get(file, 128)).toBe('');
      expect(native.thumbnail).not.toHaveBeenCalled();
    } finally {
      await isolated.close();
    }
  });

  it('releases isolated camera bytes even if thumbnail encoding fails', async () => {
    const file = path.join(first, 'camera.NEF');
    await writeFile(file, 'camera bytes');
    const release = vi.fn();
    const isolated = new Thumbnails({
      read: vi.fn(async () => ({
        value: {
          data: Buffer.from('camera JPEG'),
          extension: 'jpg' as const,
          kind: 'camera' as const,
          decoder: 'test',
        },
        release,
      })),
    });
    native.fromBuffer.mockImplementation(() => {
      throw new Error('Image encoding failed');
    });
    try {
      expect(await isolated.get(file, 128)).toBe('');
      expect(release).toHaveBeenCalledOnce();
      expect(native.thumbnail).not.toHaveBeenCalled();
    } finally {
      await isolated.close();
    }
  });

  it('cancels a pending RAW thumbnail when its folder access is revoked', async () => {
    const file = path.join(first, 'camera.NEF');
    await writeFile(file, 'camera bytes');
    let active: AbortSignal | undefined;
    const read = vi.fn(async (_file, _mode, signal: AbortSignal) => {
      active = signal;
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      throw new Error('Cancelled RAW decoder must not return an image');
    });
    const isolated = new Thumbnails({ read });
    try {
      const pending = isolated.get(file, 128);
      await vi.waitFor(() => expect(active).toBeDefined());
      await isolated.quiesce(first);
      expect(active!.aborted).toBe(true);
      expect(await pending).toBe('');
      expect(native.thumbnail).not.toHaveBeenCalled();
    } finally {
      await isolated.close();
    }
  });

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
