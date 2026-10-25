import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { copyPDFRuntime } from '../tools/pdf-runtime';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import { pdfFixture } from './fixtures';

it('extracts a PDF from the packaged ESM and native dependencies without the workspace', async () => {
  const root = await temporaryRoot('viewer-pdf-runtime-');
  const file = path.join(root, 'Generated.pdf');
  await writeFile(file, pdfFixture());
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
        file,
      ],
      { cwd: root, timeout: 10000 },
    );
    expect(stdout).toContain('Viewer preview fixture');
    expect(stdout).toContain('Searchable PDF text and local file resources.');
    expect(stderr).not.toContain('Cannot load');
    expect(stderr).not.toContain('Cannot polyfill');
  } finally {
    await trashTemporary(root);
  }
  // Copying the packaged dependency tree competes with the suite's other filesystem work;
  // the extraction subprocess retains its separate 10-second deadline.
}, 60_000);
