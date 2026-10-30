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
import { click, countOf, exists, patchSettings, textOf } from './runtime/page';
import { pageCall } from './runtime/page-function';

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
type WorkbookValues = 'formatted' | 'stored';

/** The Office view's opacity, multiplied through its ancestors. */
function viewOpacity() {
  let element = document.querySelector('.data-scroll,.office-document'),
    opacity = 1;
  while (element) {
    opacity *= Number(getComputedStyle(element).opacity);
    element = element.parentElement;
  }
  return opacity;
}

const officeViewChoices = () =>
  [...document.querySelectorAll('.preview-toolbar button')].some((button) =>
    ['Layout', 'Print layout', 'Reading', 'Sheet'].includes(button.textContent.trim()),
  );

function pressToolbarButton(label: string) {
  [...document.querySelectorAll<HTMLElement>('.preview-toolbar button')]
    .find((button) => button.textContent.trim() === label)!
    .click();
}

function scrollGrid(left: number) {
  document.querySelector('.data-scroll')!.scrollLeft = left;
}

function scrollDocument(top: number) {
  document.querySelector('.office-document-scroll')!.scrollTop = top;
}

function selectPageField() {
  const input = document.querySelector<HTMLInputElement>('.worksheet-navigation input')!;
  input.focus();
  input.select();
}

/** Whether a workbook part is refused as an image, which only DOCX files serve. */
async function workbookImageRefused(file: string) {
  const resource = await window.viewer.resource(file);
  try {
    await window.viewer.officeImage(resource.id, 'xl/styles.xml', crypto.randomUUID());
    return false;
  } catch (error) {
    return (error as Error).message.includes('DOCX');
  } finally {
    await window.viewer.release(resource.id);
  }
}

function studyImageShown() {
  const image = document.querySelector<HTMLImageElement>('img[alt="Material study"]');
  return !!image && image.complete && image.naturalWidth > 0;
}

/** Refuses an unrelated part, serves a related image, and expires it with the resource. */
async function wordImageAuthority(file: string) {
  const resource = await window.viewer.resource(file);
  let refused = false;
  try {
    await window.viewer.officeImage(resource.id, 'word/media/diagram.svg', crypto.randomUUID());
  } catch (error) {
    refused = (error as Error).message.includes('relationship');
  }
  const image = await window.viewer.officeImage(
    resource.id,
    'word/media/study.png',
    crypto.randomUUID(),
  );
  const live = (await fetch(image.url)).status;
  await window.viewer.release(resource.id);
  const expired = (await fetch(image.url)).status;
  return { refused, live, expired };
}

const decodedImage = () =>
  [...document.querySelectorAll<HTMLImageElement>('.office-document img')].some(
    (image) => image.complete && image.naturalWidth > 0,
  );

/** The workbook's sheet count and how many of its first cells carry a formatted value. */
async function workbookCoverage(file: string) {
  const resource = await window.viewer.resource(file);
  try {
    const { office } = await window.viewer.document(resource.id, {
      fromRow: 1,
      limit: 100,
      requestID: crypto.randomUUID(),
    });
    if (office?.kind !== 'workbook') throw new Error('No workbook content: ' + file);
    return {
      sheets: office.sheets.length,
      formatted: office.sheets
        .flatMap((sheet) => sheet.rows.flatMap((row) => row.cells))
        .filter((cell) => cell.formatted !== undefined).length,
    };
  } finally {
    await window.viewer.release(resource.id);
  }
}

async function capture(connection: Connection, name: string) {
  await until(
    () => connection.evaluate(pageCall(viewOpacity)),
    (value) => value > 0.999,
    'Settled Office capture',
  );
  await connection.evaluate(
    pageCall((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)), 200),
  );
  const image = await connection.command<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
  });
  const file = path.join(root, name + '.png');
  await writeFile(file, Buffer.from(image.data, 'base64'), { flag: 'wx' });
  captures.push(file);
}
/** Shows workbook values formatted or as stored, from the toolbar's More menu. */
async function showValues(connection: Connection, values: WorkbookValues) {
  const choice = `.choice-menu [data-menu-id="choice:${values}"]`;
  await connection.evaluate(click('button[aria-label="Preview options"]'));
  await until(() => connection.evaluate(exists(choice)), Boolean, 'Preview options');
  await connection.evaluate(click(choice));
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
        () => connection!.evaluate(pageCall(officeViewChoices)),
        Boolean,
        'Office layout/reading choices',
      );
      await connection.evaluate(pageCall(pressToolbarButton, 'Reading'));
    }
    await until(
      () => connection!.evaluate(exists('.office-viewer .data-scroll,.office-document')),
      Boolean,
      'Office document ready',
    );
    await check(connection);
    assert.equal((await connection.evaluate(pageCall(() => window.viewer.jobs()))).length, 0);
  } finally {
    await app.close(connection);
  }
}
try {
  await run(book, async (connection) => {
    const { evaluate, command } = connection;
    await until(
      () => evaluate(textOf('.workbook-merged-cell')),
      (text) => text === 'Quarterly materials',
      'Merged title',
    );
    assert.equal(
      await evaluate(
        pageCall(() =>
          document
            .querySelector('.workbook-merged-cell')!
            .parentElement!.getAttribute('aria-colspan'),
        ),
      ),
      '3',
    );
    await evaluate(pageCall(scrollGrid, 500));
    await until(
      () => evaluate(exists('button[aria-label="G2: $1,234.50"]')),
      Boolean,
      'Formatted cached formula',
    );
    await evaluate(click('button[aria-label="G2: $1,234.50"]'));
    assert.equal(await evaluate(textOf('[aria-label="Selected range"]')), 'G2');
    assert.match(
      await evaluate(textOf('.workbook-cell-detail')),
      /Saved value: 1234.5 · Formula: SUM\(D2\)/,
    );
    await capture(connection, 'workbook-formatted-dark');
    await showValues(connection, 'stored');
    await until(() => evaluate(exists('button[aria-label="G2: 1234.5"]')), Boolean, 'Stored value');
    await showValues(connection, 'formatted');
    await evaluate(pageCall(selectPageField));
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
      () => evaluate(textOf('.workbook-merged-cell')),
      (text) => text.includes('Continued from A3'),
      'Cross-page merged anchor',
    );
    await evaluate(pageCall(scrollGrid, 0));
    await evaluate(click('.workbook-merged-cell'));
    assert.equal(await evaluate(textOf('[aria-label="Selected range"]')), 'A3:C104');
    assert.match(
      await evaluate(textOf('.workbook-cell-detail')),
      /Value: Continued source range · Merged A3:C104/,
    );
    await capture(connection, 'workbook-continued-dark');
    await evaluate(patchSettings({ path: 'settings.appearance', value: 'light' }));
    await until(
      () => evaluate(pageCall(() => document.documentElement.dataset.look)),
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
    const guard = await evaluate(pageCall(workbookImageRefused, book));
    assert.equal(guard, true);
    observations.push(
      'Workbook formatted/stored, cached formula, cross-page source anchor and non-DOCX image refusal pass.',
    );
  });
  await run(word, async (connection) => {
    const { evaluate } = connection;
    await until(() => evaluate(pageCall(studyImageShown)), Boolean, 'Embedded Word pixels');
    assert.equal(await evaluate(textOf('.office-document p')), 'Before the image.After the image.');
    assert.equal(
      await evaluate(
        pageCall(() => getComputedStyle(document.querySelector('.office-document')!).fontSize),
      ),
      '16px',
    );
    await capture(connection, 'word-image-dark');
    await evaluate(pageCall(scrollDocument, 10000));
    await until(
      () => evaluate(exists('.office-image-placeholder[aria-label*="External images"]')),
      Boolean,
      'External image placeholder',
    );
    await capture(connection, 'word-table-placeholders');
    const guarded = await evaluate(pageCall(wordImageAuthority, word));
    assert.deepEqual(guarded, { refused: true, live: 200, expired: 404 });
    await evaluate(patchSettings({ path: 'settings.appearance', value: 'light' }));
    await until(
      () => evaluate(pageCall(() => document.documentElement.dataset.look)),
      (look) => look === 'light',
      'Light Word',
    );
    await evaluate(pageCall(scrollDocument, 0));
    await until(() => evaluate(pageCall(studyImageShown)), Boolean, 'Reopened image');
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
      () => connection.evaluate(countOf('.office-document img')),
      (count) => count > 0,
      'Public Word embedded media',
    );
    await until(
      () => connection.evaluate(pageCall(decodedImage)),
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
      () => connection.evaluate(countOf('.workbook-cell')),
      (count) => count > 0,
      'Public workbook cells',
    );
    const coverage = await connection.evaluate(pageCall(workbookCoverage, files[3]!));
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
