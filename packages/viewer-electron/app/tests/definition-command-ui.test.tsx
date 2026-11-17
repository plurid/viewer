// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalPane, Workspace } from '../src/domain/contracts';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import type {
  DefinitionCommandStart,
  DefinitionCommandOutcome,
} from '../src/domain/terminals/definition-commands';
import type { TerminalStart } from '../src/domain/automation/actions';

const fake = vi.hoisted(() => ({
  session: vi.fn(),
  flush: vi.fn(async () => {}),
  park: vi.fn(),
  mounted: vi.fn(),
  start: vi.fn(),
  running: vi.fn(async (_request: TerminalStart) => false),
  count: vi.fn(async (_workspaceID: string) => 0),
  focus: vi.fn(),
  all: vi.fn<(items: DefinitionCommandStart[]) => Promise<DefinitionCommandOutcome[]>>(),
  paneID: '',
}));
vi.mock('@plurid/plurid-react', async (original) => ({
  ...(await original<object>()),
  usePluridPlane: () => ({ parameters: { id: fake.paneID } }),
}));
vi.mock('../src/renderer/state/persistence', async (original) => ({
  ...(await original<object>()),
  flushState: fake.flush,
}));
vi.mock('../src/renderer/terminals/sessions', () => ({
  terminalSession: fake.session,
  terminalStarted: async (_id: string, session: { started: boolean }) => {
    session.started = true;
  },
  trimTerminals: vi.fn(),
}));
vi.mock('../src/renderer/terminals/TerminalPlane', () => ({
  TerminalPlane: ({ pane }: { pane: TerminalPane }) => {
    fake.mounted(pane.id);
    return <div data-terminal-id={pane.id} tabIndex={-1} data-testid={'terminal-' + pane.id}>Shell</div>;
  },
}));
import { DefinitionTerminal } from '../src/renderer/terminals/DefinitionTerminal';
import { checkDefinitionTerminal, chooseDefinitionTerminals, displayedDefinitionCommand } from '../src/renderer/terminals/definition-command-session';
import { DefinitionDialog } from '../src/renderer/ui/workspace/DefinitionDialog';
import { WorkspaceDefinitionCommands } from '../src/renderer/workspace/WorkspaceDefinitionCommands';
import { WorkspaceContext } from '../src/renderer/workspace/context';
import { getState, activeWorkspace, initialize } from '../src/renderer/state/store';
import { savePatch, update } from '../src/renderer/state/core';
import {
  deferTerminal,
  allowTerminalStart,
  agentTerminalWork,
  receiveTerminalAuthority,
} from '../src/renderer/terminals/start-authority';
import { sampleDefinition, sampleWorkspace } from './workspace-definition-fixtures';
import { parseLaunch } from '../src/domain/workspaces/launch';
import { resolveWorkspaceQuery } from '../src/domain/workspaces/definitions/query';
import { routeWorkspaceLaunch } from '../src/desktop/windows/workspace-launch';
import { openDefinition } from '../src/renderer/state/definitions';

let workspace: Workspace;
let panes: TerminalPane[];
let sequence = 0;
const controller = { rootID: (id: string) => id, focusPane: fake.focus } as unknown as WorkspaceController;
beforeEach(() => {
  fake.running.mockReset().mockResolvedValue(false);
  fake.count.mockReset().mockResolvedValue(0);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  fake.start.mockReset().mockResolvedValue(undefined);
  fake.all
    .mockReset()
    .mockImplementation(
      async (items: { request: TerminalStart; key: string; basis: string; plane: number }[]) =>
        items.map((item) => ({ ...item, terminalID: item.request.id, kind: 'started' })),
    );
  fake.session.mockReset().mockImplementation(async () => ({
    terminal: { cols: 80, rows: 24 },
    input: '',
    started: false,
    park: fake.park,
  }));
  Object.assign(window, {
    viewer: {
      save: vi.fn(async () => {}),
      terminalStart: fake.start,
      terminalRunning: fake.running,
      terminalCount: fake.count,
      terminalResize: vi.fn(async () => {}),
      terminalStartAll: fake.all,
      terminalWrite: vi.fn(async () => {}),
      workspaceDefinitionFile: vi.fn(),
    },
  });
  initialize({
    home: '/home/sample',
    platform: 'darwin',
    locations: [],
    state: null,
    openPaths: [],
  });
  panes = [0, 1, 2].map((plane) => ({
    id: `command-${++sequence}`,
    type: 'terminal',
    path: '/projects/sample',
    profileID: 'login',
    definitionPlane: plane,
    startOnOpen: false,
  }));
  workspace = sampleWorkspace('commands-' + sequence, {
    panes,
    roots: panes.map((pane) => pane.id),
    definition: { key: 'sample/site', basis: 'shown-basis' },
  });
  const definition = sampleDefinition('sample/site', {
    basis: 'shown-basis',
    planes: panes.map((pane, index) => ({
      index,
      plane: { kind: 'terminal', path: pane.path, command: 'echo sample-' + index },
    })),
  });
  update({
    ...getState(),
    bootstrap: {
      ...getState().bootstrap,
      definitions: {
        revision: sequence,
        file: { path: '/data/workspaces.jsonc', state: 'read' },
        definitions: [definition],
        diagnostics: [],
        projectManager: {
          path: '/source/projects.json',
          state: 'read',
          projects: 1,
          missing: 0,
          disabled: 0,
          remote: 0,
          duplicateKeys: 0,
        },
      },
    },
  });
  savePatch({ workspaces: [workspace], activeWorkspace: workspace.id });
});
afterEach(() => {
  cleanup();
  for (const pane of panes) allowTerminalStart(pane.id);
  agentTerminalWork('test-agent', false);
});

async function show(all = false) {
  const view = render(
    createElement(
      WorkspaceContext.Provider,
      { value: controller },
      <>
        <div className="workspace-surface" tabIndex={-1}>
        <WorkspaceDefinitionCommands />
        {(all ? panes : [panes[0]!]).map((pane) => (
          <DefinitionTerminal key={pane.id} pane={pane} />
        ))}
        </div>
      </>,
    ),
  );
  await waitFor(() => expect(view.queryByText('Checking terminal…')).toBeNull());
  return view;
}

describe('definition commands in workspace planes', () => {
  it('viewer --workspace from any shell opens the definition and shows choices without a start', async () => {
    const definition = {
      ...getState().bootstrap.definitions!.definitions[0]!,
      key: 'sample/from-cli',
    };
    const catalog = getState().bootstrap.definitions!;
    update({
      ...getState(),
      bootstrap: {
        ...getState().bootstrap,
        definitions: { ...catalog, definitions: [...catalog.definitions, definition] },
      },
    });
    Object.assign(window.viewer, {
      workspaceDefinitions: vi.fn(async () => ({ kind: 'build', definition })),
      workspaceClaim: vi.fn(async () => true),
    });
    const request = parseLaunch(
      ['--workspace', definition.key],
      '/shell/folder',
      '/home/sample',
      (_cwd, file) => file,
    );
    const routed = await routeWorkspaceLaunch(
      request,
      resolveWorkspaceQuery([], [definition], definition.key),
      {
        current: undefined,
        create: async () => ({ id: 'window' }),
        independent: async () => ({ id: 'window' }),
        forWorkspace: () => undefined,
      },
    );
    await openDefinition(routed.request.definition!);
    workspace = activeWorkspace();
    panes = workspace.panes.filter((pane): pane is TerminalPane => pane.type === 'terminal');
    const view = await show();
    expect(view.getByRole('button', { name: 'Run echo sample-0' })).toBeDefined();
    expect(fake.start).not.toHaveBeenCalled();
    expect(fake.all).not.toHaveBeenCalled();
    expect(fake.session).not.toHaveBeenCalled();
  });
  it.each(['open', 'restore', 'reload', 'reset'] as const)(
    '%s shows the panel without mounting xterm or starting any shell',
    async (kind) => {
      if (kind === 'reset') savePatch({ workspaces: [{ ...workspace, epoch: 1 }] });
      if (kind === 'restore' || kind === 'reload') {
        const saved = structuredClone(getState().saved);
        const bootstrap = getState().bootstrap;
        initialize({ ...bootstrap, state: saved });
      }
      const view = await show();
      expect(view.getByRole('button', { name: 'Run echo sample-0' })).toBeDefined();
      expect(view.getByRole('button', { name: 'Run all 3 commands' })).toBeDefined();
      expect(fake.mounted).not.toHaveBeenCalled();
      expect(fake.session).not.toHaveBeenCalled();
      expect(fake.start).not.toHaveBeenCalled();
      expect(fake.all).not.toHaveBeenCalled();
    },
  );

  it('mounts the Start panel through WorkspaceSurface TerminalContent', async () => {
    fake.paneID = panes[0]!.id;
    const { TerminalContent } = await import('../src/renderer/workspace/WorkspaceSurface');
    const view = render(
      createElement(WorkspaceContext.Provider, { value: controller }, <TerminalContent />),
    );
    await waitFor(() => expect(view.getByRole('button', { name: 'Run echo sample-0' })).toBeDefined());
    expect(fake.mounted).not.toHaveBeenCalled();
    expect(fake.session).not.toHaveBeenCalled();
    expect(fake.start).not.toHaveBeenCalled();
  });

  it('Shell only prepares an emulator and starts a shell without a reference or input', async () => {
    const view = await show();
    fireEvent.click(view.getByRole('button', { name: 'Shell only' }));
    await waitFor(() => expect(fake.start).toHaveBeenCalledOnce());
    expect(fake.start).toHaveBeenCalledWith(
      expect.objectContaining({ id: panes[0]!.id }),
      undefined,
    );
    expect(fake.park.mock.invocationCallOrder[0]).toBeLessThan(
      fake.start.mock.invocationCallOrder[0]!,
    );
    expect(view.queryByRole('button', { name: 'Run echo sample-0' })).toBeNull();
  });

  it('Run carries the displayed basis and prepares xterm before the IPC call', async () => {
    const view = await show();
    fireEvent.click(view.getByRole('button', { name: 'Run echo sample-0' }));
    await waitFor(() => expect(fake.start).toHaveBeenCalledOnce());
    expect(fake.start).toHaveBeenCalledWith(expect.objectContaining({ id: panes[0]!.id }), {
      key: 'sample/site',
      plane: 0,
      basis: 'shown-basis',
    });
    expect(fake.park.mock.invocationCallOrder[0]).toBeLessThan(
      fake.start.mock.invocationCallOrder[0]!,
    );
  });

  it('Run all prepares offscreen planes and retains each failure on its own panel', async () => {
    const view = await show();
    fake.all.mockImplementation(async (items) =>
      items.map((item, index) => ({
        ...item,
        terminalID: item.request.id,
        kind: index === 1 ? 'failed' : 'started',
        message: 'Review this plane again.',
      })),
    );
    fireEvent.click(view.getByRole('button', { name: 'Run all 3 commands' }));
    await waitFor(() => expect(fake.all).toHaveBeenCalledOnce());
    expect(fake.session).toHaveBeenCalledTimes(3);
    expect(fake.park).toHaveBeenCalledTimes(3);
    expect(fake.park.mock.invocationCallOrder.at(-1)!).toBeLessThan(
      fake.all.mock.invocationCallOrder[0]!,
    );
    view.unmount();
    const again = await show(true);
    await waitFor(() =>
      expect(again.getByRole('alert').textContent).toBe('Review this plane again.'),
    );
    expect(again.getByRole('button', { name: 'Run echo sample-1' })).toBeDefined();
  });

  it('keeps other Run all starts independent of one emulator failure', async () => {
    fake.session.mockImplementation(async (request: TerminalStart) => {
      if (request.id === panes[1]!.id) throw new Error('This emulator failed to open.');
      return { terminal: { cols: 80, rows: 24 }, input: '', started: false, park: fake.park };
    });
    const view = await show(true);
    fireEvent.click(view.getByRole('button', { name: 'Run all 3 commands' }));
    await waitFor(() => expect(fake.all).toHaveBeenCalledOnce());
    expect(fake.all.mock.calls[0]![0].map((item) => item.plane)).toEqual([0, 2]);
    expect(view.getByRole('alert').textContent).toBe('This emulator failed to open.');
    expect(view.getByRole('button', { name: 'Run echo sample-1' })).toBeDefined();
  });

  it('a quiet decline restores the panel', async () => {
    fake.start.mockResolvedValue({ kind: 'declined' });
    const view = await show();
    fireEvent.click(view.getByRole('button', { name: 'Run echo sample-0' }));
    await waitFor(() => expect(fake.start).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(view.getByRole('button', { name: 'Run echo sample-0' }).hasAttribute('disabled')).toBe(
        false,
      ),
    );
    expect(view.queryByRole('alert')).toBeNull();
  });

  it('Not now hides only this opening and returns for the next workspace epoch', async () => {
    const view = await show();
    fireEvent.click(view.getByRole('button', { name: 'Not now' }));
    expect(view.queryByRole('region', { name: 'Workspace commands' })).toBeNull();
    act(() => savePatch({ workspaces: [{ ...activeWorkspace(), epoch: 1 }] }));
    expect(view.getByRole('button', { name: 'Run all 3 commands' })).toBeDefined();
  });

  it.each(['agent', 'navigation', 'task'] as const)(
    '%s disables Run and Run all while Shell only stays available',
    async (route) => {
      if (route === 'agent') agentTerminalWork('test-agent', true);
      else deferTerminal(panes[0]!.id);
      const view = await show();
      const run = view.getByRole('button', { name: 'Run echo sample-0' });
      expect(run.hasAttribute('disabled')).toBe(true);
      expect(
        view.getByRole('button', { name: 'Run all 3 commands' }).hasAttribute('disabled'),
      ).toBe(true);
      fireEvent.click(run);
      expect(fake.start).not.toHaveBeenCalled();
      expect(fake.session).not.toHaveBeenCalled();
      expect(view.getByRole('button', { name: 'Shell only' }).hasAttribute('disabled')).toBe(false);
    },
  );

  it('refreshes the displayed command after a stale-basis refusal', async () => {
    const view = await show();
    const catalog = structuredClone(getState().bootstrap.definitions!);
    catalog.revision++;
    catalog.definitions[0]!.basis = 'changed-basis';
    catalog.definitions[0]!.planes[0]!.plane = {
      kind: 'terminal',
      path: panes[0]!.path,
      command: 'echo changed',
    };
    vi.mocked(window.viewer.workspaceDefinitionFile).mockResolvedValue(catalog);
    fake.start.mockRejectedValue(new Error('The definition changed. Review the command again.'));
    fireEvent.click(view.getByRole('button', { name: 'Run echo sample-0' }));
    await waitFor(() =>
      expect(view.getByRole('button', { name: 'Run echo changed' })).toBeDefined(),
    );
    expect(view.getByRole('alert').textContent).toContain('Review the command again.');
    expect(fake.start).toHaveBeenCalledOnce();
  });
  it('keeps Run disabled after reload when desktop bootstrap still reports agent work', async () => {
    update({ ...getState(), bootstrap: { ...getState().bootstrap, agentDriven: true } });
    const view = await show();
    expect(view.getByRole('button', { name: 'Run echo sample-0' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(view.getByRole('button', { name: 'Shell only' }).hasAttribute('disabled')).toBe(false);
    act(() => receiveTerminalAuthority(false));
    expect(view.getByRole('button', { name: 'Run echo sample-0' }).hasAttribute('disabled')).toBe(
      false,
    );
    act(() => receiveTerminalAuthority(true));
    expect(view.getByRole('button', { name: 'Run all 3 commands' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(fake.start).not.toHaveBeenCalled();
  });

  it('a reload after Run returns to the panel and spawns nothing from persisted state', async () => {
    const view = await show();
    fireEvent.click(view.getByRole('button', { name: 'Run echo sample-0' }));
    await waitFor(() =>
      expect(view.queryByRole('button', { name: 'Run echo sample-0' })).toBeNull(),
    );
    const saved = structuredClone(getState().saved);
    const bootstrap = getState().bootstrap;
    const starts = fake.start.mock.calls.length;
    const sessions = fake.session.mock.calls.length;
    view.unmount();
    vi.resetModules();
    const fresh = await import('../src/renderer/state/store');
    fresh.initialize({ ...bootstrap, state: saved });
    const { DefinitionTerminal: ReloadedTerminal } =
      await import('../src/renderer/terminals/DefinitionTerminal');
    const { WorkspaceContext: ReloadedContext } = await import('../src/renderer/workspace/context');
    const reloaded = render(
      createElement(
        ReloadedContext.Provider,
        { value: controller },
        <ReloadedTerminal pane={panes[0]!} />,
      ),
    );
    await waitFor(() => expect(reloaded.getByRole('button', { name: 'Run echo sample-0' })).toBeDefined());
    expect(fake.start).toHaveBeenCalledTimes(starts);
    expect(fake.session).toHaveBeenCalledTimes(sessions);
  });
});
