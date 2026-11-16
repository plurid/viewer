import { fileStat } from '../src/desktop/files/stats';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { open, readFile, writeFile, chmod, readdir } from 'node:fs/promises';
import path from 'node:path';
import type * as Coordination from '../src/desktop/files/file-coordination';
import { Resources } from '../src/desktop/previews/resources';
import { DerivedPreviews } from '../src/desktop/previews/derived';
import { readPostScript } from '../src/desktop/previews/postscript';
import { imageDecoder } from '../src/desktop/native/quick-look-render';
import { imageDimensions } from '../src/desktop/previews/image-dimensions';
import { previewTextLimit } from '../src/domain/files/read-limits';
import { choosePreview, previewModules } from '../src/renderer/previews/registry';
import { postscriptFormats } from '../src/domain/previews/documents/postscript';
import { entry } from '../src/desktop/files/filesystem';
import { temporaryRoot } from '../tools/temporary';
import {
  binaryEPSSample,
  epsiSample,
  pdfSample,
  postscriptSample,
  tiffSample,
} from './support/postscript';

vi.mock('../src/desktop/files/file-coordination', async (importOriginal) => {
  const original = await importOriginal<typeof Coordination>();
  return {
    ...original,
    fileCoordination: new original.FileCoordination(() => ({
      coordinateStart: async (_id, intents) => intents.map((intent) => intent.path),
      coordinateEnd: async () => {},
      coordinateCancel: () => {},
      coordinateSameItem: () => false,
    })),
  };
});
let root: string;
const services: Resources[] = [];
beforeEach(async () => {
  root = await temporaryRoot('viewer-postscript-resources-');
});
afterEach(async () => {
  await Promise.all(services.map((service) => service.close()));
  services.length = 0;
});
const create = (images?: DerivedPreviews) => {
  const service = new Resources(async () => {}, undefined, 12000, undefined, images);
  services.push(service);
  return service;
};

describe('authorized PostScript inspection', () => {
  it.each(['data', 'unknown'])(
    'routes a .%s file by its PostScript header without running it',
    async (extension) => {
      const file = path.join(root, `unexpected.${extension}`);
      await writeFile(file, postscriptSample);
      const service = create();
      const resource = await service.grant(file);
      expect(choosePreview(resource.entry).id).toBe('postscript');
      expect((await service.inspectPostscript(resource.id, 'read')).source.text).toBe(
        postscriptSample,
      );
    },
  );
  it.each(['txt', 'sh', 'pdf', 'pfa', 'ts', 'mts'])(
    'keeps the known kind of .%s despite a PostScript header',
    async (extension) => {
      const file = path.join(root, `known.${extension}`);
      await writeFile(file, postscriptSample);
      const resource = await create().grant(file);
      expect(resource.entry.extension).toBe(extension);
      expect(choosePreview(resource.entry).id).not.toBe('postscript');
    },
  );
  it.each(['PostScript', 'binary EPS'])(
    'keeps every declared preview kind despite %s bytes',
    async (kind) => {
      const names = [...new Set(previewModules.flatMap((module) => module.formats))]
        .filter((format) => !postscriptFormats.some((postscript) => postscript === format))
        .map((format) => `known.${format}`);
      names.push('.env.local', '.gitignore', 'id_rsa', 'README');
      const service = create();
      const bytes = kind === 'PostScript' ? Buffer.from(postscriptSample) : binaryEPSSample();
      for (const name of names) {
        const file = path.join(root, name);
        await writeFile(file, bytes, { flag: 'wx' });
        const expected = choosePreview(await entry(file)).id;
        if (expected === 'fallback') continue;
        const resource = await service.grant(file);
        expect(choosePreview(resource.entry).id, name).toBe(expected);
        service.release(resource.id);
      }
    },
    15_000,
  );
  it('grants an unreadable unrelated file without letting signature probing reject it', async () => {
    const file = path.join(root, 'unreadable.data');
    await writeFile(file, 'Unrelated retained fixture.');
    await chmod(file, 0);
    const service = create();
    const resource = await service.grant(file);
    expect(resource.entry.extension).toBe('data');
    expect(choosePreview(resource.entry).id).toBe('fallback');
    await expect(service.read(resource.id)).rejects.toThrow();
  });
  it.each(['wrong rows', 'missing end', 'end whitespace'])(
    'keeps comments and source for an EPSI picture with %s',
    async (kind) => {
      const file = path.join(root, 'flawed.epsi');
      const source =
        kind === 'wrong rows'
          ? epsiSample.replace('8 2 1 2', '8 2 1 3')
          : kind === 'missing end'
            ? epsiSample.replace('%%EndPreview', '')
            : epsiSample.replace('%%EndPreview', '%%EndPreview  ');
      await writeFile(file, source);
      const service = create();
      const resource = await service.grant(file);
      const result = await service.inspectPostscript(resource.id, 'read');
      expect(result.metadata.title).toBe('Saved bitmap');
      expect(result.source.text).toBe(source);
      if (kind === 'end whitespace') expect(result.preview).toBeDefined();
      else expect(result.previewMessage).toBe('The embedded EPSI picture could not be read.');
    },
  );
  it('bounds selection work for four megabytes of bare newlines', async () => {
    const file = path.join(root, 'newlines.ps');
    await writeFile(file, '%!\n' + '\n'.repeat(previewTextLimit));
    const service = create();
    const resource = await service.grant(file);
    const before = performance.now();
    const result = await service.inspectPostscript(resource.id, 'read');
    expect(performance.now() - before).toBeLessThan(300);
    expect(result.source.text.length).toBe(previewTextLimit);
    expect(result.limited).toBe(true);
  });
  it('shows only the PostScript section of a binary EPS and names an undrawn WMF', async () => {
    const file = path.join(root, 'drawing.eps');
    await writeFile(
      file,
      binaryEPSSample(postscriptSample, Buffer.alloc(0), Buffer.from('WMF bytes')),
    );
    const service = create();
    const resource = await service.grant(file);
    const result = await service.inspectPostscript(resource.id, 'read');
    expect(result.source.text).toBe(postscriptSample);
    expect(result.wmf).toBe(true);
    expect(result.preview).toBeUndefined();
  });
  it('uses the existing 4 MB text limit without reading preview pictures as source', async () => {
    const file = path.join(root, 'long.ps');
    const bytes = Buffer.from(postscriptSample + '%'.repeat(previewTextLimit));
    await writeFile(file, bytes);
    const service = create();
    const resource = await service.grant(file);
    const result = await service.inspectPostscript(resource.id, 'read');
    expect(result.source.text.length).toBe(previewTextLimit);
    expect(result.source.truncated).toBe(true);
    expect(result.limited).toBe(true);
  });
  it('serves an EPSI as an image child and releases it with its parent', async () => {
    const file = path.join(root, 'bitmap.epsi');
    await writeFile(file, epsiSample);
    const service = create();
    const resource = await service.grant(file);
    const result = await service.inspectPostscript(resource.id, 'read');
    expect(result.preview?.entry.extension).toBe('bmp');
    expect(result.preview?.dimensions).toEqual({ width: 8, height: 2 });
    const response = await service.response(new Request(result.preview!.url));
    expect(
      Buffer.from(await response.arrayBuffer())
        .subarray(0, 2)
        .toString(),
    ).toBe('BM');
    service.release(resource.id);
    await expect(service.read(result.preview!.id)).rejects.toThrow('expired');
  });
  it.each([true, false])('reads an Illustrator with PDF compatibility %s', async (pdf) => {
    const file = path.join(root, 'drawing.ai');
    await writeFile(file, pdf ? pdfSample() : Buffer.from(postscriptSample));
    const service = create();
    const resource = await service.grant(file);
    expect(await service.inspectPostscript(resource.id, 'read')).toMatchObject({
      kind: 'Illustrator',
      pdf,
    });
  });
  it('rejects invalid binary ranges before the TIFF decoder is called', async () => {
    const file = path.join(root, 'malformed.eps');
    const bytes = binaryEPSSample(undefined, tiffSample());
    bytes.writeUInt32LE(0xffffffff, 24);
    await writeFile(file, bytes);
    const decode = vi.fn();
    const service = create(new DerivedPreviews(async () => {}, decode));
    const resource = await service.grant(file);
    await expect(service.inspectPostscript(resource.id, 'read')).rejects.toThrow('malformed');
    expect(decode).not.toHaveBeenCalled();
  });
  it('keeps comments and source when a valid TIFF section cannot be decoded', async () => {
    const file = path.join(root, 'unsupported-tiff.eps');
    await writeFile(file, binaryEPSSample(postscriptSample, tiffSample()));
    const service = create(
      new DerivedPreviews(
        async () => {},
        async () => {
          throw new Error('Unsupported TIFF encoding.');
        },
      ),
    );
    const resource = await service.grant(file);
    const result = await service.inspectPostscript(resource.id, 'read');
    expect(result.source.text).toBe(postscriptSample);
    expect(result.metadata.title).toBe('Two squares');
    expect(result.previewMessage).toBe(
      'The embedded TIFF picture could not be decoded within the preview limits.',
    );
  });
  it('keeps inspection when an EPSI picture extends past the bounded source read', async () => {
    const file = path.join(root, 'bounded.epsi');
    const prefix = '%!PS\n%%Title: Bounded source\n';
    const preview = '%%BeginPreview: 8 2 1 2\n% aa\n';
    const source =
      prefix +
      'x'.repeat(previewTextLimit - prefix.length - preview.length - 1) +
      '\n' +
      preview +
      '% 55\n%%EndPreview\n';
    await writeFile(file, source);
    const service = create();
    const resource = await service.grant(file);
    const result = await service.inspectPostscript(resource.id, 'read');
    expect(result.metadata.title).toBe('Bounded source');
    expect(result.previewMessage).toContain('inspection limits');
    expect(result.source.truncated).toBe(true);
  });
  it('obeys cancellation before reading any PostScript content', async () => {
    const file = path.join(root, 'cancelled.ps');
    await writeFile(file, postscriptSample);
    const handle = await open(file, 'r');
    try {
      const abort = new AbortController();
      abort.abort();
      await expect(
        readPostScript({ file, handle, info: await fileStat(handle) }, 'ps', abort.signal),
      ).rejects.toThrow();
    } finally {
      await handle.close();
    }
  });
  const helper = path.resolve('assets/viewer-image-preview');
  const ffmpeg = path.resolve(
    'assets',
    `viewer-processors-${process.platform}-${process.arch}`,
    'ffmpeg',
  );
  it.skipIf(process.platform !== 'darwin' || !existsSync(helper) || !existsSync(ffmpeg))(
    'decodes only the TIFF picture through the existing isolated image pipeline',
    async () => {
      const file = path.join(root, 'embedded.eps');
      const bytes = binaryEPSSample(undefined, tiffSample());
      await writeFile(file, bytes);
      const images = new DerivedPreviews(async () => {}, imageDecoder(helper, ffmpeg));
      const service = create(images);
      const resource = await service.grant(file);
      const before = await readdir(root);
      const result = await service.inspectPostscript(resource.id, 'read');
      expect(await readdir(root)).toEqual(before);
      expect(result.preview?.entry.extension).toBe('png');
      const response = await service.response(new Request(result.preview!.url));
      const picture = Buffer.from(await response.arrayBuffer());
      expect(imageDimensions(picture)).toEqual({ width: 2, height: 1 });
      expect(await readFile(file)).toEqual(bytes);
      await expect(images.read(file, 'image', new AbortController().signal)).rejects.toThrow(
        'Only an embedded TIFF',
      );
    },
  );
});
