import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ExternalTerminals,
  shellQuote,
  type ExternalTerminalAdapter,
} from '../src/desktop/terminal-launch';
import { Executions } from '../src/desktop/executions';
import { AgentRequests } from '../src/desktop/agent-requests';
import { SettingsService } from '../src/desktop/settings';
import { defaultSettings } from '../src/domain/services';
import {
  actionArguments,
  actionAvailable,
  terminalDirectory,
  type CapturedTarget,
  type CustomAction,
} from '../src/domain/automation';
import { entry } from '../src/desktop/filesystem';
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
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-programs-'));
  config = defaultSettings(root);
});
afterEach(async () => {
  cleanup.splice(0).forEach((stop) => stop());
  await fs.rm(root, { recursive: true, force: true });
});

describe('literal command execution', () => {
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
    await fs.unlink(file);
    await fs.writeFile(file, 'replacement data');
    const executions = new Executions(
      () => config,
      () => {},
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
          value: [
            command({
              kind: 'executable',
              executable: '/bin/echo',
              args: ['{paths}'],
              perItem: false,
            }),
          ],
        },
      ],
      0,
    );
    const execute = vi.fn(async (): Promise<void | { taskID: string }> => {});
    const write = vi.fn();
    const requests = new AgentRequests(root, settings, () => {}, execute, {
      read: () => ({ cwd: root, output: 'fixture screen' }),
      write,
    });
    return { settings, execute, requests, write };
  }
  it('reviews by default, invalidates changed executor grants, and scopes unattended execution to canonical folders', async () => {
    const { settings, execute, requests } = await setup();
    const first = await requests.command('custom.fixture', target(), 'Fixture');
    expect(first.requiresUserReview).toBe(true);
    expect(execute).not.toHaveBeenCalled();
    await requests.review(first.id, true);
    expect(execute).toHaveBeenCalledOnce();
    await requests.grant('custom.fixture', root, 'execute', true);
    const unattended = await requests.command('custom.fixture', target(), 'Fixture');
    expect(unattended.requiresUserReview).toBe(false);
    expect(requests.get(unattended.id).status).toBe('completed');
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
    expect((await requests.command('custom.fixture', target(), 'Fixture')).requiresUserReview).toBe(
      true,
    );
    const sibling = path.join(root, 'outside');
    await fs.mkdir(sibling);
    await requests.grant('custom.fixture', sibling, 'execute', true);
    const link = path.join(sibling, 'escape');
    await fs.symlink(root, link);
    expect(
      (await requests.command('custom.fixture', target(link), 'Fixture')).requiresUserReview,
    ).toBe(true);
  });
  it('separates terminal read/write grants and configuration proposals cannot self-authorize', async () => {
    const { requests, write } = await setup();
    await expect(requests.readTerminal('terminal')).rejects.toThrow('separate read grant');
    await requests.grant('*', root, 'terminal-read', true);
    expect((await requests.readTerminal('terminal')).output).toBe('fixture screen');
    const pending = await requests.writeTerminal('terminal', 'pwd\r');
    expect(pending.requiresUserReview).toBe(true);
    expect(write).not.toHaveBeenCalled();
    await requests.review(pending.id, true);
    expect(write).toHaveBeenCalledWith('terminal', 'pwd\r');
    expect(() => requests.configuration([{ path: 'executionApprovals', value: [] }])).toThrow(
      'Unknown setting',
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
    const stale = await requests.command('open-terminal-plane', target(), 'Terminal');
    await expect(requests.review(stale.id, true)).rejects.toThrow('originating plane');
    expect(requests.get(stale.id).status).toBe('failed');
  });
});
