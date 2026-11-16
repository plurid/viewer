import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../src/domain/contracts';
import { identifyBytes } from '../src/domain/files/signatures';
import { previewTextLimit } from '../src/domain/files/read-limits';
import { choosePreview } from '../src/renderer/previews/registry';
import { nativeOpening } from '../src/renderer/explorer/opening';
import {
  decodeEPSI,
  epsHeader,
  epsiBMP,
  inspectPostScript,
  postscriptMetadata,
} from '../src/domain/previews/documents/postscript';
import {
  binaryEPSSample,
  epsiSample,
  pdfSample,
  postscriptSample,
  tiffSample,
  unusableEPSBoxes,
  epsCropSample,
} from './support/postscript';

describe('PostScript identities and registry', () => {
  it.each(['%!PS', '%!\n', '%!\r', '%!\t', '%! showpage'])(
    'recognizes the bounded PostScript signature %j for unknown files',
    (header) => {
      expect(identifyBytes(Buffer.from(header), 'unknown.data')?.extension).toBe('ps');
    },
  );
  it.each(['%!', '%!TEX root = main.tex', '%!other', '%!P', '%!\u0000'])(
    'does not claim the unknown signature %j',
    (header) => {
      expect(identifyBytes(Buffer.from(header), 'unknown.data')).toBeUndefined();
      expect(inspectPostScript(Buffer.from(header), 'ps').kind).toBe('PostScript document');
    },
  );
  it.each(unusableEPSBoxes)('uses full pages for an EPS box that is %s', (_name, comments) => {
    expect(inspectPostScript(Buffer.from(epsCropSample(comments)), 'eps').epsCrop).toBe('page');
  });
  it.each([
    '%%BoundingBox: 10 20 154 92',
    '%%BoundingBox: 0 0 14400 14400',
    '%%BoundingBox: 0 0 144 72\n%%HiResBoundingBox: 0 0 143.5 71.5',
  ])('uses a stated, usable EPS box %j', (comments) => {
    expect(inspectPostScript(Buffer.from(epsCropSample(comments)), 'eps').epsCrop).toBe('drawing');
  });
  it.each(['ps', 'eps', 'epsf', 'epsi', 'ai'])(
    'preserves automatic double-click opening for .%s',
    (extension) => {
      const file = {
        extension,
        name: `Drawing.${extension}`,
        directory: false,
        mime: 'application/postscript',
      } as FileEntry;
      expect(nativeOpening(file, { default: 'automatic', types: {} })).toBe(true);
      expect(nativeOpening(file, { default: 'automatic', types: {} }, true)).toBe(false);
      expect(nativeOpening(file, { default: 'automatic', types: { [extension]: 'plane' } })).toBe(
        false,
      );
    },
  );
  it.each([
    '%!\nshowpage\n',
    '\u0004%!PS\nshowpage\n',
    '\ufeff%!PS\nshowpage\n',
    '% A PostScript comment\nshowpage\n',
    '1 2 add pop showpage\n',
  ])('describes valid PostScript preambles without interpreting them', (source) => {
    expect(inspectPostScript(Buffer.from(source), 'ps').kind).toBe('PostScript document');
  });
  it.each(['ps', 'eps', 'epsf', 'epsi', 'ai', 'PS', 'EPS', 'AI'])(
    'recognizes .%s before text and image MIME hints',
    (extension) => {
      for (const mime of ['text/plain', 'application/octet-stream', 'image/x-eps']) {
        const file = {
          extension,
          mime,
          name: `Drawing.${extension}`,
          directory: false,
        } as FileEntry;
        expect(choosePreview(file).id).toBe('postscript');
      }
    },
  );
  it('recognizes text-only headers, binary EPS, and PDF inside Illustrator', () => {
    expect(identifyBytes(Buffer.from('%!PS'))).toEqual({
      label: 'PostScript document',
      extension: 'ps',
    });
    expect(identifyBytes(Buffer.from(epsiSample))).toEqual({
      label: 'Encapsulated PostScript',
      extension: 'eps',
    });
    expect(identifyBytes(binaryEPSSample(), 'unknown')).toEqual({
      label: 'Encapsulated PostScript',
      extension: 'eps',
    });
    expect(identifyBytes(pdfSample(), 'Drawing.ai')?.extension).toBe('ai');
    expect(identifyBytes(Buffer.from(postscriptSample), 'Old.ai')?.extension).toBe('ai');
    expect(identifyBytes(Buffer.from('%PDF'))?.extension).toBe('pdf');
    expect(identifyBytes(Buffer.from('ordinary text'))).toBeUndefined();
  });
  it('treats Illustrator PDF and PostScript separately', () => {
    expect(inspectPostScript(pdfSample(), 'ai')).toMatchObject({ kind: 'Illustrator', pdf: true });
    expect(inspectPostScript(Buffer.from(postscriptSample), 'ai')).toMatchObject({
      kind: 'Illustrator',
      pdf: false,
    });
    expect(() => inspectPostScript(Buffer.from([0, 1, 2, 3]), 'eps')).toThrow('malformed');
  });
});

describe('bounded document comments', () => {
  it('reads only stated facts, including dates and sizes', () => {
    expect(postscriptMetadata(Buffer.from(postscriptSample))).toEqual({
      title: 'Two squares',
      creator: 'Viewer generated fixture',
      creationDate: '2001-01-01',
      pages: 2,
      languageLevel: 3,
      size: { width: 144, height: 72, kind: 'Bounding box' },
    });
    expect(
      postscriptMetadata(Buffer.from('%!PS\n%%DocumentMedia: sheet 595.28 841.89 0 () ()\n')),
    ).toEqual({
      size: { width: 595.28, height: 841.89, kind: 'Page size' },
    });
  });
  it('keeps missing, malformed, binary and header-only facts unknown', () => {
    for (const source of [
      '%!PS',
      '%!PS\nshowpage',
      '%!PS\n%%Pages: twelve\n%%LanguageLevel: 99\n%%BoundingBox: 1 2 0 NaN\n%%CreationDate:\n',
      '%!PS\n%%Title: broken\0binary\n%%Creator: broken\u0001\n',
      '%!PS\n%%Title: ' + 'x'.repeat(100_000) + '\n',
    ])
      expect(postscriptMetadata(Buffer.from(source))).toEqual({});
  });
  it('resolves atend comments and prefers the stated high resolution box', () => {
    const source =
      '%!PS\n%%Pages: (atend)\n%%BoundingBox: (atend)\n%%Trailer\n%%Pages: 3\n%%BoundingBox: 0 0 100 100\n%%HiResBoundingBox: -1.5 0 100.5 200.5\n';
    expect(postscriptMetadata(Buffer.from(source))).toEqual({
      pages: 3,
      size: { width: 102, height: 200.5, kind: 'Bounding box' },
    });
  });
  it('excludes embedded documents, binary blocks and comments past the existing text limit', () => {
    const source =
      '%!PS\n%%BeginDocument: nested\n%%Title: Child\n%%EndDocument\n%%Creator: Parent\n%%BeginBinary: 10\n%%Title: forged\n';
    expect(postscriptMetadata(Buffer.from(source))).toEqual({ creator: 'Parent' });
    expect(
      postscriptMetadata(Buffer.from('%!PS\n' + 'x'.repeat(previewTextLimit) + '\n%%Pages: 99\n')),
    ).toEqual({});
  });
});

describe('binary EPS sections', () => {
  it('accepts disjoint sections and absent optional sections', () => {
    const bytes = binaryEPSSample(undefined, tiffSample(), Buffer.from('WMF'));
    const sections = epsHeader(bytes, bytes.length)!;
    expect(sections.postscript.offset).toBe(30);
    expect(sections.tiff!.length).toBe(tiffSample().length);
    expect(sections.wmf!.length).toBe(3);
    const plain = binaryEPSSample();
    expect(epsHeader(plain, plain.length)).toMatchObject({ tiff: undefined, wmf: undefined });
  });
  it.each([
    'past end',
    'overlap',
    'zero PS',
    'zero optional',
    'header overlap',
    'truncated header',
  ])('refuses %s before using any section', (kind) => {
    let bytes = binaryEPSSample(undefined, tiffSample());
    if (kind === 'past end') bytes.writeUInt32LE(0xffffffff, 20);
    if (kind === 'overlap') bytes.writeUInt32LE(31, 20);
    if (kind === 'zero PS') bytes.writeUInt32LE(0, 8);
    if (kind === 'zero optional') bytes.writeUInt32LE(0, 24);
    if (kind === 'header overlap') bytes.writeUInt32LE(4, 4);
    if (kind === 'truncated header') bytes = bytes.subarray(0, 28);
    expect(() => epsHeader(bytes, bytes.length)).toThrow('malformed');
  });
});

describe('EPSI bitmap decoding', () => {
  it('decodes exact bitmap bytes and grayscale BMP pixels with row padding', () => {
    const bitmap = decodeEPSI(Buffer.from(epsiSample))!;
    expect(bitmap).toMatchObject({ width: 8, height: 2, depth: 1 });
    expect([...bitmap.bytes]).toEqual([0xaa, 0x55]);
    const bmp = Buffer.from(epsiBMP(bitmap));
    expect(bmp.subarray(0, 2).toString()).toBe('BM');
    expect([...bmp.subarray(1078, 1086)]).toEqual([255, 0, 255, 0, 255, 0, 255, 0]);
    expect([...bmp.subarray(1086, 1094)]).toEqual([0, 255, 0, 255, 0, 255, 0, 255]);
  });
  it.each([2, 4, 8])('supports %s-bit previews', (depth) => {
    const source = `%!PS\n%%BeginPreview: 1 1 ${depth} 1\n% ff\n%%EndPreview\n`;
    expect(epsiBMP(decodeEPSI(Buffer.from(source))!)[1078]).toBe(0);
  });
  it.each([
    epsiSample.replace('% 55\n', ''),
    epsiSample.replace('%%EndPreview', ''),
    epsiSample.replace('% aa', '% gg'),
    epsiSample.replace('% 55', '% 5'),
    epsiSample.replace('8 2 1 2', '8 2 3 2'),
  ])('refuses truncated or malformed bitmaps', (source) => {
    expect(() => decodeEPSI(Buffer.from(source))).toThrow('malformed');
  });
  it('distinguishes a preview limit from a malformed bitmap', () => {
    expect(() =>
      decodeEPSI(Buffer.from(epsiSample.replace('8 2 1 2', '100000 100000 1 2'))),
    ).toThrow('preview limits');
    expect(() =>
      decodeEPSI(Buffer.from(epsiSample.slice(0, epsiSample.indexOf('% 55'))), true),
    ).toThrow('inspection limits');
  });
  it('leaves files without a preview and embedded child previews alone', () => {
    expect(decodeEPSI(Buffer.from(postscriptSample))).toBeUndefined();
    expect(
      decodeEPSI(Buffer.from('%!PS\n%%BeginDocument: child\n' + epsiSample + '%%EndDocument\n')),
    ).toBeUndefined();
  });
});
