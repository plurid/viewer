/** Owned packaged paging, real public workbook and generated source citations.
 * Every source/profile/capture is preserved. No user Viewer session is changed. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { sourceVersion, type EvidenceAnchor } from '../../src/domain/files/inspection';
import { entry } from '../../src/desktop/files/filesystem';
import { officeFixture } from '../office-fixtures';
import { defaultPlaygroundDirectory } from '../../tools/playground/main';
import { qualificationSamples } from '../../tools/playground/qualification-samples';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await temporaryRoot('viewer-native-worksheet-pages-');
const generated = path.join(root, 'Source rows.xlsx'),
  publicFile = path.join(root, 'LibreOffice workbook.xlsx');
const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const rows = Array.from({ length: 2600 }, (_, i) => {
  const row = i + 1;
  return `<row r="${row}"><c r="A${row}"><v>${row}</v></c><c r="B${row}"><f>SUM(${row},${row})</f><v>${row * 2}</v></c></row>`;
}).join('');
await writeFile(
  generated,
  officeFixture('workbook', {
    'xl/worksheets/data.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
    'xl/worksheets/empty.xml': '<worksheet><sheetData/></worksheet>',
    'xl/worksheets/broken.xml': '<worksheet><sheetData><row r="1"></sheetData></worksheet>',
    'xl/workbook.xml': `<workbook xmlns:r="${rel}"><sheets><sheet name="Hidden" state="hidden" r:id="hidden"/><sheet name="Measurements" r:id="data"/><sheet name="Empty" r:id="empty"/><sheet name="Broken" r:id="broken"/><sheet name="External" r:id="external"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships>${['hidden', 'data', 'empty', 'broken'].map((id) => `<Relationship Id="${id}" Type="${rel}worksheet" Target="worksheets/${id}.xml"/>`).join('')}<Relationship Id="strings" Type="${rel}sharedStrings" Target="sharedStrings.xml"/><Relationship Id="external" Type="${rel}worksheet" Target="https://example.invalid/not-fetched.xml" TargetMode="External"/></Relationships>`,
  }),
  { flag: 'wx' },
);
const reference = qualificationSamples.find((sample) =>
  sample.path.endsWith('poi-large-workbook.xlsx'),
)!;
const original = path.join(defaultPlaygroundDirectory, reference.path);
const hash = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
assert.equal(await hash(original), reference.sha256);
await copyFile(original, publicFile, 1);
const sourceHashes = new Map(
  await Promise.all([generated, publicFile].map(async (file) => [file, await hash(file)] as const)),
);
const checks: string[] = [],
  captures: string[] = [];
type Connection = Awaited<ReturnType<Awaited<ReturnType<typeof ownedApp>>['connect']>>;
async function run(
  file: string,
  name: string,
  anchor: EvidenceAnchor | undefined,
  check: (connection: Connection) => Promise<void>,
) {
  const profile = path.join(root, name);
  await mkdir(profile);
  const settings = defaultSettings(root),
    ui = normalizePreferences();
  settings.hotkey.enabled = false;
  settings.providers = [];
  const state: SavedState = {
    version: CURRENT_STATE_VERSION,
    look: 'dark',
    activeWorkspace: 'pages',
    favorites: [],
    recents: [],
    ui,
    workspaces: [
      {
        id: 'pages',
        name: 'Worksheet pages',
        roots: ['book'],
        activePane: 'book',
        arrangement: {},
        layout: {
          placements: [
            {
              id: 'book',
              location: { translateX: 0, translateY: 0, translateZ: 0, rotateX: 0, rotateY: 0 },
              width: 1100,
              height: 760,
              show: true,
            },
          ],
          active: 'book',
          docked: 'book',
        },
        panes: [
          {
            id: 'book',
            type: 'preview',
            path: file,
            ...(anchor
              ? {
                  evidence: {
                    path: file,
                    version: sourceVersion(await entry(file)),
                    anchor,
                    quote: '',
                  },
                }
              : {}),
          },
        ],
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
    await check(connection);
    assert.equal((await connection.evaluate<unknown[]>('window.viewer.jobs()')).length, 0);
  } finally {
    await app.close(connection);
  }
}
async function ready(connection: Connection, from: number, name?: string) {
  await until(
    () =>
      connection.evaluate<{
        value?: string;
        range?: string;
        firstRow?: number;
        ready: boolean;
        name?: string;
      }>(
        `(()=>{const first=document.querySelector('.data-scroll .data-row[aria-rowindex]');return {value:document.querySelector('.worksheet-navigation input')?.value,range:document.querySelector('.worksheet-navigation [role=status]')?.textContent,firstRow:first?Number(first.getAttribute('aria-rowindex'))-1:undefined,ready:!!document.querySelector('.office-viewer .data-scroll'),name:document.querySelector('.data-scroll')?.getAttribute('aria-label')}})()`,
      ),
    (value) =>
      Boolean(
        value.ready &&
        (value.value === String(from) || (from === 1 && value.value === undefined)) &&
        (!name || value.name === name) &&
        (value.firstRow !== undefined ||
          value.range?.startsWith('No rows') ||
          (from === 1 && value.value === undefined)) &&
        ((from === 1 && name) || value.range?.startsWith(`Rows ${from.toLocaleString()}–`)),
      ),
    `worksheet ${name || ''} from ${from}`,
  );
}
async function choose(connection: Connection, value: string) {
  const name = JSON.stringify(value);
  await connection.evaluate(
    `[...document.querySelectorAll('[role="tab"]')].find(tab => tab.textContent.trim() === ${name} || tab.textContent.trim() === ${name} + ' (hidden)').click()`,
  );
}

async function press(
  connection: Connection,
  key: string,
  code: string,
  windowsVirtualKeyCode: number,
) {
  for (const type of ['keyDown', 'keyUp'])
    await connection.command('Input.dispatchKeyEvent', {
      type,
      key,
      code,
      windowsVirtualKeyCode,
      ...(type === 'keyDown' && key === 'Enter' ? { text: '\r' } : {}),
    });
}
async function jump(connection: Connection, row: number) {
  await connection.evaluate(
    '(()=>{const input=document.querySelector(".worksheet-navigation input");input.focus();input.select()})()',
  );
  await connection.command('Input.insertText', { text: String(row) });
  await press(connection, 'Enter', 'Enter', 13);
  await ready(connection, row);
}
async function capture(connection: Connection, name: string) {
  let previous = '',
    stable = 0;
  const bounds = await until(
    async () => {
      await connection.evaluate('new Promise(resolve=>setTimeout(resolve,120))');
      const value = await connection.evaluate<{
        overflow: boolean;
        controls: number;
        opacity: number;
      }>(
        `(()=>{const nav=document.querySelector('.worksheet-navigation'),box=nav.getBoundingClientRect();let opacity=1,node=nav;while(node){opacity*=Number(getComputedStyle(node).opacity);node=node.parentElement}return {overflow:[...nav.querySelectorAll('button,input')].some(node=>{const r=node.getBoundingClientRect();return r.left<box.left-1||r.right>box.right+1}),controls:nav.querySelectorAll('button,input').length,opacity}})()`,
      );
      const current = JSON.stringify(value);
      stable = previous === current ? stable + 1 : 0;
      previous = current;
      return value;
    },
    (value) => value.opacity > 0.999 && stable >= 2,
    'settled worksheet capture ' + name,
    10000,
  );
  assert.ok(
    !bounds.overflow && bounds.controls === 4 && bounds.opacity > 0.999,
    JSON.stringify(bounds),
  );
  const shot = await connection.command<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
  });
  const file = path.join(root, name + '.png');
  await writeFile(file, Buffer.from(shot.data, 'base64'), { flag: 'wx' });
  captures.push(file);
}
try {
  await run(
    generated,
    'CitationProfile',
    { kind: 'cells', sheet: 'Measurements', row: 2500, column: 1 },
    async (connection) => {
      await ready(connection, 2500, 'Measurements');
      assert.equal(
        await connection.evaluate<string>(
          'document.querySelector(".data-scroll .evidence-cell")?.textContent.trim()',
        ),
        '2500',
      );
      assert.equal(
        await connection.evaluate<string>(
          'document.querySelector(".data-scroll").getAttribute("aria-rowcount")',
        ),
        '2601',
      );
      await capture(connection, 'citation-dark');
      await connection.evaluate(
        '[...document.querySelectorAll(".worksheet-navigation button")].find(button=>button.textContent==="Next").click()',
      );
      await ready(connection, 2600);
      assert.equal(
        await connection.evaluate<boolean>(
          '[...document.querySelectorAll(".worksheet-navigation button")].find(button=>button.textContent==="Next").disabled',
        ),
        true,
      );
      await connection.evaluate(
        '[...document.querySelectorAll(".worksheet-navigation button")].find(button=>button.textContent==="Previous").click()',
      );
      await ready(connection, 2500);
      await jump(connection, 1200);
      assert.ok(
        (
          await connection.evaluate<string>('document.querySelector(".data-scroll").innerText')
        ).includes('1200'),
      );
      await choose(connection, 'Hidden');
      await ready(connection, 1, 'Hidden');
      await choose(connection, 'Measurements');
      await ready(connection, 1200, 'Measurements');
      checks.push(
        'Original cell citation A2500 loads directly, Next reaches final row 2600, Previous returns, Enter jumps to row 1200 and each sheet remembers its position.',
      );
      await assert.rejects(
        () =>
          connection.evaluate(
            `(async()=>{const resource=await window.viewer.resource(${JSON.stringify(generated)});try{return await window.viewer.document(resource.id,{requestID:crypto.randomUUID(),sheet:'External',fromRow:1,limit:100})}finally{await window.viewer.release(resource.id)}})()`,
          ),
        /worksheet/,
      );
      await choose(connection, 'Broken');
      await until(
        () =>
          connection.evaluate<string>(
            'document.querySelector(".office-viewer .empty-state")?.textContent||""',
          ),
        (text) => text.includes('Worksheet page unavailable'),
        'malformed worksheet refusal',
      );
      assert.equal(
        await connection.evaluate<boolean>('!!document.querySelector(".worksheet-navigation")'),
        false,
      );
      await connection.evaluate('new Promise(resolve=>setTimeout(resolve,400))');
      const errorShot = await connection.command<{ data: string }>('Page.captureScreenshot', {
        format: 'png',
      });
      const errorPath = path.join(root, 'page-error-dark.png');
      await writeFile(errorPath, Buffer.from(errorShot.data, 'base64'), { flag: 'wx' });
      captures.push(errorPath);
      await connection.evaluate(
        '[...document.querySelectorAll(".empty-state button")].find(button=>button.textContent==="First worksheet").click()',
      );
      await ready(connection, 1, 'Measurements');
      await choose(connection, 'Empty');
      await ready(connection, 1, 'Empty');
      assert.ok(
        (
          await connection.evaluate<string>('document.querySelector(".office-viewer").innerText')
        ).includes('No stored rows in this sheet.'),
      );
      checks.push(
        'External worksheet targets fail without being fetched; First worksheet recovers and true empty sheets remain explicit.',
      );
    },
  );
  await run(publicFile, 'PublicProfile', undefined, async (connection) => {
    await ready(connection, 1, 'Documents Per Project');
    const observed = await connection.evaluate<{
      page: { lastRow: number };
      cells: number;
      ms: number;
    }>(
      `(async()=>{const resource=await window.viewer.resource(${JSON.stringify(publicFile)});try{const start=performance.now(),value=await window.viewer.document(resource.id,{requestID:crypto.randomUUID(),sheet:'Documents Per Project',fromRow:5000,limit:100});return {page:value.office.page,cells:value.office.sheets.find(sheet=>sheet.loaded).rows.reduce((n,row)=>n+row.cells.length,0),ms:performance.now()-start}}finally{await window.viewer.release(resource.id)}})()`,
    );
    assert.equal(observed.page.lastRow, 5392);
    assert.ok(observed.cells > 0 && observed.cells <= 25600);
    await jump(connection, 5000);
    await capture(connection, 'public-row-5000-dark');
    await choose(connection, 'Documents Analysis');
    await ready(connection, 1, 'Documents Analysis');
    assert.ok(
      (await connection.evaluate<number>(
        'document.querySelectorAll(".data-scroll .data-row[aria-rowindex]").length',
      )) > 0,
    );
    await connection.evaluate(
      "window.viewer.settingsGet().then(snapshot=>window.viewer.settingsPatch([{path:'settings.appearance',value:'light'}],snapshot.revision))",
    );
    await until(
      () => connection.evaluate<string>('document.documentElement.dataset.look'),
      (look) => look === 'light',
      'light worksheet',
    );
    await capture(connection, 'public-second-sheet-light');
    await connection.command('Emulation.setDeviceMetricsOverride', {
      width: 760,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await choose(connection, 'Documents Per Project');
    await ready(connection, 5000, 'Documents Per Project');
    await capture(connection, 'public-row-5000-narrow-light');
    checks.push(
      `Public 18 MB worksheet page from row 5000 and formerly starved second sheet both render; bounded page contains ${observed.cells} cells, last source row ${observed.page.lastRow}, read ${observed.ms.toFixed(1)} ms. Dark/light and 760px controls stay inside their plane.`,
    );
  });
  for (const [file, expected] of sourceHashes) assert.equal(await hash(file), expected);
  assert.equal(await hash(original), reference.sha256);
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      { completed: true, root, checks, captures, sourceHashes: Object.fromEntries(sourceHashes) },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  for (const check of checks) console.log('PASS', check);
  console.log('Worksheet paging acceptance passed:', root);
} finally {
  console.log('Retained worksheet paging fixtures:', root);
}
