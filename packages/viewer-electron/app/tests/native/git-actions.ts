/** Hidden, owned Git/Chat UI acceptance. Never submit a mutation or send a model request. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import {
  CURRENT_STATE_VERSION,
  type SavedState,
  type TerminalPane,
} from '../../src/domain/contracts';
import type { TerminalEvent } from '../../src/domain/automation/actions';
import { gitTerminalProfileID } from '../../src/domain/comparison/git-actions';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import {
  animationFrames,
  attributeOf,
  click,
  exists,
  focus,
  pressButton,
  textOf,
} from './runtime/page';
import { pageCall } from './runtime/page-function';

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

interface Acceptance extends Capture {
  bytes: number;
  release: () => void;
}
type AcceptanceWindow = { __viewerGitAcceptance?: Acceptance };
/** The parts of React's fiber tree and of the Plurid engine ref that framing reads. */
interface EngineRef {
  camera: {
    frame: unknown;
    moveBy(move: { pan: { x: number; y: number } }, options: { animate: boolean }): void;
    get(): unknown;
    motion(): unknown;
  };
  tree: { get: unknown };
  inspect(): { view: unknown };
}
/** A hook's ref may hold anything; only an engine has a camera that frames and a tree. */
interface Hook {
  memoizedState?: { current?: Partial<EngineRef> | null } | null;
  next: Hook | null;
}
interface Fiber {
  memoizedState: Hook | null;
  return: Fiber | null;
}
type FiberHost = Element & Record<string, Fiber | undefined>;
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
  viewport: Bounds;
  send: Bounds;
  sendHit: boolean;
  sendPointerEvents: string;
  hitTarget: HitTarget | null;
  hitStack: HitTarget[];
  disabled: boolean;
}

/**
 * Runs the selected command. With a pause, it first pans the camera away through the public
 * engine ref, then keeps the renderer busy for that long after the next frame.
 */
async function runSelectedCommand(pause: number) {
  if (pause > 0) {
    const marker = document.querySelector('[data-viewer-plane]') as FiberHost;
    const key = Object.keys(marker).find((key) => key.startsWith('__reactFiber'))!;
    let api: EngineRef | undefined;
    for (let fiber: Fiber | null | undefined = marker[key]; fiber && !api; fiber = fiber.return) {
      for (let hook = fiber.memoizedState; hook; hook = hook.next) {
        const current = hook.memoizedState?.current;
        if (current?.camera?.frame && current.tree?.get) {
          api = current as EngineRef;
          break;
        }
      }
    }
    if (!api) throw new Error('The owned framing test needs the public engine ref.');
    api.camera.moveBy({ pan: { x: 600, y: 0 } }, { animate: false });
  }
  document.querySelector<HTMLElement>('.command-result[aria-selected=true]')!.click();
  if (pause > 0) await new Promise((resolve) => requestAnimationFrame(resolve));
  const end = performance.now() + pause;
  while (performance.now() < end) {
    // bounded scheduling stress in this owned renderer
  }
}

/** The first match's box as [x, y, width, height], or [] without one. */
function boxOf(selector: string) {
  const element = document.querySelector(selector);
  if (!element) return [];
  const rect = element.getBoundingClientRect();
  return [rect.x, rect.y, rect.width, rect.height];
}

/** Records terminal events from now on, within a bounded budget. */
function subscribeTerminalEvents() {
  const state = { events: [], overflow: false, bytes: 0 } as unknown as Acceptance;
  (window as unknown as AcceptanceWindow).__viewerGitAcceptance = state;
  state.release = window.viewer.onEvent((value) => {
    if (value.type !== 'terminal') return;
    const bytes = JSON.stringify(value.event).length;
    if (state.events.length >= 2000 || state.bytes + bytes > 262144) {
      state.overflow = true;
      return;
    }
    state.bytes += bytes;
    state.events.push({ sequence: state.events.length, event: value.event });
  });
}

function observedEvents(): Capture {
  const state = (window as unknown as AcceptanceWindow).__viewerGitAcceptance!;
  return { events: state.events, overflow: state.overflow };
}

/** The public xterm rows as text, or null when the terminal draws no rows. */
function terminalRows(selector: string) {
  const rows = document.querySelector(selector);
  return rows ? [...rows.children].map((row) => row.textContent).join('\n') : null;
}

function pointerDown(selector: string) {
  document
    .querySelector(selector)!
    .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
}

/** The header's box as JSON while its view is idle, or null while it moves. */
function idleHeaderBox(selector: string) {
  const header = document.querySelector(selector);
  const view = header?.closest('[data-plurid-entity="PluridView"]');
  if (!header || !view || (view.getAttribute('data-plurid-motion') ?? 'idle') !== 'idle')
    return null;
  const rect = header.getBoundingClientRect();
  return JSON.stringify([rect.x, rect.y, rect.width, rect.height]);
}

function commitForm() {
  const dialog = document.querySelector('.git-commit-dialog')!;
  return {
    message: dialog.querySelector('textarea')!.value,
    enabled: !dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled,
    folder: dialog.querySelector('.git-commit-folder')!.textContent,
  };
}

/** The Chat composer's styles and boxes, and what lies under the Send button. */
function chatComposerAppearance(): Appearance | null {
  const textarea = document.querySelector<HTMLTextAreaElement>('.chat-composer textarea');
  const view = textarea?.closest('[data-plurid-entity="PluridView"]');
  if (!textarea || !view) return null;
  const form = textarea.closest('form')!;
  const send = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const actions = form.querySelector<HTMLElement>('.chat-composer-actions');
  if (!send || !actions) return null;
  const style = getComputedStyle(textarea);
  const rect = (element: Element): Bounds => {
    const r = element.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  };
  // Offset coordinates measure the actual flex layout, before Plurid's perspective.
  // Projected axis-aligned bounds can overlap while their local boxes remain separated.
  const layout = (element: HTMLElement): Bounds => {
    let top = 0,
      left = 0;
    for (
      let current: HTMLElement | null = element;
      current;
      current = current.offsetParent as HTMLElement | null
    ) {
      top += current.offsetTop;
      left += current.offsetLeft;
    }
    return { left, right: left + element.offsetWidth, top, bottom: top + element.offsetHeight };
  };
  const sendBounds = rect(send);
  const hitX = (sendBounds.left + sendBounds.right) / 2;
  const hitY = (sendBounds.top + sendBounds.bottom) / 2;
  const hit = document.elementFromPoint(hitX, hitY);
  const describe = (element: Element): HitTarget => ({
    tag: element.tagName,
    className: typeof element.className === 'string' ? element.className : '',
    label: element.getAttribute('aria-label'),
    control: element.closest('[data-plurid-control]')?.getAttribute('data-plurid-control') ?? null,
    overlay: element.closest('[data-plurid-overlay]')?.getAttribute('data-plurid-overlay') ?? null,
  });
  return {
    fontFamily: style.fontFamily,
    bodyFontFamily: getComputedStyle(document.body).fontFamily,
    background: style.backgroundColor,
    border: style.borderTopStyle,
    borderWidth: parseFloat(style.borderTopWidth),
    textarea: rect(textarea),
    motion: view.getAttribute('data-plurid-motion') ?? 'idle',
    transform: getComputedStyle(textarea.closest('[data-plurid-plane]')!).transform,
    actions: rect(actions),
    layout: { textarea: layout(textarea), actions: layout(actions) },
    plane: rect(textarea.closest('.chat-plane')!),
    viewport: rect(document.querySelector('.workspace-surface')!),
    send: sendBounds,
    sendHit: hit === send || send.contains(hit),
    sendPointerEvents: getComputedStyle(send).pointerEvents,
    hitTarget: hit ? describe(hit) : null,
    hitStack: document.elementsFromPoint(hitX, hitY).slice(0, 6).map(describe),
    disabled: send.disabled,
  };
}

/** Camera, visibility and ancestor scroll state around an obstructed Send button. */
function framingSnapshot() {
  const marker = (document.querySelector('.chat-plane')?.closest('[data-viewer-plane]') ||
    document.querySelector('[data-viewer-plane]')) as FiberHost | null;
  const key = marker && Object.keys(marker).find((key) => key.startsWith('__reactFiber'));
  let api: EngineRef | undefined;
  for (
    let fiber: Fiber | null | undefined = key ? marker![key] : undefined;
    fiber && !api;
    fiber = fiber.return
  ) {
    for (let hook = fiber.memoizedState; hook; hook = hook.next) {
      const current = hook.memoizedState?.current;
      if (current?.camera?.frame && current.tree?.get) {
        api = current as EngineRef;
        break;
      }
    }
  }
  const box = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  };
  const send = document.querySelector<HTMLElement>('.chat-composer button[type="submit"]');
  const rect = send?.getBoundingClientRect();
  const hit = rect && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
  const ancestors = [];
  for (let element = send; element; element = element.parentElement) {
    ancestors.push({
      tag: element.tagName,
      className: element.className,
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop,
      bounds: box(element),
    });
  }
  return {
    at: performance.now(),
    visibility: document.visibilityState,
    camera: api?.camera.get(),
    motion: api?.camera.motion(),
    view: api?.inspect().view,
    send: send && box(send),
    sendHit: !!hit && (hit === send || send!.contains(hit)),
    ancestors,
  };
}

function searchInputState() {
  const input = document.querySelector<HTMLInputElement>('[aria-label="Search commands"]')!;
  return { query: input.value, focused: document.activeElement === input };
}

function dismissMinimap() {
  document
    .querySelector('[data-plurid-overlay="minimap"]')!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

/** Whether resizing the terminal is refused, and why. */
function resizeOutcome(id: string) {
  return window.viewer.terminalResize(id, 80, 24).then(
    () => ({ rejected: false, message: '' }),
    (error: Error) => ({ rejected: true, message: error.message }),
  );
}

async function palette(main: Connection, label: string) {
  await main.evaluate(click('[aria-label="Commands (⌘K)"]'));
  await until(
    () =>
      main.evaluate(
        pageCall(() => document.activeElement?.getAttribute('aria-label') === 'Search commands'),
      ),
    Boolean,
    'palette input',
  );
  await main.command('Input.insertText', { text: label });
  await until(
    () => main.evaluate(textOf('.command-result[aria-selected=true]')),
    (text) => text.includes(label),
    'palette command ' + label,
  );
  const framePause =
    label === 'Frame plane' ? Number(process.env.VIEWER_TEST_FRAME_PAUSE_MS ?? 0) : 0;
  assert.ok(Number.isInteger(framePause) && framePause >= 0 && framePause <= 3000);
  await main.evaluate(pageCall(runSelectedCommand, framePause));
  await until(
    () => main.evaluate(exists('[aria-label="Search commands"]')),
    (open) => !open,
    'palette dismissed',
  );
}
async function capture(main: Connection, directory: string, name: string, selector: string) {
  let previous = '';
  let stable = 0;
  await until(
    () => main.evaluate(pageCall(boxOf, selector)),
    (geometry) => {
      const current = JSON.stringify(geometry);
      stable = current === previous ? stable + 1 : 0;
      previous = current;
      return geometry.length === 4 && geometry[2] > 0 && geometry[3] > 0 && stable >= 3;
    },
    'settled screenshot ' + name,
  );
  await main.evaluate(animationFrames(2));
  const screenshot = await main.command<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
  });
  const file = path.join(directory, name + '.png');
  await writeFile(file, Buffer.from(screenshot.data, 'base64'), { flag: 'wx', mode: 0o600 });
  return file;
}
async function subscribe(main: Connection) {
  await main.evaluate(pageCall(subscribeTerminalEvents));
}
const observed = (main: Connection) => main.evaluate(pageCall(observedEvents));
async function screen(main: Connection, id: string, expected: string) {
  await until(
    () => main.evaluate(exists(`[data-terminal-id="${id}"] .xterm-screen`)),
    Boolean,
    'terminal screen ' + id,
  );
  return until(
    () => main.evaluate(pageCall(terminalRows, `[data-terminal-id="${id}"] .xterm-rows`)),
    (text) => text === null || text.includes(expected),
    'public terminal output ' + id,
  );
}
async function activate(main: Connection, id: string) {
  await palette(main, 'Frame all planes');
  const selector = `[data-viewer-plane="${id}"]`;
  await until(() => main.evaluate(exists(selector)), Boolean, 'saved plane header ' + id);
  await main.evaluate(pageCall(pointerDown, selector));
  await palette(main, 'Frame plane');
  let previous = '';
  let stable = 0;
  await until(
    () => main.evaluate(pageCall(idleHeaderBox, selector)),
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
  await until(() => main.evaluate(exists(selector)), Boolean, 'linked parent control');
  await main.evaluate(click(selector));
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
    () => main.evaluate(exists('.git-commit-dialog[open] textarea')),
    Boolean,
    'actual commit message dialog',
  );
  const message = 'Generated message — never submitted\n\nNo mutation approval is requested.';
  await main.evaluate(focus('.git-commit-dialog textarea'));
  await main.command('Input.insertText', { text: message });
  const form = await until(
    () => main.evaluate(pageCall(commitForm)),
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
  await main.evaluate(pressButton('Cancel', '.git-commit-dialog'));
  await until(
    () => main.evaluate(exists('.git-commit-dialog')),
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
    () => main.evaluate(exists('.chat-composer textarea')),
    Boolean,
    'generated Chat composer',
  );
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
      () => main.evaluate(pageCall(chatComposerAppearance)),
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
          current.viewport,
          current.send,
          current.transform,
        ]);
        stable = geometry === previous ? stable + 1 : 0;
        previous = geometry;
        return (
          current.send.right > current.send.left &&
          current.textarea.bottom > current.textarea.top &&
          current.send.left >= current.viewport.left - 1 &&
          current.send.right <= current.viewport.right + 1 &&
          current.send.top >= current.viewport.top - 1 &&
          current.send.bottom <= current.viewport.bottom + 1 &&
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
    if (!value.sendHit) {
      const samples: unknown[] = [];
      checks.push({ id: 'offscreen-framing-diagnostics', detail: samples });
      for (let sample = 0; sample < 5; sample++) {
        if (sample) await delay(500);
        const snapshot = await main.evaluate(pageCall(framingSnapshot));
        samples.push({ sample, activePane: workspace(await saved()).activePane, snapshot });
      }
      await save();
    }
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
    await main.evaluate(exists('.app-titlebar button[aria-label*="Overview"]')),
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
      () => main.evaluate(attributeOf(selector, 'placeholder')),
      (value) => value !== null,
      label + ' input',
    );
    assert.equal(placeholder, expected);
    placeholders[label] = placeholder!;
    await main.evaluate(click('.command-palette [aria-label="Close"]'));
  }
  await main.evaluate(click('[aria-label="Commands (⌘K)"]'));
  await until(
    () => main.evaluate(exists('[aria-label="Search commands"]')),
    Boolean,
    'recent commands palette',
  );
  await main.command('Input.insertText', { text: 'Frame plane' });
  await until(
    () => main.evaluate(exists('[aria-label="Clear recent commands"]')),
    Boolean,
    'Clear recent control',
  );
  await main.evaluate(click('[aria-label="Clear recent commands"]'));
  await until(
    () => main.evaluate(exists('[aria-label="Clear recent commands"]')),
    (shown) => !shown,
    'cleared recent commands',
  );
  assert.deepEqual(
    await main.evaluate(pageCall(searchInputState)),
    { query: 'Frame plane', focused: true },
    'Clearing recents preserves the current query and input focus.',
  );
  await main.evaluate(click('.command-palette [aria-label="Close"]'));
  await palette(main, 'Show minimap');
  await until(
    () => main.evaluate(exists('[data-plurid-overlay="minimap"]')),
    Boolean,
    'explicitly enabled minimap',
  );
  await palette(main, 'Overview');
  await until(
    () =>
      main.evaluate(
        pageCall(
          () =>
            document.querySelector('[data-plurid-overlay="minimap"]')?.matches(':popover-open') ??
            false,
        ),
      ),
    Boolean,
    'Overview command opens its map',
  );
  const screenshot = await capture(main, app.evidenceDirectory, 'overview-command', 'body');
  await main.evaluate(pageCall(dismissMinimap));
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
    const cpuRate = Number(process.env.VIEWER_TEST_FRAME_CPU_RATE ?? 1);
    assert.ok(Number.isFinite(cpuRate) && cpuRate >= 1 && cpuRate <= 20);
    if (cpuRate !== 1) await main.command('Emulation.setCPUThrottlingRate', { rate: cpuRate });
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
        .evaluate(textOf('.notice'))
        .catch(() => 'Owned renderer unavailable');
      const events = await observed(main).catch(() => undefined);
      const screenshot = await capture(main, app.evidenceDirectory, 'failure', 'body').catch(
        () => undefined,
      );
      checks.push({ id: 'failure-context', detail: { notice, events, screenshot } });
    }
    throw error;
  } finally {
    if (main)
      await main
        .evaluate(
          pageCall(() => (window as unknown as AcceptanceWindow).__viewerGitAcceptance?.release()),
        )
        .catch(() => {});
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
      await main.evaluate(
        pageCall(() => window.viewer.settingsGet().then((value) => value.settings.git.enabled)),
      ),
      false,
    );
    const badges = await main.evaluate(
      pageCall((path: string) => window.viewer.git({ kind: 'status', path }), repository),
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
        const resize = await main.evaluate(pageCall(resizeOutcome, pane.id));
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
      await main.evaluate(click(closeSelector));
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
