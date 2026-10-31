/** Shell startup, command receipts and operation history in an isolated packaged Viewer. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { NativeInteractions } from './runtime/interactions';
import { exists, patchSettings, textOf } from './runtime/page';
import { pageCall } from './runtime/page-function';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await temporaryRoot('viewer-command-history-');
const profile = path.join(root, 'Profile'),
  folder = path.join(root, 'Files');
await Promise.all([mkdir(profile), mkdir(folder)]);
await writeFile(path.join(root, '.zshrc'), "alias ll='printf alias-from-zshrc'\n", { flag: 'wx' });
const ui = normalizePreferences(),
  settings = defaultSettings(folder);
settings.hotkey.enabled = false;
ui.space.opening = 'dock';
ui.titlebar.operations = true;
ui.titlebar.commands = true;
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  activeWorkspace: 'commands',
  look: 'dark',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'commands',
      name: 'Command checks',
      roots: ['folder'],
      activePane: 'folder',
      arrangement: {},
      panes: [
        {
          id: 'folder',
          type: 'folder',
          path: folder,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [folder],
          historyIndex: 0,
        },
      ],
    },
  ],
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), { flag: 'wx' });
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
});
const app = await ownedApp(binary, profile, {
  label: 'command-history',
  environment: { SHELL: '/bin/zsh', ZDOTDIR: root },
});
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
try {
  connection = await app.connect();
  const { evaluate, command } = connection;
  const actions = new NativeInteractions({ evaluate, command, until });
  await until(() => evaluate(exists('.folder-explorer')), Boolean, 'Folder explorer');
  assert.equal(await evaluate(exists('.operations-button')), false);
  await actions.palette('File operations');
  await until(
    () => evaluate(textOf('.operations-panel')),
    (text) => text.includes('No recent file operations.'),
    'Empty operation history',
  );
  assert.equal(await evaluate(exists('.operations-button')), true);
  await actions.capture(path.join(app.evidenceDirectory, 'empty-operations.png'));
  await actions.palette('File operations');
  assert.equal(
    await evaluate(exists('.operations-panel')),
    false,
    'Command toggles history closed',
  );
  assert.equal(await evaluate(exists('.operations-button')), false);

  await evaluate(patchSettings({ path: 'ui.titlebar.operations', value: false }));
  await actions.palette('File operations');
  assert.equal(await evaluate(exists('.operations-panel')), true);
  assert.equal(await evaluate(exists('.operations-button')), false);
  await actions.click('.operations-panel [aria-label="Close operations"]');
  await evaluate(patchSettings({ path: 'ui.titlebar.operations', value: true }));

  await actions.palette('New folder…');
  await actions.text('dialog[aria-label="New folder"] input', 'History folder');
  await actions.button('Create', 'dialog[aria-label="New folder"]');
  await until(
    () =>
      evaluate(
        pageCall(async () =>
          (await window.viewer.jobs()).some(
            (job) => job.kind === 'mkdir' && job.status === 'completed',
          ),
        ),
      ),
    Boolean,
    'Finished folder operation',
  );
  assert.equal(await evaluate(exists('.operations-button')), false);
  await actions.palette('File operations');
  await until(
    () => evaluate(textOf('.operations-panel')),
    (text) => text.includes('completed') && text.includes('New folder') && text.includes(folder),
    'Completed operation history',
  );
  await actions.capture(path.join(app.evidenceDirectory, 'completed-operations.png'));
  await actions.click('.operations-panel [aria-label="Close operations"]');

  await evaluate(pageCall(() => window.viewer.openSettings()));
  const preferences = await app.connect(true);
  const preferenceActions = new NativeInteractions({ ...preferences, until });
  await preferenceActions.field('Search settings', 'Command startup');
  await until(
    () => preferences.evaluate(textOf('.choice-button[aria-label="Command startup"]')),
    (text) => text === 'Load shell configuration',
    'Command startup setting',
  );
  await preferenceActions.capture(path.join(app.evidenceDirectory, 'command-startup-setting.png'));
  await command('Target.closeTarget', { targetId: preferences.targetID });

  await actions.click('[aria-label="Commands (⌘K)"]');
  await actions.field('Search commands', '! ');
  await actions.field('Shell command', 'll');
  await actions.key('Enter', 'Enter');
  await until(
    () => evaluate(textOf('.quick-command-output [role=status]')),
    (text) => text === 'completed · exit 0',
    'Alias command completion',
  );
  assert.equal(await evaluate(textOf('.quick-command-output pre')), 'alias-from-zshrc');
  await actions.capture(path.join(app.evidenceDirectory, 'shell-alias.png'));

  await actions.field('Shell command', "printf 'receipt-spacing-check'; exit 7");
  await actions.key('Enter', 'Enter');
  await until(
    () => evaluate(textOf('.quick-command-output [role=status]')),
    (text) => text === 'failed · exit 7',
    'Failed command receipt',
  );
  await actions.button('Open receipt', '.quick-command');
  await until(
    () => evaluate(exists('.receipt-scroll > .inline-warning')),
    Boolean,
    'Receipt error notice',
  );
  await actions.capture(path.join(app.evidenceDirectory, 'receipt-spacing.png'));
  const spacing = await evaluate(
    pageCall(() => {
      const warning = document.querySelector<HTMLElement>('.receipt-scroll > .inline-warning')!;
      const details = document.querySelector<HTMLElement>('.receipt-scroll > dl')!;
      const scale = warning.getBoundingClientRect().height / warning.offsetHeight;
      return {
        gap: (details.getBoundingClientRect().top - warning.getBoundingClientRect().bottom) / scale,
        margin: Number.parseFloat(getComputedStyle(warning).marginBottom),
        scale,
      };
    }),
  );
  assert.ok(
    spacing.gap >= 15.5 && spacing.margin >= 16,
    'Notice is separated from folder details: ' + JSON.stringify(spacing),
  );
  await writeFile(
    path.join(app.evidenceDirectory, 'result.json'),
    JSON.stringify(
      {
        passed: [
          'empty-operation-history',
          'history-command-toggle',
          'history-with-hidden-icon',
          'finished-operation-history',
          'command-startup-setting',
          'shell-alias',
          'receipt-spacing',
        ],
        spacing,
      },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  console.log('PASS command history:', app.evidenceDirectory);
} catch (error) {
  if (connection)
    await writeFile(
      path.join(app.evidenceDirectory, 'failure.txt'),
      await connection.evaluate(pageCall(() => document.body.innerText)),
      { flag: 'wx' },
    );
  throw error;
} finally {
  await app.close(connection);
}
