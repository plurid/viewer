import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, realpath, rename, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { Resources } from '../src/desktop/previews/resources';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
let root: string, resources: Resources;
beforeEach(async () => {
  root = await temporaryRoot('viewer-resources-');
  resources = new Resources();
});
afterEach(async () => {
  await resources.quiesce();
  await trashTemporary(root);
});
describe('scoped preview resources', () => {
  it('cancels only the matching preview page and keeps independent resources usable', async () => {
    const file = path.join(root, 'Workbook.xlsx');
    await writeFile(file, 'source');
    const first = await resources.grant(file),
      second = await resources.grant(file);
    let active!: AbortSignal;
    const pending = resources.documentRead(first.id, 'page', async (_file, signal) => {
      active = signal;
      return new Promise<void>((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      );
    });
    const cancelled = expect(pending).rejects.toThrow();
    resources.cancelDocument(second.id, 'page');
    expect(active.aborted).toBe(false);
    resources.cancelDocument(first.id, 'page');
    await cancelled;
    expect(await resources.documentRead(second.id, 'independent', async () => 'usable')).toBe(
      'usable',
    );
    expect(resources.documentSource(first.id)).toBeTruthy();
  });
  it('rejects late document bytes after the source resource is released', async () => {
    const file = path.join(root, 'Workbook.xlsx');
    await writeFile(file, 'source');
    const grant = await resources.grant(file);
    let finish!: (value: string) => void;
    const pending = resources.documentRead(
      grant.id,
      'late-page',
      async () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const rejected = expect(pending).rejects.toThrow();
    expect(() => resources.documentRead(grant.id, 'late-page', async () => 'duplicate')).toThrow(
      'already running',
    );
    resources.release(grant.id);
    finish('late source bytes');
    await rejected;
    expect(() => resources.documentRead(grant.id, 'new-page', async () => 'expired')).toThrow(
      'expired',
    );
  });
  it('aborts document pages during shutdown and drains their tracked work', async () => {
    const file = path.join(root, 'Workbook.xlsx');
    await writeFile(file, 'source');
    const grant = await resources.grant(file);
    const pending = resources.documentRead(
      grant.id,
      'closing-page',
      async (_file, signal) =>
        new Promise<void>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        ),
    );
    const rejected = expect(pending).rejects.toThrow();
    await resources.close();
    await rejected;
  });
  it('cancels an unfinished native acquisition without resurrecting a closed preview', async () => {
    const file = path.join(root, 'cancelled.txt');
    await writeFile(file, 'retained source');
    let resume!: () => void;
    resources = new Resources(
      async () =>
        await new Promise<void>((resolve) => {
          resume = resolve;
        }),
    );
    const request = crypto.randomUUID();
    const work = resources.grant(file, request);
    resources.release(request);
    resume();
    await expect(work).rejects.toThrow('expired');
  });
  it('revokes only the chosen root while independent text and media previews stay usable', async () => {
    const first = path.join(root, 'first'),
      second = path.join(root, 'second');
    await Promise.all([mkdir(first), mkdir(second)]);
    await writeFile(path.join(first, 'notes.txt'), 'independent');
    await writeFile(path.join(first, 'media.wav'), Buffer.alloc(1024 * 1024, 1));
    await writeFile(path.join(second, 'media.wav'), Buffer.alloc(1024 * 1024, 2));
    const text = await resources.grant(path.join(first, 'notes.txt'));
    const independent = await resources.grant(path.join(first, 'media.wav'));
    const revoked = await resources.grant(path.join(second, 'media.wav'));
    const playing = await resources.response(new Request(independent.url));
    const stopped = await resources.response(new Request(revoked.url));
    await resources.quiesce(second);
    expect((await resources.read(text.id)).text).toBe('independent');
    expect((await playing.arrayBuffer()).byteLength).toBe(1024 * 1024);
    await expect(stopped.arrayBuffer()).rejects.toThrow();
    expect((await resources.response(new Request(revoked.url))).status).toBe(404);
  });
  it('invalidates pending canonical aliases without cancelling an independent request', async () => {
    const first = path.join(root, 'first'),
      second = path.join(root, 'second');
    await Promise.all([mkdir(first), mkdir(second)]);
    await writeFile(path.join(first, 'notes.txt'), 'independent');
    await writeFile(path.join(second, 'notes.txt'), 'revoked');
    const alias = path.join(root, 'alias');
    await symlink(second, alias);
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    resources = new Resources(async () => {
      await gate;
    });
    const independent = resources.grant(path.join(first, 'notes.txt'));
    const denied = resources.grant(path.join(alias, 'notes.txt'));
    const rejected = expect(denied).rejects.toThrow('expired');
    const drained = resources.quiesce(second);
    resume();
    expect((await independent).entry.path).toBe(path.join(first, 'notes.txt'));
    await rejected;
    await drained;
    expect(
      (await resources.read((await resources.grant(path.join(first, 'notes.txt'))).id)).text,
    ).toBe('independent');
  });
  it('cannot resurrect a preview that was still acquiring access when resources were cleared', async () => {
    const file = path.join(root, 'private.txt');
    await writeFile(file, 'private');
    let resume!: () => void,
      calls = 0;
    resources = new Resources(async () => {
      if (calls++ === 0)
        await new Promise<void>((resolve) => {
          resume = resolve;
        });
    });
    const pending = resources.grant(file);
    resources.clear();
    resume();
    await expect(pending).rejects.toThrow('expired');
  });
  it('cancels unconsumed media streams and drains their descriptors when previews close', async () => {
    const file = path.join(root, 'large.wav');
    await writeFile(file, Buffer.alloc(8 * 1024 * 1024));
    const grant = await resources.grant(file);
    const response = await resources.response(new Request(grant.url));
    expect(response.status).toBe(200);
    await resources.quiesce();
    expect((await resources.response(new Request(grant.url))).status).toBe(404);
    await expect(response.arrayBuffer()).rejects.toThrow();
  });
  it('rechecks private access before reading cached archive bytes', async () => {
    let denied = false;
    resources = new Resources(async () => {
      if (denied) throw new Error('revoked');
    });
    const file = path.join(root, 'fixture.zip');
    await writeFile(file, zipSync({ 'hello.txt': strToU8('private') }));
    const grant = await resources.grant(file);
    const child = await resources.archiveEntry(grant.id, 'hello.txt');
    denied = true;
    await expect(resources.read(child.id)).rejects.toThrow('revoked');
    expect((await resources.response(new Request(child.url))).status).toBe(404);
  });
  it('purges decoded archive children reached through a canonical alias', async () => {
    const folder = path.join(root, 'private'),
      alias = path.join(root, 'alias');
    await mkdir(folder);
    await symlink(folder, alias);
    await writeFile(
      path.join(folder, 'fixture.zip'),
      zipSync({ 'private.txt': strToU8('private bytes') }),
    );
    const grant = await resources.grant(path.join(alias, 'fixture.zip'));
    const child = await resources.archiveEntry(grant.id, 'private.txt');
    const affected = await resources.affected(folder);
    expect(affected).toContain(grant.id);
    expect(affected).toContain(child.id);
    await resources.quiesce(folder);
    await expect(resources.read(child.id)).rejects.toThrow('expired');
  });
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
    await rename(file, path.join(folder, 'Retained original.txt'));
    await symlink(outside, file);
    await expect(resources.read(grant.id)).rejects.toThrow();
    expect((await resources.response(new Request(grant.url))).status).toBe(403);
  });
  it('limits a non-model preview to its own file', async () => {
    const folder = path.join(root, 'documents');
    await mkdir(folder);
    await writeFile(path.join(folder, 'report.txt'), 'shown');
    await writeFile(path.join(folder, 'private.txt'), 'not shown');
    const grant = await resources.grant(path.join(folder, 'report.txt'));
    expect((await resources.response(new Request(grant.url))).status).toBe(200);
    const sibling = grant.url.replace(/report\.txt$/, 'private.txt');
    expect((await resources.response(new Request(sibling))).status).toBe(404);
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
describe('preview work cancellation', () => {
  it('aborts a preview’s background work when it releases its resource', async () => {
    const file = path.join(root, 'report.txt');
    await writeFile(file, 'report');
    resources = new Resources();
    const resource = await resources.grant(file);
    const signal = resources.signal(resource.id);
    expect(resources.signal(resource.id)).toBe(signal);
    expect(signal.aborted).toBe(false);
    resources.release(resource.id);
    expect(signal.aborted).toBe(true);
    expect(() => resources.signal(resource.id)).toThrow();
  });
});
describe('rendered image previews', () => {
  it('bounds a system renderer that never answers and lets shutdown drain', async () => {
    const file = path.join(root, 'Camera.nef');
    await writeFile(file, 'generated RAW fixture');
    resources = new Resources(
      async () => {},
      () => new Promise(() => {}),
      25,
    );
    const resource = await resources.grant(file);
    await expect(resources.rendition(resource.id)).rejects.toThrow('timed out');
    await resources.quiesce();
  });
  it('cancels an unanswered rendition when its source preview closes and ignores late bytes', async () => {
    const file = path.join(root, 'Camera.dng');
    await writeFile(file, 'generated RAW fixture');
    let resolve!: (value: { data: Buffer; extension: string }) => void, started!: () => void;
    const begun = new Promise<void>((done) => {
      started = done;
    });
    resources = new Resources(
      async () => {},
      () =>
        new Promise((done) => {
          resolve = done;
          started();
        }),
    );
    const resource = await resources.grant(file),
      pending = resources.rendition(resource.id);
    await begun;
    resources.release(resource.id);
    await expect(pending).rejects.toThrow();
    await resources.quiesce();
    resolve({ data: Buffer.from('late bytes'), extension: 'png' });
    expect((await resources.response(new Request(resource.url))).status).toBe(404);
  });
  it('serves a system rendering as a child resource released with its file', async () => {
    const file = path.join(root, 'Scan.tiff');
    await writeFile(file, 'tiff bytes the renderer cannot decode');
    const rendered = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const render = vi.fn(async () => ({ data: rendered, extension: 'jpg' }));
    resources = new Resources(async () => {}, render);
    const resource = await resources.grant(file);
    const rendition = await resources.rendition(resource.id);
    expect(render).toHaveBeenCalledWith(await realpath(file), expect.any(AbortSignal));
    expect(rendition.entry.name).toBe('Scan.tiff.jpg');
    const response = await resources.response(new Request(rendition.url));
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(rendered);
    // Closing the preview releases the rendering too.
    resources.release(resource.id);
    expect((await resources.response(new Request(rendition.url))).status).toBe(404);
  });
  it('reports rendering as unavailable without a renderer', async () => {
    const file = path.join(root, 'Photo.heic');
    await writeFile(file, 'heic');
    resources = new Resources();
    await expect(resources.rendition((await resources.grant(file)).id)).rejects.toThrow(
      'unavailable',
    );
  });
});
describe('printing previewed PDFs', () => {
  it('prints only PDF files on disk', async () => {
    const pdfFile = path.join(root, 'Report.pdf');
    const textFile = path.join(root, 'Notes.txt');
    await writeFile(pdfFile, '%PDF-1.4');
    await writeFile(textFile, 'notes');
    resources = new Resources();
    expect(await resources.printableFile((await resources.grant(pdfFile)).id)).toBe(
      await realpath(pdfFile),
    );
    await expect(resources.printableFile((await resources.grant(textFile)).id)).rejects.toThrow(
      'Only PDF files',
    );
  });
});
describe('editing a previewed file (2026-10-23)', () => {
  it('names the file a preview shows, through a link its target, and refuses an archive entry', async () => {
    const file = path.join(root, 'notes.txt'),
      link = path.join(root, 'link.txt');
    await writeFile(file, 'text');
    await symlink(file, link);
    expect(resources.editableFile((await resources.grant(file)).id)).toBe(await realpath(file));
    expect(resources.editableFile((await resources.grant(link)).id)).toBe(await realpath(file));
    const archive = path.join(root, 'notes.zip');
    await writeFile(archive, zipSync({ 'inside.txt': strToU8('inside') }));
    const grant = await resources.grant(archive);
    const child = await resources.archiveEntry(grant.id, 'inside.txt');
    expect(() => resources.editableFile(child.id)).toThrow('archive');
  });
});
