/**
 * `.ts` and `.mts` name TypeScript and transport streams. The desktop service reads a file's first
 * packets when it grants its preview; every view and the opening policy follow that resource.
 * Real files: this module and a vendored declaration as TypeScript, and FFmpeg recordings from the
 * playground, 188-byte packets (`-f mpegts`) and AVCHD's 192 (`-mpegts_m2ts_mode 1`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { appendFile, copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FileEntry } from '../src/domain/contracts';
import {
  isTransportStream,
  transportStreamContent,
  transportStreamProbe,
} from '../src/domain/media/transport-stream';
import { defaultSettings } from '../src/domain/services';
import { Resources } from '../src/desktop/previews/resources';
import { DerivedPreviews } from '../src/desktop/previews/derived';
import type { Decoder } from '../src/desktop/previews/derived';
import { videoDecoder } from '../src/desktop/previews/video-rendition';
import { entry } from '../src/desktop/files/filesystem';
import { choosePreview } from '../src/renderer/previews/registry';
import { nativeOpening } from '../src/renderer/explorer/opening';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const app = fileURLToPath(new URL('../', import.meta.url));
const files = {
  typescript: path.join(app, 'src/domain/media/transport-stream.ts'),
  declarations: path.join(app, 'assets/vendor/ssf-0.11.2.d.mts'),
  stream: path.join(app, 'tools/playground/assets/motion.m2t'),
  avchd: path.join(app, 'tools/playground/assets/motion.m2ts'),
};
const processors = path.join(app, `assets/viewer-processors-${process.platform}-${process.arch}`);
const head = async (file: string) =>
  new Uint8Array((await readFile(file)).subarray(0, transportStreamProbe));
const text = (value: string) => new TextEncoder().encode(value);
/** `count` packets of `size` bytes, each with the sync byte at `offset`, from `start`. */
function packets(count: number, size: number, offset = 0, start = 0) {
  const bytes = new Uint8Array(start + count * size);
  for (let index = 0; index < count; index++) bytes[start + index * size + offset] = 0x47;
  return bytes;
}

describe('what a .ts or .mts head holds', () => {
  it('reads TypeScript as text and recordings as video', async () => {
    expect(transportStreamContent(await head(files.typescript))).toBe('text');
    expect(transportStreamContent(await head(files.declarations))).toBe('text');
    expect(transportStreamContent(await head(files.stream))).toBe('video');
    expect(transportStreamContent(await head(files.avchd))).toBe('video');
  });
  it('needs eight packets in a row, from the first whole one', () => {
    expect(transportStreamContent(packets(8, 188))).toBe('video');
    expect(transportStreamContent(packets(8, 192, 4))).toBe('video');
    // a recording cut mid-packet
    expect(transportStreamContent(packets(8, 188, 0, 100))).toBe('video');
    expect(transportStreamContent(packets(7, 188))).toBe('text');
    expect(transportStreamContent(packets(7, 192, 4))).toBe('text');
    expect(transportStreamContent(new Uint8Array(transportStreamProbe))).toBe('text');
    expect(transportStreamContent(new Uint8Array())).toBe('text');
  });
  it('keeps text that repeats a G, or cuts a character in two, as text', () => {
    const line = text('G' + 'x'.repeat(186) + '\n');
    const repeated = new Uint8Array(line.length * 10);
    for (let index = 0; index < 10; index++) repeated.set(line, index * line.length);
    expect(isTransportStream(repeated)).toBe(true);
    expect(transportStreamContent(repeated)).toBe('text');
    const accented = text('export const place = "Neamț";\n'.repeat(60));
    expect(transportStreamContent(accented.subarray(0, accented.indexOf(0xc8) + 1))).toBe('text');
    // not UTF-8 and no packets: unclear, so code
    expect(transportStreamContent(new Uint8Array([0x63, 0xe9, 0x74, 0x0a]))).toBe('text');
  });
});

describe('a preview of a .ts or .mts file', () => {
  let root: string;
  const copy = vi.fn<Decoder>(async () => ({
    data: Buffer.from('fixture copy'),
    extension: 'mp4',
    kind: 'video',
    decoder: 'fixture',
  }));
  let resources: Resources;
  beforeEach(async () => {
    root = await temporaryRoot('viewer-transport-stream-');
    copy.mockClear();
    resources = new Resources(
      async () => {},
      undefined,
      12000,
      new DerivedPreviews(async () => {}, copy),
    );
    await copyFile(files.typescript, path.join(root, 'Module.ts'));
    await copyFile(files.declarations, path.join(root, 'Types.mts'));
    await copyFile(files.stream, path.join(root, 'Recording.ts'));
    await copyFile(files.avchd, path.join(root, 'Camera.mts'));
  });
  afterEach(async () => {
    await resources.close();
    await trashTemporary(root);
  });

  it('plays a recording and shows TypeScript as code, in every view and on double-click', async () => {
    const policy = defaultSettings('/fixture').fileOpening;
    for (const [name, module, extension] of [
      ['Module.ts', 'text', 'ts'],
      ['Types.mts', 'text', 'mts'],
      ['Recording.ts', 'media', 'm2ts'],
      ['Camera.mts', 'media', 'm2ts'],
    ] as const) {
      const listed: FileEntry = await entry(path.join(root, name));
      // a folder's entry names TypeScript, so selecting one stays instant and Edit stays offered
      expect(choosePreview(listed).id, name).toBe('text');
      // double-click opens a plane, whose preview is the resource below
      expect(nativeOpening(listed, policy), name).toBe(false);
      const resource = await resources.grant(path.join(root, name));
      expect(resource.entry.name, name).toBe(name);
      expect(resource.entry.extension, name).toBe(extension);
      expect(choosePreview(resource.entry).id, name).toBe(module);
    }
  });

  it('copies the recording as a transport stream, and only the version it read', async () => {
    const recording = path.join(root, 'Recording.ts');
    const resource = await resources.grant(recording);
    expect((await resources.videoRendition(resource.id, 'first')).derivation?.kind).toBe('video');
    expect(copy.mock.lastCall?.[0].format).toBe('m2ts');
    await appendFile(recording, Buffer.alloc(188));
    await expect(resources.videoRendition(resource.id, 'changed')).rejects.toThrow(
      'changed after Viewer read its format',
    );
    const typescript = await resources.grant(path.join(root, 'Module.ts'));
    expect((await resources.read(typescript.id)).text).toContain('transportStreamContent');
  });

  it.skipIf(!existsSync(path.join(processors, 'ffmpeg')))(
    'makes a playable copy of each recording with the bundled FFmpeg',
    { timeout: 120000 },
    async () => {
      const converting = new Resources(
        async () => {},
        undefined,
        12000,
        new DerivedPreviews(async () => {}, videoDecoder(processors)),
      );
      try {
        for (const name of ['Recording.ts', 'Camera.mts']) {
          const source = await converting.grant(path.join(root, name));
          const video = await converting.videoRendition(source.id, name);
          expect(video.entry.extension, name).toBe('mp4');
          expect(video.entry.size, name).toBeGreaterThan(1000);
        }
      } finally {
        await converting.close();
      }
    },
  );
});
