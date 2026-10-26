/** Human worktree creation with real Git. All repositories and profiles remain. */
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
assert.ok(binary);
const root = await realpath(await temporaryRoot('viewer-native-worktree-create-')),
  repo = path.join(root, 'Repository'),
  profile = path.join(root, 'Profile'),
  templates = path.join(root, 'Templates'),
  hooks = path.join(root, 'Hooks');
await Promise.all([repo, profile, templates, hooks].map((folder) => mkdir(folder)));
const exec = promisify(execFile);
const git = async (...args: string[]) =>
  (
    await exec('/usr/bin/git', ['-c', 'commit.gpgSign=false', '-C', repo, ...args], {
      env: {
        PATH: '/usr/bin:/bin',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_AUTHOR_NAME: 'Viewer fixture',
        GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_NAME: 'Viewer fixture',
        GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
      },
    })
  ).stdout.trim();
await git('init', '--initial-branch=main', '--template=' + templates);
await git('config', 'core.hooksPath', hooks);
await writeFile(path.join(repo, 'notes.txt'), 'Unchanged source\n');
await git('add', '--', 'notes.txt');
await git('commit', '-m', 'Generated baseline');
await git('branch', 'existing');
const hash = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const before = {
  source: await hash(path.join(repo, 'notes.txt')),
  index: await hash(path.join(repo, '.git/index')),
  commit: await git('rev-parse', 'HEAD'),
};
const settings = defaultSettings(repo),
  ui = normalizePreferences();
settings.hotkey.enabled = false;
settings.providers = [];
settings.git.enabled = true;
ui.sidebar.inNewPlanes = false;
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'trees',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'trees',
      name: 'Worktree creation',
      roots: ['source'],
      activePane: 'source',
      arrangement: {},
      panes: [
        {
          id: 'source',
          type: 'folder',
          path: repo,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [repo],
          historyIndex: 0,
        },
      ],
    },
  ],
};
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
});
const stateFile = path.join(profile, 'viewer-state-v1.json');
await writeFile(stateFile, JSON.stringify(state), { flag: 'wx' });
const saved = async () => JSON.parse(await readFile(stateFile, 'utf8')) as SavedState;
const captures: string[] = [],
  checks: string[] = [];
let app = await ownedApp(binary, profile),
  connection: Awaited<ReturnType<typeof app.connect>> | undefined;
try {
  connection = await app.connect();
  const { evaluate, command } = connection;
  const click = async (label: string) =>
    evaluate(
      `(()=>{const b=[...document.querySelectorAll('.worktrees-dialog button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing button');b.click()})()`,
    );
  const type = async (selector: string, value: string) => {
    await evaluate(
      `(()=>{const i=document.querySelector(${JSON.stringify(selector)});i.focus();i.select()})()`,
    );
    await command('Input.insertText', { text: value });
  };
  const palette = async () => {
    await evaluate(`document.querySelector('[aria-label="Commands (⌘K)"]').click()`);
    await until(
      () => evaluate<string>('document.activeElement?.getAttribute("aria-label")'),
      (value) => value === 'Search commands',
      'Commands focus',
    );
    await command('Input.insertText', { text: 'Open worktree…' });
    await until(
      () =>
        evaluate<string>(
          'document.querySelector(".command-result[aria-selected=true]")?.textContent',
        ),
      (value) => value?.includes('Open worktree…'),
      'Worktree command',
    );
    await evaluate('document.querySelector(".command-result[aria-selected=true]").click()');
    await until(
      () =>
        evaluate<boolean>('!!document.querySelector(".worktrees-dialog button:not([disabled])")'),
      Boolean,
      'Worktree picker',
    );
    await until(
      () =>
        evaluate<boolean>(
          `[...document.querySelectorAll('.worktrees-dialog button')].some(b=>b.textContent.trim()==='Create worktree…'&&!b.disabled)`,
        ),
      Boolean,
      'Creation available',
    );
  };
  const capture = async (name: string, width = 1440) => {
    await command('Emulation.setDeviceMetricsOverride', {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate('new Promise(r=>setTimeout(r,400))');
    const image = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' }),
      file = path.join(root, name + '.png');
    await writeFile(file, Buffer.from(image.data, 'base64'), { flag: 'wx' });
    captures.push(file);
  };
  await until(
    () => evaluate<string>('document.querySelector(".git-branch")?.textContent'),
    (value) => value?.includes('main'),
    'Source checkout',
  );
  await palette();
  await click('Create worktree…');
  await type('input[aria-label="New branch name"]', 'invalid branch');
  assert.equal(
    await evaluate<boolean>(
      `document.querySelector('input[aria-label="New branch name"]').getAttribute('aria-invalid')==='true'`,
    ),
    true,
  );
  await capture('create-invalid-name-dark');
  await type('input[aria-label="New branch name"]', 'feature/spatial');
  const destination = path.join(root, 'Repository-feature-spatial');
  assert.equal(
    await evaluate<string>(
      `document.querySelector('input[aria-label="Worktree destination"]').value`,
    ),
    destination,
  );
  await capture('create-new-dark');
  await capture('create-new-narrow-dark', 760);
  await evaluate(
    "window.viewer.settingsGet().then(s=>window.viewer.settingsPatch([{path:'settings.appearance',value:'light'}],s.revision))",
  );
  await until(
    () => evaluate<string>('document.documentElement.dataset.look'),
    (value) => value === 'light',
    'Light worktree',
  );
  await capture('create-new-light');
  await click('Create and open');
  await until(
    saved,
    (value) =>
      value.workspaces[0]!.panes.some((p) => p.type === 'folder' && p.path === destination),
    'Created folder plane',
  );
  await until(
    saved,
    (value) =>
      value.workspaces[0]!.panes.some((p) => p.type === 'git-changes' && p.path === destination),
    'Linked Git changes',
  );
  assert.equal(await git('-C', destination, 'branch', '--show-current'), 'feature/spatial');
  assert.equal(await git('-C', destination, 'rev-parse', 'HEAD'), before.commit);
  await capture('created-linked-planes');
  checks.push(
    'New branch created at pinned commit in sibling folder with linked folder and Git changes.',
  );
  await evaluate(`document.querySelector('[aria-label="Back to parent plane"]').click()`);
  await until(
    saved,
    (value) =>
      value.workspaces[0]!.panes.some(
        (p) => p.id === value.workspaces[0]!.activePane && p.type === 'folder',
      ),
    'Parent checkout focus',
  );
  await palette();
  await click('Create worktree…');
  await click('Existing branch');
  await capture('create-existing-light');
  await click('Create and open');
  const existing = path.join(root, 'Repository-existing');
  await until(
    saved,
    (value) => value.workspaces[0]!.panes.some((p) => p.type === 'folder' && p.path === existing),
    'Existing branch folder',
  );
  assert.equal(await git('-C', existing, 'branch', '--show-current'), 'existing');
  checks.push('Existing local branch opens a separate checkout without switching the source.');
  assert.equal(await hash(path.join(repo, 'notes.txt')), before.source);
  assert.equal(await hash(path.join(repo, '.git/index')), before.index);
  assert.equal(await git('branch', '--show-current'), 'main');
  assert.equal((await evaluate<unknown[]>('window.viewer.jobs()')).length, 0);
  await app.close(connection);
  connection = undefined;
  app = await ownedApp(binary, profile);
  connection = await app.connect();
  await until(
    () => connection!.evaluate<number>('document.querySelectorAll(".folder-explorer").length'),
    (count) => count === 3,
    'Restored worktree folders',
  );
  assert.equal(await hash(path.join(repo, '.git/index')), before.index);
  checks.push(
    'Cold restore keeps all three checkout views without branch switching or command replay.',
  );
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify({ pass: true, binary, captures, checks, before }, null, 2),
    { flag: 'wx' },
  );
  console.log(JSON.stringify({ pass: true, root, captures, checks }, null, 2));
} catch (error) {
  await writeFile(
    path.join(root, 'failure.json'),
    JSON.stringify({ error: String(error), captures, checks }, null, 2),
    { flag: 'wx' },
  );
  throw error;
} finally {
  await app.close(connection);
}
