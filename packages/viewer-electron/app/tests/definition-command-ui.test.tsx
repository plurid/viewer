// @vitest-environment jsdom
import { createElement, useEffect, useRef } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalPane, Workspace } from '../src/domain/contracts';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import type {
  DefinitionCommandStart,
  DefinitionCommandOutcome,
} from '../src/domain/terminals/definition-commands';
import type { TerminalStart } from '../src/domain/automation/actions';
import type { TerminalStatus } from '../src/domain/terminals/status';
import type {
  DefinitionCommandPresentation,
  DefinitionCommandReference,
} from '../src/domain/terminals/definition-commands';

const fake = vi.hoisted(() => ({
  session: vi.fn(),
  started: vi.fn(async (_id: string, session: { started: boolean }) => {
    session.started = true;
  }),
  flush: vi.fn(async () => {}),
  park: vi.fn(),
  mounted: vi.fn(),
  start: vi.fn(),
  running: vi.fn(async (_request: TerminalStart) => false),
  status: vi.fn<(request: TerminalStart, wait?: boolean) => Promise<TerminalStatus>>(),
  inspect:
    vi.fn<
      (
        request: TerminalStart,
        reference: DefinitionCommandReference,
      ) => Promise<DefinitionCommandPresentation>
    >(),
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
  terminalStarted: fake.started,
  trimTerminals: vi.fn(),
}));
vi.mock('../src/renderer/terminals/TerminalPlane', () => ({
  TerminalPlane: ({ pane }: { pane: TerminalPane }) => {
    const element = useRef<HTMLDivElement>(null);
    const active = useViewer((state) => state.activePane === pane.id);
    useEffect(() => {
      if (active) element.current?.focus();
    }, [active]);
    fake.mounted(pane.id);
    return (
      <div
        ref={element}
        data-terminal-id={pane.id}
        tabIndex={-1}
        data-testid={'terminal-' + pane.id}
      >
        Shell
      </div>
    );
  },
}));
import { DefinitionTerminal } from '../src/renderer/terminals/DefinitionTerminal';
import {
  checkDefinitionTerminal,
  checkDefinitionCommand,
  chooseDefinitionTerminals,
  definitionCommandPresentation,
  displayedDefinitionCommand,
} from '../src/renderer/terminals/definition-command-session';
import { DefinitionDialog } from '../src/renderer/ui/workspace/DefinitionDialog';
import { WorkspaceDefinitionCommands } from '../src/renderer/workspace/WorkspaceDefinitionCommands';
import { WorkspaceContext } from '../src/renderer/workspace/context';
import {
  getState,
  activeWorkspace,
  initialize,
  setActivePane,
  useViewer,
} from '../src/renderer/state/store';
import { savePatch, update } from '../src/renderer/state/core';
import {
  deferTerminal,
  allowTerminalStart,
  agentTerminalWork,
  receiveTerminalAuthority,
  terminalStartDeferred,
} from '../src/renderer/terminals/start-authority';
import { sampleDefinition, sampleWorkspace } from './workspace-definition-fixtures';
import { parseLaunch } from '../src/domain/workspaces/launch';
import { resolveWorkspaceQuery } from '../src/domain/workspaces/definitions/query';
import { routeWorkspaceLaunch } from '../src/desktop/windows/workspace-launch';
import { openDefinition } from '../src/renderer/state/definitions';

let workspace: Workspace;
let panes: TerminalPane[];
let sequence = 0;
const controller = {
  rootID: (id: string) => id,
  focusPane: fake.focus,
} as unknown as WorkspaceController;
beforeEach(() => {
  fake.flush.mockReset().mockResolvedValue(undefined);
  fake.park.mockReset();
  fake.mounted.mockReset();
  fake.focus.mockReset().mockImplementation((id: string) => setActivePane(id));
  fake.paneID = '';
  fake.started.mockReset().mockImplementation(async (_id, session) => {
    session.started = true;
  });
  fake.running.mockReset().mockResolvedValue(false);
  fake.status.mockReset().mockImplementation(async (request) => ({
    kind: (await fake.running(request)) ? 'running' : 'stopped',
  }));
  fake.inspect.mockReset().mockImplementation(async (request, reference) => {
    const definition = getState().bootstrap.definitions!.definitions.find(
      (item) => item.key === reference.key,
    );
    const plane = definition?.planes.find((item) => item.index === reference.plane)?.plane;
    if (plane?.kind !== 'terminal' || plane.path !== request.cwd) return { kind: 'changed' };
    const profileID =
      plane.profileID ??
      definition?.terminalProfile ??
      getState().settings.settings.terminals.profileID;
    if (profileID !== request.profileID) return { kind: 'changed' };
    return plane.command
      ? { kind: 'available', command: plane.command, cwd: plane.path, reference }
      : { kind: 'unavailable' };
  });
  fake.count.mockReset().mockResolvedValue(0);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
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
      terminalStatus: fake.status,
      terminalDefinitionCommand: fake.inspect,
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
  await waitFor(() => {
    expect(view.queryAllByText('Checking terminal…')).toHaveLength(0);
    expect(view.queryAllByText('Checking definition…')).toHaveLength(0);
    const current = activeWorkspace();
    for (const pane of current.panes) {
      if (pane.type !== 'terminal' || pane.definitionPlane === undefined) continue;
      expect(definitionCommandPresentation(current, pane).kind).not.toBe('checking');
    }
  });
  return view;
}

const requestFor = (pane: TerminalPane): TerminalStart => ({
  id: pane.id,
  workspaceID: workspace.id,
  rootID: pane.id,
  cwd: pane.path,
  profileID: pane.profileID,
  cols: 80,
  rows: 24,
});

describe('definition commands in workspace planes', () => {
  it('persists new panes before desktop folder inspection without starting a shell', async () => {
    await show();
    expect(fake.flush.mock.invocationCallOrder[0]).toBeLessThan(
      fake.inspect.mock.invocationCallOrder[0]!,
    );
    expect(fake.start).not.toHaveBeenCalled();
    expect(fake.all).not.toHaveBeenCalled();
    expect(fake.session).not.toHaveBeenCalled();
  });

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
    await waitFor(() =>
      expect(view.getByRole('button', { name: 'Run echo sample-0' })).toBeDefined(),
    );
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
    expect(again.getByRole('button', { name: 'Run all 1 command' })).toBeDefined();
    expect(again.getByRole('alert').closest('.definition-start-panel')).not.toBeNull();
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

  it('keeps a live terminal error in normal flow beside a flexible terminal', async () => {
    fake.started.mockImplementationOnce(async (_id, session) => {
      session.started = true;
      throw new Error('The terminal could not be resized.');
    });
    const view = await show();
    fireEvent.click(view.getByRole('button', { name: 'Run echo sample-0' }));
    await waitFor(() =>
      expect(view.getByRole('alert').textContent).toBe('The terminal could not be resized.'),
    );
    const alert = view.getByRole('alert');
    const terminal = await view.findByTestId('terminal-' + panes[0]!.id);
    expect(alert.classList.contains('definition-command-error')).toBe(true);
    expect(alert.parentElement?.classList.contains('definition-terminal')).toBe(true);
    expect(alert.nextElementSibling).toBe(terminal);
    expect(view.queryByRole('button', { name: 'Run echo sample-0' })).toBeNull();
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
    expect(document.activeElement).toBe(view.container.querySelector('.workspace-surface'));
    act(() => savePatch({ workspaces: [{ ...activeWorkspace(), epoch: 1 }] }));
    await waitFor(() =>
      expect(view.getByRole('button', { name: 'Run all 3 commands' })).toBeDefined(),
    );
  });

  it('attaches existing desktop shells, including offscreen planes, without counting them as waiting', async () => {
    fake.running.mockImplementation(async (request) => request.id !== panes[1]!.id);
    const view = await show(true);
    expect(view.getByTestId('terminal-' + panes[0]!.id)).toBeDefined();
    expect(view.getByTestId('terminal-' + panes[2]!.id)).toBeDefined();
    expect(view.getByRole('button', { name: 'Run all 1 command' })).toBeDefined();
    expect(view.queryByRole('button', { name: 'Run echo sample-0' })).toBeNull();
    expect(fake.session).toHaveBeenCalledTimes(2);
    expect(fake.running).toHaveBeenCalledWith(requestFor(panes[0]!));
    expect(fake.start).not.toHaveBeenCalled();
    expect(fake.all).not.toHaveBeenCalled();
  });

  it('does not start a fresh shell if the desktop shell exits during reattachment', async () => {
    fake.running.mockImplementation(async () => false).mockResolvedValueOnce(true);
    const view = await show();
    expect(view.getByRole('button', { name: 'Run echo sample-0' })).toBeDefined();
    expect(fake.session).toHaveBeenCalledOnce();
    expect(fake.mounted).not.toHaveBeenCalled();
    expect(fake.start).not.toHaveBeenCalled();
  });

  it('counts desktop shells for Close even when this renderer has no terminal sessions', async () => {
    fake.count.mockResolvedValue(2);
    Object.assign(window.viewer, {
      workspaceDefinitions: vi.fn(async () => ({ kind: 'close-info' })),
    });
    const view = render(
      <DefinitionDialog
        kind="close"
        workspace={workspace}
        controller={controller}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(view.getByText(/Its 2 terminals stop/)).toBeDefined());
    expect(fake.count).toHaveBeenCalledExactlyOnceWith(workspace.id);
    expect(fake.session).not.toHaveBeenCalled();
    expect(fake.start).not.toHaveBeenCalled();
  });

  it.each(['agent', 'deferral'] as const)(
    'refuses a direct renderer Run with %s authority even if the button is bypassed',
    async (reason) => {
      await checkDefinitionTerminal(workspace, panes[0]!, requestFor(panes[0]!));
      await checkDefinitionCommand(workspace, panes[0]!, requestFor(panes[0]!));
      if (reason === 'agent') agentTerminalWork('test-agent', true);
      else deferTerminal(panes[0]!.id);
      await expect(
        chooseDefinitionTerminals(workspace, [
          {
            pane: panes[0]!,
            request: requestFor(panes[0]!),
            reference: displayedDefinitionCommand(workspace, panes[0]!)!.reference,
          },
        ]),
      ).rejects.toThrow(reason === 'agent' ? 'require a person' : 'An agent opened');
      expect(fake.session).not.toHaveBeenCalled();
      expect(fake.start).not.toHaveBeenCalled();
      expect(fake.all).not.toHaveBeenCalled();
    },
  );

  it('enables explicit Run when agent work ends while keeping ordinary automatic starts deferred', async () => {
    agentTerminalWork('test-agent', true);
    deferTerminal(panes[0]!.id);
    const view = await show();
    expect(view.getByRole('button', { name: 'Run echo sample-0' }).hasAttribute('disabled')).toBe(
      true,
    );
    act(() => receiveTerminalAuthority(false));
    expect(view.getByRole('button', { name: 'Run echo sample-0' }).hasAttribute('disabled')).toBe(
      true,
    );
    act(() => agentTerminalWork('test-agent', false));
    expect(view.getByRole('button', { name: 'Run echo sample-0' }).hasAttribute('disabled')).toBe(
      false,
    );
    expect(view.getByRole('button', { name: 'Run all 3 commands' }).hasAttribute('disabled')).toBe(
      false,
    );
    expect(terminalStartDeferred(panes[0]!.id)).toBe(true);
    expect(fake.start).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: 'Run echo sample-0' }));
    await waitFor(() => expect(fake.start).toHaveBeenCalledOnce());
  });

  it('excludes a started plane from both the notice count and the next Run all batch', async () => {
    const view = await show(true);
    fireEvent.click(view.getAllByRole('button', { name: 'Shell only' })[0]!);
    await waitFor(() =>
      expect(view.getByRole('button', { name: 'Run all 2 commands' })).toBeDefined(),
    );
    fireEvent.click(view.getByRole('button', { name: 'Run all 2 commands' }));
    await waitFor(() => expect(fake.all).toHaveBeenCalledOnce());
    expect(fake.all.mock.calls[0]![0].map((item) => item.request.id)).toEqual(
      panes.slice(1).map((pane) => pane.id),
    );
    expect(fake.start).toHaveBeenCalledOnce();
  });

  it('never runs an unseen command from an open-time basis and refreshes its panel for review', async () => {
    const catalog = structuredClone(getState().bootstrap.definitions!);
    catalog.definitions[0]!.planes[0]!.plane = { kind: 'terminal', path: panes[0]!.path };
    update({ ...getState(), bootstrap: { ...getState().bootstrap, definitions: catalog } });
    const current = structuredClone(catalog);
    current.definitions[0]!.basis = 'current-basis';
    current.definitions[0]!.planes[0]!.plane = {
      kind: 'terminal',
      path: panes[0]!.path,
      command: 'echo current',
    };
    vi.mocked(window.viewer.workspaceDefinitionFile).mockResolvedValue(current);
    const view = await show(true);
    const missing = view.getByRole('region', { name: 'Command terminal 1: Command unavailable' });
    expect(missing.querySelector('code')).toBeNull();
    expect(view.getByRole('button', { name: 'Run' }).hasAttribute('disabled')).toBe(true);
    expect(missing.querySelector('[role="status"]')!.textContent).toContain('no longer available');
    expect(view.queryByRole('button', { name: 'Run Command unavailable' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Run all 3 commands' }));
    await waitFor(() => expect(fake.all).toHaveBeenCalledOnce());
    expect(fake.all.mock.calls[0]![0].map((item) => item.plane)).toEqual([1, 2]);
    expect(fake.start).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(view.getByRole('button', { name: 'Run echo current' })).toBeDefined(),
    );
    expect(view.getByRole('alert').textContent).toBe('Review the command before running it.');
  });

  it('focuses the first successfully started plane after Run all', async () => {
    fake.all.mockImplementation(async (items) =>
      items.map((item, index) => ({
        ...item,
        terminalID: item.request.id,
        kind: index === 0 ? 'failed' : 'started',
        message: 'Refused first plane.',
      })),
    );
    const view = await show(true);
    view.getByRole('button', { name: 'Run all 3 commands' }).focus();
    fireEvent.click(view.getByRole('button', { name: 'Run all 3 commands' }));
    await waitFor(() => expect(fake.focus).toHaveBeenCalledWith(panes[1]!.id));
    await waitFor(() =>
      expect(document.activeElement).toBe(view.getByTestId('terminal-' + panes[1]!.id)),
    );
  });

  it('focuses the workspace when Run all starts no planes', async () => {
    fake.all.mockImplementation(async (items) =>
      items.map((item) => ({
        ...item,
        terminalID: item.request.id,
        kind: 'declined',
      })),
    );
    const view = await show();
    view.getByRole('button', { name: 'Run all 3 commands' }).focus();
    fireEvent.click(view.getByRole('button', { name: 'Run all 3 commands' }));
    await waitFor(() => expect(fake.all).toHaveBeenCalledOnce());
    expect(fake.all.mock.calls[0]![0].map((item) => item.request.id)).toEqual(
      panes.map((pane) => pane.id),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(view.container.querySelector('.workspace-surface')),
    );
    expect(view.getByRole('button', { name: 'Run all 3 commands' })).toBeDefined();
    expect(view.getByRole('button', { name: 'Run echo sample-0' }).hasAttribute('disabled')).toBe(
      false,
    );
    expect(fake.start).not.toHaveBeenCalled();
    expect(fake.started).not.toHaveBeenCalled();
    expect(view.queryByTestId('terminal-' + panes[0]!.id)).toBeNull();
    expect(fake.focus).not.toHaveBeenCalled();
  });

  it('waits for offscreen command inspection before exercising a declined Run all', async () => {
    const inspect = fake.inspect.getMockImplementation()!;
    let release!: () => void;
    const offscreen = new Promise<void>((resolve) => {
      release = resolve;
    });
    fake.inspect.mockImplementation(async (request, reference) => {
      if (reference.plane !== 0) await offscreen;
      return inspect(request, reference);
    });
    fake.all.mockImplementation(async (items) =>
      items.map((item) => ({ ...item, terminalID: item.request.id, kind: 'declined' })),
    );
    let ready = false;
    const showing = show().then((view) => {
      ready = true;
      return view;
    });
    try {
      await waitFor(() =>
        expect(document.querySelector('.definition-command-line')?.textContent).toBe(
          'echo sample-0',
        ),
      );
      await waitFor(() => expect(fake.inspect).toHaveBeenCalledTimes(3));
      await act(async () => {});
      expect(ready).toBe(false);
    } finally {
      await act(async () => {
        release();
        await showing;
      });
    }
    const view = await showing;
    fireEvent.click(view.getByRole('button', { name: 'Run all 3 commands' }));
    await waitFor(() => expect(fake.all).toHaveBeenCalledOnce());
    expect(fake.all.mock.calls[0]![0]).toHaveLength(3);
    await waitFor(() =>
      expect(document.activeElement).toBe(view.container.querySelector('.workspace-surface')),
    );
    expect(view.getByRole('button', { name: 'Run all 3 commands' })).toBeDefined();
    expect(fake.start).not.toHaveBeenCalled();
    expect(fake.started).not.toHaveBeenCalled();
    expect(view.queryByTestId('terminal-' + panes[0]!.id)).toBeNull();
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

  it('offers and runs an edited command from the current catalog without moving the open pane', async () => {
    const view = await show();
    const catalog = structuredClone(getState().bootstrap.definitions!);
    catalog.revision++;
    catalog.definitions[0]!.basis = 'current-command';
    catalog.definitions[0]!.planes[0]!.plane = {
      kind: 'terminal',
      path: panes[0]!.path,
      command: 'echo current',
    };
    act(() =>
      update({ ...getState(), bootstrap: { ...getState().bootstrap, definitions: catalog } }),
    );
    await waitFor(() =>
      expect(view.getByRole('button', { name: 'Run echo current' })).toBeDefined(),
    );
    expect(view.queryByRole('button', { name: 'Run echo sample-0' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Run echo current' }));
    await waitFor(() => expect(fake.start).toHaveBeenCalledOnce());
    expect(fake.start).toHaveBeenCalledWith(requestFor(panes[0]!), {
      key: 'sample/site',
      plane: 0,
      basis: 'current-command',
    });
    expect(activeWorkspace().panes[0]!.path).toBe(panes[0]!.path);
  });

  it('marks swapped command folders changed, offers Reset and Shell only, and skips them in Run all', async () => {
    panes[0]!.path = '/projects/one';
    panes[1]!.path = '/projects/two';
    const initial = structuredClone(getState().bootstrap.definitions!);
    initial.definitions[0]!.planes[0]!.plane = {
      kind: 'terminal',
      path: panes[0]!.path,
      command: 'echo sample-0',
    };
    initial.definitions[0]!.planes[1]!.plane = {
      kind: 'terminal',
      path: panes[1]!.path,
      command: 'echo sample-1',
    };
    update({ ...getState(), bootstrap: { ...getState().bootstrap, definitions: initial } });
    savePatch({ workspaces: [workspace] });
    const view = await show(true);
    const catalog = structuredClone(initial);
    catalog.revision++;
    catalog.definitions[0]!.basis = 'swapped';
    const entries = catalog.definitions[0]!.planes;
    [entries[0]!.plane, entries[1]!.plane] = [entries[1]!.plane, entries[0]!.plane];
    vi.mocked(window.viewer.workspaceDefinitionFile).mockResolvedValue(catalog);
    act(() =>
      update({ ...getState(), bootstrap: { ...getState().bootstrap, definitions: catalog } }),
    );
    await waitFor(() =>
      expect(view.getAllByRole('button', { name: 'Reset to definition…' })).toHaveLength(2),
    );
    expect(view.getAllByText('This terminal changed in the definition.')).toHaveLength(2);
    expect(view.queryByRole('button', { name: 'Run echo sample-0' })).toBeNull();
    expect(view.queryByRole('button', { name: 'Run echo sample-1' })).toBeNull();
    expect(view.getAllByRole('button', { name: 'Shell only' })).toHaveLength(3);
    fireEvent.click(view.getByRole('button', { name: 'Run all 3 commands' }));
    await waitFor(() => expect(fake.start).toHaveBeenCalledOnce());
    expect(fake.start).toHaveBeenCalledWith(requestFor(panes[2]!), {
      key: 'sample/site',
      plane: 2,
      basis: 'swapped',
    });
    expect(fake.all).not.toHaveBeenCalled();
    expect(fake.session).toHaveBeenCalledOnce();
    expect(view.getAllByRole('alert').map((item) => item.textContent)).toEqual([
      'This terminal changed in the definition.',
      'This terminal changed in the definition.',
    ]);
    expect(activeWorkspace().panes.map((pane) => pane.path)).toEqual(
      panes.map((pane) => pane.path),
    );
  });

  it('marks a changed terminal profile changed, offers Reset and Shell only, and skips it in Run all', async () => {
    const view = await show(true);
    const catalog = structuredClone(getState().bootstrap.definitions!);
    catalog.revision++;
    catalog.definitions[0]!.basis = 'changed-profile';
    catalog.definitions[0]!.planes[0]!.plane = {
      kind: 'terminal',
      path: panes[0]!.path,
      command: 'echo sample-0',
      profileID: 'other',
    };
    vi.mocked(window.viewer.workspaceDefinitionFile).mockResolvedValue(catalog);
    act(() =>
      update({ ...getState(), bootstrap: { ...getState().bootstrap, definitions: catalog } }),
    );
    await waitFor(() =>
      expect(view.getByRole('button', { name: 'Reset to definition…' })).toBeDefined(),
    );
    expect(view.getByText('This terminal changed in the definition.')).toBeDefined();
    expect(view.queryByRole('button', { name: 'Run echo sample-0' })).toBeNull();
    expect(view.getAllByRole('button', { name: 'Shell only' })).toHaveLength(3);
    fireEvent.click(view.getByRole('button', { name: 'Run all 3 commands' }));
    await waitFor(() => expect(fake.all).toHaveBeenCalledOnce());
    expect(fake.all).toHaveBeenCalledWith(
      panes.slice(1).map((pane) => ({
        request: requestFor(pane),
        key: 'sample/site',
        plane: pane.definitionPlane,
        basis: 'changed-profile',
      })),
    );
    expect(fake.start).not.toHaveBeenCalled();
    expect(fake.session.mock.calls.map(([request]) => request.id)).toEqual(
      panes.slice(1).map((pane) => pane.id),
    );
    expect(view.getByRole('alert').textContent).toBe('This terminal changed in the definition.');
    expect(
      activeWorkspace().panes.map((pane) => pane.type === 'terminal' && pane.profileID),
    ).toEqual(['login', 'login', 'login']);
  });

  it('opens the existing Reset confirmation when the indexed plane is no longer a terminal', async () => {
    const catalog = structuredClone(getState().bootstrap.definitions!);
    catalog.definitions[0]!.planes[0]!.plane = { kind: 'folder', path: panes[0]!.path };
    update({ ...getState(), bootstrap: { ...getState().bootstrap, definitions: catalog } });
    const view = await show();
    expect(view.queryByRole('button', { name: 'Run echo sample-0' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Reset to definition…' }));
    await waitFor(() =>
      expect(view.getByRole('dialog', { name: 'Reset to definition?' })).toBeDefined(),
    );
    expect(fake.start).not.toHaveBeenCalled();
    expect(fake.all).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'X6: waits for the existing approval after reload without offering a start (approve: %s)',
    async (approve) => {
      let finish!: (status: TerminalStatus) => void;
      const result = new Promise<TerminalStatus>((resolve) => {
        finish = resolve;
      });
      fake.status.mockImplementation(async (request, wait) => {
        if (request.id !== panes[0]!.id) return { kind: 'stopped' };
        return wait ? result : { kind: 'starting' };
      });
      const view = await show();
      expect(view.getByText('Waiting for terminal approval…')).toBeDefined();
      expect(view.queryByRole('button', { name: 'Run echo sample-0' })).toBeNull();
      expect(view.queryByRole('button', { name: 'Shell only' })).toBeNull();
      expect(view.getByRole('button', { name: 'Run all 2 commands' })).toBeDefined();
      expect(fake.session).toHaveBeenCalledOnce();
      await act(async () => {
        finish({ kind: approve ? 'running' : 'stopped' });
      });
      if (approve)
        await waitFor(() => expect(view.getByTestId('terminal-' + panes[0]!.id)).toBeDefined());
      else
        await waitFor(() =>
          expect(view.getByRole('button', { name: 'Run echo sample-0' })).toBeDefined(),
        );
      expect(fake.start).not.toHaveBeenCalled();
      expect(fake.all).not.toHaveBeenCalled();
    },
  );
});
