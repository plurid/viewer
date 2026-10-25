import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ExternalTerminals,
  shellQuote,
  type ExternalTerminalAdapter,
} from '../src/desktop/terminals/terminal-launch';
import { Terminals } from '../src/desktop/terminals/terminals';
import { Executions } from '../src/desktop/actions/executions';
import { AgentRequests } from '../src/desktop/agents/agent-requests';
import { SettingsService } from '../src/desktop/preferences/settings';
import { defaultSettings } from '../src/domain/services';
import {
  actionArguments,
  actionAvailable,
  terminalDirectory,
  type CapturedTarget,
  type CustomAction,
} from '../src/domain/automation/actions';
import { entry } from '../src/desktop/files/filesystem';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import { removalBlocked } from './support/preservation';
let root: string;
let config: ReturnType<typeof defaultSettings>;
const cleanup: (() => void)[] = [];
const command = (executor: CustomAction['executor']): CustomAction => ({
  id: 'fixture',
  name: 'Fixture action',
  aliases: [],
  icon: 'command',
  shortcut: '',
  order: 0,
  pinned: true,
  when: { target: 'any', extensions: [], min: 0, max: 10000 },
  executor,
});
const target = (directory = root): CapturedTarget => ({
  workspaceID: 'workspace',
  rootID: 'root-one',
  paneID: 'folder',
  panePath: root,
  directory,
  selection: [],
});
beforeEach(async () => {
  root = await temporaryRoot('viewer-programs-');
  config = defaultSettings(root);
});
afterEach(async () => {
  cleanup.splice(0).forEach((stop) => stop());
  await trashTemporary(root);
});

describe('literal command execution', () => {
  it('drains an in-flight preparation without launching after folder access is revoked', async () => {
    config.customActions = [
      command({
        kind: 'executable',
        executable: '/bin/echo',
        args: ['must not launch'],
        perItem: false,
      }),
    ];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const access = vi.fn(async () => {
      await gate;
    });
    const executions = new Executions(
      () => config,
      () => {},
      access,
      async () => {},
    );
    cleanup.push(() => executions.close());
    const starting = executions.start('fixture', target());
    const rejected = expect(starting).rejects.toThrow('cancelled before launch');
    let drained = false;
    const revoking = executions.quiesce(root).then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await rejected;
    await revoking;
    expect(drained).toBe(true);
    expect(executions.list()).toEqual([]);
  });
  it('keeps spaces, quotes, dollar substitutions, and multiple paths as literal argv', async () => {
    const file = path.join(root, "Notes ' $(touch injected).txt");
    await fs.writeFile(file, 'fixture');
    const captured = { ...target(), selection: [await entry(file)] };
    config.customActions = [
      command({
        kind: 'executable',
        executable: process.execPath,
        args: [
          '-e',
          'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
          '{paths}',
          '{directory}',
        ],
        perItem: false,
      }),
    ];
    const executions = new Executions(
      () => config,
      () => {},
      undefined,
      async () => {},
    );
    cleanup.push(() => executions.close());
    const id = await executions.start('fixture', captured);
    await vi.waitFor(() =>
      expect(executions.list().find((task) => task.id === id)?.status).toBe('completed'),
    );
    expect(JSON.parse(executions.list()[0].output)).toEqual([file, root]);
    expect(await fs.stat(path.join(root, 'injected')).catch(() => undefined)).toBeUndefined();
    expect(
      actionArguments(['{paths}'], {
        ...captured,
        selection: [...captured.selection, await entry(file)],
      }),
    ).toEqual([file, file]);
    expect(() => actionArguments(['{name}'], { ...captured, selection: [] })).toThrow(
      'one selected item',
    );
    expect(terminalDirectory(root, captured.selection)).toBe(root);
  });
  it('bounds subprocess output and supports explicit shell positional arguments and cancellation', async () => {
    config.customActions = [
      command({ kind: 'shell', executable: '/bin/sh', script: 'printf "%s" "$1"', perItem: false }),
    ];
    const executions = new Executions(
      () => config,
      () => {},
      undefined,
      async () => {},
    );
    cleanup.push(() => executions.close());
    await executions.start('fixture', target());
    await vi.waitFor(() => expect(executions.list()[0].status).toBe('completed'));
    expect(executions.list()[0].output).toBe(root);
    config.customActions = [
      command({
        kind: 'executable',
        executable: process.execPath,
        args: ['-e', 'process.stdout.write("x".repeat(400000)); setInterval(()=>{},1000)'],
        perItem: false,
      }),
    ];
    const id = await executions.start('fixture', target());
    await vi.waitFor(() =>
      expect(executions.list().find((task) => task.id === id)!.output.length).toBe(256 * 1024),
    );
    executions.cancel(id);
    expect(executions.list().find((task) => task.id === id)!.status).toBe('cancelled');
  });
  it('checks conditions and captured identities before starting', async () => {
    const file = path.join(root, 'book.pdf');
    await fs.writeFile(file, 'first');
    const captured = { ...target(), selection: [await entry(file)] };
    const action = command({
      kind: 'executable',
      executable: '/bin/echo',
      args: ['{paths}'],
      perItem: true,
    });
    action.when = { target: 'files', extensions: ['pdf'], min: 1, max: 2 };
    expect(actionAvailable(action, captured)).toBe(true);
    expect(actionAvailable(action, target())).toBe(false);
    config.customActions = [action];
    await fs.rename(file, file + '.original');
    await fs.writeFile(file, 'replacement data');
    const executions = new Executions(
      () => config,
      () => {},
      undefined,
      async () => {},
    );
    cleanup.push(() => executions.close());
    await expect(executions.start('fixture', captured)).rejects.toThrow('Selection changed');
  });
});

describe('external terminal adapters', () => {
  const apps = [
    { name: 'Terminal', path: '/Applications/Terminal.app', running: false },
    { name: 'iTerm2', path: '/Applications/iTerm.app', running: true },
  ];
  it('selects a running terminal and opens a private, safely quoted script in the requested directory', async () => {
    const cwd = path.join(root, "folder ' & $(uname)");
    await fs.mkdir(cwd);
    const open = vi.fn(async (_app: string, _file: string) => {});
    const terminals = new ExternalTerminals(path.join(root, 'launches'), () => config, '', {
      discover: async () => apps,
      run: vi.fn(),
      open,
    });
    await terminals.open(cwd);
    const [application, script] = open.mock.calls[0];
    expect(application).toBe(apps[1].path);
    const text = await fs.readFile(script, 'utf8');
    expect(text).toContain('cd -- ' + shellQuote(await fs.realpath(cwd)) + ' || exit');
    expect((await fs.stat(script)).mode & 0o777).toBe(0o700);
    expect(
      (await promisify(execFile)('/bin/sh', ['-c', 'printf %s ' + shellQuote(cwd)])).stdout,
    ).toBe(cwd);
  });
  it('uses the verified bundled it2 capability and does not invoke the fallback twice', async () => {
    const run = vi.fn(async (_exe: string, args: string[]) =>
      args.includes('--help') ? '--command <command>' : 'Created new window',
    );
    const open = vi.fn();
    const terminals = new ExternalTerminals(root, () => config, '', {
      discover: async () => apps,
      run,
      open,
      bundledCLI: async () => '/trusted/it2',
    });
    await terminals.open(root);
    expect(run.mock.calls[1][1].slice(0, 3)).toEqual(['window', 'new', '--command']);
    expect(open).not.toHaveBeenCalled();
  });
  it('creates one tmux window per invocation and reuses an existing iTerm control client', async () => {
    config.terminals.tmux.executable = '/bin/echo';
    const calls: string[][] = [];
    let session = false;
    const adapter: ExternalTerminalAdapter = {
      discover: async () => apps,
      open: vi.fn(),
      run: async (_file, args) => {
        calls.push(args);
        if (args.includes('has-session') && !session)
          throw Object.assign(new Error('no session'), { code: 1 });
        if (args.includes('new-session')) session = true;
        return args.includes('list-clients') ? '1\n' : '@1\n';
      },
    };
    const terminals = new ExternalTerminals(root, () => config, '', adapter);
    await terminals.open(root, true);
    await terminals.open(root, true);
    expect(calls.filter((args) => args.includes('new-session'))).toHaveLength(1);
    expect(calls.filter((args) => args.includes('new-window'))).toHaveLength(1);
    expect(calls.find((args) => args.includes('new-window'))).toContain('=viewer');
    expect(adapter.open).toHaveBeenCalledTimes(1);
  });
  it('hands a configured profile or tmux program to a terminal only once it is confirmed', async () => {
    const refuse = async () => {
      throw new Error('The action was not confirmed. Nothing was run.');
    };
    const confirm = { profile: vi.fn(refuse), tmux: vi.fn(refuse), application: vi.fn() };
    const run = vi.fn(async () => '@1\n');
    const open = vi.fn(async (_app: string, _file: string) => {});
    const launches = path.join(root, 'launches');
    const terminals = new ExternalTerminals(
      launches,
      () => config,
      '',
      { discover: async () => apps, run, open },
      undefined,
      confirm,
    );
    await expect(terminals.open(root)).rejects.toThrow('not confirmed');
    await expect(terminals.open(root, true)).rejects.toThrow('not confirmed');
    expect(confirm.profile).toHaveBeenCalledWith(config.terminals.profiles[0]);
    expect(confirm.tmux).toHaveBeenCalledWith('tmux', '', {});
    expect(run).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    await expect(fs.readdir(launches)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('confirms a terminal application chosen by path before opening it', async () => {
    const custom = path.join(root, 'Custom Terminal.app');
    await fs.mkdir(custom);
    config.terminals.application = custom;
    const confirm = { profile: vi.fn(), tmux: vi.fn(), application: vi.fn(async () => {}) };
    const open = vi.fn(async (_app: string, _file: string) => {});
    const terminals = new ExternalTerminals(
      path.join(root, 'launches'),
      () => config,
      '',
      { discover: async () => apps, run: vi.fn(), open },
      undefined,
      confirm,
    );
    await terminals.open(root);
    expect(confirm.application).toHaveBeenCalledWith(custom);
    expect(open.mock.calls[0]?.[0]).toBe(custom);
  });
});

describe('terminal launchers left behind (2026-10-20)', () => {
  it('removes a launcher an earlier session wrote and Terminal never ran, and keeps this session’s', async () => {
    // A launcher removes itself when it runs; one that never ran kept the profile's environment.
    const directory = path.join(root, 'profile', 'terminal-launches');
    await fs.mkdir(directory, { recursive: true });
    const stale = path.join(directory, 'stale.command');
    const current = path.join(directory, 'current.command');
    const other = path.join(directory, 'notes.txt');
    for (const file of [stale, current, other]) await fs.writeFile(file, 'export TOKEN=x');
    const hourAgo = new Date(Date.now() - 3600_000);
    await fs.utimes(stale, hourAgo, hourAgo);
    await fs.utimes(other, hourAgo, hourAgo);
    const terminals = new ExternalTerminals(directory, () => config, '/Applications');
    await terminals.sweep(path.join(root, 'profile'));
    const retained = removalBlocked('expired terminal launcher cleanup', [stale]);
    expect((await fs.readdir(directory)).sort()).toEqual(
      retained
        ? [path.basename(stale), 'current.command', 'notes.txt'].sort()
        : ['current.command', 'notes.txt'],
    );
  });
});
describe('embedded terminal planes', () => {
  it('starts a configured profile only once it is confirmed, including on restore', async () => {
    const build = {
      id: 'build',
      name: 'Build',
      executable: '/bin/sh',
      args: ['-c', 'make'],
      env: {},
    };
    config.terminals.profiles.push(build);
    const confirm = vi.fn(async () => {
      throw new Error('The action was not confirmed. Nothing was run.');
    });
    // The worker is never launched, so its path is never used.
    const terminals = new Terminals(
      path.join(root, 'unlaunched-worker.cjs'),
      () => config,
      () => {},
      undefined,
      confirm,
    );
    const start = {
      id: 'terminal-pane',
      workspaceID: 'workspace',
      rootID: 'root-one',
      cwd: root,
      profileID: 'build',
      cols: 80,
      rows: 24,
    };
    await expect(terminals.start(start, 1)).rejects.toThrow('not confirmed');
    expect(confirm).toHaveBeenCalledWith(build);
    expect(() => terminals.agentRead('terminal-pane')).toThrow('no longer available');
    await terminals.close();
  });
});

describe('agent review and execution grants', () => {
  async function setup() {
    const settings = new SettingsService(
      root,
      root,
      () => true,
      () => {},
    );
    await settings.load();
    cleanup.push(() => settings.close());
    await settings.patch(
      [
        {
          path: 'settings.customActions',
          value: [command({ kind: 'builtin', command: 'copy-path' })],
        },
      ],
      0,
    );
    const execute = vi.fn(async (): Promise<void | { taskID: string }> => {});
    const write = vi.fn();
    const requests = new AgentRequests(
      root,
      settings,
      () => {},
      execute,
      { read: () => ({ cwd: root, output: 'fixture screen' }) },
      undefined,
      undefined,
      async () => true,
    );
    return { settings, execute, requests, write };
  }
  it('pins a folder’s contents in an agent Trash request and voids it after a change', async () => {
    const { execute, requests } = await setup();
    const folder = path.join(root, 'Drafts');
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, 'one.txt'), 'reviewed');
    const proposal = await requests.command(
      'trash',
      { ...target(), selection: [await entry(folder)] },
      'Move to Trash',
    );
    expect(requests.get(proposal.id).detail).toContain('(folder: 1 item');
    // Editing a file inside leaves the folder entry itself unchanged.
    await fs.appendFile(path.join(folder, 'one.txt'), ' and edited later');
    await expect(requests.review(proposal.id, true)).rejects.toThrow('contents of');
    expect(execute).not.toHaveBeenCalled();
  });
  it('counts a folder from the disk, whatever the selection says it is (2026-10-20)', async () => {
    // The window's `directory: false` was taken at its word: a folder was listed as one path.
    const { requests } = await setup();
    const folder = path.join(root, 'Drafts');
    await fs.mkdir(folder);
    for (const name of ['one.txt', 'two.txt', 'three.txt'])
      await fs.writeFile(path.join(folder, name), name);
    const proposal = await requests.command(
      'trash',
      { ...target(), selection: [{ ...(await entry(folder)), directory: false }] },
      'Move to Trash',
    );
    expect(requests.get(proposal.id).detail).toContain('(folder: 3 items');
  });
  it('hands the approved folder proofs to the Trash move, which checks them again as it runs (2026-10-20)', async () => {
    // Checked at approval only, a nested edit while the move waited in the queue went unnoticed.
    const { execute, requests } = await setup();
    const folder = path.join(root, 'Drafts');
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, 'one.txt'), 'reviewed');
    const proposal = await requests.command(
      'trash',
      { ...target(), selection: [await entry(folder)] },
      'Move to Trash',
    );
    await requests.review(proposal.id, true);
    const contents = (execute.mock.calls[0] as unknown[])[2] as ReadonlyMap<string, string>;
    expect([...contents.keys()]).toEqual([folder]);
  });
  it('requires fresh review and refuses grants that could bypass removal approval', async () => {
    const { settings, execute, requests } = await setup();
    const first = await requests.command('custom.fixture', target(), 'Fixture');
    expect(first.requiresUserReview).toBe(true);
    expect(execute).not.toHaveBeenCalled();
    await requests.review(first.id, true);
    expect(execute).toHaveBeenCalledOnce();
    await expect(requests.grant('custom.fixture', root, 'execute', true)).rejects.toThrow(
      'approval each time',
    );
    const again = await requests.command('custom.fixture', target(), 'Fixture');
    expect(again.requiresUserReview).toBe(true);
    expect(requests.get(again.id).status).toBe('review');
    expect(execute).toHaveBeenCalledOnce();
    const action = command({
      kind: 'executable',
      executable: '/bin/echo',
      args: ['changed'],
      perItem: false,
    });
    await settings.patch(
      [{ path: 'settings.customActions', value: [action] }],
      settings.snapshot().revision,
    );
    await expect(requests.command('custom.fixture', target(), 'Fixture')).rejects.toThrow(
      'bypass Trash',
    );
    await expect(requests.review(again.id, true)).rejects.toThrow('bypass Trash');
    expect(execute).toHaveBeenCalledOnce();
  });
  it('separates terminal read/write grants and configuration proposals cannot self-authorize', async () => {
    const { requests, write } = await setup();
    await expect(requests.readTerminal('terminal')).rejects.toThrow('separate read grant');
    await requests.grant('*', root, 'terminal-read', true);
    expect((await requests.readTerminal('terminal')).output).toBe('fixture screen');
    await expect(requests.writeTerminal('terminal', 'pwd\r')).rejects.toThrow('permanently delete');
    await expect(requests.grant('*', root, 'terminal-write', true)).rejects.toThrow(
      'approval each time',
    );
    expect(write).not.toHaveBeenCalled();
    expect(() => requests.configuration([{ path: 'executionApprovals', value: [] }])).toThrow(
      'Agents cannot change',
    );
    for (const path of [
      'settings',
      'settings.browsing',
      'settings.browsing.confirmTrash',
      'settings.customActions',
      'settings.terminals.profiles',
      'settings.terminals.tmux.executable',
      'settings.shortcuts',
      'settings.agents.roots',
      'settings.providers',
      'settings.fileOpening.types',
      'settings.search.contentRoots',
    ])
      expect(() => requests.configuration([{ path, value: null }]), path).toThrow(
        'Agents cannot change',
      );
    const proposal = requests.configuration([{ path: 'settings.appearance', value: 'light' }]);
    await requests.review(proposal.id, false);
    expect(requests.get(proposal.id).status).toBe('rejected');
  });
  it('reports asynchronous action completion and dispatcher failures instead of premature success', async () => {
    const { requests, execute } = await setup();
    execute.mockResolvedValueOnce({ taskID: 'fixture-task' });
    const proposal = await requests.command('custom.fixture', target(), 'Fixture');
    await requests.review(proposal.id, true);
    expect(requests.get(proposal.id)).toMatchObject({ status: 'running', taskID: 'fixture-task' });
    requests.execution({
      id: 'fixture-task',
      title: 'Fixture',
      status: 'failed',
      output: 'fixture output',
      error: 'Command failed.',
    });
    expect(requests.get(proposal.id)).toMatchObject({
      status: 'failed',
      error: 'Command failed.',
      task: { output: 'fixture output' },
    });
    execute.mockRejectedValueOnce(new Error('The originating plane changed.'));
    const stale = await requests.command('copy-path', target(), 'Copy path');
    await expect(requests.review(stale.id, true)).rejects.toThrow('originating plane');
    expect(requests.get(stale.id).status).toBe('failed');
  });
});
