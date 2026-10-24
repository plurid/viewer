/** Actual packaged stdio MCP client and rendered reviews in a hidden owned app. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { AgentProposal, AgentWorkspace } from '../src/domain/agents/requests';
import type { SavedState } from '../src/domain/contracts';
import { ownedApp, until } from './owned-app';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const binary =
  process.env.VIEWER_TEST_BINARY ||
  path.resolve('out/Viewer-darwin-arm64/Viewer.app/Contents/MacOS/Viewer');
const root = await temporaryRoot('viewer-native-agent-');
const profile = path.join(root, 'profile'),
  shared = path.join(root, 'Shared'),
  nested = path.join(shared, 'Nested'),
  downloads = path.join(shared, 'Downloads'),
  secret = path.join(root, 'Private');
await Promise.all(
  [profile, nested, downloads, secret].map((file) => mkdir(file, { recursive: true })),
);
const first = path.join(nested, 'Résumé.txt'),
  second = path.join(nested, 'Two.txt');
await writeFile(first, 'Generated Unicode MCP fixture.');
await writeFile(second, 'Second generated file.');
const folder = (id: string, file: string) => ({
  id,
  type: 'folder' as const,
  path: file,
  mode: 'list' as const,
  sort: 'name' as const,
  descending: false,
  showHidden: false,
  history: [file],
  historyIndex: 0,
});
const initial: SavedState = {
  version: 3,
  activeWorkspace: 'origin',
  favorites: [],
  recents: [],
  look: 'dark',
  workspaces: [
    {
      id: 'origin',
      name: 'Origin',
      roots: ['source'],
      activePane: 'source',
      panes: [folder('source', shared)],
      arrangement: {},
    },
    {
      id: 'downloads',
      name: 'Downloads',
      roots: ['downloads-folder'],
      activePane: 'downloads-folder',
      panes: [folder('downloads-folder', downloads)],
      arrangement: {},
    },
    {
      id: 'private',
      name: 'Private',
      roots: ['private-folder'],
      panes: [folder('private-folder', secret)],
      arrangement: {},
    },
    { id: 'empty', name: 'Empty', roots: [], panes: [], arrangement: {} },
  ],
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(initial));
const viewer = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof viewer.connect>> | undefined;
let client: ReturnType<typeof spawn> | undefined;
let stdout = '',
  stderr = '',
  token = '';
const pending = new Map<
  number,
  {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const evidence: string[] = [];
try {
  connection = await viewer.connect();
  const evaluate = <T = unknown>(expression: string) => connection!.evaluate<T>(expression);
  const readState = async () =>
    JSON.parse(await readFile(path.join(profile, 'viewer-state-v1.json'), 'utf8')) as SavedState;
  await until(
    () => evaluate<number>(`document.querySelectorAll('.folder-explorer').length`),
    Boolean,
    'owned folder renderer',
  );
  await evaluate(
    `window.viewer.settingsGet().then(s => window.viewer.settingsPatch([{path:'settings.agents.enabled',value:true},{path:'settings.agents.roots',value:[${JSON.stringify(shared)}]}],s.revision))`,
  );
  await until(
    () => readFile(path.join(profile, 'agent-connection-v1.json'), 'utf8').catch(() => ''),
    Boolean,
    'owned agent socket',
  );
  token = JSON.parse(await readFile(path.join(profile, 'agent-token-v1.json'), 'utf8')) as string;
  client = spawn(binary, ['--mcp'], {
    env: { ...process.env, VIEWER_DATA_DIRECTORY: profile, VIEWER_AGENT_TOKEN: token },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '',
    sequence = 0;
  client.stderr!.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-4000);
  });
  client.stdout!.on('data', (chunk) => {
    const data = String(chunk);
    stdout += data;
    buffer += data;
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const reply = JSON.parse(buffer.slice(0, newline)) as {
        id: number;
        result?: unknown;
        error?: { message: string };
      };
      buffer = buffer.slice(newline + 1);
      const request = pending.get(reply.id);
      if (!request) continue;
      pending.delete(reply.id);
      clearTimeout(request.timer);
      if (reply.error) request.reject(new Error(reply.error.message));
      else request.resolve(reply.result);
    }
  });
  client.on('error', (error) => {
    for (const request of pending.values()) request.reject(error);
  });
  const request = <T = unknown>(method: string, params?: unknown): Promise<T> =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer: setTimeout(() => {
          pending.delete(id);
          reject(new Error('Packaged MCP request timed out: ' + method));
        }, 10000),
      });
      client!.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  const call = async <T = unknown>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<T> => {
    const result = await request<{ content: { text: string }[] }>('tools/call', {
      name,
      arguments: args,
    });
    return JSON.parse(result.content[0].text) as T;
  };
  const status = (id: string) => call<AgentProposal>('get_proposal', { id });
  const review = async (id: string, approve = true) => {
    assert.equal((await status(id)).status, 'review');
    await until(
      () => evaluate<boolean>(`!!document.querySelector('dialog[open] form button.primary')`),
      Boolean,
      'rendered action review',
    );
    await evaluate(
      `(() => { const dialog = document.querySelector('dialog[open]'); const button = ${approve ? "dialog.querySelector('button.primary')" : "Array.from(dialog.querySelectorAll('button')).find(button => button.textContent.trim() === 'Reject')"}; if (!button) throw new Error('Review control missing'); button.click(); })()`,
    );
    return until(
      () => status(id),
      (proposal) => ['completed', 'rejected', 'failed'].includes(proposal.status),
      'acknowledged proposal completion',
    );
  };
  const context = (paneID: string) =>
    until(
      () => call<{ target: { paneID: string } }>('list_commands'),
      (result) => result.target.paneID === paneID,
      'published active plane',
    );
  await request('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'Generated navigation QA', version: '1' },
  });
  const tools = await request<{ tools: { name: string }[] }>('tools/list');
  for (const name of [
    'list_workspaces',
    'list_planes',
    'propose_open_path',
    'propose_selection',
    'propose_focus_plane',
    'propose_workspace_switch',
  ])
    assert.ok(tools.tools.some((tool) => tool.name === name));
  assert.ok(!tools.tools.some((tool) => /apply|delete|trash/.test(tool.name)));
  const workspaces = await call<(AgentWorkspace & { active: boolean })[]>('list_workspaces');
  assert.deepEqual(
    workspaces.map((space) => space.id),
    ['origin', 'downloads', 'empty'],
  );
  assert.ok(!JSON.stringify(workspaces).includes(secret));
  assert.ok(!JSON.stringify(workspaces).match(/arrangement|history/));
  await assert.rejects(call('propose_open_path', { path: secret }), /outside/);
  evidence.push(
    'Private stdio MCP transport, six advertised navigation tools, live discovery and denied-path redaction.',
  );
  const rejected = await call<{ id: string; requiresUserReview: boolean }>('propose_open_path', {
    path: nested,
  });
  assert.equal(rejected.requiresUserReview, true);
  assert.equal((await readState()).workspaces[0].panes[0].path, shared);
  assert.equal((await review(rejected.id, false)).status, 'rejected');
  const opened = await call<{ id: string }>('propose_open_path', { path: nested });
  assert.equal((await review(opened.id)).status, 'completed');
  await until(
    readState,
    (state) => state.workspaces[0].panes[0].path === nested,
    'normal current-folder navigation',
  );
  await context('source');
  const selected = await call<{ id: string }>('propose_selection', { paths: [first, second] });
  assert.equal((await review(selected.id)).status, 'completed');
  await until(
    () => call<{ target: { selection: { path: string }[] } }>('list_commands'),
    (result) => result.target.selection.length === 2,
    'actual explorer selection',
  );
  const viewText = await evaluate<string>(`document.querySelector('.folder-explorer').textContent`);
  assert.match(viewText, /2 selected/);
  evidence.push(
    'Rendered Reject/Open path/Select files controls, deferred execution, ordinary folder history and actual two-file selection.',
  );
  const rootOpen = await call<{ id: string }>('propose_open_path', {
    path: first,
    placement: 'root',
  });
  assert.equal((await review(rootOpen.id)).status, 'completed');
  const rooted = await until(
    readState,
    (state) =>
      state.workspaces[0].panes.some((pane) => pane.type === 'preview' && pane.path === first),
    'independent preview plane',
  );
  const preview = rooted.workspaces[0].panes.find(
    (pane) => pane.type === 'preview' && pane.path === first,
  )!;
  assert.ok(rooted.workspaces[0].roots.includes(preview.id));
  const focus = await call<{ id: string }>('propose_focus_plane', { paneID: 'source' });
  assert.equal((await review(focus.id)).status, 'completed');
  await context('source');
  const linked = await call<{ id: string }>('propose_open_path', {
    path: second,
    placement: 'linked',
  });
  assert.equal((await review(linked.id)).status, 'completed');
  const linkedState = await until(
    readState,
    (state) =>
      state.workspaces[0].panes.some((pane) => pane.type === 'preview' && pane.path === second),
    'linked preview plane',
  );
  const child = linkedState.workspaces[0].panes.find(
    (pane) => pane.type === 'preview' && pane.path === second,
  )!;
  assert.ok(!linkedState.workspaces[0].roots.includes(child.id));
  evidence.push(
    'Independent root versus linked preview planes and reviewed plane focus without manual intervention.',
  );
  const change = await call<{ id: string }>('propose_workspace_switch', { name: 'Downloads' });
  assert.equal((await review(change.id)).status, 'completed');
  await until(
    readState,
    (state) => state.activeWorkspace === 'downloads',
    'workspace switch by exact name',
  );
  await context('downloads-folder');
  const empty = await call<{ id: string }>('propose_workspace_switch', { workspaceID: 'empty' });
  assert.equal((await review(empty.id)).status, 'completed');
  await until(
    () => call<(AgentWorkspace & { active: boolean })[]>('list_workspaces'),
    (spaces) => spaces.some((space) => space.id === 'empty' && space.active),
    'empty workspace discovery',
  );
  const fromEmpty = await call<{ id: string }>('propose_open_path', { path: downloads });
  assert.equal((await review(fromEmpty.id)).status, 'completed');
  await until(
    readState,
    (state) =>
      state.workspaces
        .find((space) => space.id === 'empty')!
        .panes.some((pane) => pane.path === downloads),
    'agent-created root from empty workspace',
  );
  evidence.push(
    'Workspace switch by name/ID, continuation from a file preview and root creation from an empty workspace.',
  );
  client.stdin!.end();
  for (let i = 0; i < 100 && client.exitCode === null; i++) await delay(50);
  assert.equal(client.exitCode, 0, 'Packaged stdio client exits cleanly: ' + stderr);
  assert.ok(!stdout.includes(token), 'MCP output never contains its credential');
  assert.equal(await readFile(first, 'utf8'), 'Generated Unicode MCP fixture.');
  assert.equal(await readFile(second, 'utf8'), 'Second generated file.');
  const output = path.resolve('out/agent-navigation');
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, 'result.json'),
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        binary,
        hiddenOwnedProfile: true,
        passes: evidence,
        releaseReady: false,
        limitation:
          'Rendered controls and packaged stdio transport; not physical third-party-client or signed Mac App Store qualification.',
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS packaged MCP discovery, reviewed open/select/focus/switch, root/linked placement and empty-workspace continuation. Generated files preserved; no foreground activation or clipboard changes.',
  );
} finally {
  for (const request of pending.values()) clearTimeout(request.timer);
  pending.clear();
  if (client && client.exitCode === null) {
    client.stdin?.end();
    for (let i = 0; i < 40 && client.exitCode === null; i++) await delay(50);
    if (client.exitCode === null) client.kill('SIGTERM');
  }
  try {
    await viewer.close(connection);
  } finally {
    await trashTemporary(root);
  }
}
