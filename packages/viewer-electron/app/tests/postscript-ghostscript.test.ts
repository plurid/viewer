import { fileStat } from '../src/desktop/files/stats';
import { existsSync } from 'node:fs';
import { open, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { describe, expect, it } from 'vitest';
import { Ghostscript } from '../src/desktop/previews/postscript-renderer';
import { temporaryRoot } from '../tools/temporary';
import { postscriptSample, unusableEPSBoxes, epsCropSample } from './support/postscript';
import { recordingPostScriptStage } from './support/postscript-runtime';

const ready = ['/opt/homebrew/bin/gs', '/usr/local/bin/gs', '/opt/local/bin/gs'].some(existsSync);
const systemScratch = () =>
  Promise.all(
    [os.tmpdir(), '/tmp'].map(async (directory) =>
      (await readdir(directory)).filter((name) => name.startsWith('gs_')).sort(),
    ),
  );
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfWorker;

describe.skipIf(!ready)('installed Ghostscript against generated programs', () => {
  it.each(unusableEPSBoxes)(
    'renders a full EPS page when its box is %s',
    async (_name, comments) => {
      const root = await temporaryRoot('viewer-postscript-full-page-');
      const file = path.join(root, 'drawing.eps');
      await writeFile(file, epsCropSample(comments), { flag: 'wx' });
      const renderer = new Ghostscript({
        ...recordingPostScriptStage(root).options,
        store: () => false,
      });
      const handle = await open(file, 'r');
      try {
        const output = await renderer.decode(
          { file, handle, info: await fileStat(handle) },
          'postscript',
          new AbortController().signal,
          4096,
          await renderer.variant(),
        );
        const task = getDocument({ data: new Uint8Array(output.data) });
        try {
          const pdf = await task.promise;
          expect(pdf.numPages).toBe(1);
          const page = await pdf.getPage(1);
          const box = page.getViewport({ scale: 1 });
          expect(box.width).toBeGreaterThan(144);
          expect(box.height).toBeGreaterThan(72);
          expect((await page.getOperatorList()).fnArray.length).toBeGreaterThan(0);
        } finally {
          await task.destroy();
        }
      } finally {
        await handle.close();
      }
    },
  );
  it.each([2, 3])('renders a Level %s two-page document into a readable PDF', async (level) => {
    const root = await temporaryRoot('viewer-postscript-real-');
    const file = path.join(root, 'source.ps');
    const source = postscriptSample.replace('%%LanguageLevel: 3', `%%LanguageLevel: ${level}`);
    await writeFile(file, source, { flag: 'wx' });
    const renderer = new Ghostscript({
      ...recordingPostScriptStage(root).options,
      store: () => false,
    });
    const handle = await open(file, 'r');
    try {
      const output = await renderer.decode(
        { file, handle, info: await fileStat(handle) },
        'postscript',
        new AbortController().signal,
        4096,
        await renderer.variant(),
      );
      await writeFile(path.join(root, 'rendered.pdf'), output.data, { flag: 'wx' });
      const task = getDocument({ data: new Uint8Array(output.data) });
      try {
        const pdf = await task.promise;
        expect(pdf.numPages).toBe(2);
        expect((await (await pdf.getPage(1)).getOperatorList()).fnArray.length).toBeGreaterThan(0);
        expect(output.decoder).toMatch(/^Ghostscript \d+\.\d+/);
        await writeFile(
          path.join(root, 'result.json'),
          JSON.stringify({ decoder: output.decoder, pages: pdf.numPages }),
          { flag: 'wx' },
        );
        if (level === 2)
          console.log('Installed interpreter:', output.decoder, '; verified pages:', pdf.numPages);
      } finally {
        await task.destroy();
      }
      expect(await readFile(file, 'utf8')).toBe(source);
    } finally {
      await handle.close();
    }
  });

  it('refuses a generated program reading outside its private working folder', async () => {
    const root = await temporaryRoot('viewer-postscript-safer-');
    const secret = path.join(root, 'separate-file.txt');
    await writeFile(secret, 'This file was not granted to the interpreter.', { flag: 'wx' });
    const file = path.join(root, 'read-other-file.ps');
    const escaped = secret.replace(/[\\()]/g, '\\$&');
    await writeFile(file, `%!PS\n(${escaped}) (r) file closefile\nshowpage\n`, { flag: 'wx' });
    const renderer = new Ghostscript({
      ...recordingPostScriptStage(root).options,
      store: () => false,
    });
    const handle = await open(file, 'r');
    try {
      await expect(
        renderer.decode(
          { file, handle, info: await fileStat(handle) },
          'postscript',
          new AbortController().signal,
          4096,
          await renderer.variant(),
        ),
      ).rejects.toThrow('could not render');
    } finally {
      await handle.close();
    }
    expect(await readFile(secret, 'utf8')).toBe('This file was not granted to the interpreter.');
  });

  it('terminates a generated program that never finishes', async () => {
    const outsideBefore = await systemScratch();
    const root = await temporaryRoot('viewer-postscript-loop-');
    const file = path.join(root, 'loop.ps');
    await writeFile(file, '%!PS\n{} loop\n', { flag: 'wx' });
    const renderer = new Ghostscript({
      ...recordingPostScriptStage(root).options,
      store: () => false,
      timeout: 250,
    });
    const handle = await open(file, 'r');
    try {
      await expect(
        renderer.decode(
          { file, handle, info: await fileStat(handle) },
          'postscript',
          new AbortController().signal,
          4096,
          await renderer.variant(),
        ),
      ).rejects.toThrow('time limit');
      const entries = await readdir(root, { withFileTypes: true });
      expect(entries.filter((entry) => entry.name.startsWith('gs_'))).toEqual([]);
      expect(await systemScratch()).toEqual(outsideBefore);
    } finally {
      await handle.close();
    }
  });
  it('crops an EPS received on stdin to its stated bounding box', async () => {
    const root = await temporaryRoot('viewer-postscript-crop-');
    const file = path.join(root, 'drawing.eps');
    await writeFile(
      file,
      '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 10 20 154 92\n10 20 144 72 rectfill\nshowpage\n',
    );
    const recording = recordingPostScriptStage(root);
    const renderer = new Ghostscript({ ...recording.options, store: () => false });
    const handle = await open(file, 'r');
    try {
      const output = await renderer.decode(
        { file, handle, info: await fileStat(handle) },
        'postscript',
        new AbortController().signal,
        4096,
        await renderer.variant(),
      );
      const task = getDocument({ data: new Uint8Array(output.data) });
      try {
        const pdf = await task.promise;
        const box = (await pdf.getPage(1)).getViewport({ scale: 1 });
        expect([box.width, box.height]).toEqual([144, 72]);
      } finally {
        await task.destroy();
      }
      expect(recording.trash).not.toHaveBeenCalled();
      expect(recording.empty).toHaveLength(1);
    } finally {
      await handle.close();
    }
  });
  it('refuses a valid allocation program that exceeds the Ghostscript memory budget', async () => {
    const root = await temporaryRoot('viewer-postscript-memory-');
    const file = path.join(root, 'allocation.ps');
    await writeFile(
      file,
      '%!\n/chunks 4000 array def 0 1 3999 { chunks exch 60000 string put } for showpage\n',
    );
    const renderer = new Ghostscript({
      ...recordingPostScriptStage(root).options,
      store: () => false,
      timeout: 5000,
    });
    const handle = await open(file, 'r');
    try {
      await expect(
        renderer.decode(
          { file, handle, info: await fileStat(handle) },
          'postscript',
          new AbortController().signal,
          4096,
          await renderer.variant(),
        ),
      ).rejects.toThrow('could not render');
    } finally {
      await handle.close();
    }
  });
});
