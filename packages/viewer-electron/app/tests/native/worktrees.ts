/** Real checkout discovery, spatial opening and restart. No fixture or worktree is removed. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary && path.isAbsolute(binary), 'Choose an explicit packaged Viewer.');
const root = await realpath(await temporaryRoot('viewer-native-worktrees-'));
const mainFolder = path.join(root, 'Main checkout');
const featureFolder = path.join(root, 'Feature checkout');
const profile = path.join(root, 'Profile');
const templates = path.join(root, 'Empty templates');
const screenshots = path.join(root, 'Screenshots');
await Promise.all(
  [mainFolder, profile, templates, screenshots].map((folder) => mkdir(folder, { mode: 0o700 })),
);
const execute = promisify(execFile);
const git = async (directory: string, ...args: string[]) =>
  (
    await execute(
      '/usr/bin/git',
      [
        '--no-pager',
        '--no-optional-locks',
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'commit.gpgSign=false',
        '-c',
        'tag.gpgSign=false',
        '-c',
        'credential.helper=',
        '-c',
        'protocol.allow=never',
        '-c',
        'gc.auto=0',
        '-c',
        'maintenance.auto=false',
        '-C',
        directory,
        ...args,
      ],
      {
        env: {
          PATH: '/usr/bin:/bin',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_TERMINAL_PROMPT: '0',
          GIT_AUTHOR_NAME: 'Generated Viewer fixture',
          GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
          GIT_COMMITTER_NAME: 'Generated Viewer fixture',
          GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
        },
        timeout: 10000,
        maxBuffer: 65536,
      },
    )
  ).stdout;
await git(mainFolder, 'init', '--initial-branch=main', '--template=' + templates);
await writeFile(path.join(mainFolder, 'notes.txt'), 'Main baseline\n');
await git(mainFolder, 'add', '--', 'notes.txt');
await git(mainFolder, 'commit', '--no-verify', '--no-gpg-sign', '-m', 'Generated baseline');
await git(mainFolder, 'worktree', 'add', '-b', 'feature', featureFolder);
await writeFile(path.join(featureFolder, 'notes.txt'), 'Feature proposal\n');
await writeFile(path.join(featureFolder, 'new.txt'), 'Generated new file\n');
const hash = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const indices = [
  path.join(mainFolder, '.git', 'index'),
  path.join(
    (await git(featureFolder, 'rev-parse', '--absolute-git-dir')).replace(/\n$/, ''),
    'index',
  ),
];
const baseline = {
  indices: await Promise.all(indices.map(hash)),
  refs: await git(mainFolder, 'for-each-ref', '--format=%(refname) %(objectname)'),
};
const settings = defaultSettings(mainFolder);
settings.git.enabled = true;
settings.hotkey.enabled = false;
settings.providers = [];
settings.agents.enabled = false;
const ui = normalizePreferences();
ui.sidebar.inNewPlanes = false;
ui.space.minimap = false;
const initial: SavedState = {
  version: CURRENT_STATE_VERSION,
  activeWorkspace: 'worktree-acceptance',
  look: 'dark',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'worktree-acceptance',
      name: 'Generated worktree acceptance',
      activePane: 'main-folder',
      roots: ['main-folder'],
      arrangement: {},
      panes: [
        {
          id: 'main-folder',
          type: 'folder',
          path: mainFolder,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [mainFolder],
          historyIndex: 0,
          sidebar: { visible: false, width: 210 },
        },
      ],
    },
  ],
};
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  mode: 0o600,
});
const stateFile = path.join(profile, 'viewer-state-v1.json');
await writeFile(stateFile, JSON.stringify(initial), { mode: 0o600 });
const saved = async () => JSON.parse(await readFile(stateFile, 'utf8')) as SavedState;
const checks: string[] = [];
const candidate = {
  binary,
  executable: await hash(binary),
  archive: await hash(path.join(path.dirname(path.dirname(binary)), 'Resources/app.asar')),
};
const app = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
let failure: unknown;
try {
  connection = await app.connect();
  const { evaluate, command } = connection;
  const palette = async (label: string) => {
    await evaluate('document.querySelector(\'[aria-label="Commands (⌘K)"]\').click()');
    await until(
      () =>
        evaluate<boolean>(
          'document.activeElement?.getAttribute("aria-label") === "Search commands"',
        ),
      Boolean,
      'palette input',
    );
    await command('Input.insertText', { text: label });
    await until(
      () =>
        evaluate<string>(
          'document.querySelector(".command-result[aria-selected=true]")?.textContent ?? ""',
        ),
      (text) => text.includes(label),
      label,
    );
    await evaluate('document.querySelector(".command-result[aria-selected=true]").click()');
  };
  const capture = async (name: string, width: number, height: number) => {
    await command('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    let previous = '';
    let stable = 0;
    await until(
      () =>
        evaluate<number[]>(`(() => {
      const rect = document.querySelector('.worktrees-dialog')?.getBoundingClientRect();
      return rect ? [rect.x,rect.y,rect.width,rect.height] : [innerWidth,innerHeight];
    })()`),
      (values) => {
        const current = JSON.stringify(values.map((value) => Math.round(value * 10)));
        stable = current === previous ? stable + 1 : 0;
        previous = current;
        return stable >= 4;
      },
      'settled capture',
    );
    const picture = await command<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    await writeFile(path.join(screenshots, name), Buffer.from(picture.data, 'base64'), {
      mode: 0o600,
    });
  };
  await until(
    () => evaluate<string>('document.querySelector(".git-branch")?.textContent ?? ""'),
    (text) => text.includes('main') && text.includes('Clean'),
    'main branch label and count',
  );
  await palette('Open worktree…');
  await until(
    () => evaluate<number>('document.querySelectorAll(".worktree-option").length'),
    (count) => count === 2,
    'two registered checkouts',
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.worktree-option')).find(row => row.querySelector('.worktree-branch').textContent === 'feature').click()`,
  );
  await until(
    () =>
      evaluate<string>(
        'document.querySelector(".worktree-inspection [role=status]")?.textContent ?? ""',
      ),
    (text) => text.includes('2 changes'),
    'feature change count',
  );
  await capture('picker-dark.png', 1440, 900);
  await capture('picker-minimum-dark.png', 760, 650);
  const revision = await evaluate<number>(
    'window.viewer.settingsGet().then(snapshot=>snapshot.revision)',
  );
  await evaluate(
    `window.viewer.settingsPatch([{path:'settings.appearance',value:'light'}],${revision})`,
  );
  await capture('picker-light.png', 1440, 900);
  await evaluate(
    `Array.from(document.querySelectorAll('.worktrees-dialog footer button')).find(button=>button.textContent === 'Open beside').click()`,
  );
  await until(
    () =>
      evaluate<string[]>(
        'Array.from(document.querySelectorAll(".git-branch")).map(button=>button.textContent)',
      ),
    (labels) =>
      labels.length === 2 &&
      labels.some((label) => label.includes('feature') && label.includes('2 changes')),
    'two branch views',
  );
  await capture('two-branches-light.png', 1440, 900);
  checks.push(
    'actual picker discovers main/feature, reports independent clean/dirty counts and opens beside',
  );
  const both = await until(
    saved,
    (state) => state.workspaces[0]!.panes.filter((pane) => pane.type === 'folder').length === 2,
    'saved checkout roots',
  );
  assert.equal(both.workspaces[0]?.roots.length, 2);
  assert.deepEqual(
    both.workspaces[0]?.panes.map((pane) => pane.path).sort(),
    [mainFolder, featureFolder].sort(),
  );
  await palette('Open worktree…');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".worktree-option")'),
    Boolean,
    'worktree picker reopened',
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.worktrees-dialog footer button')).find(button=>button.textContent === 'Another view beside').click()`,
  );
  await until(
    () => evaluate<number>('document.querySelectorAll(".git-branch").length'),
    (count) => count === 3,
    'another view of same checkout',
  );
  const three = await until(
    saved,
    (state) => state.workspaces[0]!.panes.filter((pane) => pane.type === 'folder').length === 3,
    'three saved views',
  );
  assert.equal(three.workspaces[0]?.panes.filter((pane) => pane.path === featureFolder).length, 2);
  checks.push('another view has a distinct plane ID while retaining the same checkout path');
  await writeFile(path.join(featureFolder, 'notes.txt'), 'Updated feature proposal\n');
  await evaluate(
    `Array.from(document.querySelectorAll('.git-branch')).filter(button=>button.textContent.includes('feature')).at(-1).click()`,
  );
  await until(
    () => evaluate<number>('document.querySelectorAll(".git-change").length'),
    (count) => count === 2,
    'linked changes list',
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.git-change')).find(row=>row.querySelector('.git-change-path').textContent.includes('notes.txt')).querySelector('button').click()`,
  );
  await until(
    () => evaluate<string>('document.querySelector(".cm-merge-b .cm-content")?.textContent ?? ""'),
    (text) => text.includes('Updated feature proposal'),
    'working checkout diff',
  );
  assert.equal(
    await evaluate<string>(
      'document.querySelector(".cm-merge-b .cm-content").getAttribute("contenteditable")',
    ),
    'true',
  );
  assert.equal(await readFile(path.join(mainFolder, 'notes.txt'), 'utf8'), 'Main baseline\n');
  assert.deepEqual(await Promise.all(indices.map(hash)), baseline.indices);
  assert.equal(
    await git(mainFolder, 'for-each-ref', '--format=%(refname) %(objectname)'),
    baseline.refs,
  );
  const linked = await until(
    saved,
    (state) => state.workspaces[0]!.panes.some((pane) => pane.type === 'diff'),
    'saved linked diff',
  );
  assert.equal(linked.workspaces[0]?.roots.length, 3);
  checks.push(
    'working-file diff is editable and linked; main files, both indices and shared refs remain unchanged',
  );
} catch (error) {
  failure = error;
} finally {
  try {
    await app.close(connection);
  } catch (error) {
    failure ??= error;
  }
}
if (!failure) {
  const reopened = await ownedApp(binary, profile);
  let next: Awaited<ReturnType<typeof reopened.connect>> | undefined;
  try {
    next = await reopened.connect();
    const read = next;
    await until(
      () => read.evaluate<number>('document.querySelectorAll(".git-branch").length'),
      (count) => count === 3,
      'cold restored checkout views',
    );
    const restored = await saved();
    assert.equal(restored.workspaces[0]?.roots.length, 3);
    assert.equal(
      restored.workspaces[0]?.panes.filter(
        (pane) => pane.path === featureFolder && pane.type === 'folder',
      ).length,
      2,
    );
    assert.deepEqual(await Promise.all(indices.map(hash)), baseline.indices);
    assert.equal(
      await git(mainFolder, 'for-each-ref', '--format=%(refname) %(objectname)'),
      baseline.refs,
    );
    checks.push(
      'cold restoration retains three views and linked comparison without checkout or index changes',
    );
  } catch (error) {
    failure = error;
  } finally {
    try {
      await reopened.close(next);
    } catch (error) {
      failure ??= error;
    }
  }
}
await writeFile(
  path.join(root, 'result.json'),
  JSON.stringify(
    {
      root,
      profile,
      screenshots,
      candidate,
      checks,
      retained: true,
      noRemoval: true,
      error: failure instanceof Error ? failure.stack : failure,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(JSON.stringify({ root, screenshots, checks }));
if (failure) throw failure;
