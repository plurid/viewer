import { existsSync } from 'node:fs';
import { open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { describe, expect, it } from 'vitest';
import { Ghostscript } from '../src/desktop/previews/postscript-renderer';
import { temporaryRoot } from '../tools/temporary';
import { postscriptSample } from './support/postscript';

const ready = ['/opt/homebrew/bin/gs', '/usr/local/bin/gs', '/opt/local/bin/gs'].some(existsSync);
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfWorker;

describe.skipIf(!ready)('installed Ghostscript against generated programs', () => {
  it.each([2, 3])('renders a Level %s two-page document into a readable PDF', async (level) => {
    const root = await temporaryRoot('viewer-postscript-real-');
    const file = path.join(root, 'source.ps');
    const source = postscriptSample.replace('%%LanguageLevel: 3', `%%LanguageLevel: ${level}`);
    await writeFile(file, source, { flag: 'wx' });
    const renderer = new Ghostscript({ customPath: () => '', store: () => false, directory: root });
    const handle = await open(file, 'r');
    try {
      const output = await renderer.decode(
        { file, handle, info: await handle.stat() },
        'postscript',
        new AbortController().signal,
        4096,
        await renderer.variant(),
      );
      await writeFile(path.join(root, 'rendered.pdf'), output.data, { flag: 'wx' });
      const task = getDocument({ data: new Uint8Array(output.data), isEvalSupported: false });
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

  it('refuses a generated program reading a file outside its temporary copy', async () => {
    const root = await temporaryRoot('viewer-postscript-safer-');
    const secret = path.join(root, 'separate-file.txt');
    await writeFile(secret, 'This file was not granted to the interpreter.', { flag: 'wx' });
    const file = path.join(root, 'read-other-file.ps');
    const escaped = secret.replace(/[\\()]/g, '\\$&');
    await writeFile(file, `%!PS\n(${escaped}) (r) file closefile\nshowpage\n`, { flag: 'wx' });
    const renderer = new Ghostscript({ customPath: () => '', store: () => false, directory: root });
    const handle = await open(file, 'r');
    try {
      await expect(
        renderer.decode(
          { file, handle, info: await handle.stat() },
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
    const root = await temporaryRoot('viewer-postscript-loop-');
    const file = path.join(root, 'loop.ps');
    await writeFile(file, '%!PS\n{} loop\n', { flag: 'wx' });
    const renderer = new Ghostscript({
      customPath: () => '',
      store: () => false,
      directory: root,
      timeout: 250,
    });
    const handle = await open(file, 'r');
    try {
      await expect(
        renderer.decode(
          { file, handle, info: await handle.stat() },
          'postscript',
          new AbortController().signal,
          4096,
          await renderer.variant(),
        ),
      ).rejects.toThrow('time limit');
    } finally {
      await handle.close();
    }
  });
});
