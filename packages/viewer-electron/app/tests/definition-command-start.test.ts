import { mkdir, realpath, symlink } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DefinitionCommandApproval,
  DefinitionCommandConfirmation,
} from '../src/desktop/actions/execution-confirmations';
import { definitionCommandFingerprint } from '../src/desktop/actions/execution-confirmations';
import type { TerminalStartOptions } from '../src/desktop/terminals/terminals';
import type { TerminalProfile, TerminalStart } from '../src/domain/automation/actions';
import type {
  DefinitionCommand,
  DefinitionCommandStart,
  DefinitionCommandLookup,
} from '../src/desktop/workspaces/definition-commands';
import { DefinitionCommands } from '../src/desktop/workspaces/definition-commands';
import { schemas } from '../src/desktop/ipc/schemas';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string;
let other: string;
let definition: DefinitionCommand;
const window = {} as BrowserWindow;
const profile = { id: 'login', name: 'Login shell', executable: '', args: ['-l'], env: {} };
const reference = { key: 'tools/sample', plane: 0, basis: 'basis' };
const approve = async (
  items: readonly DefinitionCommandConfirmation[],
): Promise<DefinitionCommandApproval> => ({
  kind: 'approved',
  fingerprints: items.map(definitionCommandFingerprint),
});
const fake = {
  lookup: vi.fn<DefinitionCommandLookup>(),
  terminals: {
    start: vi.fn(
      async (_request: TerminalStart, _owner: number, _options: TerminalStartOptions) => {},
    ),
    running: vi.fn(async (_request: TerminalStart, _owner: number) => false),
    profile: vi.fn<(_id: string) => TerminalProfile | undefined>(() => structuredClone(profile)),
  },
  confirmations: { requireDefinitionCommands: vi.fn(approve) },
  isAgentDriven: vi.fn((_owner: number) => false),
  ownsWorkspace: vi.fn((_owner: number, _workspaceID: string) => true),
  window: vi.fn((_owner: number) => window),
};
const commands = new DefinitionCommands(fake);
const request = (changes: Partial<TerminalStart> = {}): TerminalStart => ({
  id: 'terminal',
  workspaceID: 'workspace',
  rootID: 'folder',
  cwd: root,
  profileID: 'login',
  cols: 80,
  rows: 24,
  ...changes,
});
const items = (): DefinitionCommandStart[] => [
  { request: request(), ...reference },
  { request: request({ id: 'terminal-2' }), key: reference.key, plane: 1, basis: reference.basis },
];

beforeEach(async () => {
  root = await realpath(await temporaryRoot('viewer-definition-start-'));
  other = path.join(root, 'other');
  await mkdir(other);
  definition = {
    command: 'npm run dev',
    cwd: root,
    paneCwd: root,
    profileID: 'login',
    workspaceName: 'Sample',
    basis: 'basis',
  };
  fake.lookup.mockReset().mockImplementation(() => definition);
  fake.terminals.start.mockReset().mockResolvedValue(undefined);
  fake.terminals.running.mockReset().mockResolvedValue(false);
  fake.terminals.profile.mockReset().mockImplementation(() => structuredClone(profile));
  fake.confirmations.requireDefinitionCommands.mockReset().mockImplementation(approve);
  fake.isAgentDriven.mockReset().mockReturnValue(false);
  fake.ownsWorkspace.mockReset().mockReturnValue(true);
});
afterEach(async () => {
  await trashTemporary(root);
});

describe('definition command entry point', () => {
  it('binds the lookup to the requesting workspace and terminal', async () => {
    fake.lookup.mockImplementation((_owner, _key, _plane, workspaceID, terminalID) =>
      workspaceID === 'workspace' && terminalID === 'terminal' ? definition : undefined,
    );
    await expect(commands.start(7, request({ workspaceID: 'ad-hoc' }), reference)).rejects.toThrow(
      'no longer available',
    );
    await expect(commands.start(7, request({ id: 'unrelated' }), reference)).rejects.toThrow(
      'no longer available',
    );
    expect(fake.terminals.start).not.toHaveBeenCalled();
  });

  it('skips an already running plane after identity lookup without a native review', async () => {
    fake.terminals.running.mockResolvedValue(true);
    await expect(commands.start(7, request(), reference)).resolves.toMatchObject({
      kind: 'running',
    });
    expect(fake.lookup).toHaveBeenCalled();
    expect(fake.confirmations.requireDefinitionCommands).not.toHaveBeenCalled();
    expect(fake.terminals.start).not.toHaveBeenCalled();
  });

  it('skips a plane that becomes running while the approval dialog is open', async () => {
    fake.confirmations.requireDefinitionCommands.mockImplementation(async (items) => {
      fake.terminals.running.mockResolvedValue(true);
      return approve(items);
    });
    await expect(commands.start(7, request(), reference)).resolves.toMatchObject({
      kind: 'running',
    });
    expect(fake.confirmations.requireDefinitionCommands).toHaveBeenCalledOnce();
    expect(fake.terminals.running).toHaveBeenCalledTimes(2);
    expect(fake.terminals.start).not.toHaveBeenCalled();
  });

  it('starts the other planes after a terminal launch fails and returns each outcome', async () => {
    fake.terminals.start.mockImplementation(async (request) => {
      if (request.id === 'terminal') throw new Error('Launch failed');
    });
    await expect(commands.startAll(7, items())).resolves.toEqual([
      expect.objectContaining({ plane: 0, kind: 'failed', message: 'Launch failed' }),
      expect.objectContaining({ plane: 1, kind: 'started' }),
    ]);
    expect(fake.terminals.start).toHaveBeenCalledTimes(2);
  });

  it('starts another plane while an earlier launch is still pending', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    fake.terminals.start.mockImplementation(async (request) => {
      if (request.id === 'terminal') await pending;
    });
    const run = commands.startAll(7, items());
    try {
      await vi.waitFor(() => expect(fake.terminals.start).toHaveBeenCalledTimes(2));
    } finally {
      release();
      await run;
    }
  });

  it('checks workspace ownership after the final asynchronous preparation before starting', async () => {
    fake.terminals.profile
      .mockImplementationOnce(() => structuredClone(profile))
      .mockImplementationOnce(() => {
        queueMicrotask(() => fake.ownsWorkspace.mockReturnValue(false));
        return structuredClone(profile);
      });
    await expect(commands.start(7, request(), reference)).rejects.toThrow(
      'workspace is no longer available',
    );
    expect(fake.terminals.start).not.toHaveBeenCalled();
  });

  it('returns a quiet outcome when a single Run is declined', async () => {
    fake.confirmations.requireDefinitionCommands.mockResolvedValue({ kind: 'declined' });
    await expect(commands.start(7, request(), reference)).resolves.toMatchObject({
      kind: 'declined',
    });
    expect(fake.terminals.start).not.toHaveBeenCalled();
  });

  it('reads the literal command from the desktop lookup, approves it, and starts the private input', async () => {
    const input = { ...request(), command: 'renderer text', initialInput: 'renderer text' };
    await commands.start(7, input, reference);
    expect(fake.lookup).toHaveBeenCalledWith(7, reference.key, 0, 'workspace', 'terminal');
    expect(fake.confirmations.requireDefinitionCommands).toHaveBeenCalledExactlyOnceWith(
      [{ key: reference.key, cwd: root, profile, command: 'npm run dev', workspaceName: 'Sample' }],
      window,
    );
    expect(fake.terminals.start).toHaveBeenCalledExactlyOnceWith(request(), 7, {
      initialInput: 'npm run dev',
      approvedProfile: profile,
      approvedCwd: root,
      validate: expect.any(Function),
    });
    expect(fake.ownsWorkspace).toHaveBeenCalledWith(7, 'workspace');
  });

  it('matches folders by realpath and passes the canonical folder to the terminal service', async () => {
    const alias = path.join(root, 'alias');
    await symlink(root, alias);
    await commands.start(7, request({ cwd: alias }), reference);
    expect(fake.terminals.start).toHaveBeenCalledWith(request({ cwd: alias }), 7, {
      initialInput: 'npm run dev',
      approvedProfile: profile,
      approvedCwd: root,
      validate: expect.any(Function),
    });
  });

  it('refuses agent windows before looking up or revealing a command', async () => {
    fake.isAgentDriven.mockReturnValue(true);
    await expect(commands.start(7, request(), reference)).rejects.toThrow('require a person');
    expect(fake.lookup).not.toHaveBeenCalled();
    expect(fake.confirmations.requireDefinitionCommands).not.toHaveBeenCalled();
    expect(fake.terminals.start).not.toHaveBeenCalled();
  });

  it('refuses a workspace owned by another window', async () => {
    fake.ownsWorkspace.mockReturnValue(false);
    await expect(commands.start(7, request(), reference)).rejects.toThrow(
      'workspace is no longer available',
    );
    expect(fake.lookup).not.toHaveBeenCalled();
    expect(fake.confirmations.requireDefinitionCommands).not.toHaveBeenCalled();
    expect(fake.terminals.start).not.toHaveBeenCalled();
  });

  it('refuses a missing definition command', async () => {
    fake.lookup.mockReturnValue(undefined);
    await expect(commands.start(7, request(), reference)).rejects.toThrow(
      'command is no longer available',
    );
    expect(fake.confirmations.requireDefinitionCommands).not.toHaveBeenCalled();
    expect(fake.terminals.start).not.toHaveBeenCalled();
  });

  it('refuses a mismatched folder', async () => {
    await expect(commands.start(7, request({ cwd: other }), reference)).rejects.toThrow(
      'folder does not match',
    );
    expect(fake.confirmations.requireDefinitionCommands).not.toHaveBeenCalled();
    expect(fake.terminals.start).not.toHaveBeenCalled();
  });

  it.each(['request', 'definition'] as const)('refuses an unavailable %s folder', async (side) => {
    const missing = path.join(root, 'missing');
    if (side === 'definition') definition.cwd = missing;
    await expect(
      commands.start(7, request({ cwd: side === 'request' ? missing : root }), reference),
    ).rejects.toThrow('ENOENT');
    expect(fake.confirmations.requireDefinitionCommands).not.toHaveBeenCalled();
    expect(fake.terminals.start).not.toHaveBeenCalled();
  });

  it('refuses a mismatched terminal profile', async () => {
    await expect(commands.start(7, request({ profileID: 'other' }), reference)).rejects.toThrow(
      'profile does not match',
    );
    expect(fake.confirmations.requireDefinitionCommands).not.toHaveBeenCalled();
    expect(fake.terminals.start).not.toHaveBeenCalled();
  });

  it('refuses a removed terminal profile', async () => {
    fake.terminals.profile.mockReturnValue(undefined);
    await expect(commands.start(7, request(), reference)).rejects.toThrow(
      'profile is no longer available',
    );
    expect(fake.confirmations.requireDefinitionCommands).not.toHaveBeenCalled();
    expect(fake.terminals.start).not.toHaveBeenCalled();
  });

  it.each(['', ' ', 'x'.repeat(1001), 'echo\nnext', 'echo\x1b'])(
    'refuses invalid lookup command %j',
    async (command) => {
      definition.command = command;
      await expect(commands.start(7, request(), reference)).rejects.toThrow('must be one line');
      expect(fake.confirmations.requireDefinitionCommands).not.toHaveBeenCalled();
      expect(fake.terminals.start).not.toHaveBeenCalled();
    },
  );

  it('starts nothing if a batch approval is declined', async () => {
    fake.confirmations.requireDefinitionCommands.mockResolvedValue({ kind: 'declined' });
    await expect(commands.startAll(7, items())).resolves.toEqual([
      expect.objectContaining({ kind: 'declined' }),
      expect.objectContaining({ kind: 'declined' }),
    ]);
    expect(fake.confirmations.requireDefinitionCommands).toHaveBeenCalledOnce();
    expect(fake.terminals.start).not.toHaveBeenCalled();
  });

  it('starts nothing if confirmation fails', async () => {
    fake.confirmations.requireDefinitionCommands.mockRejectedValue(
      new Error('Private store unavailable'),
    );
    await expect(commands.startAll(7, items())).resolves.toEqual([
      expect.objectContaining({ kind: 'failed', message: 'Private store unavailable' }),
      expect.objectContaining({ kind: 'failed', message: 'Private store unavailable' }),
    ]);
    expect(fake.terminals.start).not.toHaveBeenCalled();
  });

  it('approves the complete batch once before starting each command', async () => {
    fake.lookup.mockImplementation((_owner, _key, plane) => ({
      ...definition,
      command: plane ? 'npm test' : definition.command,
    }));
    await commands.startAll(7, items());
    expect(fake.confirmations.requireDefinitionCommands).toHaveBeenCalledOnce();
    expect(
      [...fake.terminals.start.mock.calls].sort(([left], [right]) =>
        left.id.localeCompare(right.id),
      ),
    ).toEqual([
      [
        request(),
        7,
        {
          initialInput: 'npm run dev',
          approvedProfile: profile,
          approvedCwd: root,
          validate: expect.any(Function),
        },
      ],
      [
        request({ id: 'terminal-2' }),
        7,
        {
          initialInput: 'npm test',
          approvedProfile: profile,
          approvedCwd: root,
          validate: expect.any(Function),
        },
      ],
    ]);
    expect(fake.confirmations.requireDefinitionCommands.mock.invocationCallOrder[0]).toBeLessThan(
      fake.terminals.start.mock.invocationCallOrder[0]!,
    );
  });

  it('reports an unavailable plane and starts the other valid planes', async () => {
    fake.lookup.mockImplementation((_owner, _key, plane) => (plane ? undefined : definition));
    await expect(commands.startAll(7, items())).resolves.toEqual([
      expect.objectContaining({ kind: 'started' }),
      expect.objectContaining({
        kind: 'failed',
        message: expect.stringContaining('command is no longer available'),
      }),
    ]);
    expect(fake.confirmations.requireDefinitionCommands).toHaveBeenCalledOnce();
    expect(fake.terminals.start).toHaveBeenCalledOnce();
  });

  it.each(['agent', 'ownership', 'command', 'profile', 'folder', 'removed'] as const)(
    'refuses a %s change during approval',
    async (change) => {
      fake.confirmations.requireDefinitionCommands.mockImplementation(async (items) => {
        const approved = await approve(items);
        if (change === 'agent') fake.isAgentDriven.mockReturnValue(true);
        if (change === 'ownership') fake.ownsWorkspace.mockReturnValue(false);
        if (change === 'command') definition.command = 'npm run changed';
        if (change === 'profile')
          fake.terminals.profile.mockReturnValue({ ...profile, executable: '/bin/sh' });
        if (change === 'folder') definition.cwd = other;
        if (change === 'removed') fake.lookup.mockReturnValue(undefined);
        return approved;
      });
      await expect(commands.startAll(7, items())).resolves.toEqual([
        expect.objectContaining({ kind: 'failed' }),
        expect.objectContaining({ kind: 'failed' }),
      ]);
      expect(fake.terminals.start).not.toHaveBeenCalled();
    },
  );

  it.each(['key', 'workspace', 'plane', 'terminal', 'limit'] as const)(
    'refuses an invalid batch with a mismatched %s',
    async (kind) => {
      const input = items();
      if (kind === 'key') input[1]!.key = 'other';
      if (kind === 'workspace') input[1]!.request.workspaceID = 'other';
      if (kind === 'plane') input[1]!.plane = 0;
      if (kind === 'terminal') input[1]!.request.id = 'terminal';
      if (kind === 'limit')
        input.push(
          ...Array.from({ length: 29 }, (_, index) => ({
            key: reference.key,
            basis: reference.basis,
            plane: index + 2,
            request: request({ id: `extra-${index}` }),
          })),
        );
      await expect(commands.startAll(7, input)).rejects.toThrow('distinct commands');
      expect(fake.confirmations.requireDefinitionCommands).not.toHaveBeenCalled();
      expect(fake.terminals.start).not.toHaveBeenCalled();
    },
  );

  it('does nothing for an empty batch', async () => {
    await commands.startAll(7, []);
    expect(fake.lookup).not.toHaveBeenCalled();
    expect(fake.confirmations.requireDefinitionCommands).not.toHaveBeenCalled();
    expect(fake.terminals.start).not.toHaveBeenCalled();
  });
});

describe('terminal start definition IPC', () => {
  it('accepts ordinary terminal starts and an optional definition reference', () => {
    expect(schemas.terminalStart.safeParse([request()]).success).toBe(true);
    expect(schemas.terminalStart.safeParse([request(), reference]).success).toBe(true);
    expect(
      schemas.terminalStart.safeParse([
        request(),
        { key: 'a/b/c/d/e/f/g/h', plane: 29, basis: 'basis' },
      ]).success,
    ).toBe(true);
    expect(
      schemas.terminalStart.safeParse([
        request(),
        { key: 'a'.repeat(200), plane: 0, basis: 'basis' },
      ]).success,
    ).toBe(true);
  });

  it.each([
    { ...reference, command: 'npm run injected' },
    { ...reference, initialInput: 'npm run injected' },
    { ...reference, ticket: 'obsolete' },
    { key: '', plane: 0 },
    { key: '.', plane: 0 },
    { key: '..', plane: 0 },
    { key: 'a/../b', plane: 0 },
    { key: 'a/./b', plane: 0 },
    { key: 'a'.repeat(201), plane: 0 },
    { key: '/leading', plane: 0 },
    { key: 'trailing/', plane: 0 },
    { key: 'bad//segment', plane: 0 },
    { key: 'bad key', plane: 0 },
    { key: 'bad\\key', plane: 0 },
    { key: 'a/b/c/d/e/f/g/h/i', plane: 0 },
    { key: 'sample', plane: -1 },
    { key: 'sample', plane: 30 },
    { key: 'sample', plane: 0.5 },
    { key: 'sample', plane: '0' },
  ])('rejects invalid or executable definition arguments: %j', (argument) => {
    expect(
      schemas.terminalStart.safeParse([request(), { basis: reference.basis, ...argument }]).success,
    ).toBe(false);
  });

  it('never forwards renderer fields as private initial input', () => {
    const parsed = schemas.terminalStart.parse([
      { ...request(), initialInput: 'injected', command: 'injected' },
      reference,
    ]);
    expect(parsed[0]).toEqual(request());
  });
});
