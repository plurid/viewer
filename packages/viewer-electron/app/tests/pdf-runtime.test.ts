import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { copyPDFRuntime } from '../tools/pdf-runtime';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import { createFixtures } from './fixtures';

it('extracts a PDF from the packaged ESM and native dependencies without the workspace', async () => {
  const root = await temporaryRoot('viewer-pdf-runtime-');
  const fixture = await createFixtures();
  try {
    await copyPDFRuntime(root, process.platform, process.arch);
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { readFile } from 'node:fs/promises';
        import { pathToFileURL } from 'node:url';
        const base = pathToFileURL(process.argv[1] + '/node_modules/pdfjs-dist/');
        const pdf = await import(new URL('legacy/build/pdf.mjs', base));
        globalThis.pdfjsWorker = await import(new URL('legacy/build/pdf.worker.mjs', base));
        const task = pdf.getDocument({
          data: new Uint8Array(await readFile(process.argv[2])),
          isEvalSupported: false, disableFontFace: true,
          standardFontDataUrl: process.argv[1] + '/node_modules/pdfjs-dist/standard_fonts/'
        });
        try {
          const document = await task.promise;
          const page = await document.getPage(1);
          console.log((await page.getTextContent()).items.map(item => item.str || '').join(' '));
        } finally { await task.destroy(); }`,
        root,
        path.join(fixture.files, 'Documents/Project brief.pdf'),
      ],
      { cwd: root, timeout: 10000 },
    );
    expect(stdout).toContain('Viewer preview fixture');
    expect(stdout).toContain('Searchable PDF text and local file resources.');
    expect(stderr).not.toContain('Cannot load');
    expect(stderr).not.toContain('Cannot polyfill');
  } finally {
    await trashTemporary(fixture.root);
    await trashTemporary(root);
  }
});
