/** Hidden packaged integration; only generated files and an isolated profile. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { ownedApp, until } from './owned-app';
import { click, exists, textOf } from './native/runtime/page';
import { pageCall } from './native/runtime/page-function';
import type { PageExpression } from './native/runtime/page-function';
import type { FileInformationPatch } from '../src/domain/files/information';
import type { RendererOperationRequest, SavedState } from '../src/domain/contracts';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
const binary =
  process.env.VIEWER_TEST_BINARY ||
  path.resolve('out/Viewer-darwin-arm64/Viewer.app/Contents/MacOS/Viewer');
const root = await temporaryRoot('viewer-native-info-');
const profile = path.join(root, 'profile'),
  file = path.join(root, 'Unicode ș 日本語.txt');
await mkdir(profile);
await writeFile(file, 'Preserve this generated content.');
const initial: SavedState = {
  version: 3,
  activeWorkspace: 'metadata',
  favorites: [],
  recents: [],
  look: 'dark',
  workspaces: [
    {
      id: 'metadata',
      name: 'Metadata',
      roots: ['metadata-folder'],
      activePane: 'metadata-folder',
      arrangement: {},
      panes: [
        {
          id: 'metadata-folder',
          type: 'folder',
          path: root,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [root],
          historyIndex: 0,
        },
      ],
    },
  ],
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(initial));
let viewer = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof viewer.connect>> | undefined;
const bridgeKind = () => typeof window.viewer?.fileInformation;
const informationOf = (file: string) => window.viewer.fileInformation(file);
const updateInformation = (file: string, revision: string, patch: FileInformationPatch) =>
  window.viewer.fileInformationUpdate(file, revision, patch);
const viewerJobs = () => window.viewer.jobs();
/** Clicks the row of `file`, comparing composed Unicode forms. */
function clickFile(file: string) {
  [...document.querySelectorAll<HTMLElement>('[data-file-path]')]
    .find((element) => element.dataset.filePath!.normalize('NFC') === file)!
    .click();
}
try {
  connection = await viewer.connect();
  await until(
    () => connection!.evaluate(pageCall(bridgeKind)),
    (value) => value === 'function',
    'Packaged information bridge',
  );
  const evaluate = <R>(expression: PageExpression<R>) => connection!.evaluate(expression);
  const original = await evaluate(pageCall(informationOf, file));
  const edited = await evaluate(
    pageCall(updateInformation, file, original.revision, {
      tags: [{ name: 'Project', color: 4 }],
      comment: 'Generated metadata test.',
      locked: true,
    }),
  );
  assert.equal(edited.locked, true);
  assert.deepEqual(edited.systemTagNames, ['Project']);
  await assert.rejects(
    evaluate(pageCall(updateInformation, file, original.revision, { comment: 'Stale edit' })),
    /changed/,
  );
  await evaluate(pageCall(updateInformation, file, edited.revision, { locked: false }));
  const aliasID = await evaluate(
    pageCall((request: RendererOperationRequest) => window.viewer.operate(request), {
      kind: 'alias',
      sources: [file],
    }),
  );
  const aliasJob = await until(
    () => evaluate(pageCall(viewerJobs)),
    (jobs) =>
      jobs.some((job) => job.id === aliasID && ['completed', 'failed'].includes(job.status)),
    'Packaged alias job',
  );
  const job = aliasJob.find((job) => job.id === aliasID)!;
  assert.equal(job.status, 'completed', JSON.stringify(job.errors));
  assert.equal(job.undoable, true);
  const alias = job.completed[0].destination!;
  assert.equal((await evaluate(pageCall(informationOf, alias))).alias, true);
  await viewer.close(connection);
  connection = undefined;
  viewer = await ownedApp(binary, profile);
  connection = await viewer.connect();
  await until(
    () => connection!.evaluate(pageCall(bridgeKind)),
    (value) => value === 'function',
    'Cold information bridge',
  );
  const restored = await evaluate(pageCall(informationOf, file));
  assert.deepEqual(restored.tags, [{ name: 'Project', color: 4 }]);
  assert.equal(restored.comment, 'Generated metadata test.');
  assert.equal(
    (await evaluate(pageCall(viewerJobs))).find((job) => job.id === aliasID)?.undoable,
    true,
  );
  await evaluate(pageCall((id: string) => window.viewer.undo(id), aliasID));
  await assert.rejects(readFile(alias), { code: 'ENOENT' });
  assert.equal(await readFile(file, 'utf8'), 'Preserve this generated content.');
  await until(
    () =>
      evaluate(
        pageCall(
          () =>
            !!document.querySelector('[aria-label="Dock plane"]') &&
            !!document.querySelector('.file-row'),
        ),
      ),
    Boolean,
    'Generated folder UI',
  );
  await evaluate(click('[aria-label="Dock plane"]'));
  await evaluate(pageCall(clickFile, file.normalize('NFC')));
  await until(() => evaluate(exists('.file-row.is-selected')), Boolean, 'Generated file selected');
  await connection.command('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'i',
    code: 'KeyI',
    modifiers: 4,
  });
  await connection.command('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'i',
    code: 'KeyI',
    modifiers: 4,
  });
  await until(
    () => evaluate(exists('.information-editor [aria-label="Color for Project"]')),
    Boolean,
    'Get Info metadata controls',
  );
  await evaluate(
    pageCall(() => {
      document.querySelector<HTMLDetailsElement>('.information-permissions')!.open = true;
    }),
  );
  await evaluate(click('.information-editor [aria-label="Owner write"]'));
  await until(
    () =>
      evaluate(
        pageCall(
          () =>
            !document.querySelector<HTMLButtonElement>('.information-save button.primary')!
              .disabled,
        ),
      ),
    Boolean,
    'Permission edit enables Save',
  );
  await evaluate(click('.information-save button.primary'));
  await until(
    () => evaluate(textOf('.information-save [role="status"]')),
    (text) => text === 'Saved',
    'Permission edit saved through UI',
  );
  assert.equal((await evaluate(pageCall(informationOf, file))).mode & 0o200, 0);
  const review = path.resolve('../../../.impeccable/review');
  await mkdir(review, { recursive: true });
  for (const [width, height, name] of [
    [1440, 900, 'desktop'],
    [760, 640, 'narrow'],
  ] as const) {
    await connection.command('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await until(
      () => evaluate(pageCall(() => innerWidth)),
      (value) => value === width,
      'Metadata viewport',
    );
    const overflow = await evaluate(
      pageCall(() =>
        [...document.querySelectorAll('dialog[open], .file-information, .information-tags')].some(
          (element) => element.scrollWidth > element.clientWidth + 1,
        ),
      ),
    );
    assert.equal(overflow, false, 'Metadata dialog must fit the native viewport');
    const shot = await connection.command<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      path.join(review, 'file-information-' + name + '.png'),
      Buffer.from(shot.data, 'base64'),
    );
    await evaluate(
      pageCall(() => {
        const panel = document.querySelector('.file-information')!;
        panel.scrollTop = panel.scrollHeight;
      }),
    );
    const details = await connection.command<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      path.join(review, 'file-information-' + name + '-details.png'),
      Buffer.from(details.data, 'base64'),
    );
    await evaluate(
      pageCall(() => {
        document.querySelector('.file-information')!.scrollTop = 0;
      }),
    );
  }
  console.log(
    'PASS packaged native metadata, stale-edit rejection, Foundation tags/alias, cold alias Undo, Get Info keyboard entry and two viewport layouts. Native Quick Look/Share UI and Store sandbox acceptance remain separate.',
  );
} finally {
  await viewer.close(connection);
  execFileSync('/usr/bin/chflags', ['-R', 'nouchg', root]);
  await trashTemporary(root);
}
