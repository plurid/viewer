/** Owned direct-build checks. Generated sources; these do not replace Store/native picker acceptance. */
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { ownedApp, until } from './owned-app';
import { entry } from '../src/desktop/filesystem';
import { sourceVersion } from '../src/domain/inspection';
import { workflowDefinitionSchema, type WorkflowRun } from '../src/domain/workflows';
import { panelDrawing } from './dxf-fixtures';
import type { SavedState, OperationJob } from '../src/domain/contracts';
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
const binary =
  process.env.VIEWER_TEST_BINARY ??
  path.resolve('out/Viewer-darwin-arm64/Viewer.app/Contents/MacOS/Viewer');
const viewer = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof viewer.connect>> | undefined;
const evidence: string[] = [];
try {
  connection = await viewer.connect();
  const evaluate = connection.evaluate;
  const drawing = await evaluate<{
    facts: { drawingWidth: { value: number; unit: string }; drawingHeight: { value: number } };
  }>(`window.viewer.inspect(${JSON.stringify(path.join(root, 'Panel.dxf'))},true)`);
  assert.equal(drawing.facts.drawingWidth.value, 200);
  assert.equal(drawing.facts.drawingWidth.unit, 'mm');
  assert.equal(drawing.facts.drawingHeight.value, 100);
  evidence.push(
    'The packaged inspection worker exposes shared DXF bounds and declared units without importing renderer code.',
  );
  await until(
    () =>
      evaluate<string>(`document.querySelector('.data-scroll .evidence-cell')?.textContent||''`),
    (text) => text === '60',
    'CSV evidence cell',
  );
  await until(
    () => evaluate<boolean>(`!!document.querySelector('.image-evidence-overlay')`),
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
  await evaluate(
    `window.dispatchEvent(new CustomEvent('viewer:workflows',{detail:${JSON.stringify({ file, context })}}))`,
  );
  await until(
    () =>
      evaluate<boolean>(
        `document.querySelector('.workflow-definition')?.textContent.includes('Inspect and copy')`,
      ),
    Boolean,
    'opened workflow controls',
  );
  assert.equal(await readFile(path.join(destination, 'Source.txt'), 'utf8').catch(() => ''), '');
  assert.deepEqual(await evaluate(`window.viewer.workflow({kind:'list'})`), []);
  await evaluate(
    `Array.from(document.querySelectorAll('.workflow-definition button')).find(button=>button.textContent==='Run workflow').click()`,
  );
  const runs = await until(
    () => evaluate<WorkflowRun[]>(`window.viewer.workflow({kind:'list'})`),
    (runs) => runs[0]?.status === 'waiting-review',
    'workflow awaits review',
  );
  const id = runs[0].id;
  await until(
    () => evaluate<string>(`document.querySelector('.workflow-run')?.textContent||''`),
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
  await evaluate(
    `document.querySelector('.workflow-definition summary').click();Array.from(document.querySelectorAll('.workflow-definition button')).find(button=>button.textContent==='Edit definition').click()`,
  );
  await until(
    () => evaluate<boolean>(`!!document.querySelector('.workflow-editor')`),
    Boolean,
    'actual JSONC editor',
  );
  await capture('editor-dark');
  await evaluate(
    `Array.from(document.querySelectorAll('.workflow-definition button')).find(button=>button.textContent==='Cancel editing').click();document.querySelector('.workflow-definition summary').click()`,
  );
  await evaluate(
    `window.viewer.settingsGet().then(s=>window.viewer.settingsPatch([{path:'settings.appearance',value:'light'}],s.revision))`,
  );
  await until(
    () => evaluate<string>(`document.documentElement.dataset.look||''`),
    (look) => look === 'light',
    'light workflow surface',
  );
  await capture('waiting-review-light');
  await evaluate(
    `document.querySelector('.workflow-definition summary').click();Array.from(document.querySelectorAll('.workflow-definition button')).find(button=>button.textContent==='Edit definition').click()`,
  );
  await until(
    () => evaluate<boolean>(`!!document.querySelector('.workflow-editor')`),
    Boolean,
    'light JSONC editor',
  );
  await capture('editor-light');
  await evaluate(
    `Array.from(document.querySelectorAll('.workflow-definition button')).find(button=>button.textContent==='Cancel editing').click();document.querySelector('.workflow-definition summary').click()`,
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.workflow-run button')).find(button=>button.textContent.includes('Review copy')).click()`,
  );
  await until(
    () => evaluate<boolean>(`!!document.querySelector('.operation-review-body')`),
    Boolean,
    'normal operation review from workflow',
  );
  assert.equal(await readFile(path.join(destination, 'Source.txt'), 'utf8').catch(() => ''), '');
  await evaluate(`document.querySelector('.operation-review-dialog button.primary').click()`);
  await until(
    () => evaluate<OperationJob[]>(`window.viewer.jobs()`),
    (jobs) => jobs.some((job) => job.kind === 'copy' && job.status === 'completed'),
    'reviewed journaled copy',
  );
  await evaluate(
    `window.dispatchEvent(new CustomEvent('viewer:workflows',{detail:${JSON.stringify({ context })}}))`,
  );
  await until(
    () => evaluate<boolean>(`!!document.querySelector('.workflow-run')`),
    Boolean,
    'resumed run controls',
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.workflow-run button')).find(button=>button.textContent==='Resume workflow').click()`,
  );
  await until(
    () => evaluate<WorkflowRun>(`window.viewer.workflow({kind:'get',id:${JSON.stringify(id)}})`),
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
    () =>
      evaluate<boolean>(
        `document.querySelector('.workflow-run h3')?.textContent.includes('Completed')&&document.querySelector('.workflow-run-choice[aria-pressed=true]')?.textContent.includes('Completed')`,
      ),
    Boolean,
    'rendered completed run and history labels',
  );
  await capture('completed-light');
  await evaluate(
    `document.querySelector('.workflow-dialog [aria-label=Close]').click();window.dispatchEvent(new CustomEvent('viewer:relationships',{detail:${JSON.stringify({ paths: [source, path.join(destination, 'Source.txt')], paneID: 'folder' })}}))`,
  );
  await until(
    () => evaluate<string>(`document.querySelector('.relationship-list')?.textContent||''`),
    (text) => text.includes('Recorded operation') && text.includes('Source.txt'),
    'recorded copy in Related files',
  );
  await capture('relationships-list-light');
  await evaluate(
    `Array.from(document.querySelectorAll('.relationships-body button')).find(button=>button.textContent==='Map').click()`,
  );
  await until(
    () => evaluate<boolean>(`!!document.querySelector('.relationship-map svg rect')`),
    Boolean,
    'bounded relationship diagram',
  );
  await capture('relationships-map-light');
  await evaluate(`document.querySelector('.relationship-note summary').click()`);
  await evaluate(
    `(()=>{const input=document.querySelector('.relationship-note textarea');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(input,'Generated relationship note');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await evaluate(`document.querySelector('.relationship-note button[type=submit]').click()`);
  await until(
    () =>
      evaluate<{ relations: { basis: string; note?: string }[] }>(
        `window.viewer.relationships({kind:'read',file:${JSON.stringify(source)},content:false})`,
      ),
    (result) =>
      result.relations.some(
        (row) => row.basis === 'reported' && row.note === 'Generated relationship note',
      ),
    'actual note control saves a reported relationship',
  );
  await until(
    () => evaluate<string>(`document.querySelector('.relationship-map-links')?.textContent||''`),
    (text) => text.includes('Recorded operation') && text.includes('User note'),
    'map explicitly separates recorded links and reported notes',
  );
  await evaluate(
    `document.querySelector('.relationship-note summary').click();document.querySelector('.relationship-map').scrollTop=0`,
  );
  await capture('relationships-map-light');
  await evaluate(`document.querySelector('.relationships-dialog [aria-label=Close]').click()`);
  evidence.push(
    'Actual Related files list/map show copy provenance, and the note form saves a separate reported link.',
  );
  await viewer.close(connection);
  connection = undefined;
  const cold = await ownedApp(binary, profile),
    second = await cold.connect();
  try {
    const restored = await second.evaluate<WorkflowRun>(
      `window.viewer.workflow({kind:'get',id:${JSON.stringify(id)}})`,
    );
    assert.equal(restored.status, 'completed');
    assert.equal(restored.steps[2].sources[0].path, path.join(destination, 'Source.txt'));
    const relations = await second.evaluate<{ relations: { basis: string; note?: string }[] }>(
      `window.viewer.relationships({kind:'read',file:${JSON.stringify(source)},content:false})`,
    );
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
