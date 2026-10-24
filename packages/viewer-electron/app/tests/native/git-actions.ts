/** Hidden, owned Git/Chat UI acceptance. Never submit a mutation or send a model request. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  CURRENT_STATE_VERSION,
  type SavedState,
  type TerminalPane,
} from '../../src/domain/contracts';
import type { TerminalEvent } from '../../src/domain/automation/actions';
import { gitTerminalProfileID } from '../../src/domain/comparison/git-actions';
import type { GitReply } from '../../src/domain/comparison/git';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';

assert.equal(process.platform, 'darwin', 'This acceptance uses the direct macOS build.');
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1', 'Every fixture and artifact must be retained.');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1', 'Native removals must be blocked.');
assert.ok(process.env.VIEWER_TEST_BINARY && path.isAbsolute(process.env.VIEWER_TEST_BINARY));
const binary = process.env.VIEWER_TEST_BINARY;
const root = await realpath(await temporaryRoot('viewer-native-git-actions-'));
const repository = path.join(root, 'Generated repository');
const profile = path.join(root, 'Profile');
const templates = path.join(root, 'Empty Git templates');
await Promise.all([repository, profile, templates].map((file) => mkdir(file, { mode: 0o700 })));

const run = promisify(execFile);
const gitEnvironment: NodeJS.ProcessEnv = {
  PATH: '/usr/bin:/bin',
  LANG: 'C.UTF-8',
  LC_ALL: 'C',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '/usr/bin/false',
  SSH_ASKPASS: '/usr/bin/false',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_NO_LAZY_FETCH: '1',
  GIT_AUTHOR_NAME: 'Generated Viewer fixture',
  GIT_AUTHOR_EMAIL: 'viewer-fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Generated Viewer fixture',
  GIT_COMMITTER_EMAIL: 'viewer-fixture@example.invalid',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
};
async function git(...args: string[]): Promise<string> {
  const result = await run(
    '/usr/bin/git',
    [
      '--no-pager',
      '--no-replace-objects',
      '--literal-pathspecs',
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
      repository,
      ...args,
    ],
    { env: gitEnvironment, timeout: 10000, maxBuffer: 65536, windowsHide: true },
  );
  return result.stdout;
}

// Setup is confined to this generated repository. No hooks, templates, signing,
// credential helpers, inherited Git configuration or network transport can run.
await git('init', '--initial-branch=main', '--template=' + templates);
const tracked = path.join(repository, 'tracked.txt');
const untracked = path.join(repository, 'untracked.txt');
await writeFile(tracked, 'Generated baseline\n', { flag: 'wx', mode: 0o600 });
await git('add', '--', 'tracked.txt');
await git('commit', '--no-verify', '--no-gpg-sign', '-m', 'Viewer fixture baseline');
await writeFile(tracked, 'Generated modification, never staged by Viewer\n', { mode: 0o600 });
await writeFile(untracked, 'Generated untracked file\n', { flag: 'wx', mode: 0o600 });
assert.equal((await git('remote')).trim(), '', 'The fixture has no network remotes.');

const hash = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
async function repositorySnapshot() {
  return {
    head: (await git('rev-parse', 'HEAD')).trim(),
    commitCount: (await git('rev-list', '--count', 'HEAD')).trim(),
    refs: await git('for-each-ref', '--format=%(refname) %(objectname)'),
    status: await git('status', '--porcelain=v1', '--untracked-files=all'),
    indexSha256: await hash(path.join(repository, '.git', 'index')),
    trackedSha256: await hash(tracked),
    untrackedSha256: await hash(untracked),
  };
}
const original = await repositorySnapshot();
const candidate = {
  binary,
  executableSha256: await hash(binary),
  archiveSha256: await hash(path.join(path.dirname(path.dirname(binary)), 'Resources/app.asar')),
};
const workspaceID = 'generated-git';
const folderID = 'generated-folder';
const dormant: TerminalPane[] = [
  {
    id: 'saved-commit',
    type: 'terminal',
    path: repository,
    profileID: gitTerminalProfileID,
    gitAction: 'commit',
  },
  {
    id: 'saved-push',
    type: 'terminal',
    path: repository,
    profileID: gitTerminalProfileID,
    gitAction: 'push',
  },
  { id: 'saved-git-profile', type: 'terminal', path: repository, profileID: gitTerminalProfileID },
];
const settings = defaultSettings(repository);
settings.git.enabled = false;
settings.providers = [];
settings.hotkey.enabled = false;
settings.terminals.profileID = 'generated-inert';
settings.terminals.profiles = [
  {
    id: 'generated-inert',
    name: 'Generated inert profile',
    executable: '/usr/bin/false',
    args: [],
    env: {},
  },
];
const ui = normalizePreferences();
ui.space.minimap = false;
ui.space.planeHeaders = true;
ui.space.headerControls.parent = true;
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
  mode: 0o600,
});
const initial: SavedState = {
  version: CURRENT_STATE_VERSION,
  activeWorkspace: workspaceID,
  look: 'dark',
  favorites: [],
  recents: [],
  workspaces: [
    {
      id: workspaceID,
      name: 'Generated Git acceptance',
      roots: [folderID, ...dormant.map((pane) => pane.id)],
      activePane: folderID,
      arrangement: {},
      panes: [
        {
          id: folderID,
          type: 'folder',
          path: repository,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [repository],
          historyIndex: 0,
        },
        ...dormant,
      ],
    },
  ],
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(initial), {
  flag: 'wx',
  mode: 0o600,
});

type Application = Awaited<ReturnType<typeof ownedApp>>;
type Connection = Awaited<ReturnType<Application['connect']>>;
interface ObservedTerminal {
  sequence: number;
  event: TerminalEvent;
}
interface Capture {
  events: ObservedTerminal[];
  overflow: boolean;
}
const checks: { id: string; detail: unknown }[] = [];
const evidence: string[] = [];
const resultFile = path.join(root, 'result.json');
async function save(error?: unknown) {
  await writeFile(
    resultFile,
    JSON.stringify(
      {
        version: 1,
        candidate,
        root,
        profile,
        repository,
        original,
        checks,
        evidence,
        retained: true,
        mode: 'hidden',
        noRemoval: true,
        scenario: process.env.VIEWER_TEST_CHAT_ONLY === '1' ? 'chat-palette' : 'git-chat-palette',
        evidenceLimit:
          'Public events prove output delivery. Screenshots and optional public xterm rows show rendered output; renderer session retention is also covered by git-runtime.test.ts.',
        error: error instanceof Error ? error.stack : error,
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
}
const saved = async () =>
  JSON.parse(await readFile(path.join(profile, 'viewer-state-v1.json'), 'utf8')) as SavedState;
const workspace = (state: SavedState) => {
  const value = state.workspaces.find((item) => item.id === workspaceID);
  assert.ok(value, 'The owned workspace remains saved.');
  return value;
};

async function palette(main: Connection, label: string) {
  await main.evaluate(`document.querySelector('[aria-label="Commands (⌘K)"]').click()`);
  await until(
    () =>
      main.evaluate<boolean>(
        'document.activeElement?.getAttribute("aria-label") === "Search commands"',
      ),
    Boolean,
    'palette input',
  );
  await main.command('Input.insertText', { text: label });
  await until(
    () =>
      main.evaluate<string>(
        'document.querySelector(".command-result[aria-selected=true]")?.textContent ?? ""',
      ),
    (text) => text.includes(label),
    'palette command ' + label,
  );
  await main.evaluate('document.querySelector(".command-result[aria-selected=true]").click()');
  await until(
    () => main.evaluate<boolean>(`!!document.querySelector('[aria-label="Search commands"]')`),
    (open) => !open,
    'palette dismissed',
  );
}
async function capture(main: Connection, directory: string, name: string, selector: string) {
  let previous = '';
  let stable = 0;
  await until(
    () =>
      main.evaluate<number[]>(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return [];
      const rect = element.getBoundingClientRect();
      return [rect.x, rect.y, rect.width, rect.height];
    })()`),
    (geometry) => {
      const current = JSON.stringify(geometry);
      stable = current === previous ? stable + 1 : 0;
      previous = current;
      return geometry.length === 4 && geometry[2] > 0 && geometry[3] > 0 && stable >= 3;
    },
    'settled screenshot ' + name,
  );
  await main.evaluate(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  const screenshot = await main.command<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
  });
  const file = path.join(directory, name + '.png');
  await writeFile(file, Buffer.from(screenshot.data, 'base64'), { flag: 'wx', mode: 0o600 });
  return file;
}
async function subscribe(main: Connection) {
  await main.evaluate(`(() => {
    const state = { events: [], overflow: false, bytes: 0 };
    window.__viewerGitAcceptance = state;
    state.release = window.viewer.onEvent(value => {
      if (value.type !== 'terminal') return;
      const bytes = JSON.stringify(value.event).length;
      if (state.events.length >= 2000 || state.bytes + bytes > 262144) {
        state.overflow = true;
        return;
      }
      state.bytes += bytes;
      state.events.push({ sequence: state.events.length, event: value.event });
    });
  })()`);
}
const observed = (main: Connection) =>
  main.evaluate<Capture>(
    '({ events: window.__viewerGitAcceptance.events, overflow: window.__viewerGitAcceptance.overflow })',
  );
async function screen(main: Connection, id: string, expected: string) {
  await until(
    () =>
      main.evaluate<boolean>(
        `!!document.querySelector(${JSON.stringify(`[data-terminal-id="${id}"] .xterm-screen`)})`,
      ),
    Boolean,
    'terminal screen ' + id,
  );
  return until(
    () =>
      main.evaluate<string | null>(`(() => {
    const rows = document.querySelector(${JSON.stringify(`[data-terminal-id="${id}"] .xterm-rows`)});
    return rows ? Array.from(rows.children).map(row => row.textContent).join('\\n') : null;
  })()`),
    (text) => text === null || text.includes(expected),
    'public terminal output ' + id,
  );
}
async function activate(main: Connection, id: string) {
  await palette(main, 'Frame all planes');
  const selector = `[data-viewer-plane="${id}"]`;
  await until(
    () => main.evaluate<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`),
    Boolean,
    'saved plane header ' + id,
  );
  await main.evaluate(
    `document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`,
  );
  await palette(main, 'Frame plane');
  let previous = '';
  let stable = 0;
  await until(
    () =>
      main.evaluate<string | null>(`(() => {
        const header = document.querySelector(${JSON.stringify(selector)});
        const view = header?.closest('[data-plurid-entity="PluridView"]');
        if (!header || !view || (view.getAttribute('data-plurid-motion') ?? 'idle') !== 'idle') return null;
        const rect = header.getBoundingClientRect();
        return JSON.stringify([rect.x, rect.y, rect.width, rect.height]);
      })()`),
    (geometry) => {
      stable = geometry !== null && geometry === previous ? stable + 1 : 0;
      previous = geometry ?? '';
      return stable >= 3;
    },
    'settled active plane ' + id,
  );
}
async function backToFolder(main: Connection, id: string) {
  const selector = `[data-viewer-plane="${id}"] [aria-label="Back to parent plane"]`;
  await until(
    () => main.evaluate<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`),
    Boolean,
    'linked parent control',
  );
  await main.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await until(
    saved,
    (state) => workspace(state).activePane === folderID,
    'linked parent returns to originating folder',
  );
}

async function readonlyAction(main: Connection, app: Application, kind: 'status' | 'log') {
  const before = (await observed(main)).events.length;
  await palette(main, kind === 'status' ? 'Git status' : 'Git history');
  const state = await until(
    saved,
    (value) =>
      workspace(value).panes.some((pane) => pane.type === 'terminal' && pane.gitAction === kind),
    'saved Git ' + kind + ' result',
  );
  const pane = workspace(state).panes.find(
    (item): item is TerminalPane => item.type === 'terminal' && item.gitAction === kind,
  )!;
  assert.equal(pane.profileID, gitTerminalProfileID);
  assert.equal(pane.path, repository);
  assert.equal(workspace(state).roots.includes(pane.id), false, 'Git result is a linked child.');
  const events = await until(
    () => observed(main),
    (value) => value.events.some(({ event }) => event.id === pane.id && event.type === 'exit'),
    'Git ' + kind + ' exit',
  );
  assert.equal(events.overflow, false);
  const job = events.events.filter(({ event }) => event.id === pane.id);
  assert.ok(
    job.every(({ sequence }) => sequence >= before),
    'Subscription preceded launch.',
  );
  const first = job.find(({ event }) => event.type === 'data');
  assert.ok(
    first && first.event.type === 'data' && first.event.data.length > 0,
    'First output was delivered.',
  );
  assert.equal(
    job.some(({ event }) => event.type === 'error'),
    false,
  );
  assert.ok(job.some(({ event }) => event.type === 'exit' && event.code === 0));
  const output = job.map(({ event }) => (event.type === 'data' ? event.data : '')).join('');
  assert.match(output, kind === 'status' ? /tracked\.txt/ : /Viewer fixture baseline/);
  const text = await screen(main, pane.id, 'Git exited (0).');
  const screenshot = await capture(
    main,
    app.evidenceDirectory,
    'git-' + kind,
    `[data-terminal-id="${pane.id}"]`,
  );
  await backToFolder(main, pane.id);
  checks.push({
    id: 'git-' + kind,
    detail: {
      pane,
      first,
      events: job,
      output,
      publicScreenText: text,
      screenshot,
      linkedParentReturned: true,
    },
  });
  await save();
  return pane;
}

async function commitDialog(main: Connection, app: Application) {
  const before = (await observed(main)).events.length;
  await palette(main, 'Commit staged changes…');
  await until(
    () => main.evaluate<boolean>('!!document.querySelector(".git-commit-dialog[open] textarea")'),
    Boolean,
    'actual commit message dialog',
  );
  const message = 'Generated message — never submitted\n\nNo mutation approval is requested.';
  await main.evaluate('document.querySelector(".git-commit-dialog textarea").focus()');
  await main.command('Input.insertText', { text: message });
  const form = await until(
    () =>
      main.evaluate<{ message: string; enabled: boolean; folder: string }>(`(() => {
    const dialog = document.querySelector('.git-commit-dialog');
    return {
      message: dialog.querySelector('textarea').value,
      enabled: !dialog.querySelector('button[type="submit"]').disabled,
      folder: dialog.querySelector('.git-commit-folder').textContent,
    };
  })()`),
    (value) => value.enabled && value.message === message,
    'commit message form state',
  );
  assert.equal(form.message, message);
  assert.equal(form.enabled, true);
  assert.ok(form.folder.includes(repository));
  const screenshot = await capture(
    main,
    app.evidenceDirectory,
    'git-commit-unsubmitted',
    '.git-commit-dialog[open]',
  );
  // Cancel is the only form action used by this harness. Never submit or review Git mutations.
  await main.evaluate(
    `Array.from(document.querySelectorAll('.git-commit-dialog button')).find(button => button.textContent.trim() === 'Cancel').click()`,
  );
  await until(
    () => main.evaluate<boolean>('!!document.querySelector(".git-commit-dialog")'),
    (open) => !open,
    'commit dialog cancelled',
  );
  assert.equal(
    (await observed(main)).events.length,
    before,
    'Typing/cancelling did not launch Git.',
  );
  assert.deepEqual(await repositorySnapshot(), original, 'No repository mutation occurred.');
  checks.push({ id: 'commit-dialog-only', detail: { form, screenshot, submitted: false } });
  await save();
}

async function chatAppearance(main: Connection, app: Application) {
  await palette(main, 'Chat about files');
  await until(
    () => main.evaluate<boolean>('!!document.querySelector(".chat-composer textarea")'),
    Boolean,
    'generated Chat composer',
  );
  type Bounds = { left: number; right: number; top: number; bottom: number };
  interface HitTarget {
    tag: string;
    className: string;
    label: string | null;
    control: string | null;
    overlay: string | null;
  }
  interface Appearance {
    fontFamily: string;
    bodyFontFamily: string;
    background: string;
    border: string;
    borderWidth: number;
    motion: string;
    transform: string;
    textarea: Bounds;
    actions: Bounds;
    layout: { textarea: Bounds; actions: Bounds };
    plane: Bounds;
    send: Bounds;
    sendHit: boolean;
    sendPointerEvents: string;
    hitTarget: HitTarget | null;
    hitStack: HitTarget[];
    disabled: boolean;
  }
  const measurements: Array<Appearance & { width: number; height: number; screenshot: string }> =
    [];
  const detail = { measurements, sent: false, providerConfigured: false, completed: false };
  checks.push({ id: 'generated-chat-appearance', detail });
  for (const [width, height] of [
    [1280, 900],
    [780, 560],
  ]) {
    await main.command('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await palette(main, 'Frame plane');
    let previous = '';
    let stable = 0;
    const value = await until(
      () =>
        main.evaluate<Appearance | null>(`(() => {
      const textarea = document.querySelector('.chat-composer textarea');
      const view = textarea?.closest('[data-plurid-entity="PluridView"]');
      if (!textarea || !view) return null;
      const form = textarea.closest('form');
      const send = form.querySelector('button[type="submit"]');
      const actions = form.querySelector('.chat-composer-actions');
      if (!send || !actions) return null;
      const style = getComputedStyle(textarea);
      const rect = element => {
        const r = element.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      };
      // Offset coordinates measure the actual flex layout, before Plurid's perspective.
      // Projected axis-aligned bounds can overlap while their local boxes remain separated.
      const layout = element => {
        let top = 0, left = 0;
        for (let current = element; current; current = current.offsetParent) {
          top += current.offsetTop;
          left += current.offsetLeft;
        }
        return { left, right: left + element.offsetWidth, top, bottom: top + element.offsetHeight };
      };
      const sendBounds = rect(send);
      const hitX = (sendBounds.left + sendBounds.right) / 2;
      const hitY = (sendBounds.top + sendBounds.bottom) / 2;
      const hit = document.elementFromPoint(hitX, hitY);
      const describe = element => ({
        tag: element.tagName,
        className: typeof element.className === 'string' ? element.className : '',
        label: element.getAttribute('aria-label'),
        control: element.closest('[data-plurid-control]')?.getAttribute('data-plurid-control') ?? null,
        overlay: element.closest('[data-plurid-overlay]')?.getAttribute('data-plurid-overlay') ?? null,
      });
      return {
        fontFamily: style.fontFamily, bodyFontFamily: getComputedStyle(document.body).fontFamily,
        background: style.backgroundColor, border: style.borderTopStyle,
        borderWidth: parseFloat(style.borderTopWidth), textarea: rect(textarea),
        motion: view.getAttribute('data-plurid-motion') ?? 'idle',
        transform: getComputedStyle(textarea.closest('[data-plurid-plane]')).transform,
        actions: rect(actions), layout: { textarea: layout(textarea), actions: layout(actions) },
        plane: rect(textarea.closest('.chat-plane')), send: sendBounds,
        sendHit: hit === send || send.contains(hit),
        sendPointerEvents: getComputedStyle(send).pointerEvents,
        hitTarget: hit ? describe(hit) : null,
        hitStack: document.elementsFromPoint(hitX, hitY).slice(0, 6).map(describe),
        disabled: send.disabled,
      };
    })()`),
      (current) => {
        if (!current || current.motion !== 'idle') {
          stable = 0;
          previous = '';
          return false;
        }
        const geometry = JSON.stringify([
          current.textarea,
          current.actions,
          current.layout,
          current.plane,
          current.send,
          current.transform,
        ]);
        stable = geometry === previous ? stable + 1 : 0;
        previous = geometry;
        return (
          current.send.right > current.send.left &&
          current.textarea.bottom > current.textarea.top &&
          stable >= 3
        );
      },
      `settled Chat layout ${width}×${height}`,
    );
    assert.ok(value);
    const screenshot = await capture(
      main,
      app.evidenceDirectory,
      `chat-${width}x${height}`,
      '.chat-composer',
    );
    measurements.push({ width, height, ...value, screenshot });
    await save();
    assert.equal(value.fontFamily, value.bodyFontFamily, 'Chat uses the interface font.');
    assert.notEqual(value.background, 'rgba(0, 0, 0, 0)');
    assert.notEqual(value.border, 'none');
    assert.ok(value.borderWidth >= 1);
    assert.ok(
      value.layout.textarea.bottom <= value.layout.actions.top + 1,
      'Composer actions do not overlap the text field in the plane’s layout.',
    );
    assert.ok(value.send.left >= value.plane.left - 1 && value.send.right <= value.plane.right + 1);
    assert.ok(value.send.top >= value.plane.top - 1 && value.send.bottom <= value.plane.bottom + 1);
    assert.equal(value.sendHit, true, 'The Send button remains visible and unobstructed.');
    assert.equal(value.disabled, true, 'No provider is configured and nothing can be sent.');
  }
  detail.completed = true;
  await save();
}

async function paletteAppearance(main: Connection, app: Application) {
  assert.equal(
    await main.evaluate<boolean>(
      '!!document.querySelector(\'.app-titlebar button[aria-label*="Overview"]\')',
    ),
    false,
    'Overview has no persistent titlebar button.',
  );
  const placeholders: Record<string, string> = {};
  for (const [command, label, expected] of [
    ['Command line…', 'Command line', 'help'],
    ['Ask in words…', 'Ask in words', 'Ask Viewer…'],
  ]) {
    await palette(main, command);
    const selector = `input[aria-label="${label}"]`;
    const placeholder = await until(
      () =>
        main.evaluate<string | null>(
          `document.querySelector(${JSON.stringify(selector)})?.getAttribute('placeholder') ?? null`,
        ),
      (value) => value !== null,
      label + ' input',
    );
    assert.equal(placeholder, expected);
    placeholders[label] = placeholder!;
    await main.evaluate(
      'document.querySelector(\'.command-palette [aria-label="Close"]\').click()',
    );
  }
  await main.evaluate('document.querySelector(\'[aria-label="Commands (⌘K)"]\').click()');
  await until(
    () => main.evaluate<boolean>('!!document.querySelector(\'[aria-label="Search commands"]\')'),
    Boolean,
    'recent commands palette',
  );
  await main.command('Input.insertText', { text: 'Frame plane' });
  await until(
    () =>
      main.evaluate<boolean>('!!document.querySelector(\'[aria-label="Clear recent commands"]\')'),
    Boolean,
    'Clear recent control',
  );
  await main.evaluate('document.querySelector(\'[aria-label="Clear recent commands"]\').click()');
  await until(
    () =>
      main.evaluate<boolean>('!!document.querySelector(\'[aria-label="Clear recent commands"]\')'),
    (shown) => !shown,
    'cleared recent commands',
  );
  assert.deepEqual(
    await main.evaluate<{ query: string; focused: boolean }>(`(() => {
      const input = document.querySelector('[aria-label="Search commands"]');
      return { query: input.value, focused: document.activeElement === input };
    })()`),
    { query: 'Frame plane', focused: true },
    'Clearing recents preserves the current query and input focus.',
  );
  await main.evaluate('document.querySelector(\'.command-palette [aria-label="Close"]\').click()');
  await palette(main, 'Show minimap');
  await until(
    () => main.evaluate<boolean>('!!document.querySelector(\'[data-plurid-overlay="minimap"]\')'),
    Boolean,
    'explicitly enabled minimap',
  );
  await palette(main, 'Overview');
  await until(
    () =>
      main.evaluate<boolean>(
        'document.querySelector(\'[data-plurid-overlay="minimap"]\')?.matches(":popover-open") ?? false',
      ),
    Boolean,
    'Overview command opens its map',
  );
  const screenshot = await capture(main, app.evidenceDirectory, 'overview-command', 'body');
  await main.evaluate(`document.querySelector('[data-plurid-overlay="minimap"]').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  )`);
  checks.push({
    id: 'palette-refinements',
    detail: { placeholders, recentQueryPreserved: true, overviewCommand: true, screenshot },
  });
  await save();
}

async function phase(work: (main: Connection, app: Application) => Promise<void>) {
  const app = await ownedApp(binary, profile, { mode: 'hidden' });
  evidence.push(app.evidenceDirectory);
  let main: Connection | undefined;
  try {
    main = await app.connect();
    await main.command('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await subscribe(main);
    await work(main, app);
  } catch (error) {
    if (main) {
      const notice = await main
        .evaluate<string>('document.querySelector(".notice")?.textContent ?? ""')
        .catch(() => 'Owned renderer unavailable');
      const events = await observed(main).catch(() => undefined);
      const screenshot = await capture(main, app.evidenceDirectory, 'failure', 'body').catch(
        () => undefined,
      );
      checks.push({ id: 'failure-context', detail: { notice, events, screenshot } });
    }
    throw error;
  } finally {
    if (main) await main.evaluate('window.__viewerGitAcceptance?.release()').catch(() => {});
    await app.close(main);
  }
}

try {
  await save();
  const results: TerminalPane[] = [];
  await phase(async (main, app) => {
    await activate(main, folderID);
    if (process.env.VIEWER_TEST_CHAT_ONLY === '1') {
      await chatAppearance(main, app);
      await paletteAppearance(main, app);
      return;
    }
    assert.equal(
      await main.evaluate<boolean>(
        'window.viewer.settingsGet().then(value => value.settings.git.enabled)',
      ),
      false,
    );
    const badges = await main.evaluate<GitReply>(
      `window.viewer.git({ kind: 'status', path: ${JSON.stringify(repository)} })`,
    );
    assert.equal(badges.kind, 'disabled', 'Background Git badges remain opt-in.');
    await palette(main, 'Frame plane');
    for (const kind of ['status', 'log'] as const)
      results.push(await readonlyAction(main, app, kind));
    await commitDialog(main, app);
  });
  assert.deepEqual(await repositorySnapshot(), original);
  if (process.env.VIEWER_TEST_CHAT_ONLY !== '1')
    await phase(async (main, app) => {
      for (const pane of [...results, ...dormant]) {
        assert.ok(workspace(await saved()).panes.some((item) => item.id === pane.id));
        await activate(main, pane.id);
        const text = await screen(main, pane.id, 'This Git output is from a previous session.');
        if (text !== null) assert.match(text, /This Git output is from a previous session/);
        const resize = await main.evaluate<{
          rejected: boolean;
          message: string;
        }>(`window.viewer.terminalResize(${JSON.stringify(pane.id)}, 80, 24).then(
        () => ({ rejected: false, message: '' }),
        error => ({ rejected: true, message: error.message }),
      )`);
        assert.equal(resize.rejected, true, 'Saved Git output has no live native terminal.');
        assert.match(resize.message, /Terminal is no longer available/);
        const screenshot = await capture(
          main,
          app.evidenceDirectory,
          'dormant-' + (pane.gitAction ?? 'profile'),
          `[data-terminal-id="${pane.id}"]`,
        );
        if (results.some((result) => result.id === pane.id)) await backToFolder(main, pane.id);
        checks.push({ id: 'dormant-' + pane.id, detail: { pane, text, resize, screenshot } });
      }
      const events = await observed(main);
      assert.equal(events.overflow, false);
      assert.deepEqual(events.events, [], 'No shell or Git action was replayed on reopening.');
      const closing = results[0]!;
      await activate(main, closing.id);
      const closeSelector = `[data-viewer-plane="${closing.id}"] [aria-label="Close plane"]`;
      await main.evaluate(`document.querySelector(${JSON.stringify(closeSelector)}).click()`);
      await until(
        saved,
        (state) =>
          workspace(state).activePane === folderID &&
          !workspace(state).panes.some((pane) => pane.id === closing.id),
        'closing a linked Git result returns to its parent',
      );
      checks.push({
        id: 'close-linked-git-parent',
        detail: {
          closed: closing.id,
          parent: folderID,
          screenshot: await capture(
            main,
            app.evidenceDirectory,
            'close-parent',
            `[data-viewer-plane="${folderID}"]`,
          ),
        },
      });
      await activate(main, folderID);
      await chatAppearance(main, app);
      await paletteAppearance(main, app);
      assert.deepEqual(
        (await observed(main)).events,
        [],
        'Chat appearance did not launch a program.',
      );
    });
  assert.deepEqual(
    await repositorySnapshot(),
    original,
    'HEAD, refs, index and generated files remain unchanged.',
  );
  assert.equal(await hash(binary), candidate.executableSha256);
  assert.equal(
    await hash(path.join(path.dirname(path.dirname(binary)), 'Resources/app.asar')),
    candidate.archiveSha256,
  );
  await save();
  console.log(
    process.env.VIEWER_TEST_CHAT_ONLY === '1'
      ? 'PASS generated Chat layout, unobstructed Send, concise palettes, Clear recent and Overview command.'
      : 'PASS owned Git commands, first terminal events, commit-dialog cancellation, dormant restore, generated Chat layout and palette refinements.',
  );
} catch (error) {
  await save(error);
  throw error;
} finally {
  console.log('Retained native Git acceptance evidence: ' + resultFile);
}
