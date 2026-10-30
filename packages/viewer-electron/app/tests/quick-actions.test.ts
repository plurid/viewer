import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { OperationJob, OperationRequest } from '../src/domain/contracts';
import { Operations } from '../src/desktop/operations/operations';
import { ProtectedPaths } from '../src/desktop/files/protected-paths';
import {
  conversionOutput,
  imagesToPDF,
  rotateBitmap,
  type ImageConverter,
} from '../src/desktop/operations/image-convert';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string, trash: string, operations: Operations;
const converter: ImageConverter = {
  // Records what it was asked to make; the real converter decodes with the system.
  async convert(conversion, sources, output) {
    await writeFile(output, JSON.stringify({ conversion, sources }), { flag: 'wx' });
  },
};
beforeEach(async () => {
  root = await temporaryRoot('viewer-quick-');
  trash = path.join(root, 'trash');
  await mkdir(trash);
  operations = new Operations(
    async (file) => {
      await rename(file, path.join(trash, path.basename(file) + '-' + crypto.randomUUID()));
    },
    () => undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    new ProtectedPaths(path.join(root, 'home')),
    converter,
  );
});
afterEach(async () => {
  await operations.close();
  await trashTemporary(root);
});
async function run(request: OperationRequest): Promise<OperationJob> {
  const id = operations.start(request);
  await vi.waitFor(
    () =>
      expect(['completed', 'failed', 'cancelled']).toContain(
        operations.all().find((job) => job.id === id)?.status,
      ),
    { timeout: 10000, interval: 10 },
  );
  return operations.all().find((job) => job.id === id)!;
}

describe('image quick actions', () => {
  it('creates a rotated copy beside the original, and Undo moves only the copy to the Trash', async () => {
    const photo = path.join(root, 'Photo.jpg');
    await writeFile(photo, 'original pixels');
    const job = await run({ kind: 'convert', conversion: 'rotate-left', sources: [photo] });
    expect(job.status).toBe('completed');
    const copy = path.join(root, 'Photo rotated.jpg');
    expect(JSON.parse(await readFile(copy, 'utf8'))).toEqual({
      conversion: 'rotate-left',
      sources: [photo],
    });
    expect(await readFile(photo, 'utf8')).toBe('original pixels');
    const entries = await readdir(root);
    const stages = entries.filter((name) => name.startsWith('.viewer-convert-'));
    if (process.env.VIEWER_TEST_NO_REMOVAL === '1') {
      expect(stages).toHaveLength(1);
      expect(await readdir(path.join(root, stages[0]))).toEqual([]);
    } else expect(stages).toEqual([]);
    expect(entries.filter((name) => !stages.includes(name)).sort()).toEqual([
      'Photo rotated.jpg',
      'Photo.jpg',
      'trash',
    ]);
    expect(job.undoable).toBe(true);
    await operations.undo(job.id);
    expect(await readdir(root)).not.toContain('Photo rotated.jpg');
    expect(await readFile(photo, 'utf8')).toBe('original pixels');
    expect(await readdir(trash)).toHaveLength(1);
  });
  it('combines images into one PDF in selection order', async () => {
    const first = path.join(root, 'b.png'),
      second = path.join(root, 'a.heic');
    await writeFile(first, 'b');
    await writeFile(second, 'a');
    const job = await run({
      kind: 'convert',
      conversion: 'pdf',
      sources: [first, second],
      destination: root,
      name: 'Scans.pdf',
    });
    expect(job.status).toBe('completed');
    expect(JSON.parse(await readFile(path.join(root, 'Scans.pdf'), 'utf8')).sources).toEqual([
      first,
      second,
    ]);
  });
  it('refuses non-images and a missing PDF name', async () => {
    const note = path.join(root, 'note.txt'),
      photo = path.join(root, 'photo.jpg');
    await writeFile(note, 'text');
    await writeFile(photo, 'pixels');
    expect(() => operations.start({ kind: 'convert', conversion: 'png', sources: [note] })).toThrow(
      'Quick actions work on',
    );
    expect(() =>
      operations.start({ kind: 'convert', conversion: 'pdf', sources: [photo], destination: root }),
    ).toThrow('PDF name');
  });
  it('converts an image to its own format as a copy beside it, never over it', async () => {
    const photo = path.join(root, 'photo.jpg');
    await writeFile(photo, 'pixels');
    const job = await run({ kind: 'convert', conversion: 'jpeg', sources: [photo] });
    expect(job).toMatchObject({ status: 'completed', errors: [], undoable: true });
    expect(job.completed).toEqual([
      { source: photo, destination: path.join(root, 'photo copy.jpg') },
    ]);
    expect(JSON.parse(await readFile(path.join(root, 'photo copy.jpg'), 'utf8'))).toEqual({
      conversion: 'jpeg',
      sources: [photo],
    });
    expect(await readFile(photo, 'utf8')).toBe('pixels');
  });
});

describe('Save PDF copy', () => {
  it('writes one PDF beside each Office document and refuses other files', async () => {
    const report = path.join(root, 'Report.docx'),
      budget = path.join(root, 'Budget.ods');
    await writeFile(report, 'document');
    await writeFile(budget, 'workbook');
    const job = await run({ kind: 'convert', conversion: 'office-pdf', sources: [report, budget] });
    expect(job.status).toBe('completed');
    expect(JSON.parse(await readFile(path.join(root, 'Report.pdf'), 'utf8'))).toEqual({
      conversion: 'office-pdf',
      sources: [report],
    });
    expect(JSON.parse(await readFile(path.join(root, 'Budget.pdf'), 'utf8')).sources).toEqual([
      budget,
    ]);
    const photo = path.join(root, 'Photo.jpg');
    await writeFile(photo, 'pixels');
    expect(() =>
      operations.start({ kind: 'convert', conversion: 'office-pdf', sources: [photo] }),
    ).toThrow('PDF copies are made from');
  });
});

describe('quick action building blocks', () => {
  it('names outputs beside their source', () => {
    expect(conversionOutput('/a/Photo.JPG', 'rotate-right')).toBe('/a/Photo rotated.JPG');
    expect(conversionOutput('/a/Scan.tiff', 'rotate-left')).toBe('/a/Scan rotated.png');
    expect(conversionOutput('/a/Scan.tiff', 'jpeg')).toBe('/a/Scan.jpg');
    expect(conversionOutput('/a/Shot.heic', 'png')).toBe('/a/Shot.png');
  });
  it('rotates a bitmap a quarter turn either way', () => {
    // A 2×1 image: pixel values 1 and 2, as 32-bit words.
    const pixels = new Uint8Array(new Uint32Array([1, 2]).buffer);
    const words = (value: Uint8Array) => [...new Uint32Array(value.buffer)];
    expect(words(rotateBitmap(pixels, 2, 1, true))).toEqual([1, 2]);
    expect(words(rotateBitmap(pixels, 2, 1, false))).toEqual([2, 1]);
    const square = new Uint8Array(new Uint32Array([1, 2, 3, 4]).buffer);
    expect(words(rotateBitmap(square, 2, 2, true))).toEqual([3, 1, 4, 2]);
    expect(words(rotateBitmap(square, 2, 2, false))).toEqual([2, 4, 1, 3]);
    expect(() => rotateBitmap(square, 3, 3, true)).toThrow('incomplete');
  });
  it('writes a PDF whose cross-reference table points at each object', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const pdf = imagesToPDF([
      { jpeg, width: 640, height: 480 },
      { jpeg, width: 100, height: 200 },
    ]);
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.match(/\/Type \/Page /g)).toHaveLength(2);
    expect(text).toContain('/MediaBox [0 0 100 200]');
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe('xref');
    const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((match) =>
      Number(match[1]),
    );
    // Catalog, page tree, then a page, image and content stream per image.
    expect(offsets).toHaveLength(8);
    offsets.forEach((offset, index) =>
      expect(text.slice(offset, offset + 12)).toMatch(new RegExp(`^${index + 1} 0 obj`)),
    );
    expect(() => imagesToPDF([])).toThrow();
  });
});
