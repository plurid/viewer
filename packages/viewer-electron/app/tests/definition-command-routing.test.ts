import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { realpath } from 'node:fs/promises';
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

function fixture() {
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
    defaultProfile: () => 'login',
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
  const handlers = createTerminalHandlers({
    terminals: { start: ordinaryStart },
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
    request,
    reference,
    agent: () => {
      agent = true;
    },
  };
}

describe('desktop definition reference authority', () => {
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
