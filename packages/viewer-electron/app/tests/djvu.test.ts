import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { DjVuReply, DjVuRequest } from '../src/renderer/previews/djvu/protocol';

/** A one-page DjVu file with only its INFO chunk: a blank page of the given size. */
function blankPage(width: number, height: number, dpi: number): Uint8Array {
  const info = Buffer.alloc(10);
  info.writeUInt16BE(width, 0);
  info.writeUInt16BE(height, 2);
  info[4] = 26;
  info.writeUInt16LE(dpi, 6);
  info[8] = 22;
  info[9] = 1;
  const body = Buffer.concat([Buffer.from('DJVUINFO'), Buffer.from([0, 0, 0, 10]), info]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length);
  return new Uint8Array(Buffer.concat([Buffer.from('AT&TFORM'), size, body]));
}
const files = new Map<string, Uint8Array>();
let wasm: Buffer;
const replies: DjVuReply[] = [];
let handle: (event: { data: DjVuRequest }) => Promise<void>;
beforeAll(async () => {
  const root = path.dirname(createRequire(import.meta.url).resolve('djvu-rs'));
  wasm = await readFile(path.join(root, 'simd128', 'djvu_rs_bg.wasm'));
  vi.stubGlobal('self', { postMessage: (reply: DjVuReply) => replies.push(reply) });
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = String(input);
    if (url.endsWith('.wasm'))
      return new Response(new Uint8Array(wasm), {
        headers: { 'Content-Type': 'application/wasm' },
      });
    const bytes = files.get(url);
    return bytes ? new Response(new Uint8Array(bytes)) : new Response(null, { status: 404 });
  });
  await import('../src/renderer/previews/djvu/djvu.worker');
  handle = (globalThis as unknown as { self: { onmessage: typeof handle } }).self.onmessage;
});
afterAll(() => vi.unstubAllGlobals());
async function ask(request: DjVuRequest): Promise<DjVuReply> {
  await handle({ data: request });
  return replies.find((reply) => reply.id === request.id)!;
}

describe('DjVu decoding worker', () => {
  it('opens a document, measures and renders a page, and reads its text', async () => {
    files.set('resource:/page.djvu', blankPage(200, 300, 100));
    expect(await ask({ kind: 'open', id: 1, url: 'resource:/page.djvu' })).toEqual({
      kind: 'opened',
      id: 1,
      pages: 1,
    });
    expect(await ask({ kind: 'size', id: 2, page: 1 })).toMatchObject({ width: 192, height: 288 });
    const rendered = await ask({ kind: 'render', id: 3, page: 1, dpi: 96 });
    expect(rendered).toMatchObject({ kind: 'rendered', width: 192, height: 288 });
    expect(rendered.kind === 'rendered' && rendered.pixels.length).toBe(192 * 288 * 4);
    expect(await ask({ kind: 'text', id: 4, page: 1 })).toEqual({ kind: 'text', id: 4, text: '' });
  });
  it('refuses pages that do not exist and renders beyond the pixel limit', async () => {
    expect(await ask({ kind: 'render', id: 5, page: 2, dpi: 96 })).toMatchObject({
      kind: 'error',
      message: 'That page does not exist.',
    });
    files.set('resource:/huge.djvu', blankPage(6000, 6000, 100));
    await ask({ kind: 'open', id: 6, url: 'resource:/huge.djvu' });
    expect(await ask({ kind: 'render', id: 7, page: 1, dpi: 1200 })).toMatchObject({
      kind: 'error',
      message: 'This page is too large to render.',
    });
  });
  it('reports files that are not DjVu', async () => {
    files.set('resource:/notes.djvu', new Uint8Array([1, 2, 3]));
    const reply = await ask({ kind: 'open', id: 8, url: 'resource:/notes.djvu' });
    expect(reply.kind).toBe('error');
  });
});
