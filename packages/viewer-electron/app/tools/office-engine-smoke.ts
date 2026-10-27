/** Real universal-engine check, runnable on all desktop platforms. All outputs stay. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'vite';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { temporaryRoot } from './temporary';
import { prepareOfficeRuntime } from './office-runtime';
import { downloadSample } from './playground/camera-raw';
import { officeLayoutSamples } from './playground/office-layout';
import { qualificationSamples } from './playground/qualification-samples';
import { officeFontFixture } from '../tests/fixtures/office-fonts';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = await prepareOfficeRuntime(appRoot);
await mkdir(path.join(appRoot, 'out'), { recursive: true });
const root = await temporaryRoot('viewer-office-engine-smoke-', path.join(appRoot, 'out'));
await mkdir(path.join(root, 'Profile'));
const samples = [
  ...officeLayoutSamples,
  ...qualificationSamples.filter((sample) =>
    /poi-(various-pictures.docx|conditional-formatting.xlsx)$/.test(sample.path),
  ),
];
const inputs = [];
for (const sample of samples) {
  const name = path.basename(sample.path);
  await writeFile(path.join(root, name), await downloadSample(sample), { flag: 'wx' });
  inputs.push({ name, sha256: sample.sha256 });
}
// Exercise an actual FILENAME field with characters that have URL semantics.
// This is a byte-identical public fixture, renamed only inside the owned root.
const filenameSource = inputs.find((input) => input.name === 'FloatingPictures.doc');
assert.ok(filenameSource);
const fieldName = "見積 #1 (50%) 'draft'.doc";
await writeFile(path.join(root, fieldName), await readFile(path.join(root, filenameSource.name)), {
  flag: 'wx',
});
inputs.push({ name: fieldName, sha256: filenameSource.sha256 });
const fontName = 'Regional serif and sans.docx';
const fontFixture = officeFontFixture();
await writeFile(path.join(root, fontName), fontFixture, { flag: 'wx' });
inputs.push({ name: fontName, sha256: createHash('sha256').update(fontFixture).digest('hex') });
await writeFile(path.join(root, 'job.json'), JSON.stringify({ runtime, inputs }), { flag: 'wx' });
const output = path.join(root, 'Application');
await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    outDir: output,
    emptyOutDir: false,
    target: 'node22',
    lib: {
      entry: path.join(appRoot, 'tests/native/office-engine-host.ts'),
      formats: ['es'],
      fileName: () => 'main.mjs',
    },
    rollupOptions: { external: [/^node:/, 'electron'] },
  },
});
const require = createRequire(import.meta.url);
const electron = require('electron') as string;
await promisify(execFile)(electron, [path.join(output, 'main.mjs'), root], {
  timeout: 300000,
  killSignal: 'SIGKILL',
  maxBuffer: 1024 * 1024,
});
const result = JSON.parse(await readFile(path.join(root, 'result.json'), 'utf8'));
assert.equal(result.passed, true);
async function pageText(file: string, number = 1): Promise<string> {
  const task = getDocument({ data: new Uint8Array(await readFile(file)) });
  try {
    const document = await task.promise,
      page = await document.getPage(number);
    return (await page.getTextContent()).items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');
  } finally {
    await task.destroy();
  }
}
for (const item of result.cases) {
  if (item.name === fontName) {
    const pdf = await readFile(path.join(root, item.name + '.pdf'));
    for (const family of [
      'NotoSerifCJKjp',
      'NotoSansCJKjp',
      'NotoSerifCJKsc',
      'NotoSansCJKsc',
      'NotoSerifCJKtc',
      'NotoSansCJKtc',
      'NotoSerifCJKhk',
      'NotoSerifCJKkr',
      'NotoSansCJKkr',
    ])
      assert.ok(pdf.includes(Buffer.from(family)), 'Embedded regional font: ' + family);
    assert.ok((await pageText(path.join(root, item.name + '.pdf'))).includes('日本語の明朝体'));
  }
  if (item.name.endsWith('.doc')) {
    assert.ok(
      (await pageText(path.join(root, item.name + '.pdf')))
        .replace(/\s+/g, '')
        .includes(item.name.replace(/\s+/g, '')),
      'Legacy DOC filename fields preserve the source basename.',
    );
    assert.ok(
      (await pageText(path.join(root, item.name + '.pdf'), 7)).includes('文京区と目黒区。'),
      'Legacy DOC layout includes readable Japanese glyphs.',
    );
  }
  if (item.office?.sheets.length > 1)
    assert.notEqual(
      await pageText(path.join(root, item.name + '.pdf')),
      await pageText(path.join(root, item.name + '.second-sheet.pdf')),
      'Worksheet selection changes rendered content: ' + item.name,
    );
}
console.log(
  JSON.stringify(
    {
      passed: true,
      platform: process.platform,
      architecture: process.arch,
      cases: result.cases,
      fixture: path.basename(root),
    },
    null,
    2,
  ),
);
