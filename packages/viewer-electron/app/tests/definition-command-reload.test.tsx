// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { TerminalPane, Workspace } from '../src/domain/contracts';
import type { TerminalStart } from '../src/domain/automation/actions';
import type { WorkspaceController } from '../src/renderer/workspace/context';

const fake = vi.hoisted(() => ({
  start: vi.fn(async (_request: TerminalStart) => {}),
  running: vi.fn(async (_request: TerminalStart) => false),
  session: vi.fn(async () => ({
    terminal: { cols: 80, rows: 24 },
    input: '',
    started: false,
    park: vi.fn(),
  })),
  started: vi.fn(async (_id: string, session: { started: boolean }) => {
    session.started = true;
  }),
}));
vi.mock('../src/renderer/state/persistence', async (original) => ({
  ...(await original<object>()),
  flushState: vi.fn(async () => {}),
}));
vi.mock('../src/renderer/terminals/sessions', () => ({
  terminalSession: fake.session,
  terminalStarted: fake.started,
  trimTerminals: vi.fn(),
}));
vi.mock('../src/renderer/terminals/TerminalPlane', () => ({
  TerminalPlane: ({ pane }: { pane: TerminalPane }) => (
    <div data-testid={'terminal-' + pane.id}>Shell</div>
  ),
}));
import { DefinitionTerminal } from '../src/renderer/terminals/DefinitionTerminal';
import { WorkspaceDefinitionCommands } from '../src/renderer/workspace/WorkspaceDefinitionCommands';
import { WorkspaceContext } from '../src/renderer/workspace/context';
import { getState, initialize } from '../src/renderer/state/store';
import { savePatch, update } from '../src/renderer/state/core';
import { sampleDefinition, sampleWorkspace } from './workspace-definition-fixtures';
import type { DefinitionCommandReference } from '../src/domain/terminals/definition-commands';

afterEach(cleanup);

// A module reload needs its own file so shuffled tests cannot retain two renderer stores.
it('a fresh renderer after Run reattaches the still-running shell and excludes it from Run all', async () => {
  const panes: TerminalPane[] = [0, 1, 2].map((plane) => ({
    id: 'command-' + plane,
    type: 'terminal',
    path: '/projects/sample',
    profileID: 'login',
    definitionPlane: plane,
    startOnOpen: false,
  }));
  const definition = sampleDefinition('sample/site', {
    basis: 'shown-basis',
    planes: panes.map((pane, index) => ({
      index,
      plane: { kind: 'terminal', path: pane.path, command: 'echo sample-' + index },
    })),
  });
  const workspace: Workspace = sampleWorkspace('commands', {
    panes,
    roots: panes.map((pane) => pane.id),
    definition: { key: definition.key, basis: definition.basis },
  });
  const controller = {
    rootID: (id: string) => id,
    focusPane: vi.fn(),
  } as unknown as WorkspaceController;
  Object.assign(window, {
    viewer: {
      save: vi.fn(async () => {}),
      terminalStart: fake.start,
      terminalStatus: vi.fn(async (request: TerminalStart) => ({
        kind: (await fake.running(request)) ? 'running' : 'stopped',
      })),
      terminalDefinitionCommand: vi.fn(
        async (request: TerminalStart, reference: DefinitionCommandReference) => ({
          kind: 'available',
          command: 'echo sample-' + reference.plane,
          cwd: request.cwd,
          reference,
        }),
      ),
    },
  });
  initialize({
    home: '/home/sample',
    platform: 'darwin',
    locations: [],
    state: null,
    openPaths: [],
  });
  update({
    ...getState(),
    bootstrap: {
      ...getState().bootstrap,
      definitions: {
        revision: 1,
        definitions: [definition],
        diagnostics: [],
        file: { path: '/data/workspaces.jsonc', state: 'read' },
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
  const view = render(
    createElement(
      WorkspaceContext.Provider,
      { value: controller },
      <>
        <WorkspaceDefinitionCommands />
        <DefinitionTerminal pane={panes[0]!} />
      </>,
    ),
  );
  const run = await view.findByRole('button', { name: 'Run echo sample-0' });
  fireEvent.click(run);
  await waitFor(() => expect(fake.started).toHaveBeenCalledOnce());
  await view.findByTestId('terminal-' + panes[0]!.id);
  const saved = structuredClone(getState().saved);
  const bootstrap = getState().bootstrap;
  const starts = fake.start.mock.calls.length;
  const sessions = fake.session.mock.calls.length;
  view.unmount();
  vi.resetModules();
  fake.running.mockImplementation(async (request) => request.id === panes[0]!.id);
  const fresh = await import('../src/renderer/state/store');
  fresh.initialize({ ...bootstrap, state: saved });
  const { DefinitionTerminal: ReloadedTerminal } =
    await import('../src/renderer/terminals/DefinitionTerminal');
  const { WorkspaceContext: ReloadedContext } = await import('../src/renderer/workspace/context');
  const { WorkspaceDefinitionCommands: ReloadedNotice } =
    await import('../src/renderer/workspace/WorkspaceDefinitionCommands');
  const reloaded = render(
    createElement(
      ReloadedContext.Provider,
      { value: controller },
      <>
        <ReloadedNotice />
        <ReloadedTerminal pane={panes[0]!} />
      </>,
    ),
  );
  await reloaded.findByTestId('terminal-' + panes[0]!.id);
  expect(reloaded.queryByText('Command not started')).toBeNull();
  expect(reloaded.getByRole('button', { name: 'Run all 2 commands' })).toBeDefined();
  expect(fake.start).toHaveBeenCalledTimes(starts);
  expect(fake.session).toHaveBeenCalledTimes(sessions + 1);
});
