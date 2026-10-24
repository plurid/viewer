/** Actual comparison/review/collection controls with generated files and an isolated profile. */
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ownedApp, until } from './owned-app';
import type { SavedState, OperationJob } from '../src/domain/contracts';
import { entry } from '../src/desktop/files/filesystem';
import { sourceVersion } from '../src/domain/files/inspection';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
const root = await temporaryRoot('viewer-native-collections-'),
  profile = path.join(root, 'Profile'),
  left = path.join(root, 'Left'),
  right = path.join(root, 'Right');
await Promise.all([profile, left, right].map((file) => mkdir(file)));
const source = path.join(left, 'Only.txt'),
  other = path.join(right, 'Other.txt');
await writeFile(source, 'Original left file');
await writeFile(other, 'Original right file');
await Promise.all([
  writeFile(path.join(left, 'Equal.txt'), 'Equal contents'),
  writeFile(path.join(right, 'Equal.txt'), 'Equal contents'),
]);
const collectionID = crypto.randomUUID();
const initial: SavedState = {
  version: 4,
  look: 'dark',
  activeWorkspace: 'scope',
  favorites: [],
  recents: [],
  workspaces: [
    {
      id: 'scope',
      name: 'Comparison checks',
      roots: ['folder', 'collection'],
      activePane: 'folder',
      arrangement: {},
      collections: [
        {
          id: collectionID,
          name: 'Files from both folders',
          kind: 'explicit',
          sources: [source, other],
        },
      ],
      basket: [
        { path: source, version: sourceVersion(await entry(source)) },
        { path: other, version: sourceVersion(await entry(other)) },
      ],
      panes: [
        {
          id: 'folder',
          type: 'folder',
          path: left,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [left],
          historyIndex: 0,
        },
        { id: 'collection', type: 'collection', path: left, collectionID },
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
const output = path.resolve('out/comparison-collection-acceptance');
await mkdir(output, { recursive: true });
try {
  connection = await viewer.connect();
  const evaluate = connection.evaluate;
  await until(
    () => evaluate<number>(`document.querySelectorAll('.collection-explorer .file-row').length`),
    (count) => count === 2,
    'collection plane from two folders',
  );
  evidence.push(
    'A restored collection plane displays references from two folders using the normal virtualized file table.',
  );
  await evaluate(
    `window.dispatchEvent(new CustomEvent('viewer:compare',{detail:${JSON.stringify([left, right])}}))`,
  );
  await evaluate(
    `(()=>{document.querySelector('.comparison-body input[type=checkbox]').click();Array.from(document.querySelectorAll('dialog[open] footer button')).find(b=>b.textContent.trim()==='Compare').click();})()`,
  );
  await until(
    () => evaluate<string>(`document.querySelector('.comparison-table')?.innerText||''`),
    (text) => text.includes('Equal SHA-256') && text.includes('Only.txt'),
    'rendered verified content comparison',
  );
  const shot = await connection.command<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
  });
  await writeFile(path.join(output, 'comparison.png'), Buffer.from(shot.data, 'base64'));
  await evaluate(
    `Array.from(document.querySelectorAll('dialog[open] footer button')).find(b=>b.textContent.includes('Review copy')).click()`,
  );
  await until(
    () => evaluate<boolean>(`!!document.querySelector('.operation-review-body')`),
    Boolean,
    'shared operation review',
  );
  assert.ok(!(await readFile(path.join(right, 'Only.txt'), 'utf8').catch(() => '')));
  await evaluate(
    `document.querySelector('.operation-review-body .review-checkpoint input').click();document.querySelector('dialog[open] [aria-label=Close]').focus()`,
  );
  const reviewShot = await connection.command<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
  });
  await writeFile(
    path.join(output, 'operation-review.png'),
    Buffer.from(reviewShot.data, 'base64'),
  );
  assert.equal(
    await evaluate<string>(
      `getComputedStyle(document.querySelector('dialog[open] [aria-label=Close]')).outlineStyle`,
    ),
    'none',
  );
  await evaluate(`document.querySelector('dialog[open] button.primary').click()`);
  await until(
    () => evaluate<OperationJob[]>(`window.viewer.jobs()`),
    (jobs) => jobs.some((job) => job.kind === 'copy' && job.status === 'completed'),
    'journaled reconciliation copy',
  );
  assert.equal(await readFile(path.join(right, 'Only.txt'), 'utf8'), 'Original left file');
  const saved = await evaluate<{ records: { id: string }[] }>(
    `window.viewer.checkpoints({kind:'list'})`,
  );
  assert.equal(saved.records.length, 1);
  evidence.push(
    'Actual comparison produces a selectable revisioned review without writes; opt-in snapshot precedes the queued copy and the focused Close control has no outline.',
  );
  await evaluate(`window.dispatchEvent(new Event('viewer:collections'))`);
  await until(
    () => evaluate<boolean>(`!!document.querySelector('.collections-body')`),
    Boolean,
    'basket controls',
  );
  assert.ok(
    await evaluate<boolean>(
      `document.querySelector('.collections-body').innerText.includes('Basket · 2 files')`,
    ),
  );
  await evaluate(
    `(()=>{const input=document.querySelector('.collections-body > label input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'Retained cross-folder collection');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.collections-body button')).find(button=>button.textContent.includes('Save basket as collection')).click()`,
  );
  await until(
    async () =>
      JSON.parse(await readFile(path.join(profile, 'viewer-state-v1.json'), 'utf8')) as SavedState,
    (state) =>
      state.workspaces[0].collections?.some(
        (collection) => collection.name === 'Retained cross-folder collection',
      ),
    'persisted collection creation',
  );
  const collectionsShot = await connection.command<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
  });
  await writeFile(
    path.join(output, 'collections.png'),
    Buffer.from(collectionsShot.data, 'base64'),
  );
  await viewer.close(connection);
  connection = undefined;
  const cold = await ownedApp(binary, profile);
  const second = await cold.connect();
  try {
    await until(
      () =>
        second.evaluate<number>(
          `document.querySelectorAll('.collection-explorer .file-row').length`,
        ),
      (count) => count === 2,
      'cold collection plane',
    );
    const state = JSON.parse(
      await readFile(path.join(profile, 'viewer-state-v1.json'), 'utf8'),
    ) as SavedState;
    assert.equal(state.workspaces[0].basket?.length, 2);
    assert.ok(
      state.workspaces[0].collections?.some(
        (collection) => collection.name === 'Retained cross-folder collection',
      ),
    );
  } finally {
    await cold.close(second);
  }
  evidence.push(
    'Named collection definitions, its actual plane and cross-folder basket references survive graceful Quit and a fresh process.',
  );
  await writeFile(
    path.join(output, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        evidence,
        scope:
          'Owned direct package; no native picker, cloud-provider edge or Store qualification claim.',
      },
      null,
      2,
    ),
  );
  evidence.forEach((item) => process.stdout.write('PASS ' + item + '\n'));
} finally {
  if (connection) await viewer.close(connection);
  await trashTemporary(root);
}
