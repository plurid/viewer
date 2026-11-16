import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type * as Coordination from '../src/desktop/files/file-coordination';
import { Resources } from '../src/desktop/previews/resources';
import { DerivedPreviews } from '../src/desktop/previews/derived';
import { readPostScript } from '../src/desktop/previews/postscript';
import { imageDecoder } from '../src/desktop/native/quick-look-render';
import { imageDimensions } from '../src/desktop/previews/image-dimensions';
import { previewTextLimit } from '../src/domain/files/read-limits';
import { choosePreview } from '../src/renderer/previews/registry';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
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
  await trashTemporary(root);
});
const create = (images?: DerivedPreviews) => {
  const service = new Resources(async () => {}, undefined, 12000, undefined, images);
  services.push(service);
  return service;
};

describe('authorized PostScript inspection', () => {
  it.each(['data', 'txt'])(
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
    expect(result.previewMessage).toContain('text preview limit');
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
        readPostScript({ file, handle, info: await handle.stat() }, 'ps', abort.signal),
      ).rejects.toThrow();
    } finally {
      await handle.close();
    }
  });
  const helper = path.resolve('assets/viewer-image-preview');
  it.skipIf(process.platform !== 'darwin' || !existsSync(helper))(
    'decodes only the TIFF picture through the existing isolated image pipeline',
    async () => {
      const file = path.join(root, 'embedded.eps');
      const bytes = binaryEPSSample(undefined, tiffSample());
      await writeFile(file, bytes);
      const images = new DerivedPreviews(
        async () => {},
        imageDecoder(helper, undefined, undefined, { directory: root }),
      );
      const service = create(images);
      const resource = await service.grant(file);
      const result = await service.inspectPostscript(resource.id, 'read');
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
