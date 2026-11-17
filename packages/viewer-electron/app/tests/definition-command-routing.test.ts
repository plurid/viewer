import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, realpath, symlink } from 'node:fs/promises';
import type { TerminalStatus } from '../src/domain/terminals/status';
import type { TerminalStart } from '../src/domain/automation/actions';
import type { TerminalStartOptions } from '../src/desktop/terminals/terminals';
import { definitionCommandLookup } from '../src/desktop/workspaces/definition-command-lookup';
import { DefinitionCommands } from '../src/desktop/workspaces/definition-commands';
import { ExecutionConfirmations } from '../src/desktop/actions/execution-confirmations';
import { createTerminalHandlers } from '../src/desktop/ipc/terminal-handlers';
import { schemas } from '../src/desktop/ipc/schemas';
import { sampleDefinition, sampleWorkspace } from './workspace-definition-fixtures';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string;
beforeEach(async () => {
  root = await realpath(await temporaryRoot('viewer-definition-routing-'));
});
afterEach(async () => {
  await trashTemporary(root);
});

function fixture(defaultProfile = 'login') {
  const definition = sampleDefinition('sample/site', {
    basis: 'basis',
    name: 'Sample',
    planes: [0, 1, 2].map((index) => ({
      index,
      plane: { kind: 'terminal' as const, path: root, command: `echo command-${index}` },
    })),
  });
  const workspace = sampleWorkspace('workspace', {
    definition: { key: definition.key, basis: definition.basis },
    panes: [0, 1, 2].map((index) => ({
      id: 'terminal-' + index,
      type: 'terminal' as const,
      path: root,
      profileID: 'login',
      definitionPlane: index,
    })),
  });
  const window = { workspaceID: workspace.id, workspaces: [workspace] };
  let agent = false;
  const profile = { id: 'login', name: 'Login shell', executable: '', args: ['-l'], env: {} };
  const start = vi.fn(
    async (_request: TerminalStart, _owner: number, options?: TerminalStartOptions) => {
      options?.validate?.();
    },
  );
  const ask = vi.fn(async (_summary: { title: string; detail: string }) => true);
  const confirmations = new ExecutionConfirmations(root, ask);
  const lookup = definitionCommandLookup({
    window: (owner) => (owner === 7 ? window : undefined),
    definition: (key) => (key === definition.key ? definition : undefined),
    defaultProfile: () => defaultProfile,
  });
  const service = new DefinitionCommands({
    lookup,
    terminals: { start, profile: () => profile, running: async () => false },
    confirmations,
    isAgentDriven: () => agent,
    ownsWorkspace: () => true,
    window: () => undefined,
  });
  const ordinaryStart = vi.fn(async () => {});
  const running = vi.fn(
    async (_request: TerminalStart, _owner: number, _includePending?: boolean) => true,
  );
  const count = vi.fn((_workspaceID: string, _owner: number) => 2);
  const status = vi.fn(async (request: TerminalStart): Promise<TerminalStatus> => ({
    kind: start.mock.calls.some(([started]) => started.id === request.id) ? 'running' : 'stopped',
  }));
  const handlers = createTerminalHandlers({
    terminals: { start: ordinaryStart, running, count, status },
    definitionCommands: service,
  } as unknown as Parameters<typeof createTerminalHandlers>[0]);
  const request = (plane = 0): TerminalStart => ({
    id: 'terminal-' + plane,
    workspaceID: workspace.id,
    rootID: 'terminal-' + plane,
    cwd: root,
    profileID: 'login',
    cols: 80,
    rows: 24,
  });
  const reference = (plane = 0) => ({ key: definition.key, basis: definition.basis, plane });
  return {
    definition,
    workspace,
    window,
    start,
    ask,
    confirmations,
    service,
    handlers,
    ordinaryStart,
    running,
    count,
    request,
    reference,
    agent: () => {
      agent = true;
    },
  };
}

describe('desktop definition reference authority', () => {
  it('offers and runs a command-only edit from the current catalog after approval', async () => {
    const f = fixture();
    f.definition.basis = 'edited-command';
    f.definition.planes[0]!.plane = { kind: 'terminal', path: root, command: 'echo current' };
    await expect(
      f.handlers.terminalDefinitionCommand([f.request(), f.reference()], 7),
    ).resolves.toMatchObject({
      kind: 'available',
      command: 'echo current',
      reference: f.reference(),
    });
    await f.handlers.terminalStart([f.request(), f.reference()], 7);
    expect(f.ask.mock.calls[0]![0].detail).toContain('Command: echo current');
    expect(f.start).toHaveBeenCalledWith(
      f.request(),
      7,
      expect.objectContaining({ initialInput: 'echo current' }),
    );
    expect(f.workspace.panes[0]!.path).toBe(root);
  });

  it.each(['plane', 'workspace', 'default'] as const)(
    'marks a changed effective %s profile unavailable before offering Run',
    async (source) => {
      const f = fixture(source === 'default' ? 'other' : 'login');
      f.definition.basis = 'changed-profile';
      if (source === 'plane')
        f.definition.planes[0]!.plane = {
          kind: 'terminal',
          path: root,
          command: 'echo command-0',
          profileID: 'other',
        };
      if (source === 'workspace') f.definition.terminalProfile = 'other';
      await expect(
        f.handlers.terminalDefinitionCommand([f.request(), f.reference()], 7),
      ).resolves.toEqual({ kind: 'changed' });
      await expect(f.handlers.terminalStart([f.request(), f.reference()], 7)).rejects.toThrow(
        'The terminal profile does not match the workspace command.',
      );
      expect(f.ask).not.toHaveBeenCalled();
      expect(f.start).not.toHaveBeenCalled();
    },
  );

  it.each(['plane', 'workspace'] as const)(
    'offers a matching %s profile that overrides a different default',
    async (source) => {
      const f = fixture('other');
      if (source === 'plane') {
        f.definition.terminalProfile = 'other';
        f.definition.planes[0]!.plane = {
          kind: 'terminal',
          path: root,
          command: 'echo command-0',
          profileID: 'login',
        };
      } else f.definition.terminalProfile = 'login';
      await expect(
        f.handlers.terminalDefinitionCommand([f.request(), f.reference()], 7),
      ).resolves.toMatchObject({ kind: 'available', command: 'echo command-0' });
      await f.handlers.terminalStart([f.request(), f.reference()], 7);
      expect(f.start).toHaveBeenCalledOnce();
    },
  );

  it('rejects swapped folders even when a forged Run changes cwd to match the new catalog plane', async () => {
    const f = fixture();
    const folders = [root + '/one', root + '/two'];
    await Promise.all(folders.map((folder) => mkdir(folder)));
    for (const plane of [0, 1]) f.workspace.panes[plane]!.path = folders[plane]!;
    f.definition.basis = 'swapped';
    for (const plane of [0, 1])
      f.definition.planes[plane]!.plane = {
        kind: 'terminal',
        path: folders[1 - plane]!,
        command: 'echo swapped-' + plane,
      };
    for (const plane of [0, 1]) {
      const request = { ...f.request(plane), cwd: folders[plane]! };
      await expect(
        f.handlers.terminalDefinitionCommand([request, f.reference(plane)], 7),
      ).resolves.toEqual({ kind: 'changed' });
      await expect(
        f.handlers.terminalStart([{ ...request, cwd: folders[1 - plane]! }, f.reference(plane)], 7),
      ).rejects.toThrow('folder does not match');
    }
    expect(f.ask).not.toHaveBeenCalled();
    expect(f.start).not.toHaveBeenCalled();
    expect(f.workspace.panes.slice(0, 2).map((pane) => pane.path)).toEqual(folders);
  });

  it('matches the current definition folder through realpath aliases without rearranging the pane', async () => {
    const f = fixture();
    const alias = root + '/alias';
    await symlink(root, alias);
    f.workspace.panes[0]!.path = alias;
    const request = { ...f.request(), cwd: alias + '/' };
    await expect(
      f.handlers.terminalDefinitionCommand([request, f.reference()], 7),
    ).resolves.toMatchObject({ kind: 'available', command: 'echo command-0' });
    await f.handlers.terminalStart([request, f.reference()], 7);
    expect(f.start).toHaveBeenCalledOnce();
    expect(f.workspace.panes[0]!.path).toBe(alias);
  });

  it.each([true, false])(
    'reports a pending approval to a reloaded renderer, then settles it (approve: %s)',
    async (approve) => {
      const f = fixture();
      let answer!: (approved: boolean) => void;
      f.ask.mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            answer = resolve;
          }),
      );
      const starting = f.handlers.terminalStart([f.request(), f.reference()], 7);
      await vi.waitFor(() => expect(f.ask).toHaveBeenCalledOnce());
      await expect(f.handlers.terminalStatus([f.request()], 7)).resolves.toEqual({
        kind: 'starting',
      });
      await expect(f.handlers.terminalStatus([f.request()], 8)).rejects.toThrow('another plane');
      for (const field of ['workspaceID', 'rootID', 'profileID'] as const)
        await expect(
          f.handlers.terminalStatus([{ ...f.request(), [field]: 'forged' }], 7),
        ).rejects.toThrow('another plane');
      const settled = f.handlers.terminalStatus([f.request(), true], 7);
      expect(f.start).not.toHaveBeenCalled();
      answer(approve);
      await starting;
      await expect(settled).resolves.toEqual({ kind: approve ? 'running' : 'stopped' });
      expect(f.start).toHaveBeenCalledTimes(approve ? 1 : 0);
      expect(f.ask).toHaveBeenCalledOnce();
    },
  );

  it('routes reload status and Close counts through the requesting owner without starting input', async () => {
    const f = fixture();
    await expect(f.handlers.terminalRunning([f.request()], 7)).resolves.toBe(true);
    expect(f.running).toHaveBeenCalledExactlyOnceWith(f.request(), 7, false);
    expect(f.handlers.terminalCount(['workspace'], 7)).toBe(2);
    expect(f.count).toHaveBeenCalledExactlyOnceWith('workspace', 7);
    expect(f.start).not.toHaveBeenCalled();
    expect(f.ordinaryStart).not.toHaveBeenCalled();
    expect(f.ask).not.toHaveBeenCalled();
  });

  it.each(['window', 'key', 'terminal', 'plane'] as const)(
    'refuses a forged %s before private input',
    async (kind) => {
      const f = fixture();
      // Keep the catalog entry valid so each ownership guard independently prevents a spawn.
      if (kind === 'window') f.window.workspaceID = 'another-window';
      if (kind === 'key') f.workspace.definition!.key = 'another/key';
      if (kind === 'terminal') f.workspace.panes[0]!.id = 'another-terminal';
      if (kind === 'plane' && f.workspace.panes[0]!.type === 'terminal')
        f.workspace.panes[0].definitionPlane = 1;
      await expect(f.handlers.terminalStart([f.request(), f.reference()], 7)).rejects.toThrow(
        'no longer available',
      );
      expect(f.start).not.toHaveBeenCalled();
      expect(f.ordinaryStart).not.toHaveBeenCalled();
      expect(f.ask).not.toHaveBeenCalled();
    },
  );

  it("routes a person's click through current lookup and native approval to private input", async () => {
    const f = fixture();
    await f.handlers.terminalStart([f.request(), f.reference()], 7);
    expect(f.start).toHaveBeenCalledWith(
      f.request(),
      7,
      expect.objectContaining({ initialInput: 'echo command-0' }),
    );
    expect(f.ask).toHaveBeenCalledOnce();
    expect(f.ordinaryStart).not.toHaveBeenCalled();
  });

  it('routes Shell only without a definition or private input', async () => {
    const f = fixture();
    await f.handlers.terminalStart([f.request()], 7);
    expect(f.ordinaryStart).toHaveBeenCalledExactlyOnceWith(f.request(), 7);
    expect(f.start).not.toHaveBeenCalled();
    expect(f.ask).not.toHaveBeenCalled();
  });

  it('refuses the basis the person saw even if the changed command was already approved', async () => {
    const f = fixture();
    await f.confirmations.requireDefinitionCommand({
      key: f.definition.key,
      cwd: root,
      profile: { id: 'login', name: 'Login shell', executable: '', args: ['-l'], env: {} },
      command: 'echo changed',
      workspaceName: 'Sample',
    });
    const shown = f.reference();
    f.definition.basis = 'new-basis';
    f.definition.planes[0]!.plane = { kind: 'terminal', path: root, command: 'echo changed' };
    await expect(f.handlers.terminalStart([f.request(), shown], 7)).rejects.toThrow(
      'The definition changed. Review the command again.',
    );
    expect(f.start).not.toHaveBeenCalled();
    expect(f.ask).toHaveBeenCalledOnce();
  });

  it('refuses a synthetic fallback reference', async () => {
    const f = fixture();
    f.definition.planes = [
      { index: -1, plane: { kind: 'terminal', path: root, command: 'echo forbidden' } },
    ];
    expect(
      schemas.terminalStart.safeParse([f.request(), { ...f.reference(), plane: -1 }]).success,
    ).toBe(false);
    await expect(f.service.start(7, f.request(), f.reference())).rejects.toThrow(
      'no longer available',
    );
    expect(f.start).not.toHaveBeenCalled();
  });

  it('starts approved and new commands independently while reporting a refused plane', async () => {
    const f = fixture();
    await f.handlers.terminalStart([f.request(), f.reference()], 7);
    f.ask.mockClear();
    f.start.mockClear();
    const items = [0, 1, 2].map((plane) => ({ request: f.request(plane), ...f.reference(plane) }));
    items[2]!.request.id = 'forged-terminal';
    const outcomes = await f.handlers.terminalStartAll([items], 7);
    expect(outcomes.map((item) => item.kind)).toEqual(['started', 'started', 'failed']);
    expect(f.ask).toHaveBeenCalledOnce();
    expect(f.ask.mock.calls[0]![0]).toMatchObject({
      detail: expect.stringContaining('echo command-1'),
    });
    expect(f.ask.mock.calls[0]![0]).toMatchObject({
      detail: expect.not.stringContaining('echo command-0'),
    });
    expect(f.start).toHaveBeenCalledTimes(2);
  });

  it('refuses an agent-driven flip while the dialog is open', async () => {
    const f = fixture();
    f.ask.mockImplementation(async () => {
      f.agent();
      return true;
    });
    await expect(f.handlers.terminalStart([f.request(), f.reference()], 7)).rejects.toThrow(
      'require a person',
    );
    expect(f.start).not.toHaveBeenCalled();
  });

  it('rechecks the catalog at the terminal spawn validation point', async () => {
    const f = fixture();
    f.start.mockImplementation(async (_request, _owner, options) => {
      f.definition.basis = 'changed-after-approval';
      options?.validate?.();
    });
    await expect(f.service.start(7, f.request(), f.reference())).rejects.toThrow(
      'The definition changed.',
    );
  });
});
