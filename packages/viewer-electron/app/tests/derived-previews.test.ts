import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DerivedPreviews } from '../src/desktop/previews/derived';
import { Resources } from '../src/desktop/previews/resources';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string;
const caches: DerivedPreviews[] = [];
beforeEach(async () => {
  root = await temporaryRoot('viewer-derived-');
});
afterEach(async () => {
  await Promise.all(caches.map((cache) => cache.close()));
  caches.length = 0;
  await trashTemporary(root);
});
const signal = () => new AbortController().signal;
const value = () => ({
  data: Buffer.alloc(8),
  extension: 'jpg' as const,
  kind: 'camera' as const,
  decoder: 'test',
});
const cache = (...args: ConstructorParameters<typeof DerivedPreviews>) => {
  const instance = new DerivedPreviews(...args);
  caches.push(instance);
  return instance;
};
describe('bounded derived preview leases', () => {
  it('separates image sizes and shares private rendered resources with the same captured source', async () => {
    const file = path.join(root, 'image.tiff');
    await writeFile(file, 'image source');
    const decode = vi.fn(async () => ({
      ...value(),
      extension: 'png' as const,
      kind: 'image' as const,
    }));
    const images = cache(async () => {}, decode);
    const small = await images.read(file, 'image', signal(), 128);
    small.release();
    const warm = await images.read(file, 'image', signal(), 128);
    warm.release();
    expect(decode).toHaveBeenCalledTimes(1);
    const large = await images.read(file, 'image', signal(), 512);
    large.release();
    expect(decode).toHaveBeenCalledTimes(2);
    const legacy = vi.fn(async () => {
      throw new Error('Shared renderer must not run');
    });
    const resources = new Resources(async () => {}, legacy, 12000, undefined, images);
    try {
      const source = await resources.grant(file);
      const output = await resources.rendition(source.id);
      expect(output.derivation?.kind).toBe('image');
      expect(legacy).not.toHaveBeenCalled();
      resources.release(source.id);
      await expect(resources.read(output.id)).rejects.toThrow('expired');
    } finally {
      await resources.close();
    }
  });

  it('shares exact-source bytes across views and warm opens, but separates processing mode and changed versions', async () => {
    const file = path.join(root, 'camera.nef');
    await writeFile(file, 'source');
    const decode = vi.fn(async () => value());
    const service = cache(async () => {}, decode);
    const [a, b] = await Promise.all([
      service.read(file, 'camera', signal()),
      service.read(file, 'camera', signal()),
    ]);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(a.value.data).toBe(b.value.data);
    a.release();
    b.release();
    const warm = await service.read(file, 'camera', signal());
    expect(warm.value.data).toBe(a.value.data);
    warm.release();
    const raw = await service.read(file, 'raw', signal());
    raw.release();
    expect(decode).toHaveBeenCalledTimes(2);
    await writeFile(file, 'new source');
    const changed = await service.read(file, 'camera', signal());
    changed.release();
    expect(decode).toHaveBeenCalledTimes(3);
  });
  it('accounts pinned bytes until the last view releases them and evicts only unpinned cache entries', async () => {
    const first = path.join(root, 'a.nef'),
      second = path.join(root, 'b.nef');
    await writeFile(first, 'a');
    await writeFile(second, 'b');
    const service = cache(
      async () => {},
      async () => value(),
      10,
    );
    const a = await service.read(first, 'camera', signal());
    await expect(service.read(second, 'camera', signal())).rejects.toThrow('cache is full');
    a.release();
    const b = await service.read(second, 'camera', signal());
    expect(b.value.data.length).toBe(8);
    b.release();
  });
  it('rechecks permission on a warm hit and rejects source mutations during decoding', async () => {
    const file = path.join(root, 'camera.nef');
    await writeFile(file, 'source');
    let allowed = true;
    const decode = vi.fn(async () => value());
    const service = cache(async () => {
      if (!allowed) throw new Error('revoked');
    }, decode);
    const a = await service.read(file, 'camera', signal());
    a.release();
    allowed = false;
    await expect(service.read(file, 'camera', signal())).rejects.toThrow('revoked');
    expect(decode).toHaveBeenCalledTimes(1);
    const changed = cache(
      async () => {},
      async () => {
        await writeFile(file, 'changed during decode');
        return value();
      },
    );
    await expect(changed.read(file, 'raw', signal())).rejects.toThrow('source changed');
  });
  it('cancels one subscriber without cancelling another, then stops the helper when its last subscriber closes', async () => {
    const file = path.join(root, 'camera.nef');
    await writeFile(file, 'source');
    let active: AbortSignal | undefined, resolve!: () => void;
    const decode = vi.fn(async (_source, _mode, input: AbortSignal) => {
      active = input;
      await new Promise<void>((done) => {
        resolve = done;
      });
      return value();
    });
    const service = cache(async () => {}, decode),
      first = new AbortController(),
      second = new AbortController();
    const a = service.read(file, 'camera', first.signal),
      b = service.read(file, 'camera', second.signal);
    await vi.waitFor(() => expect(active).toBeDefined());
    await new Promise((resolve) => setTimeout(resolve, 30));
    const rejected = expect(a).rejects.toThrow();
    first.abort();
    await rejected;
    expect(active!.aborted).toBe(false);
    resolve();
    const kept = await b;
    kept.release();
    expect(decode).toHaveBeenCalledTimes(1);
    const last = new AbortController();
    const pending = service.read(file, 'raw', last.signal);
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(2));
    const cancelled = expect(pending).rejects.toThrow();
    last.abort();
    await cancelled;
    expect(active!.aborted).toBe(true);
    resolve();
  });
  it('serves RAW bytes as scoped resources without invoking the system renderer and releases them with the parent', async () => {
    const file = path.join(root, 'camera.nef');
    await writeFile(file, 'source');
    const system = vi.fn();
    const service = cache(
      async () => {},
      async () => value(),
    );
    const resources = new Resources(async () => {}, system, 100, service);
    const source = await resources.grant(file),
      rendered = await resources.rendition(source.id, { requestID: 'camera', mode: 'camera' });
    expect(system).not.toHaveBeenCalled();
    expect(rendered.derivation?.kind).toBe('camera');
    expect((await resources.response(new Request(rendered.url))).status).toBe(200);
    resources.release(source.id);
    expect((await resources.response(new Request(rendered.url))).status).toBe(404);
    await resources.close();
  });
});
