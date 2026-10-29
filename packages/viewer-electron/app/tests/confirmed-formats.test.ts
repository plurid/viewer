/**
 * Show as for a format the desktop service reads by extension: a misnamed file is read as one only
 * once its own first bytes say so, and every reader that chooses by extension then follows.
 * Real samples from the playground, copied under a wrong or missing name; Office 97 to 2003 files
 * and camera RAW heads are generated, and the pinned originals read where the playground has them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { appendFile, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resources } from '../src/desktop/previews/resources';
import { DerivedPreviews, rawDecoder } from '../src/desktop/previews/derived';
import type { Decoder } from '../src/desktop/previews/derived';
import { DocumentCache } from '../src/desktop/previews/document-cache';
import type { extractDocument } from '../src/desktop/previews/formats';
import { createOfficeJob, officeFileName } from '../src/desktop/previews/office-job';
import { videoDecoder } from '../src/desktop/previews/video-rendition';
import { createResourceHandlers } from '../src/desktop/ipc/resource-handlers';
import { methodWindows, schemas } from '../src/desktop/ipc/schemas';
import type { FileServices } from '../src/desktop/files/file-services';
import {
  confirmedFormats,
  confirms,
  directoryProbe,
  identifyBytes,
  identifyProbe,
} from '../src/domain/files/signatures';
import { cameraRawSamples } from '../tools/playground/camera-raw';
import { officeLayoutSamples } from '../tools/playground/office-layout';
import { documentSamples, office } from '../tools/playground/samples/documents';
import { openDocument, presentation } from '../tools/playground/samples/office';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import {
  compoundFile,
  excelDirectory,
  powerPointDirectory,
  wordDirectory,
} from './support/compound-file';
import { holds, pinned } from './support/real-corpus';

const assets = fileURLToPath(new URL('../tools/playground/assets/', import.meta.url));
const processors = fileURLToPath(
  new URL(`../assets/viewer-processors-${process.platform}-${process.arch}/`, import.meta.url),
);
const book = async () =>
  documentSamples(await readFile(path.join(assets, 'study.jpg'))).find((sample) =>
    sample.path.endsWith('.epub'),
  )!.bytes as Uint8Array;
/** The Office samples by the extension their bytes say. */
const officeSamples: Record<string, () => Uint8Array> = {
  docx: () => office('docx'),
  xlsx: () => office('xlsx'),
  pptx: presentation,
  odt: () => openDocument('text'),
  ods: () => openDocument('spreadsheet'),
  odp: () => openDocument('presentation'),
  odg: () => openDocument('drawing'),
  // Word writes its directory near the end, past the head the service reads first
  doc: () => compoundFile(wordDirectory, { directory: 10 }),
  xls: () => compoundFile(excelDirectory),
  ppt: () => compoundFile(powerPointDirectory),
};
/** What a file's bytes say it is, read as the desktop service reads them. */
const named = (data: Uint8Array) => {
  const head = data.subarray(0, identifyProbe);
  const probe = directoryProbe(head, data.length);
  return identifyBytes(head, '', probe && data.subarray(probe.at, probe.at + probe.length));
};
/** A binary header's first bytes, then zeros. */
const header = (text: string) => Buffer.concat([Buffer.from(text, 'latin1'), Buffer.alloc(64)]);
/** Each camera RAW kind Show as confirms, by the first bytes its maker writes. */
const rawHeads: Record<string, Buffer> = {
  cr2: header('II*\0\x10\0\0\0CR\x02\0'),
  cr3: header('\0\0\0\x18ftypcrx \0\0\0\x01crx isom'),
  raf: header('FUJIFILMCCD-RAW 0201FF159505X-T4'),
  orf: header('IIRO\x08\0\0\0'),
  rw2: header('IIU\0\x18\0\0\0'),
};
/** Playground media, each asked for as its own kind or a name its container also takes. */
const media: [sample: string, extension: string][] = [
  ['motion.mkv', 'mkv'],
  ['tone.mka', 'mka'],
  ['motion.avi', 'avi'],
  ['motion.flv', 'flv'],
  ['motion.wmv', 'wmv'],
  ['tone.wma', 'wma'],
  ['motion.mpg', 'mpg'],
  ['motion.vob', 'vob'],
  ['motion.3gp', '3gp'],
  ['motion.3g2', '3g2'],
  ['tone.aiff', 'aiff'],
  ['tone.caf', 'caf'],
];
const officePDF = vi.fn<Decoder>(async () => ({
  data: Buffer.from('%PDF-1.7\nfixture'),
  extension: 'pdf',
  kind: 'office',
  decoder: 'fixture',
  office: { sheets: [], limited: false },
}));
const videoCopy = vi.fn<Decoder>(async () => ({
  data: Buffer.from('fixture copy'),
  extension: 'mp4',
  kind: 'video',
  decoder: 'fixture',
}));
/** The RAW helper's reply: a camera preview, or a RAW rendition. */
const rawRendition = vi.fn<Decoder>(async (_source, mode) => ({
  data: Buffer.from('fixture rendition'),
  extension: 'jpg',
  kind: mode,
  decoder: 'fixture',
}));

let root: string, resources: Resources;
beforeEach(async () => {
  root = await temporaryRoot('viewer-show-as-');
  officePDF.mockClear();
  videoCopy.mockClear();
  rawRendition.mockClear();
  resources = new Resources(
    async () => {},
    undefined,
    12000,
    new DerivedPreviews(
      async () => {},
      (source, mode, signal) => (mode === 'video' ? videoCopy : rawRendition)(source, mode, signal),
    ),
    undefined,
    new DerivedPreviews(async () => {}, officePDF),
  );
});
afterEach(async () => {
  await resources.close();
  await trashTemporary(root);
});
const grant = async (name: string, data: Uint8Array) => {
  await writeFile(path.join(root, name), data);
  return resources.grant(path.join(root, name));
};
/** The resource handlers, reading documents as the preview worker does. */
function handlers() {
  const documents = new DocumentCache();
  const extract: FileServices['extract'] = async (file, signal, chapters, worksheet, format) => {
    const document = await documents.read(file, undefined, signal, worksheet, format);
    return chapters ? document : { ...document, chapters: undefined };
  };
  return createResourceHandlers({
    resources,
    thumbnails: { get: vi.fn() },
    webPreviews: { releaseResource: vi.fn() },
    files: { extract },
    fileAccess: { require: vi.fn() },
    forgetGitResource: vi.fn(),
    warmOffice: vi.fn(),
  });
}

describe('the agreement between a file’s bytes and a format', () => {
  it('confirms a format only when the identity names it or a container that holds it', () => {
    const identity = (extension: string) => ({ label: extension, extension });
    expect(confirms(identity('epub'), 'epub')).toBe(true);
    expect(confirms(identity('mkv'), 'mka')).toBe(true);
    expect(confirms(identity('asf'), 'wmv')).toBe(true);
    expect(confirms(identity('mpg'), 'vob')).toBe(true);
    expect(confirms(identity('docx'), 'xlsx')).toBe(false);
    expect(confirms(identity('epub'), 'zip')).toBe(false);
    expect(confirms(identity('webm'), 'mkv')).toBe(false);
    expect(confirms(identity('pdf'), 'pdf')).toBe(false);
    expect(confirms({ label: 'Office Open XML document' }, 'docx')).toBe(false);
    expect(confirms(undefined, 'epub')).toBe(false);
  });
  it('takes an Office 97 to 2003 template or show for its document, and one RAW for itself', () => {
    const identity = (extension: string) => ({ label: extension, extension });
    for (const [extension, also] of [
      ['doc', ['dot']],
      ['xls', ['xlt']],
      ['ppt', ['pps', 'pot']],
    ] as const)
      for (const format of [extension, ...also])
        expect(confirms(identity(extension), format)).toBe(true);
    expect(confirms(identity('doc'), 'xls')).toBe(false);
    expect(confirms(identity('ppt'), 'pptx')).toBe(false);
    expect(confirms({ label: 'Office 97-2003 or Outlook file' }, 'doc')).toBe(false);
    for (const raw of ['cr2', 'cr3', 'raf', 'orf', 'rw2'])
      expect(confirms(identity(raw), raw)).toBe(true);
    expect(confirms(identity('cr3'), 'cr2')).toBe(false);
    // a DNG, NEF or ARW file reads as the TIFF image it also is, which shows without confirming
    for (const tiff of ['dng', 'nef', 'arw']) {
      expect(confirms(identity('tiff'), tiff)).toBe(false);
      expect(confirmedFormats.has(tiff)).toBe(false);
    }
  });
  it('takes a short lowercase extension at the IPC boundary, from the workspace window', () => {
    expect(methodWindows.resourceFormat).toBe('viewer');
    expect(schemas.resourceFormat.safeParse(['resource', 'epub']).success).toBe(true);
    for (const extension of ['', 'EPUB', '../epub', 'e.pub', 'x'.repeat(9)])
      expect(schemas.resourceFormat.safeParse(['resource', extension]).success).toBe(false);
  });
});

describe('confirming a format from the file’s own bytes', () => {
  it('reads a misnamed book as EPUB, and refuses a format its bytes do not say', async () => {
    const source = await grant('Field notes.bin', await book());
    await expect(resources.confirmFormat(source.id, 'docx')).rejects.toThrow(
      'The contents of this file do not match .docx.',
    );
    await expect(resources.confirmFormat(source.id, 'pdf')).rejects.toThrow(
      'Show as cannot read a file as .pdf.',
    );
    const confirmed = await resources.confirmFormat(source.id, 'epub');
    expect(confirmed).toMatchObject({ id: source.id, url: source.url });
    expect(confirmed.entry).toMatchObject({
      path: source.entry.path,
      name: 'Field notes.bin',
      extension: 'epub',
      mime: 'application/epub+zip',
    });
    const notes = await grant('notes.epub.txt', Buffer.from('Plain notes, not a book.\n'));
    await expect(resources.confirmFormat(notes.id, 'epub')).rejects.toThrow('do not match .epub');
    const motion = await grant('motion', await readFile(path.join(assets, 'motion.mkv')));
    await expect(resources.confirmFormat(motion.id, 'avi')).rejects.toThrow('do not match .avi');
  });
  it('reads a compound file’s directory past its head before it confirms the kind', async () => {
    const word = compoundFile(wordDirectory, { directory: 10 });
    const report = await grant('Report', word);
    await expect(resources.confirmFormat(report.id, 'xls')).rejects.toThrow(
      'The contents of this file do not match .xls.',
    );
    expect((await resources.confirmFormat(report.id, 'doc')).entry).toMatchObject({
      name: 'Report',
      extension: 'doc',
      mime: 'application/msword',
    });
    // the same head without the directory it names, and a directory that names no Office kind
    const cut = await grant('Cut', word.subarray(0, word.length - 1));
    await expect(resources.confirmFormat(cut.id, 'doc')).rejects.toThrow('do not match .doc');
    const contents = await grant(
      'Contents',
      compoundFile([
        { name: 'Root Entry', type: 'root', child: 1 },
        { name: 'Contents', type: 'stream' },
      ]),
    );
    await expect(resources.confirmFormat(contents.id, 'doc')).rejects.toThrow('do not match .doc');
  });
  it('does not confirm bytes held in memory, which no reader chooses by extension', async () => {
    const held = await resources.grantBytes(root, 'Field notes.bin', Buffer.from(await book()));
    await expect(resources.confirmFormat(held.id, 'epub')).rejects.toThrow('a file on disk');
  });
  it('drops a confirmed format when the file changes', async () => {
    const { document } = handlers();
    const source = await grant('Field notes.bin', await book());
    await resources.confirmFormat(source.id, 'epub');
    expect((await document([source.id], 1)).chapters).toHaveLength(2);
    await appendFile(path.join(root, 'Field notes.bin'), 'appended');
    await expect(document([source.id], 1)).rejects.toThrow(
      'This file changed after Viewer read its format.',
    );
    // read by its own name again: a .bin file has no reader
    await expect(document([source.id], 1)).rejects.toThrow('no text extractor');
    await writeFile(path.join(root, 'Field notes.bin'), 'Now a note.\n');
    await expect(resources.confirmFormat(source.id, 'epub')).rejects.toThrow('do not match');
  });
});

describe('readers that choose by extension follow the confirmed format', () => {
  it('extracts a misnamed EPUB, Word document and workbook', async () => {
    const { document } = handlers();
    const epub = await grant('Field notes.bin', await book());
    await expect(document([epub.id], 1)).rejects.toThrow('no text extractor');
    await resources.confirmFormat(epub.id, 'epub');
    const read = await document([epub.id], 1);
    expect(read.metadata.title).toBe('Field notes');
    expect(read.chapters?.map((chapter) => chapter.title)).toEqual(['Look around', 'Keep context']);

    const word = await grant('Materials', office('docx'));
    await resources.confirmFormat(word.id, 'docx');
    const words = await document([word.id], 1);
    expect(words.office?.kind).toBe('word');
    expect(words.text).toContain('Field notes: a spatial workbench');

    const workbook = await grant('Materials.zip', office('xlsx'));
    await resources.confirmFormat(workbook.id, 'xlsx');
    const page = await document(schemas.document.parse([workbook.id, { requestID: 'page' }]), 1);
    expect(page.office?.kind).toBe('workbook');
    expect(JSON.stringify(page.office)).toContain('Materials');
  });
  it('lays out each misnamed Office and OpenDocument file as its format', async () => {
    for (const [extension, bytes] of Object.entries(officeSamples)) {
      const source = await grant(`Field notes ${extension}`, bytes());
      expect(named(bytes())?.extension).toBe(extension);
      await expect(resources.officeLayout(source.id, { requestID: 'before' })).rejects.toThrow(
        'Choose a Word, Excel or PowerPoint file',
      );
      await resources.confirmFormat(source.id, extension);
      const layout = await resources.officeLayout(source.id, { requestID: extension });
      expect(layout.derivation?.kind).toBe('office');
      const [read] = officePDF.mock.lastCall!;
      expect(read.format).toBe(extension);
      // the engine is given the file under a name in the confirmed extension, which it accepts
      const job = createOfficeJob(extension, {
        name: officeFileName(path.basename(read.file), extension),
      });
      expect(job.inputPath).toBe(`/tmp/viewer-input/Field notes ${extension}.${extension}`);
    }
    expect(officePDF).toHaveBeenCalledTimes(Object.keys(officeSamples).length);
  });
  it('renders misnamed camera RAW through the RAW helper as its format', async () => {
    for (const [extension, head] of Object.entries(rawHeads)) {
      const source = await grant(`Field notes ${extension}`, head);
      expect(named(head)?.extension).toBe(extension);
      await expect(
        resources.rendition(source.id, { requestID: 'before', mode: 'raw' }),
      ).rejects.toThrow('RAW rendering requires a camera RAW file.');
      await resources.confirmFormat(source.id, extension);
      const preview = await resources.rendition(source.id, {
        requestID: extension,
        mode: 'camera',
      });
      expect(preview.derivation?.kind).toBe('camera');
      expect(rawRendition.mock.lastCall!.slice(0, 2)).toEqual([
        expect.objectContaining({ format: extension }),
        'camera',
      ]);
      await resources.rendition(source.id, { requestID: `${extension} RAW`, mode: 'raw' });
      expect(rawRendition.mock.lastCall![1]).toBe('raw');
    }
    // a DNG, NEF or ARW file's head is a TIFF image's; one maker's RAW is not another's
    const tiff = await grant('Field notes nef', header('II*\0\x08\0\0\0'));
    for (const extension of ['nef', 'dng', 'arw'])
      await expect(resources.confirmFormat(tiff.id, extension)).rejects.toThrow(
        `Show as cannot read a file as .${extension}.`,
      );
    const canon = await grant('Field notes', rawHeads.cr3!);
    await expect(resources.confirmFormat(canon.id, 'cr2')).rejects.toThrow('do not match .cr2');
  });
  it('makes a compatibility copy of misnamed media as its format', async () => {
    for (const [sample, extension] of media) {
      const source = await grant(
        sample.replace('.', ' '),
        await readFile(path.join(assets, sample)),
      );
      await expect(resources.videoRendition(source.id, 'before')).rejects.toThrow(
        'Choose a supported audio or video file',
      );
      await resources.confirmFormat(source.id, extension);
      await resources.videoRendition(source.id, sample);
      expect(videoCopy.mock.lastCall![0].format).toBe(extension);
    }
  });
  it('keeps a confirmed reading apart from the file’s own in the caches', async () => {
    const file = path.join(root, 'Field notes.bin');
    await writeFile(file, await book());
    const decode = vi.fn<typeof extractDocument>(async (_file, options) => ({
      path: file,
      metadata: {},
      evidence: [],
      text: options?.format ?? '',
      truncated: false,
    }));
    const documents = new DocumentCache(decode);
    expect((await documents.read(file)).text).toBe('bin');
    expect((await documents.read(file, undefined, undefined, undefined, 'epub')).text).toBe('epub');
    expect((await documents.read(file, undefined, undefined, undefined, 'bin')).text).toBe('bin');
    expect(decode).toHaveBeenCalledTimes(2);
    const derived = new DerivedPreviews(async () => {}, videoCopy);
    const signal = new AbortController().signal;
    for (const format of [undefined, 'mkv', 'bin'])
      (await derived.read(file, 'video', signal, 4096, '', format)).release();
    expect(videoCopy.mock.calls.map(([source]) => source.format)).toEqual([undefined, 'mkv']);
    await derived.close();
  });
});

const ready = process.platform === 'darwin' && existsSync(path.join(processors, 'ffmpeg'));
it.skipIf(!ready)(
  'converts misnamed media with the bundled FFmpeg once the bytes confirm it',
  { timeout: 300000 },
  async () => {
    const converting = new Resources(
      async () => {},
      undefined,
      12000,
      new DerivedPreviews(async () => {}, videoDecoder(processors)),
    );
    try {
      for (const [sample, extension] of media) {
        const name = sample.replace('.', ' ');
        await copyFile(path.join(assets, sample), path.join(root, name));
        const source = await converting.grant(path.join(root, name));
        await converting.confirmFormat(source.id, extension);
        const copy = await converting.videoRendition(source.id, sample);
        expect(copy.derivation?.kind, sample).toBe('video');
        expect(['mp4', 'm4a'], sample).toContain(copy.entry.extension);
        expect(copy.entry.size, sample).toBeGreaterThan(1000);
        converting.release(source.id);
      }
    } finally {
      await converting.close();
    }
  },
);

/** The Apache POI references, where the playground or a retained corpus holds them. */
const references = officeLayoutSamples.filter((sample) =>
  ['doc', 'xls', 'ppt'].includes(sample.formats[0]!),
);
/** The kinds a binary Office reference also confirms: its template or show. */
const variants: Record<string, readonly string[]> = {
  doc: ['dot'],
  xls: ['xlt'],
  ppt: ['pps', 'pot'],
};
it.skipIf(!references.every(holds))(
  'lays out misnamed Office 97 to 2003 references once their own directories confirm them',
  async () => {
    for (const sample of references) {
      const extension = sample.formats[0]!;
      const name = path.basename(sample.path, '.' + extension);
      const source = await grant(name, await pinned(sample));
      await expect(
        resources.confirmFormat(source.id, extension === 'doc' ? 'xls' : 'doc'),
      ).rejects.toThrow('do not match');
      await resources.confirmFormat(source.id, extension);
      const layout = await resources.officeLayout(source.id, { requestID: name });
      expect(layout.derivation?.kind, name).toBe('office');
      const [read] = officePDF.mock.lastCall!;
      expect(read.format, name).toBe(extension);
      expect(officeFileName(path.basename(read.file), extension)).toBe(`${name}.${extension}`);
      for (const variant of variants[extension]!)
        expect((await resources.confirmFormat(source.id, variant)).entry.extension).toBe(variant);
    }
  },
);

const rawHelper = fileURLToPath(
  new URL(`../assets/viewer-raw-v3-darwin-${process.arch}/viewer-raw`, import.meta.url),
);
/** The camera RAW originals of the kinds Show as confirms. */
const rawSamples = cameraRawSamples.filter((sample) => confirmedFormats.has(sample.formats[0]!));
const rawReady = process.platform === 'darwin' && existsSync(rawHelper) && rawSamples.every(holds);
it.skipIf(!rawReady)(
  'renders misnamed camera RAW with the bundled RAW helper once the bytes confirm it',
  { timeout: 300000 },
  async () => {
    const rendering = new Resources(
      async () => {},
      undefined,
      12000,
      new DerivedPreviews(async () => {}, rawDecoder(rawHelper)),
    );
    try {
      for (const [index, sample] of rawSamples.entries()) {
        const extension = sample.formats[0]!;
        const name = path.basename(sample.path).replace('.', ' ');
        await writeFile(path.join(root, name), await pinned(sample));
        const source = await rendering.grant(path.join(root, name));
        await expect(
          rendering.rendition(source.id, { requestID: 'before', mode: 'raw' }),
        ).rejects.toThrow('RAW rendering requires a camera RAW file.');
        await rendering.confirmFormat(source.id, extension);
        const preview = await rendering.rendition(source.id, { requestID: name, mode: 'camera' });
        expect(preview.derivation, name).toEqual({ kind: 'camera', decoder: 'LibRaw 0.22.2' });
        expect(preview.entry.extension, name).toBe('jpg');
        expect(preview.dimensions?.width, name).toBeGreaterThan(100);
        // one full RAW rendition: the camera preview is the embedded JPEG
        if (index === 0) {
          const raw = await rendering.rendition(source.id, {
            requestID: `${name} RAW`,
            mode: 'raw',
          });
          expect(raw.derivation?.kind, name).toBe('raw');
          expect(raw.dimensions?.width, name).toBeGreaterThan(100);
        }
        rendering.release(source.id);
      }
    } finally {
      await rendering.close();
    }
  },
);
