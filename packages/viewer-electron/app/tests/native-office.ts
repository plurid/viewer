/** Generated Office fixtures in an owned direct package. No native picker/Store qualification claim. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { SavedState } from '../src/domain/contracts';
import type { EvidenceAnchor } from '../src/domain/files/inspection';
import { sourceVersion } from '../src/domain/files/inspection';
import { entry } from '../src/desktop/files/filesystem';
import { ownedApp, until } from './owned-app';
import { officeFixture, workbookSheet } from './office-fixtures';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const root = await temporaryRoot('viewer-native-office-');
const output = path.join(root, 'acceptance');
await mkdir(output, { recursive: true });
await writeFile(
  path.join(output, 'result.json'),
  JSON.stringify({ completed: false, startedAt: new Date().toISOString() }),
);
const word = path.join(root, 'Fabrication.docx'),
  book = path.join(root, 'Measurements.xlsx');
const extra = Array.from({ length: 59 }, (_, index) => {
  const row = index + 2;
  return `<row r="${row}"><c r="A${row}" t="inlineStr"><is><t>Cut panel ${row}</t></is></c><c r="B${row}"><v>${row * 2}</v></c><c r="C${row}" t="inlineStr"><is><t>mm</t></is></c></row>`;
}).join('');
await writeFile(word, officeFixture('word'));
await writeFile(
  book,
  officeFixture('workbook', {
    'xl/worksheets/data.xml': workbookSheet.replace('<row r="61">', extra + '<row r="61">'),
    'xl/workbook.xml':
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships/"><sheets><sheet name="Hidden" sheetId="1" state="hidden" r:id="hidden"/><sheet name="Measurements" sheetId="2" r:id="data"/><sheet name="Empty" sheetId="3" r:id="empty"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships>' +
      ['hidden', 'data', 'empty']
        .map(
          (id) =>
            `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${id}.xml"/>`,
        )
        .join('') +
      '<Relationship Id="strings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
    'xl/worksheets/empty.xml': '<worksheet><sheetData/></worksheet>',
  }),
);
const binary =
  process.env.VIEWER_TEST_BINARY ??
  path.resolve('out/Viewer-darwin-arm64/Viewer.app/Contents/MacOS/Viewer');
const evidence: string[] = [];
async function prepare(file: string, name: string, anchor: EvidenceAnchor) {
  const profile = path.join(root, name);
  await mkdir(profile);
  const state: SavedState = {
    version: 4,
    look: 'dark',
    activeWorkspace: 'office',
    favorites: [],
    recents: [],
    workspaces: [
      {
        id: 'office',
        name: 'Office checks',
        roots: ['document'],
        activePane: 'document',
        arrangement: {},
        layout: {
          placements: [
            {
              id: 'document',
              location: { translateX: 0, translateY: 0, translateZ: 0, rotateX: 0, rotateY: 0 },
              width: 1100,
              height: 760,
              show: true,
            },
          ],
          active: 'document',
          docked: 'document',
        },
        panes: [
          {
            id: 'document',
            type: 'preview',
            path: file,
            evidence: { path: file, version: sourceVersion(await entry(file)), anchor, quote: '' },
          },
        ],
      },
    ],
  };
  await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));
  return profile;
}
async function checkWord() {
  const profile = await prepare(word, 'WordProfile', { kind: 'document', block: 1 });
  const viewer = await ownedApp(binary, profile);
  let connection: Awaited<ReturnType<typeof viewer.connect>> | undefined;
  try {
    connection = await viewer.connect();
    const evaluate = connection.evaluate;
    await connection.command('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 940,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const passage = await until(
      () =>
        evaluate<string>(
          `document.querySelector('.office-document .evidence-passage')?.textContent||''`,
        ),
      (text) => text.includes('Știință'),
      'Word source passage',
    );
    assert.ok(passage.includes('200 mm'));
    assert.equal(
      await evaluate<number>(`document.querySelectorAll('.office-document table td').length`),
      4,
    );
    assert.equal(
      await evaluate<boolean>(
        `!!document.querySelector('.office-document iframe, .office-document script')`,
      ),
      false,
    );
    assert.equal(
      await evaluate<boolean>(
        `document.querySelector('.office-document').textContent.includes('Deleted secret')`,
      ),
      false,
    );
    const facts = await evaluate<{
      facts: { title: { value: string } };
      coverage: { content: string };
    }>(`window.viewer.inspect(${JSON.stringify(word)},true)`);
    assert.equal(facts.facts.title.value, 'Panel fabrication');
    assert.equal(facts.coverage.content, 'partial');
    await capture(connection, 'word-dark');
    await evaluate(
      `window.viewer.settingsGet().then(s=>window.viewer.settingsPatch([{path:'settings.appearance',value:'light'}],s.revision))`,
    );
    await until(
      () => evaluate<string>(`document.documentElement.dataset.look`),
      (look) => look === 'light',
      'light Word theme',
    );
    await capture(connection, 'word-light');
    await connection.command('Emulation.setDeviceMetricsOverride', {
      width: 900,
      height: 640,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await capture(connection, 'word-compact-light');
    evidence.push(
      'Packaged worker extracts actual DOCX metadata/body; rendered headings/tables and version-matched passage anchors work; source tags stay text and deleted text stays omitted. Dark/light and compact captures.',
    );
  } finally {
    await viewer.close(connection);
  }
}
async function capture(
  connection: Awaited<ReturnType<Awaited<ReturnType<typeof ownedApp>>['connect']>>,
  name: string,
) {
  let previous = '',
    stable = 0;
  const settled = await until(
    async () => {
      await delay(120);
      const value = await connection.evaluate<{
        opacity: number;
        chain: { className: string; opacity: string; transform: string }[];
      }>(
        `(()=>{let node=document.querySelector('.office-viewer')||document.querySelector('.preview-host'),opacity=1,chain=[];while(node){const s=getComputedStyle(node);opacity*=Number(s.opacity);chain.push({className:node.className,opacity:s.opacity,transform:s.transform});node=node.parentElement}return {opacity,chain}})()`,
      );
      const serialized = JSON.stringify(value);
      stable = serialized === previous ? stable + 1 : 0;
      previous = serialized;
      return value;
    },
    (value) => value.opacity > 0.999 && stable >= 2,
    'Office plane opacity settled for ' + name,
  );
  await writeFile(path.join(output, name + '-styles.json'), JSON.stringify(settled, null, 2));
  await connection.evaluate(
    'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))',
  );
  const shot = await connection.command<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
  });
  await writeFile(path.join(output, name + '.png'), Buffer.from(shot.data, 'base64'));
}
/** Chooses in a choice menu (ui/ChoiceMenu.tsx) as a person does: its button, then the value's row. */
async function choose(
  evaluate: <T>(expression: string) => Promise<T>,
  label: string,
  value: string,
) {
  const row = JSON.stringify(`.choice-menu [data-menu-id=${JSON.stringify('choice:' + value)}]`);
  await evaluate(`document.querySelector('button[aria-label=${JSON.stringify(label)}]').click()`);
  await until(
    () => evaluate<boolean>(`!!document.querySelector(${row})`),
    Boolean,
    label + ' menu',
  );
  await evaluate(`document.querySelector(${row}).click()`);
}
async function checkBook() {
  const profile = await prepare(book, 'BookProfile', {
    kind: 'cells',
    sheet: 'Measurements',
    row: 61,
    column: 2,
  });
  let viewer = await ownedApp(binary, profile);
  let connection: Awaited<ReturnType<typeof viewer.connect>> | undefined;
  try {
    connection = await viewer.connect();
    const evaluate = connection.evaluate;
    await connection.command('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 940,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await until(
      () =>
        evaluate<string>(`document.querySelector('.data-scroll .evidence-cell')?.textContent||''`),
      (text) => text === '20',
      'original worksheet B61',
    );
    assert.match(
      await evaluate<string>(`document.querySelector('.workbook-cell-detail').textContent`),
      /B61.*Saved value: 20.*SUM/,
    );
    await capture(connection, 'workbook-dark');
    await evaluate(
      `document.querySelector('input[aria-label="Filter current worksheet page"]').focus()`,
    );
    await connection.command('Input.insertText', { text: 'Panel front' });
    await until(
      () => evaluate<number>(`document.querySelectorAll('.data-scroll [role="rowheader"]').length`),
      (n) => n === 1,
      'filtered worksheet',
    );
    assert.equal(
      await evaluate<string>(
        `document.querySelector('.data-scroll [role="rowheader"]').textContent`,
      ),
      '61',
    );
    await evaluate(`document.querySelector('button[aria-label="C61: No saved value"]').click()`);
    assert.match(
      await evaluate<string>(`document.querySelector('.workbook-cell-detail').textContent`),
      /C61.*No saved value.*HYPERLINK/,
    );
    assert.equal(
      await evaluate<boolean>(
        `performance.getEntriesByType('resource').some(e=>e.name.startsWith('https://example.invalid'))`,
      ),
      false,
    );
    evidence.push(
      'Packaged XLSX preview selects evidence sheet B61, marks saved formula value, filters without renumbering source row 61, and shows missing cached values without executing formulas.',
    );
    await evaluate(
      `Array.from(document.querySelectorAll('.preview-toolbar button')).find(b=>b.textContent==='Preview details').click()`,
    );
    await until(
      () =>
        evaluate<boolean>(
          `(()=>{const e=document.querySelector('.office-coverage');if(!e)return false;const r=e.getBoundingClientRect();return r.height>40&&!!document.elementFromPoint(r.left+20,r.top+20)?.closest('.office-coverage')})()`,
        ),
      Boolean,
      'coverage is visibly rendered outside the header',
    );
    await evaluate(
      `window.viewer.settingsGet().then(s=>window.viewer.settingsPatch([{path:'settings.appearance',value:'light'}],s.revision))`,
    );
    await until(
      () => evaluate<string>(`document.documentElement.dataset.look`),
      (look) => look === 'light',
      'light workbook theme',
    );
    await capture(connection, 'workbook-formula-light');
    await connection.command('Emulation.setDeviceMetricsOverride', {
      width: 900,
      height: 640,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await capture(connection, 'workbook-compact-light');
    await evaluate(
      `Array.from(document.querySelectorAll('.preview-toolbar button')).find(b=>b.textContent==='Preview details').click()`,
    );
    await choose(evaluate, 'Worksheet', 'Hidden');
    await until(
      () => evaluate<string>(`document.querySelector('.data-scroll')?.textContent||''`),
      (text) => text.includes('Hidden source'),
      'hidden worksheet selection',
    );
    await capture(connection, 'workbook-hidden-compact-light');
    await choose(evaluate, 'Worksheet', 'Empty');
    await until(
      () => evaluate<string>(`document.querySelector('.data-viewer')?.textContent||''`),
      (text) => text.includes('No stored rows in this sheet.'),
      'empty worksheet message',
    );
    await capture(connection, 'workbook-empty-compact-light');
    await choose(evaluate, 'Worksheet', 'Hidden');
    await viewer.close(connection);
    connection = undefined;
    const saved = JSON.parse(
      await readFile(path.join(profile, 'viewer-state-v1.json'), 'utf8'),
    ) as SavedState;
    assert.equal(saved.previewStates?.['office:document']?.['office.sheet'], 'Hidden');
    viewer = await ownedApp(binary, profile);
    connection = await viewer.connect();
    await until(
      () =>
        connection!.evaluate<string>(
          `document.querySelector('.data-scroll .evidence-cell')?.textContent||''`,
        ),
      (text) => text === '20',
      'cold original worksheet evidence',
    );
    evidence.push(
      'Worksheet choice is durably saved. A cold process honours the original evidence citation over the stored sheet and restores the marked B61 cell.',
    );
  } finally {
    await viewer.close(connection);
  }
}
async function checkError() {
  const file = path.join(root, 'Unreadable.docx');
  await writeFile(file, 'Unsupported or encrypted Office container');
  const profile = await prepare(file, 'ErrorProfile', { kind: 'document', block: 0 });
  const viewer = await ownedApp(binary, profile);
  let connection: Awaited<ReturnType<typeof viewer.connect>> | undefined;
  try {
    connection = await viewer.connect();
    await connection.command('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 940,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await until(
      () =>
        connection!.evaluate<string>(`document.querySelector('.preview-host')?.textContent||''`),
      (text) => text.includes('Office preview unavailable'),
      'unreadable Office recovery',
    );
    assert.equal(
      await connection.evaluate<boolean>(
        `Array.from(document.querySelectorAll('.preview-host button')).some(b=>b.textContent==='Open in Default App')`,
      ),
      true,
    );
    await capture(connection, 'office-error-dark');
    evidence.push(
      'Preview details is visibly readable outside header clipping. Empty worksheets and unsupported-container recovery render in the actual package. All captures wait for settled camera transforms and full opacity.',
    );
  } finally {
    await viewer.close(connection);
  }
}
try {
  await checkWord();
  await checkBook();
  await checkError();
  await writeFile(
    path.join(output, 'result.json'),
    JSON.stringify(
      {
        completed: true,
        checks: evidence,
        scope:
          'Owned direct package; generated files. Native folder pickers, physical assistive technologies and Store acceptance remain separate.',
      },
      null,
      2,
    ),
  );
  for (const check of evidence) console.log('PASS', check);
} finally {
  await trashTemporary(root);
}
