/**
 * Which files show the picture they saved, the picture chosen, the facts read beside it and how
 * such a file opens.
 */
import { describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import type { ArchiveEntry, FileEntry } from '../src/domain/contracts';
import {
  canvasSize,
  embeddedExtensions,
  embeddedFacts,
  embeddedMember,
  embeddedPictures,
  embeddedSummary,
  previewsAsFile,
  sketchPages,
  xpsDocuments,
  xpsPages,
} from '../src/domain/previews/documents/embedded';
import { fileFamily } from '../src/domain/files/entries';
import { itemPlaneType } from '../src/domain/workspaces/planes';
import { confirms, identifyBytes } from '../src/domain/files/signatures';
import { defaultSettings } from '../src/domain/services';
import { choosePreview } from '../src/renderer/previews/registry';
import { chooseOpening, nativeOpening } from '../src/renderer/explorer/opening';
import { documentTypes } from '../tools/document-types';

const file = (name: string, directory = false): FileEntry => ({
  path: `/fixtures/${name}`,
  name,
  parent: '/fixtures',
  extension: name.includes('.') ? name.split('.').pop()!.toLowerCase() : '',
  mime: 'application/octet-stream',
  size: 0,
  kind: directory ? 'directory' : 'file',
  directory,
  identity: name,
  modified: 0,
  created: 0,
  hidden: false,
});
const listed = (name: string, size: number, previewable = true): ArchiveEntry => ({
  name,
  size,
  directory: false,
  previewable,
});

describe('documents shown by the picture they saved', () => {
  it('routes every format to the saved preview, and an iWork package folder too', () => {
    for (const extension of embeddedExtensions)
      expect([extension, choosePreview(file(`Field notes.${extension}`)).id]).toEqual([
        extension,
        'embedded',
      ]);
    expect(previewsAsFile(file('Report.pages', true))).toBe(true);
    expect(previewsAsFile(file('Slides.KEY', true))).toBe(true);
    expect(previewsAsFile(file('Notes.txt'))).toBe(true);
    // other folders and bundles are no document: Space passes them by
    for (const name of ['Projects', 'Viewer.app', 'Study.kra', 'Plan.xps'])
      expect([name, previewsAsFile(file(name, true))]).toEqual([name, false]);
  });

  it('opens a document package in a document plane, and other folders in folder planes', () => {
    for (const name of ['Report.pages', 'Budget.numbers', 'Slides.key'])
      expect([name, itemPlaneType(file(name, true))]).toEqual([name, 'preview']);
    expect(itemPlaneType(file('Notes.txt'))).toBe('preview');
    for (const name of ['Projects', 'Viewer.app', 'Study.kra'])
      expect([name, itemPlaneType(file(name, true))]).toEqual([name, 'folder']);
  });

  it('opens in its own app on double-click, unless linked or set to open in a plane', () => {
    const policy = defaultSettings('/fixtures').fileOpening;
    for (const extension of embeddedExtensions)
      expect([extension, nativeOpening(file(`Field notes.${extension}`), policy)]).toEqual([
        extension,
        true,
      ]);
    expect(nativeOpening(file('Report.pages', true), policy)).toBe(true);
    expect(nativeOpening(file('Report.pages', true), policy, true)).toBe(false);
    expect(nativeOpening(file('Study.kra'), policy, true)).toBe(false);
    expect(nativeOpening(file('Study.kra'), { ...policy, types: { kra: 'plane' } })).toBe(false);
  });

  it("reads a .key file's first bytes: a ZIP opens in Keynote, a key or certificate in Viewer", async () => {
    const policy = defaultSettings('/fixtures').fileOpening;
    const keynote = zipSync({ 'Index/Document.iwa': new Uint8Array(64).fill(7) });
    const pem = strToU8('-----BEGIN PRIVATE KEY-----\n');
    const read = vi.fn(
      async (path: string) =>
        identifyBytes(path.endsWith('Slides.key') ? keynote : pem, path) ?? null,
    );
    Object.assign(globalThis, { window: { viewer: { fileIdentity: read } } });
    const choose = (entry: FileEntry, types = {}) =>
      new Promise<string>((resolve) =>
        chooseOpening(
          entry,
          { ...policy, types },
          false,
          () => resolve('app'),
          () => resolve('viewer'),
        ),
      );
    expect(await choose(file('Slides.key'))).toBe('app');
    expect(await choose(file('server.key'))).toBe('viewer');
    // a package, or a per-type choice, needs no read
    read.mockClear();
    expect(await choose(file('Slides.key', true))).toBe('app');
    expect(await choose(file('server.key'), { key: 'native' })).toBe('app');
    expect(await choose(file('server.key'), { key: 'plane' })).toBe('viewer');
    expect(read).not.toHaveBeenCalled();
    // bytes that cannot be read leave the file to its app
    read.mockRejectedValueOnce(new Error('Not readable'));
    expect(await choose(file('locked.key'))).toBe('app');
  });

  it('gives painted and designed images the image icon, and offers Viewer in Open With', () => {
    for (const name of ['Study.kra', 'Study.ora', 'Field notes.sketch'])
      expect([name, fileFamily(file(name))]).toEqual([name, 'image']);
    expect(fileFamily(file('Report.pages', true))).toBe('folder');
    const extensions = documentTypes.flatMap((type) => type.CFBundleTypeExtensions ?? []);
    expect(extensions).toEqual(expect.arrayContaining(embeddedExtensions));
  });

  it('names Krita, OpenRaster and XPS files from their bytes', () => {
    const stored = (entries: Record<string, string>) =>
      zipSync(
        Object.fromEntries(
          Object.entries(entries).map(([name, text]) => [name, [strToU8(text), { level: 0 }]]),
        ),
      );
    const kra = identifyBytes(stored({ mimetype: 'application/x-krita', 'maindoc.xml': '<DOC/>' }));
    const ora = identifyBytes(stored({ mimetype: 'image/openraster', 'stack.xml': '<image/>' }));
    const xps = identifyBytes(
      stored({ 'FixedDocumentSequence.fdseq': '<FixedDocumentSequence/>', '_rels/.rels': '' }),
    );
    expect([kra, ora, xps]).toEqual([
      { label: 'Krita image', extension: 'kra' },
      { label: 'OpenRaster image', extension: 'ora' },
      { label: 'XPS document', extension: 'xps' },
    ]);
    expect(confirms(xps, 'oxps')).toBe(true);
    expect(confirms(kra, 'ora')).toBe(false);
  });
});

describe('the picture and facts a container gives', () => {
  it('reads only its own pictures and fact members', () => {
    expect(embeddedMember('pages', 'preview.jpg')).toBe('picture');
    expect(embeddedMember('key', 'QuickLook/Thumbnail.jpg')).toBe('picture');
    expect(embeddedMember('pages', 'Index/Document.iwa')).toBeUndefined();
    expect(embeddedMember('kra', 'maindoc.xml')).toBe('facts');
    expect(embeddedMember('ora', 'maindoc.xml')).toBeUndefined();
    expect(embeddedMember('oxps', 'Documents/1/FixedDoc.fdoc')).toBe('facts');
    expect(embeddedMember('sketch', 'pages/page.json')).toBeUndefined();
  });

  it('tries the largest picture within the limit first', () => {
    const entries = [
      listed('preview-micro.jpg', 900),
      listed('Index/Document.iwa', 90000),
      listed('preview.jpg', 64000),
      listed('preview-web.jpg', 12000),
    ];
    expect(embeddedPictures('pages', entries)).toEqual([
      'preview.jpg',
      'preview-web.jpg',
      'preview-micro.jpg',
    ]);
    expect(
      embeddedPictures('kra', [
        listed('mergedimage.png', 33 * 1024 * 1024),
        listed('preview.png', 4000),
      ]),
    ).toEqual(['preview.png']);
    expect(embeddedPictures('ora', [listed('mergedimage.png', 100, false)])).toEqual([]);
  });

  it('reads a canvas size, a page count and the documents an XPS sequence names', () => {
    expect(
      canvasSize(
        "<!DOCTYPE DOC><DOC><IMAGE mime='application/x-kra' width='1920' height='1080'>",
        'IMAGE',
        'width',
        'height',
      ),
    ).toEqual({ width: 1920, height: 1080 });
    expect(canvasSize('<image version="0.0.5" w="640" h="480">', 'image', 'w', 'h')).toEqual({
      width: 640,
      height: 480,
    });
    expect(canvasSize('<image w="0" h="480">', 'image', 'w', 'h')).toBeUndefined();
    expect(sketchPages('{"pagesAndArtboards":{"a":{},"b":{},"c":{}}}')).toBe(3);
    expect(sketchPages('{"pagesAndArtboards":[]}')).toBeUndefined();
    expect(sketchPages('not JSON')).toBeUndefined();
    expect(
      xpsDocuments(
        'Sequence/FixedDocSeq.fdseq',
        '<FixedDocumentSequence><DocumentReference Source="/Documents/1/FixedDoc.fdoc"/>' +
          '<DocumentReference Source="Second%20part.fdoc"/></FixedDocumentSequence>',
      ),
    ).toEqual(['Documents/1/FixedDoc.fdoc', 'Sequence/Second part.fdoc']);
    // a page's link targets are a property of it, not another page
    expect(
      xpsPages(
        '<FixedDocument><PageContent Source="1.fpage"><PageContent.LinkTargets/></PageContent>' +
          '<PageContent Source="2.fpage"/></FixedDocument>',
      ),
    ).toBe(2);
  });

  it('reads a member of unclosed tags in one pass', () => {
    // about 1 MB each, the fact limit: read from every start to the end, they took minutes
    const references = '<DocumentReference Source'.repeat(40000);
    const images = '<IMAGE width="1"'.repeat(65000);
    const started = performance.now();
    expect(xpsDocuments('FixedDocumentSequence.fdseq', references)).toEqual([]);
    expect(canvasSize(images, 'IMAGE', 'width', 'height')).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('counts the pages of every FixedDocument in the sequence, or gives none', async () => {
    const parts: Record<string, string> = {
      'FixedDocumentSequence.fdseq':
        '<FixedDocumentSequence><DocumentReference Source="/Documents/1/FixedDocument.fdoc"/>' +
        '<DocumentReference Source="/Documents/2/FixedDocument.fdoc"/></FixedDocumentSequence>',
      'Documents/1/FixedDocument.fdoc':
        '<FixedDocument><PageContent/><PageContent/></FixedDocument>',
      'Documents/2/FixedDocument.fdoc': '<FixedDocument><PageContent/></FixedDocument>',
    };
    const text = async (name: string) => parts[name];
    expect(await embeddedFacts('xps', Object.keys(parts), text)).toEqual({ pages: 3 });
    // without a sequence, every FixedDocument the package holds
    const documents = Object.keys(parts).filter((name) => name.endsWith('.fdoc'));
    expect(await embeddedFacts('oxps', documents, text)).toEqual({ pages: 3 });
    // a document the sequence names but the package lacks: no count is better than a wrong one
    expect(
      await embeddedFacts('xps', ['FixedDocumentSequence.fdseq', documents[0]!], text),
    ).toEqual({ pages: undefined });
    expect(await embeddedFacts('pages', ['preview.jpg'], text)).toEqual({});
    expect(
      await embeddedFacts('kra', ['maindoc.xml'], async () => '<IMAGE width="64" height="32"/>'),
    ).toEqual({ canvas: { width: 64, height: 32 } });
  });

  it('says what the document is and what was read', () => {
    expect(embeddedSummary('kra', { canvas: { width: 640, height: 480 } })).toBe(
      'Krita image · 640 × 480 canvas',
    );
    expect(embeddedSummary('xps', { pages: 1 })).toBe('XPS document · 1 page');
    expect(embeddedSummary('sketch', { pages: 2 })).toBe('Sketch document · 2 pages');
    expect(embeddedSummary('key', {})).toBe('Keynote presentation');
  });
});
