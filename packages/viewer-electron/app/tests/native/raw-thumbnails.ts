/** One camera thumbnail through the packaged private decoder, without RAW demosaicing.
 * Original and generated files are preserved. No Finder/Trash operations are performed. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { defaultPlaygroundDirectory } from '../../tools/playground/main';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { countOf } from './runtime/page';
import { pageCall } from './runtime/page-function';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await temporaryRoot('viewer-native-raw-thumbnails-');
const files = path.join(root, 'Files');
const profile = path.join(root, 'Profile');
await Promise.all([mkdir(files), mkdir(profile)]);
const name = 'Nikon-Z6.NEF';
const original = path.join(defaultPlaygroundDirectory, 'previews/images/camera-raw', name);
const file = path.join(files, name);
const hash = async (source: string) =>
  createHash('sha256')
    .update(await readFile(source))
    .digest('hex');
const originalHash = await hash(original);
await copyFile(original, file, 1);
const settings = defaultSettings(files);
settings.hotkey.enabled = false;
settings.providers = [];
const ui = normalizePreferences();
ui.sidebar.inNewPlanes = false;
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'thumbnails',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'thumbnails',
      name: 'Isolated camera thumbnail',
      roots: ['folder'],
      activePane: 'folder',
      arrangement: {},
      panes: [
        {
          id: 'folder',
          type: 'folder',
          path: files,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [files],
          historyIndex: 0,
        },
      ],
    },
  ],
};
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
});
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), { flag: 'wx' });

/** The pixel size of a private thumbnail, once the page has decoded it. */
async function thumbnailSize(file: string, size: number) {
  const data = await window.viewer.thumbnail(file, size);
  if (!data.startsWith('data:image/')) throw new Error('Missing isolated RAW thumbnail');
  const image = new Image();
  image.src = data;
  await image.decode();
  return { width: image.naturalWidth, height: image.naturalHeight };
}

const app = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
try {
  connection = await app.connect();
  const { evaluate } = connection;
  await until(
    () => evaluate(countOf('[data-file-path]')),
    (count) => count === 1,
    'single camera fixture',
  );
  const sizes: { requested: number; width: number; height: number }[] = [];
  for (const size of [128, 512, 128]) {
    const value = await evaluate(pageCall(thumbnailSize, file, size));
    assert.ok(value.width > 0 && value.height > 0);
    assert.equal(Math.max(value.width, value.height), size);
    sizes.push({ requested: size, ...value });
  }
  assert.equal(await hash(original), originalHash);
  assert.equal(await hash(file), originalHash);
  await app.close(connection);
  connection = undefined;
  await writeFile(path.join(root, 'result.json'), JSON.stringify({ binary, originalHash, sizes }), {
    flag: 'wx',
  });
  console.log('Packaged isolated RAW thumbnail acceptance passed:', root);
} finally {
  if (connection) {
    await app.close(connection);
  }
}
