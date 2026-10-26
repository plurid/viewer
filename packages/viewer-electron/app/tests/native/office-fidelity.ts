/** Owned packaged fidelity, permissions and source preservation. Fixtures stay. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { defaultPlaygroundDirectory } from '../../tools/playground/main';
import { qualificationSamples } from '../../tools/playground/qualification-samples';
import { temporaryRoot } from '../../tools/temporary';
import { fidelityWord, fidelityWorkbook } from '../office-fidelity-fixtures';
import { ownedApp, until } from '../owned-app';
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await temporaryRoot('viewer-native-office-fidelity-');
const word = path.join(root, 'Materials.docx'),
  book = path.join(root, 'Report.xlsx');
await writeFile(
  word,
  fidelityWord(await readFile(path.resolve('tools/playground/assets/study.png'))),
  { flag: 'wx' },
);
await writeFile(book, fidelityWorkbook(), { flag: 'wx' });
const files = [word, book];
for (const name of ['poi-various-pictures.docx', 'poi-conditional-formatting.xlsx']) {
  const sample = qualificationSamples.find((item) => item.path.endsWith('/' + name))!;
  const from =
      name === 'poi-various-pictures.docx' && process.env.VIEWER_TEST_OFFICE_IMAGE_FILE
        ? process.env.VIEWER_TEST_OFFICE_IMAGE_FILE
        : path.join(defaultPlaygroundDirectory, sample.path),
    to = path.join(root, name);
  assert.equal(
    createHash('sha256')
      .update(await readFile(from))
      .digest('hex'),
    sample.sha256,
  );
  await copyFile(from, to, 1);
  files.push(to);
}
const hash = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const before = await Promise.all(files.map(hash));
const captures: string[] = [],
  observations: unknown[] = [];
type Connection = Awaited<ReturnType<Awaited<ReturnType<typeof ownedApp>>['connect']>>;
async function capture(connection: Connection, name: string) {
  await until(
    () =>
      connection.evaluate<number>(
        `(()=>{let n=document.querySelector('.data-scroll,.office-document'),v=1;while(n){v*=Number(getComputedStyle(n).opacity);n=n.parentElement}return v})()`,
      ),
    (value) => value > 0.999,
    'Settled Office capture',
  );
  await connection.evaluate('new Promise(r=>setTimeout(r,200))');
  const image = await connection.command<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
  });
  const file = path.join(root, name + '.png');
  await writeFile(file, Buffer.from(image.data, 'base64'), { flag: 'wx' });
  captures.push(file);
}
async function click(connection: Connection, label: string) {
  await connection.evaluate(
    `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing '+${JSON.stringify(label)});b.click()})()`,
  );
}
async function run(file: string, check: (connection: Connection) => Promise<void>) {
  const profile = path.join(root, path.basename(file) + '-Profile');
  await mkdir(profile);
  const settings = defaultSettings(root),
    ui = normalizePreferences();
  settings.hotkey.enabled = false;
  settings.providers = [];
  const state: SavedState = {
    version: CURRENT_STATE_VERSION,
    look: 'dark',
    activeWorkspace: 'office',
    favorites: [],
    recents: [],
    ui,
    workspaces: [
      {
        id: 'office',
        name: 'Office fidelity',
        roots: ['file'],
        activePane: 'file',
        arrangement: {},
        layout: {
          placements: [
            {
              id: 'file',
              width: 1200,
              height: 780,
              show: true,
              location: { translateX: 0, translateY: 0, translateZ: 0, rotateX: 0, rotateY: 0 },
            },
          ],
          active: 'file',
          docked: 'file',
        },
        panes: [{ id: 'file', type: 'preview', path: file }],
      },
    ],
  };
  await writeFile(
    path.join(profile, 'config.jsonc'),
    JSON.stringify({ version: 1, settings, ui }),
    { flag: 'wx' },
  );
  await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), {
    flag: 'wx',
  });
  const app = await ownedApp(binary!, profile);
  let connection: Connection | undefined;
  try {
    connection = await app.connect();
    await connection.command('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 940,
      deviceScaleFactor: 1,
      mobile: false,
    });
    if (file.endsWith('.docx')) {
      await until(
        () => connection!.evaluate<boolean>('!!document.querySelector(".office-mode-bar")'),
        Boolean,
        'Office layout/reading choices',
      );
      await connection.evaluate(
        '[...document.querySelectorAll(".office-mode-bar button")].find(b=>b.textContent.trim()==="Reading").click()',
      );
    }
    await until(
      () =>
        connection!.evaluate<boolean>(
          '!!document.querySelector(".office-viewer .data-scroll,.office-document")',
        ),
      Boolean,
      'Office document ready',
    );
    await check(connection);
    assert.equal((await connection.evaluate<unknown[]>('window.viewer.jobs()')).length, 0);
  } finally {
    await app.close(connection);
  }
}
try {
  await run(book, async (connection) => {
    const { evaluate, command } = connection;
    await until(
      () => evaluate<string>('document.querySelector(".workbook-merged-cell")?.textContent'),
      (text) => text === 'Quarterly materials',
      'Merged title',
    );
    assert.equal(
      await evaluate<string>(
        'document.querySelector(".workbook-merged-cell").parentElement.getAttribute("aria-colspan")',
      ),
      '3',
    );
    await evaluate('document.querySelector(".data-scroll").scrollLeft=500');
    await until(
      () => evaluate<boolean>(`!!document.querySelector('button[aria-label="G2: $1,234.50"]')`),
      Boolean,
      'Formatted cached formula',
    );
    await evaluate(`document.querySelector('button[aria-label="G2: $1,234.50"]').click()`);
    assert.match(
      await evaluate<string>('document.querySelector(".workbook-cell-detail").textContent'),
      /G2Saved value: 1234.5 · Formula: SUM\(D2\)/,
    );
    await capture(connection, 'workbook-formatted-dark');
    await click(connection, 'Stored');
    assert.ok(
      await evaluate<boolean>(`!!document.querySelector('button[aria-label="G2: 1234.5"]')`),
    );
    await click(connection, 'Formatted');
    await evaluate(
      '(()=>{const input=document.querySelector(".worksheet-navigation input");input.focus();input.select()})()',
    );
    await command('Input.insertText', { text: '100' });
    for (const type of ['keyDown', 'keyUp'])
      await command('Input.dispatchKeyEvent', {
        type,
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        ...(type === 'keyDown' ? { text: '\r' } : {}),
      });
    await until(
      () => evaluate<string>('document.querySelector(".workbook-merged-cell")?.textContent'),
      (text) => text?.includes('Continued from A3'),
      'Cross-page merged anchor',
    );
    await evaluate('document.querySelector(".data-scroll").scrollLeft=0');
    await evaluate('document.querySelector(".workbook-merged-cell").click()');
    assert.match(
      await evaluate<string>('document.querySelector(".workbook-cell-detail").textContent'),
      /A3Continued source range.*Merged A3:C104/,
    );
    await capture(connection, 'workbook-continued-dark');
    await evaluate(
      "window.viewer.settingsGet().then(s=>window.viewer.settingsPatch([{path:'settings.appearance',value:'light'}],s.revision))",
    );
    await until(
      () => evaluate<string>('document.documentElement.dataset.look'),
      (look) => look === 'light',
      'Light Office theme',
    );
    await capture(connection, 'workbook-light');
    await command('Emulation.setDeviceMetricsOverride', {
      width: 760,
      height: 920,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await capture(connection, 'workbook-narrow');
    const guard = await evaluate(
      `(async()=>{const r=await window.viewer.resource(${JSON.stringify(book)});try {await window.viewer.officeImage(r.id,'xl/styles.xml',crypto.randomUUID());return false}catch(e){return e.message.includes('DOCX')}finally{await window.viewer.release(r.id)}})()`,
    );
    assert.equal(guard, true);
    observations.push(
      'Workbook formatted/stored, cached formula, cross-page source anchor and non-DOCX image refusal pass.',
    );
  });
  await run(word, async (connection) => {
    const { evaluate } = connection;
    await until(
      () =>
        evaluate<boolean>(
          `(()=>{const i=document.querySelector('img[alt="Material study"]');return !!i&&i.complete&&i.naturalWidth>0})()`,
        ),
      Boolean,
      'Embedded Word pixels',
    );
    assert.equal(
      await evaluate<string>('document.querySelector(".office-document p").textContent'),
      'Before the image.After the image.',
    );
    assert.equal(
      await evaluate<string>(
        'getComputedStyle(document.querySelector(".office-document")).fontSize',
      ),
      '16px',
    );
    await capture(connection, 'word-image-dark');
    await evaluate('document.querySelector(".office-document-scroll").scrollTop=10000');
    await until(
      () =>
        evaluate<boolean>(
          `!!document.querySelector('.office-image-placeholder[aria-label*="External images"]')`,
        ),
      Boolean,
      'External image placeholder',
    );
    await capture(connection, 'word-table-placeholders');
    const guarded = await evaluate(
      `(async()=>{const r=await window.viewer.resource(${JSON.stringify(word)});let refused=false;try{await window.viewer.officeImage(r.id,'word/media/diagram.svg',crypto.randomUUID())}catch(e){refused=e.message.includes('relationship')}const image=await window.viewer.officeImage(r.id,'word/media/study.png',crypto.randomUUID());const live=(await fetch(image.url)).status;await window.viewer.release(r.id);const expired=(await fetch(image.url)).status;return {refused,live,expired}})()`,
    );
    assert.deepEqual(guarded, { refused: true, live: 200, expired: 404 });
    await evaluate(
      "window.viewer.settingsGet().then(s=>window.viewer.settingsPatch([{path:'settings.appearance',value:'light'}],s.revision))",
    );
    await until(
      () => evaluate<string>('document.documentElement.dataset.look'),
      (look) => look === 'light',
      'Light Word',
    );
    await evaluate('document.querySelector(".office-document-scroll").scrollTop=0');
    await until(
      () =>
        evaluate<boolean>(
          `(()=>{const i=document.querySelector('img[alt="Material study"]');return !!i&&i.complete&&i.naturalWidth>0})()`,
        ),
      Boolean,
      'Reopened image',
    );
    await capture(connection, 'word-image-light');
    await connection.command('Emulation.setDeviceMetricsOverride', {
      width: 760,
      height: 920,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await capture(connection, 'word-narrow');
    observations.push({
      embeddedImages: 'PNG pixels, inline order, table and placeholders',
      authority: guarded,
    });
  });
  await run(files[2]!, async (connection) => {
    await until(
      () => connection.evaluate<number>('document.querySelectorAll(".office-document img").length'),
      (count) => count > 0,
      'Public Word embedded media',
    );
    await until(
      () =>
        connection.evaluate<boolean>(
          '[...document.querySelectorAll(".office-document img")].some(i=>i.complete&&i.naturalWidth>0)',
        ),
      Boolean,
      'Public Word decoded image',
    );
    await capture(connection, 'public-word');
    observations.push(
      'Pinned Apache POI VariousPictures document decodes PNG/JPEG and labels unsupported WMF/EMF.',
    );
  });
  await run(files[3]!, async (connection) => {
    await until(
      () => connection.evaluate<number>('document.querySelectorAll(".workbook-cell").length'),
      (count) => count > 0,
      'Public workbook cells',
    );
    const coverage = await connection.evaluate(
      `(async()=>{const r=await window.viewer.resource(${JSON.stringify(files[3])});try{const d=await window.viewer.document(r.id,{fromRow:1,limit:100,requestID:crypto.randomUUID()});return {sheets:d.office.sheets.length,formatted:d.office.sheets.flatMap(s=>s.rows.flatMap(r=>r.cells)).filter(c=>c.formatted!==undefined).length}}finally{await window.viewer.release(r.id)}})()`,
    );
    await capture(connection, 'public-workbook');
    observations.push(coverage);
  });
  assert.deepEqual(await Promise.all(files.map(hash)), before, 'Every original remains unchanged');
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify({ pass: true, binary, captures, observations, hashes: before }, null, 2),
    { flag: 'wx' },
  );
  console.log(JSON.stringify({ pass: true, root, captures, observations }, null, 2));
} catch (error) {
  await writeFile(
    path.join(root, 'failure.json'),
    JSON.stringify({ error: String(error), binary, captures, observations }, null, 2),
    { flag: 'wx' },
  );
  throw error;
}
