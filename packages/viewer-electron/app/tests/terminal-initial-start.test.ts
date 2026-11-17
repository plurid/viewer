import { realpath, mkdir, rename } from 'node:fs/promises';
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
let settings: ReturnType<typeof defaultSettings>;
let terminals: Terminals;
const confirm = vi.fn(async () => {});
const access = vi.fn(async (_paths: readonly string[]) => {});
const approvedInput = (initialInput: string) => ({
  initialInput,
  approvedProfile: structuredClone(settings.terminals.profiles[0]!),
  approvedCwd: root,
});
const request = (id = 'terminal'): TerminalStart => ({
  id,
  workspaceID: 'workspace',
  rootID: 'folder',
  cwd: root,
  profileID: 'login',
  cols: 80,
  rows: 24,
});

beforeEach(async () => {
  root = await realpath(await temporaryRoot('viewer-initial-start-'));
  settings = defaultSettings(root);
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
  confirm.mockReset().mockResolvedValue(undefined);
  access.mockReset().mockResolvedValue(undefined);
  terminals = new Terminals('/fixture/worker.cjs', () => settings, vi.fn(), access, confirm);
});
afterEach(async () => {
  await terminals.close();
  await trashTemporary(root);
});

describe('private initial input in the terminal service', () => {
  it('reports a running definition shell to its owner without starting it again', async () => {
    await terminals.start(request(), 7, approvedInput('npm run dev'));
    await expect(terminals.running(request(), 7, false)).resolves.toBe(true);
    await expect(terminals.running({ ...request(), cwd: root + '/' }, 7, false)).resolves.toBe(
      true,
    );
    await expect(terminals.running(request('missing'), 7, false)).resolves.toBe(false);
    expect(fake.postMessage).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
  });

  it.each(['owner', 'workspaceID', 'rootID', 'profileID', 'cwd'] as const)(
    'refuses a forged %s when checking a running terminal',
    async (field) => {
      await terminals.start(request(), 7, approvedInput('npm run dev'));
      const elsewhere = root + '/elsewhere';
      await mkdir(elsewhere);
      const changed =
        field === 'owner'
          ? request()
          : { ...request(), [field]: field === 'cwd' ? elsewhere : 'another' };
      await expect(terminals.running(changed, field === 'owner' ? 8 : 7, false)).rejects.toThrow(
        'another plane',
      );
      expect(fake.postMessage).toHaveBeenCalledOnce();
    },
  );

  it('keeps a renamed original folder reachable through the desktop status query', async () => {
    const folder = root + '/build';
    await mkdir(folder);
    const input = { ...request(), cwd: folder };
    await terminals.start(input, 7);
    await rename(folder, folder + '-moved');
    await expect(terminals.running(input, 7, false)).resolves.toBe(true);
    expect(fake.postMessage).toHaveBeenCalledOnce();
  });

  it('X6: reports a pending terminal start as starting and waits for it without another launch', async () => {
    let release!: () => void;
    access.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const pending = terminals.start(request(), 7);
    await expect(terminals.running(request(), 7, false)).resolves.toBe(false);
    await expect(terminals.status(request(), 7)).resolves.toEqual({ kind: 'starting' });
    const settled = terminals.status(request(), 7, true);
    expect(terminals.count('workspace', 7)).toBe(0);
    release();
    await pending;
    await expect(settled).resolves.toEqual({ kind: 'running' });
    await expect(terminals.running(request(), 7, false)).resolves.toBe(true);
  });

  it('counts desktop shells by workspace and owner, including shells no renderer has attached', async () => {
    await terminals.start(request(), 7, approvedInput('npm run dev'));
    await terminals.start({ ...request('other-workspace'), workspaceID: 'elsewhere' }, 7);
    await terminals.start(request('other-owner'), 8);
    expect(terminals.count('workspace', 7)).toBe(1);
    expect(terminals.count('elsewhere', 7)).toBe(1);
    expect(terminals.count('workspace', 8)).toBe(1);
    expect(terminals.count('workspace', 9)).toBe(0);
    terminals.stop('terminal', 7);
    expect(terminals.count('workspace', 7)).toBe(0);
  });

  it('refuses a canonical folder different from the one whose approval was passed in', async () => {
    const elsewhere = root + '/elsewhere';
    await mkdir(elsewhere);
    await expect(
      terminals.start(request(), 7, {
        ...approvedInput('npm run dev'),
        approvedCwd: elsewhere,
      }),
    ).rejects.toThrow('Review it again');
    expect(fake.launch).not.toHaveBeenCalled();
  });

  it.each(['workspaceID', 'rootID', 'profileID'] as const)(
    'refuses an ordinary reattach with a different %s even at the same original cwd',
    async (field) => {
      await terminals.start(request(), 7);
      await expect(terminals.start({ ...request(), [field]: 'another' }, 7)).rejects.toThrow(
        'another plane',
      );
      expect(fake.postMessage).toHaveBeenCalledOnce();
    },
  );

  it('reattaches an ordinary shell by its original cwd after that folder moves', async () => {
    const folder = root + '/build';
    await mkdir(folder);
    const input = { ...request(), cwd: folder };
    await terminals.start(input, 7);
    await rename(folder, folder + '-moved');
    await expect(terminals.start(input, 7)).resolves.toBeUndefined();
    expect(fake.postMessage).toHaveBeenCalledOnce();
  });

  it('requires a private approved profile and folder before a command launch', async () => {
    await expect(terminals.start(request(), 7, { initialInput: 'npm run dev' })).rejects.toThrow(
      'approved profile and folder',
    );
    expect(access).not.toHaveBeenCalled();
    expect(fake.launch).not.toHaveBeenCalled();
  });

  it('reads an ordinary profile only after folder access has completed', async () => {
    access.mockImplementation(async () => {
      settings.terminals.profiles[0]!.executable = '/fixture/current-shell';
    });
    await terminals.start(request(), 7);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ executable: '/fixture/current-shell' }),
    );
    expect(fake.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ executable: '/fixture/current-shell' }),
    );
  });

  it('deeply captures the approved profile before waiting for folder access', async () => {
    const options = approvedInput('npm run dev');
    const args = [...options.approvedProfile.args];
    access.mockImplementation(async () => {
      options.approvedProfile.args.push('unapproved');
    });
    await terminals.start(request(), 7, options);
    expect(fake.postMessage).toHaveBeenCalledWith(expect.objectContaining({ args }));
  });

  it('refuses a definition start on an existing ordinary shell', async () => {
    await terminals.start(request(), 7);
    await expect(terminals.start(request(), 7, approvedInput('npm run dev'))).rejects.toThrow(
      'another plane',
    );
    expect(fake.postMessage).toHaveBeenCalledOnce();
  });

  it('reattaches without rereading a profile removed from settings', async () => {
    await terminals.start(request(), 7, approvedInput('npm run dev'));
    settings.terminals.profiles = [];
    await expect(terminals.start(request(), 7)).resolves.toBeUndefined();
    expect(fake.postMessage).toHaveBeenCalledOnce();
  });

  it('uses one batch dialog for commands with a new configured profile', async () => {
    settings.terminals.profiles[0]!.executable = '/bin/sh';
    const ask = vi.fn(async () => true);
    const confirmations = new ExecutionConfirmations(root, ask);
    terminals = new Terminals(
      '/fixture/worker.cjs',
      () => settings,
      vi.fn(),
      access,
      (profile) => confirmations.requireTerminal(profile),
    );
    const commands = new DefinitionCommands({
      lookup: (_owner, _key, plane) => ({
        command: plane ? 'npm test' : 'npm run dev',
        cwd: root,
        paneCwd: root,
        profileID: 'login',
        workspaceName: 'Sample',
        basis: 'basis',
      }),
      terminals,
      confirmations,
      isAgentDriven: () => false,
      ownsWorkspace: () => true,
      window: () => undefined,
    });
    await commands.startAll(7, [
      { key: 'tools/sample', plane: 0, basis: 'basis', request: request() },
      { key: 'tools/sample', plane: 1, basis: 'basis', request: request('terminal-2') },
    ]);
    expect(ask).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ title: 'Run 2 commands in “Sample”?' }),
      undefined,
    );
    expect(fake.postMessage).toHaveBeenCalledTimes(2);
  });

  it('passes only desktop options to the worker and starts an identical request once', async () => {
    await terminals.start(request(), 7, approvedInput('npm run dev'));
    await terminals.start(request(), 7, approvedInput('npm run dev'));
    expect(confirm).not.toHaveBeenCalled();
    expect(fake.postMessage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        kind: 'start',
        id: 'terminal',
        initialInput: 'npm run dev',
      }),
    );
    await expect(terminals.start(request(), 7)).resolves.toBeUndefined();
    await expect(terminals.start(request(), 8, approvedInput('npm run dev'))).rejects.toThrow(
      'another plane',
    );
  });

  it('ignores initial input embedded in the public request itself', async () => {
    await terminals.start({ ...request(), initialInput: 'renderer input' } as TerminalStart, 7);
    expect(confirm).toHaveBeenCalledOnce();
    expect(fake.postMessage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        kind: 'start',
        initialInput: undefined,
      }),
    );
  });

  it.each([
    'x'.repeat(1001),
    'echo\nnext',
    'echo\rnext',
    '\x1b[31m',
    'echo\x00',
    'echo\x85',
    'echo\u2028next',
  ])('refuses invalid private input before launching: %j', async (initialInput) => {
    await expect(terminals.start(request(), 7, { initialInput })).rejects.toThrow(
      'private terminal command is invalid',
    );
    expect(fake.launch).not.toHaveBeenCalled();
  });

  it('shares matching pending starts and refuses different private input', async () => {
    let approve!: () => void;
    access.mockReturnValue(
      new Promise<void>((resolve) => {
        approve = resolve;
      }),
    );
    const first = terminals.start(request(), 7, approvedInput('npm run dev'));
    const second = terminals.start(request(), 7, approvedInput('npm run dev'));
    await expect(terminals.start(request(), 7, approvedInput('npm test'))).rejects.toThrow(
      'another plane',
    );
    approve();
    await Promise.all([first, second]);
    expect(fake.postMessage).toHaveBeenCalledOnce();
  });

  it('preserves the private input snapshot while awaiting folder access', async () => {
    const options = approvedInput('npm run dev');
    access.mockImplementation(async () => {
      options.initialInput = 'changed';
    });
    await terminals.start(request(), 7, options);
    expect(fake.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ initialInput: 'npm run dev' }),
    );
  });

  it('refuses a profile change while a command waits to launch', async () => {
    access.mockImplementation(async () => {
      settings.terminals.profiles[0]!.args = ['-c', 'echo changed'];
    });
    await expect(terminals.start(request(), 7, approvedInput('npm run dev'))).rejects.toThrow(
      'profile changed',
    );
    expect(fake.launch).not.toHaveBeenCalled();
  });

  it('returns a detached profile snapshot for approval', () => {
    const profile = terminals.profile('login');
    expect(profile).toEqual(settings.terminals.profiles[0]);
    profile!.args.push('changed');
    expect(settings.terminals.profiles[0]!.args).not.toContain('changed');
    expect(terminals.profile('missing')).toBeUndefined();
  });
});
