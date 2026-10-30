/** Owned direct-build checks. Generated sources; these do not replace Store/native picker acceptance. */
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { ownedApp, until } from './owned-app';
import { entry } from '../src/desktop/files/filesystem';
import { sourceVersion } from '../src/domain/files/inspection';
import { workflowDefinitionSchema, type WorkflowRun } from '../src/domain/automation/workflows';
import type { RelationshipsResult } from '../src/domain/files/relationships';
import { panelDrawing } from './dxf-fixtures';
import type { SavedState } from '../src/domain/contracts';
import { click, exists, patchSettings, textOf } from './native/runtime/page';
import { pageCall } from './native/runtime/page-function';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const root = await temporaryRoot('viewer-native-workflow-');
const profile = path.join(root, 'Profile'),
  destination = path.join(root, 'Destination'),
  output = path.resolve('out/workflow-acceptance');
await Promise.all([profile, destination, output].map((file) => mkdir(file, { recursive: true })));
const source = path.join(root, 'Source.txt'),
  table = path.join(root, 'Evidence.csv'),
  image = path.join(root, 'Region.png');
await writeFile(source, 'Original Știință workflow evidence.');
await writeFile(path.join(root, 'Panel.dxf'), panelDrawing);
await writeFile(
  table,
  'Name,Count\n' +
    Array.from({ length: 100 }, (_, i) => 'Row ' + (i + 1) + ',' + (i + 1)).join('\n'),
);
const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type), data]),
    prefix = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  prefix.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([prefix, body, checksum]);
};
const header = Buffer.alloc(13);
header.writeUInt32BE(480);
header.writeUInt32BE(320, 4);
header[8] = 8;
header[9] = 6;
const pixels = Buffer.alloc(320 * (480 * 4 + 1));
for (let y = 0; y < 320; y++)
  for (let x = 0; x < 480; x++) {
    const offset = y * (480 * 4 + 1) + 1 + x * 4;
    const highlighted = x >= 96 && x < 288 && y >= 64 && y < 192;
    pixels[offset] = highlighted ? 80 : 205;
    pixels[offset + 1] = highlighted ? 130 : 214;
    pixels[offset + 2] = highlighted ? 155 : 222;
    pixels[offset + 3] = 255;
  }
await writeFile(
  image,
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]),
);
const file = path.join(root, 'viewer.workflow.jsonc');
await writeFile(
  file,
  '// Generated workflow; opening must be dormant.\n' +
    JSON.stringify(
      workflowDefinitionSchema.parse({
        version: 1,
        id: 'native-workflow',
        name: 'Inspect and copy',
        inputs: { source: { path: 'Source.txt' }, destination: { path: 'Destination' } },
        steps: [
          {
            id: 'inspect',
            kind: 'inspect',
            sources: [{ kind: 'input', name: 'source' }],
            content: true,
          },
          {
            id: 'copy',
            kind: 'copy',
            needs: ['inspect'],
            sources: [{ kind: 'step', id: 'inspect' }],
            destination: { kind: 'input', name: 'destination' },
          },
          {
            id: 'verify',
            kind: 'inspect',
            needs: ['copy'],
            sources: [{ kind: 'step', id: 'copy' }],
            content: true,
          },
        ],
      }),
      null,
      2,
    ),
);
const initial: SavedState = {
  version: 4,
  look: 'dark',
  activeWorkspace: 'scope',
  favorites: [],
  recents: [],
  workspaces: [
    {
      id: 'scope',
      name: 'Workflow checks',
      roots: ['folder', 'table', 'image'],
      activePane: 'folder',
      arrangement: {},
      panes: [
        {
          id: 'folder',
          type: 'folder',
          path: root,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [root],
          historyIndex: 0,
        },
        {
          id: 'table',
          type: 'preview',
          path: table,
          evidence: {
            path: table,
            version: sourceVersion(await entry(table)),
            anchor: { kind: 'cells', row: 61, column: 2 },
            quote: '60',
          },
        },
        {
          id: 'image',
          type: 'preview',
          path: image,
          evidence: {
            path: image,
            version: sourceVersion(await entry(image)),
            anchor: { kind: 'image', x: 0.2, y: 0.2, width: 0.4, height: 0.4 },
            quote: 'region',
          },
        },
      ],
    },
  ],
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(initial));

const workflowRuns = () => window.viewer.workflow({ kind: 'list' }) as Promise<WorkflowRun[]>;
const workflowRun = (id: string) =>
  window.viewer.workflow({ kind: 'get', id }) as Promise<WorkflowRun>;
const relationsOf = (file: string) =>
  window.viewer.relationships({
    kind: 'read',
    file,
    content: false,
  }) as Promise<RelationshipsResult>;
const sendWindowEvent = (name: string, detail: unknown) =>
  window.dispatchEvent(new CustomEvent(name, { detail }));

/** Clicks the first button in the scope reading exactly `label`; a busy, disabled one ignores it. */
const clickButton = (scope: string, label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>(scope + ' button')]
    .find((button) => button.textContent === label)!
    .click();

/** Opens the definition disclosure and its JSONC editor. */
function editDefinition() {
  document.querySelector<HTMLElement>('.workflow-definition summary')!.click();
  [...document.querySelectorAll<HTMLButtonElement>('.workflow-definition button')]
    .find((button) => button.textContent === 'Edit definition')!
    .click();
}

function cancelEditing() {
  [...document.querySelectorAll<HTMLButtonElement>('.workflow-definition button')]
    .find((button) => button.textContent === 'Cancel editing')!
    .click();
  document.querySelector<HTMLElement>('.workflow-definition summary')!.click();
}

const reviewCopy = () =>
  [...document.querySelectorAll<HTMLButtonElement>('.workflow-run button')]
    .find((button) => button.textContent.includes('Review copy'))!
    .click();

const completedShown = () =>
  !!document.querySelector('.workflow-run h3')?.textContent.includes('Completed') &&
  !!document
    .querySelector('.workflow-run-choice[aria-pressed=true]')
    ?.textContent.includes('Completed');

/** Closes Workflows, then opens Related files for the paths. */
function openRelationships(detail: { paths: string[]; paneID: string }) {
  document.querySelector<HTMLElement>('.workflow-dialog [aria-label=Close]')!.click();
  window.dispatchEvent(new CustomEvent('viewer:relationships', { detail }));
}

/** Types the note through the textarea's own value setter, so React sees the input. */
function typeNote(text: string) {
  const input = document.querySelector<HTMLTextAreaElement>('.relationship-note textarea')!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function foldNote() {
  document.querySelector<HTMLElement>('.relationship-note summary')!.click();
  document.querySelector('.relationship-map')!.scrollTop = 0;
}

const binary =
  process.env.VIEWER_TEST_BINARY ??
  path.resolve('out/Viewer-darwin-arm64/Viewer.app/Contents/MacOS/Viewer');
const viewer = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof viewer.connect>> | undefined;
const evidence: string[] = [];
try {
  connection = await viewer.connect();
  const evaluate = connection.evaluate;
  const drawing = await evaluate(
    pageCall((file: string) => window.viewer.inspect(file, true), path.join(root, 'Panel.dxf')),
  );
  assert.equal(drawing.facts.drawingWidth.value, 200);
  assert.equal(drawing.facts.drawingWidth.unit, 'mm');
  assert.equal(drawing.facts.drawingHeight.value, 100);
  evidence.push(
    'The packaged inspection worker exposes shared DXF bounds and declared units without importing renderer code.',
  );
  await until(
    () => evaluate(textOf('.data-scroll .evidence-cell')),
    (text) => text === '60',
    'CSV evidence cell',
  );
  await until(
    () => evaluate(exists('.image-evidence-overlay')),
    Boolean,
    'normalized image evidence region',
  );
  evidence.push(
    'Version-matched CSV evidence scrolls to and marks source cell row 61, column 2; image evidence renders a normalized region overlay.',
  );
  const context = {
    scope: 'folder',
    workspaceID: 'scope',
    paneID: 'folder',
    directory: root,
    path: root,
    selection: [],
    clipboard: null,
    jobs: [],
  };
  await evaluate(pageCall(sendWindowEvent, 'viewer:workflows', { file, context }));
  await until(
    () => evaluate(textOf('.workflow-definition')),
    (text) => text.includes('Inspect and copy'),
    'opened workflow controls',
  );
  assert.equal(await readFile(path.join(destination, 'Source.txt'), 'utf8').catch(() => ''), '');
  assert.deepEqual(await evaluate(pageCall(workflowRuns)), []);
  await evaluate(pageCall(clickButton, '.workflow-definition', 'Run workflow'));
  const runs = await until(
    () => evaluate(pageCall(workflowRuns)),
    (runs) => runs[0]?.status === 'waiting-review',
    'workflow awaits review',
  );
  const id = runs[0].id;
  await until(
    () => evaluate(textOf('.workflow-run')),
    (text) => text.includes('Review copy'),
    'rendered step review',
  );
  const capture = async (name: string) => {
    const shot = await connection!.command<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(path.join(output, name + '.png'), Buffer.from(shot.data, 'base64'));
  };
  await capture('waiting-review');
  await evaluate(pageCall(editDefinition));
  await until(() => evaluate(exists('.workflow-editor')), Boolean, 'actual JSONC editor');
  await capture('editor-dark');
  await evaluate(pageCall(cancelEditing));
  await evaluate(patchSettings({ path: 'settings.appearance', value: 'light' }));
  await until(
    () => evaluate(pageCall(() => document.documentElement.dataset.look || '')),
    (look) => look === 'light',
    'light workflow surface',
  );
  await capture('waiting-review-light');
  await evaluate(pageCall(editDefinition));
  await until(() => evaluate(exists('.workflow-editor')), Boolean, 'light JSONC editor');
  await capture('editor-light');
  await evaluate(pageCall(cancelEditing));
  await evaluate(pageCall(reviewCopy));
  await until(
    () => evaluate(exists('.operation-review-body')),
    Boolean,
    'normal operation review from workflow',
  );
  assert.equal(await readFile(path.join(destination, 'Source.txt'), 'utf8').catch(() => ''), '');
  await evaluate(click('.operation-review-dialog button.primary'));
  await until(
    () => evaluate(pageCall(() => window.viewer.jobs())),
    (jobs) => jobs.some((job) => job.kind === 'copy' && job.status === 'completed'),
    'reviewed journaled copy',
  );
  await evaluate(pageCall(sendWindowEvent, 'viewer:workflows', { context }));
  await until(() => evaluate(exists('.workflow-run')), Boolean, 'resumed run controls');
  await evaluate(pageCall(clickButton, '.workflow-run', 'Resume workflow'));
  await until(
    () => evaluate(pageCall(workflowRun, id)),
    (run) => run.status === 'completed',
    'dependent inspection after reviewed copy',
  );
  assert.equal(
    await readFile(path.join(destination, 'Source.txt'), 'utf8'),
    'Original Știință workflow evidence.',
  );
  evidence.push(
    'Opening is dormant. The actual Run and Review copy controls create a durable plan without writing; actual Apply and Resume controls perform journaled copy and dependent inspection.',
  );
  await until(
    () => evaluate(pageCall(completedShown)),
    Boolean,
    'rendered completed run and history labels',
  );
  await capture('completed-light');
  await evaluate(
    pageCall(openRelationships, {
      paths: [source, path.join(destination, 'Source.txt')],
      paneID: 'folder',
    }),
  );
  await until(
    () => evaluate(textOf('.relationship-list')),
    (text) => text.includes('Recorded operation') && text.includes('Source.txt'),
    'recorded copy in Related files',
  );
  await capture('relationships-list-light');
  await evaluate(pageCall(clickButton, '.relationships-body', 'Map'));
  await until(
    () => evaluate(exists('.relationship-map svg rect')),
    Boolean,
    'bounded relationship diagram',
  );
  await capture('relationships-map-light');
  await evaluate(click('.relationship-note summary'));
  await evaluate(pageCall(typeNote, 'Generated relationship note'));
  await evaluate(click('.relationship-note button[type=submit]'));
  await until(
    () => evaluate(pageCall(relationsOf, source)),
    (result) =>
      result.relations.some(
        (row) => row.basis === 'reported' && row.note === 'Generated relationship note',
      ),
    'actual note control saves a reported relationship',
  );
  await until(
    () => evaluate(textOf('.relationship-map-links')),
    (text) => text.includes('Recorded operation') && text.includes('User note'),
    'map explicitly separates recorded links and reported notes',
  );
  await evaluate(pageCall(foldNote));
  await capture('relationships-map-light');
  await evaluate(click('.relationships-dialog [aria-label=Close]'));
  evidence.push(
    'Actual Related files list/map show copy provenance, and the note form saves a separate reported link.',
  );
  await viewer.close(connection);
  connection = undefined;
  const cold = await ownedApp(binary, profile),
    second = await cold.connect();
  try {
    const restored = await second.evaluate(pageCall(workflowRun, id));
    assert.equal(restored.status, 'completed');
    assert.equal(restored.steps[2].sources[0].path, path.join(destination, 'Source.txt'));
    const relations = await second.evaluate(pageCall(relationsOf, source));
    assert.ok(
      relations.relations.some(
        (row) => row.basis === 'reported' && row.note === 'Generated relationship note',
      ),
    );
  } finally {
    await cold.close(second);
  }
  evidence.push(
    'A new process restores completed workflow receipts and versioned output references without executing another step.',
  );
  await writeFile(
    path.join(output, 'result.json'),
    JSON.stringify({ passed: true, checks: evidence, storeQualification: false }, null, 2),
  );
  for (const check of evidence) process.stdout.write('PASS ' + check + '\n');
} finally {
  if (connection) await viewer.close(connection).catch(() => {});
  await trashTemporary(root);
}
