import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { Resources } from '../src/desktop/resources';
let root: string, resources: Resources;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'viewer-resources-'));
  resources = new Resources();
});
afterEach(async () => {
  resources.clear();
  await rm(root, { recursive: true, force: true });
});
describe('scoped preview resources', () => {
  it('streams explicit and suffix ranges for media seeking', async () => {
    const file = path.join(root, 'sound.wav');
    await writeFile(file, '0123456789');
    const grant = await resources.grant(file);
    const response = await resources.response(
      new Request(grant.url, { headers: { range: 'bytes=2-5' } }),
    );
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await response.text()).toBe('2345');
    expect(
      await (
        await resources.response(new Request(grant.url, { headers: { range: 'bytes=-3' } }))
      ).text(),
    ).toBe('789');
    expect(
      (await resources.response(new Request(grant.url, { headers: { range: 'bytes=20-' } })))
        .status,
    ).toBe(416);
  });
  it('bounds text reads and detects binary data', async () => {
    const text = path.join(root, 'large.txt');
    await writeFile(text, 'x'.repeat(100));
    const grant = await resources.grant(text);
    expect(await resources.read(grant.id, 10)).toMatchObject({
      text: 'xxxxxxxxxx',
      truncated: true,
      binary: false,
    });
    const binary = path.join(root, 'binary');
    await writeFile(binary, Buffer.from([0, 1, 2, 3]));
    expect((await resources.read((await resources.grant(binary)).id)).binary).toBe(true);
  });
  it('uses the target size and format for extensionless symbolic file links', async () => {
    const file = path.join(root, 'model.gltf'),
      link = path.join(root, 'linked-model');
    await writeFile(file, 'x'.repeat(1024));
    await symlink(file, link);
    const grant = await resources.grant(link);
    expect(grant.entry).toMatchObject({ size: 1024, extension: 'gltf', kind: 'symlink' });
    expect((await resources.read(grant.id, 10)).truncated).toBe(true);
  });
  it('rejects a file replaced with a symbolic link after its grant was issued', async () => {
    const folder = path.join(root, 'scope');
    await mkdir(folder);
    const file = path.join(folder, 'notes.txt'),
      outside = path.join(root, 'outside');
    await writeFile(file, 'local');
    await writeFile(outside, 'private');
    const grant = await resources.grant(file);
    await unlink(file);
    await symlink(outside, file);
    await expect(resources.read(grant.id)).rejects.toThrow();
    expect((await resources.response(new Request(grant.url))).status).toBe(403);
  });
  it('allows local companion assets and rejects scope escape and symlink escape', async () => {
    const folder = path.join(root, 'model');
    await mkdir(folder);
    await writeFile(path.join(folder, 'model.gltf'), '{}');
    await writeFile(path.join(folder, 'texture.png'), 'texture');
    await writeFile(path.join(root, 'outside'), 'private');
    await symlink(path.join(root, 'outside'), path.join(folder, 'link'));
    const grant = await resources.grant(path.join(folder, 'model.gltf'));
    expect(
      await (await resources.response(new Request(new URL('texture.png', grant.url)))).text(),
    ).toBe('texture');
    expect(
      (
        await resources.response(
          new Request(`viewer-resource://${grant.id}/asset/%2e%2e%2foutside`),
        )
      ).status,
    ).toBe(403);
    expect((await resources.response(new Request(new URL('link', grant.url)))).status).toBe(403);
    resources.release(grant.id);
    expect((await resources.response(new Request(grant.url))).status).toBe(404);
  });
  it('previews ZIP entries without extracting archive paths and revokes children', async () => {
    const file = path.join(root, 'files.zip');
    await writeFile(
      file,
      zipSync({ 'notes.md': strToU8('# Hello'), '../escape.txt': strToU8('unsafe') }),
    );
    const grant = await resources.grant(file);
    expect((await resources.archive(grant.id)).entries.map((item) => item.name)).toEqual([
      'notes.md',
    ]);
    const child = await resources.archiveEntry(grant.id, 'notes.md');
    expect((await resources.read(child.id)).text).toBe('# Hello');
    resources.release(grant.id);
    await expect(resources.read(child.id)).rejects.toThrow('expired');
  });
  it('reports malformed archives as errors', async () => {
    const file = path.join(root, 'bad.zip');
    await writeFile(file, Buffer.from('PK\x03\x04truncated'));
    const grant = await resources.grant(file);
    await expect(resources.archive(grant.id)).rejects.toThrow();
  });
});
