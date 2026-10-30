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
import {
  animationFrames,
  click,
  countOf,
  exists,
  focus,
  patchSettings,
  textOf,
} from './native/runtime/page';
import type { PageExpression } from './native/runtime/page-function';
import { pageCall } from './native/runtime/page-function';
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

const documentLook = () => document.documentElement.dataset.look;

/** The Office plane's opacity through its ancestors, with each one's class and transform. */
function settledChain() {
  let node = document.querySelector('.office-viewer') || document.querySelector('.preview-host'),
    opacity = 1;
  const chain: { className: string; opacity: string; transform: string }[] = [];
  while (node) {
    const style = getComputedStyle(node);
    opacity *= Number(style.opacity);
    chain.push({ className: node.className, opacity: style.opacity, transform: style.transform });
    node = node.parentElement;
  }
  return { opacity, chain };
}

/** Whether Preview details is tall enough to read and on top where it starts. */
function coverageVisible() {
  const coverage = document.querySelector('.office-coverage');
  if (!coverage) return false;
  const rect = coverage.getBoundingClientRect();
  return (
    rect.height > 40 &&
    !!document.elementFromPoint(rect.left + 20, rect.top + 20)?.closest('.office-coverage')
  );
}

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
      () => evaluate(textOf('.office-document .evidence-passage')),
      (text) => text.includes('Știință'),
      'Word source passage',
    );
    assert.ok(passage.includes('200 mm'));
    assert.equal(await evaluate(countOf('.office-document table td')), 4);
    assert.equal(await evaluate(exists('.office-document iframe, .office-document script')), false);
    assert.equal(
      await evaluate(
        pageCall(() =>
          document.querySelector('.office-document')!.textContent.includes('Deleted secret'),
        ),
      ),
      false,
    );
    const facts = await evaluate(
      pageCall((file: string) => window.viewer.inspect(file, true), word),
    );
    assert.equal(facts.facts.title.value, 'Panel fabrication');
    assert.equal(facts.coverage.content, 'partial');
    await capture(connection, 'word-dark');
    await evaluate(patchSettings({ path: 'settings.appearance', value: 'light' }));
    await until(
      () => evaluate(pageCall(documentLook)),
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
      const value = await connection.evaluate(pageCall(settledChain));
      const serialized = JSON.stringify(value);
      stable = serialized === previous ? stable + 1 : 0;
      previous = serialized;
      return value;
    },
    (value) => value.opacity > 0.999 && stable >= 2,
    'Office plane opacity settled for ' + name,
  );
  await writeFile(path.join(output, name + '-styles.json'), JSON.stringify(settled, null, 2));
  await connection.evaluate(animationFrames(2));
  const shot = await connection.command<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
  });
  await writeFile(path.join(output, name + '.png'), Buffer.from(shot.data, 'base64'));
}
/** Chooses in a choice menu (ui/ChoiceMenu.tsx) as a person does: its button, then the value's row. */
async function choose(
  evaluate: <R>(expression: PageExpression<R>) => Promise<Awaited<R>>,
  label: string,
  value: string,
) {
  const row = `.choice-menu [data-menu-id=${JSON.stringify('choice:' + value)}]`;
  await evaluate(click(`button[aria-label=${JSON.stringify(label)}]`));
  await until(() => evaluate(exists(row)), Boolean, label + ' menu');
  await evaluate(click(row));
}
/** Clicks a worksheet's tab; a hidden sheet's tab says so after its name. */
function sheetTab(name: string): void {
  const tab = [...document.querySelectorAll<HTMLElement>('.worksheet-tab-list [role=tab]')].find(
    (tab) => [name, name + ' (hidden)'].includes(tab.textContent.trim()),
  );
  if (!tab) throw new Error('No worksheet tab: ' + name);
  tab.click();
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
      () => evaluate(textOf('.data-scroll .evidence-cell')),
      (text) => text === '20',
      'original worksheet B61',
    );
    assert.match(await evaluate(textOf('.workbook-cell-detail')), /B61.*Saved value: 20.*SUM/);
    await capture(connection, 'workbook-dark');
    await evaluate(focus('input[aria-label="Filter current worksheet page"]'));
    await connection.command('Input.insertText', { text: 'Panel front' });
    await until(
      () => evaluate(countOf('.data-scroll [role="rowheader"]')),
      (n) => n === 1,
      'filtered worksheet',
    );
    assert.equal(await evaluate(textOf('.data-scroll [role="rowheader"]')), '61');
    await evaluate(click('button[aria-label="C61: No saved value"]'));
    assert.match(await evaluate(textOf('.workbook-cell-detail')), /C61.*No saved value.*HYPERLINK/);
    assert.equal(
      await evaluate(
        pageCall(() =>
          performance
            .getEntriesByType('resource')
            .some((entry) => entry.name.startsWith('https://example.invalid')),
        ),
      ),
      false,
    );
    evidence.push(
      'Packaged XLSX preview selects evidence sheet B61, marks saved formula value, filters without renumbering source row 61, and shows missing cached values without executing formulas.',
    );
    await choose(evaluate, 'Preview options', 'details');
    await until(
      () => evaluate(pageCall(coverageVisible)),
      Boolean,
      'coverage is visibly rendered outside the header',
    );
    await evaluate(patchSettings({ path: 'settings.appearance', value: 'light' }));
    await until(
      () => evaluate(pageCall(documentLook)),
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
    await choose(evaluate, 'Preview options', 'details');
    await evaluate(pageCall(sheetTab, 'Hidden'));
    await until(
      () => evaluate(textOf('.data-scroll')),
      (text) => text.includes('Hidden source'),
      'hidden worksheet selection',
    );
    await capture(connection, 'workbook-hidden-compact-light');
    await evaluate(pageCall(sheetTab, 'Empty'));
    await until(
      () => evaluate(textOf('.data-viewer')),
      (text) => text.includes('No stored rows in this sheet.'),
      'empty worksheet message',
    );
    await capture(connection, 'workbook-empty-compact-light');
    await evaluate(pageCall(sheetTab, 'Hidden'));
    await viewer.close(connection);
    connection = undefined;
    const saved = JSON.parse(
      await readFile(path.join(profile, 'viewer-state-v1.json'), 'utf8'),
    ) as SavedState;
    assert.equal(saved.previewStates?.['office:document']?.['office.sheet'], 'Hidden');
    viewer = await ownedApp(binary, profile);
    connection = await viewer.connect();
    await until(
      () => connection!.evaluate(textOf('.data-scroll .evidence-cell')),
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
      () => connection!.evaluate(textOf('.preview-host')),
      (text) => text.includes('Office preview unavailable'),
      'unreadable Office recovery',
    );
    assert.equal(
      await connection.evaluate(
        pageCall(() =>
          [...document.querySelectorAll('.preview-host button')].some(
            (button) => button.textContent === 'Open in Default App',
          ),
        ),
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
