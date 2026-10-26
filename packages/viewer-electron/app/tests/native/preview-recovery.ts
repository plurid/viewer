/** External writes/renames and a temporarily unreachable folder. No removals,
 * buffer discards, real volume unmounts or user-profile changes. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type Pane, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await temporaryRoot('viewer-native-preview-recovery-');
const files = path.join(root, 'Files');
await mkdir(files);
const observations: unknown[] = [];
async function profile(name: string, pane: Pane) {
  const directory = path.join(root, name);
  await mkdir(directory);
  const settings = defaultSettings(root),
    ui = normalizePreferences();
  settings.hotkey.enabled = false;
  settings.providers = [];
  ui.space.opening = 'dock';
  const state: SavedState = {
    version: CURRENT_STATE_VERSION,
    look: 'dark',
    ui,
    favorites: [],
    recents: [],
    activeWorkspace: 'recovery',
    workspaces: [
      {
        id: 'recovery',
        name: 'Recovery acceptance',
        roots: [pane.id],
        activePane: pane.id,
        arrangement: {},
        panes: [pane],
        layout: {
          placements: [
            {
              id: pane.id,
              width: 1100,
              height: 720,
              show: true,
              location: { translateX: 0, translateY: 0, translateZ: 0, rotateX: 0, rotateY: 0 },
            },
          ],
          active: pane.id,
          docked: pane.id,
        },
      },
    ],
  };
  await writeFile(
    path.join(directory, 'config.jsonc'),
    JSON.stringify({ version: 1, settings, ui }),
    { flag: 'wx' },
  );
  await writeFile(path.join(directory, 'viewer-state-v1.json'), JSON.stringify(state), {
    flag: 'wx',
  });
  return directory;
}
const original = path.join(files, 'Original.txt'),
  renamed = path.join(files, 'Renamed.txt'),
  moved = path.join(files, 'Moved again.txt');
await writeFile(original, 'Original reference text.\n', { flag: 'wx' });
const previewProfile = await profile('Preview-Profile', {
  id: 'file',
  type: 'preview',
  path: original,
});
let app = await ownedApp(binary, previewProfile);
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
try {
  connection = await app.connect();
  const { evaluate, command } = connection;
  const saved = async () =>
    JSON.parse(
      await readFile(path.join(previewProfile, 'viewer-state-v1.json'), 'utf8'),
    ) as SavedState;
  await until(
    () => evaluate<string>('document.querySelector(".code-scroll")?.textContent'),
    (text) => text?.includes('Original reference'),
    'Original text',
  );
  await writeFile(original, 'Externally changed reference text.\n');
  await until(
    () => evaluate<string>('document.querySelector(".code-scroll")?.textContent'),
    (text) => text?.includes('Externally changed'),
    'External replacement refreshed',
  );
  await rename(original, renamed);
  await evaluate('window.dispatchEvent(new Event("focus"))');
  await until(
    () => evaluate<string>('document.querySelector(".preview-recovery")?.textContent'),
    (text) => text?.includes('last loaded version'),
    'Missing-file notice',
  );
  await evaluate(
    '[...document.querySelectorAll(".preview-recovery button")].find(b=>b.textContent==="Find renamed file").click()',
  );
  await until(
    saved,
    (state) => state.workspaces[0]?.panes[0]?.path === renamed,
    'Clean view follows confirmed identity',
  );
  await until(
    () => evaluate<string>('document.querySelector(".code-scroll")?.textContent'),
    (text) => text?.includes('Externally changed'),
    'Renamed content retained',
  );
  const parked = path.join(root, 'Parked Files');
  await rename(files, parked);
  await evaluate('window.dispatchEvent(new Event("focus"))');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".preview-recovery")'),
    Boolean,
    'Unreachable folder notice',
  );
  await rename(parked, files);
  await evaluate(
    '[...document.querySelectorAll(".preview-recovery button")].find(b=>b.textContent==="Check again").click()',
  );
  await until(
    () => evaluate<boolean>('!document.querySelector(".preview-recovery")'),
    Boolean,
    'Restored folder recovered',
  );
  await evaluate(
    '[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Edit").click()',
  );
  await until(
    () => evaluate<boolean>('!!document.querySelector(".text-editing .cm-content")'),
    Boolean,
    'Editing view',
  );
  await evaluate('document.querySelector(".text-editing .cm-content").focus()');
  await command('Input.insertText', { text: 'Retained unsaved marker.\n' });
  await writeFile(renamed, 'Another application changed the file again.\n');
  await until(
    () => evaluate<string>('document.querySelector(".text-editing .editing-bar")?.textContent'),
    (text) => text?.includes('changed on disk'),
    'Dirty conflict preserved',
  );
  assert.match(
    await evaluate<string>('document.querySelector(".cm-content").textContent'),
    /Retained unsaved marker/,
  );
  await rename(renamed, moved);
  await evaluate('window.dispatchEvent(new Event("focus"))');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".preview-recovery")'),
    Boolean,
    'Missing dirty file notice',
  );
  await evaluate(
    '[...document.querySelectorAll(".preview-recovery button")].find(b=>b.textContent==="Find renamed file").click()',
  );
  await until(
    saved,
    (state) => state.workspaces[0]?.panes.some((p) => p.type === 'preview' && p.path === moved),
    'Located file opens separately from draft',
  );
  const state = await saved();
  const draft = state.workspaces[0]!.panes.find((p) => p.id === 'file');
  assert.equal(draft?.path, renamed, 'Dirty editor stays attached to its original draft');
  await until(
    () => evaluate<{ buffers: { id: string }[] }>('window.viewer.bufferList()'),
    (value) => value.buffers.length > 0,
    'Draft persisted',
  );
  const buffers = await evaluate<{ buffers: { id: string }[] }>('window.viewer.bufferList()');
  const retained = await evaluate<{ text: string }>(
    `window.viewer.bufferRead(${JSON.stringify(buffers.buffers[0]!.id)})`,
  );
  assert.match(retained.text, /Retained unsaved marker/);
  assert.equal(await readFile(moved, 'utf8'), 'Another application changed the file again.\n');
  observations.push({
    externalWrite: true,
    identityRename: true,
    unreachableFolder: true,
    dirtyDraftPreserved: true,
  });
} finally {
  await app.close(connection);
}

const server = createServer((_request, response) =>
  response.end(
    '<!doctype html><title>Recovered reference site</title><h1>Recovered local page</h1>',
  ),
);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const url = `http://127.0.0.1:${address.port}/reference`;
const browserProfile = await profile('Browser-Profile', {
  id: 'browser',
  type: 'browser',
  path: root,
  url,
});
app = await ownedApp(binary, browserProfile);
connection = undefined;
try {
  connection = await app.connect();
  const { evaluate } = connection;
  await until(
    () =>
      evaluate<{ title: string }>(
        'window.viewer.browser({kind:"state",id:"browser"}).catch(()=>undefined)',
      ),
    (state) => state?.title === 'Recovered reference site',
    'Initial browser page',
  );
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await evaluate(
    `document.querySelector('.browser-navigation [aria-label="Reload page"]').click()`,
  );
  await until(
    () => evaluate<string>('document.querySelector(".browser-error")?.textContent'),
    Boolean,
    'Stopped listener produces recoverable error',
  );
  await new Promise<void>((resolve) => server.listen(address.port, '127.0.0.1', resolve));
  await evaluate(
    '[...document.querySelectorAll(".browser-error button")].find(b=>b.textContent.trim()==="Retry").click()',
  );
  await until(
    () =>
      evaluate<{ title: string; error?: string }>(
        'window.viewer.browser({kind:"state",id:"browser"}).catch(()=>undefined)',
      ),
    (state) => state?.title === 'Recovered reference site' && !state.error,
    'Same-address browser recovery',
  );
  await until(
    () => evaluate<boolean>('!document.querySelector(".browser-error")'),
    Boolean,
    'Obsolete failure clears',
  );
  observations.push({ stoppedListener: true, retryAtSameAddress: true, urlPreserved: true });
} finally {
  await app.close(connection);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
await writeFile(
  path.join(root, 'result.json'),
  JSON.stringify({ passed: true, observations }, null, 2) + '\n',
  { flag: 'wx' },
);
console.log('Recovery acceptance passed; retained fixture:', path.basename(root));
