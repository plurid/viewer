/**
 * A crashed window asks Reload or Close, and neither traps the person. Hidden runs answer through
 * VIEWER_TEST_STOPPED_WINDOW. The first launch crashes its window and reloads it: the saved
 * workspace comes back, and Quit succeeds. The second crashes one of two windows and closes it:
 * the window closes well before a save could time out, and Quit succeeds. No removals.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { FLUSH_TIMEOUT_MS } from '../../src/desktop/windows/flush-requests';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { pageCall } from './runtime/page-function';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await temporaryRoot('viewer-native-stopped-window-');
const files = path.join(root, 'Files');
await mkdir(files);
const marker = 'Kept after the crash.txt';
await writeFile(path.join(files, marker), 'This file names the restored folder.\n', { flag: 'wx' });

/** A profile whose one workspace shows `files`. */
async function profile(name: string): Promise<string> {
  const folder = path.join(root, name);
  await mkdir(folder);
  const settings = defaultSettings(files);
  settings.hotkey.enabled = false;
  settings.providers = [];
  const ui = normalizePreferences();
  ui.sidebar.inNewPlanes = false;
  const state: SavedState = {
    version: CURRENT_STATE_VERSION,
    look: 'dark',
    activeWorkspace: 'stopped',
    favorites: [],
    recents: [],
    ui,
    workspaces: [
      {
        id: 'stopped',
        name: 'Stopped window',
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
  await writeFile(path.join(folder, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
    flag: 'wx',
  });
  await writeFile(path.join(folder, 'viewer-state-v1.json'), JSON.stringify(state), {
    flag: 'wx',
  });
  return folder;
}

const showsText = (text: string) => document.body.innerText.includes(text);
const openWindow = () => window.viewer.newWindow();

/** The workspace windows' debugger targets. */
async function workspaceTargets(port: number): Promise<string[]> {
  const targets = (await fetch(`http://127.0.0.1:${port}/json/list`).then((reply) =>
    reply.json(),
  )) as { id: string; type: string; url: string }[];
  return targets
    .filter(
      (target) =>
        target.type === 'page' &&
        target.url.startsWith('viewer-app://app/') &&
        !target.url.includes('window=settings'),
    )
    .map((target) => target.id);
}

const observations: unknown[] = [];

// Reload: the same window comes back with its saved workspace.
{
  const app = await ownedApp(binary, await profile('Reload profile'), {
    environment: { VIEWER_TEST_STOPPED_WINDOW: 'reload' },
  });
  let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
  try {
    connection = await app.connect();
    await until(
      () => connection!.evaluate(pageCall(showsText, marker)),
      Boolean,
      'workspace folder shown before the crash',
    );
    const crashed = connection.targetID;
    // the renderer ends without answering
    void connection.command('Page.crash').catch(() => undefined);
    // the same target comes back once the reloaded page has loaded
    for (let attempt = 0; ; attempt++) {
      await delay(250);
      try {
        connection = await app.connect(false, crashed);
        break;
      } catch (error) {
        if (attempt >= 40) throw error;
      }
    }
    await until(
      () => connection!.evaluate(pageCall(showsText, marker)),
      Boolean,
      'reloaded window restores its workspace',
    );
    observations.push({ answer: 'reload', target: crashed });
    await app.close(connection);
    connection = undefined;
  } finally {
    if (connection) await app.close(connection);
  }
}

// Close: the crashed window closes without waiting on its renderer, and Quit still succeeds.
{
  const app = await ownedApp(binary, await profile('Close profile'), {
    environment: { VIEWER_TEST_STOPPED_WINDOW: 'close' },
  });
  let survivor: Awaited<ReturnType<typeof app.connect>> | undefined;
  try {
    const first = await app.connect();
    await first.evaluate(pageCall(openWindow));
    const opened = await until(
      () => workspaceTargets(app.port),
      (targets) => targets.length === 2,
      'second workspace window opened',
    );
    const other = opened.find((id) => id !== first.targetID)!;
    survivor = await app.connect(false, other);
    const started = Date.now();
    void first.command('Page.crash').catch(() => undefined);
    await until(
      () => workspaceTargets(app.port),
      (targets) => !targets.includes(first.targetID),
      'crashed window closed',
      FLUSH_TIMEOUT_MS - 2000,
    );
    const closedAfter = Date.now() - started;
    assert.ok(closedAfter < FLUSH_TIMEOUT_MS, 'the close did not wait for a save timeout');
    observations.push({ answer: 'close', closedAfter });
    await app.close(survivor);
    survivor = undefined;
  } finally {
    if (survivor) await app.close(survivor);
  }
}

await writeFile(
  path.join(root, 'result.json'),
  JSON.stringify({ pass: true, binary, observations }, null, 2),
  { flag: 'wx' },
);
console.log('Packaged stopped-window acceptance passed:', root);
