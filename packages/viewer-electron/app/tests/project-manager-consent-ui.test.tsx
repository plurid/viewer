// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type {
  DefinitionCatalog,
  ProjectManagerReadState,
  WorkspaceDefinitionFileRequest,
} from '../src/domain/workspaces/definitions/schema';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import type { WindowDialog } from '../src/renderer/app/WindowDialogs';
import { WindowDialogs } from '../src/renderer/app/WindowDialogs';
import { WorkspaceContext } from '../src/renderer/workspace/context';
import { CommandsContext } from '../src/renderer/commands/context';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { CommandPalette } from '../src/renderer/commands/CommandPalette';
import { WorkspacesDialog } from '../src/renderer/ui/workspace/WorkspacesDialog';
import { WorkspaceDefinitionsSettings } from '../src/renderer/ui/settings/WorkspaceDefinitionsSettings';
import { projectManagerConsentText } from '../src/renderer/ui/workspace/ProjectManagerOffer';
import { activeWorkspace, getState, initialize } from '../src/renderer/state/store';
import { flushState } from '../src/renderer/state/persistence';
import { sampleDefinition } from './workspace-definition-fixtures';

function catalog(state: ProjectManagerReadState): DefinitionCatalog {
  return {
    revision: 1,
    file: { path: '/data/workspaces.jsonc', state: 'read' },
    projectManager: {
      path: '/source/projects.json',
      state,
      enabled:
        state === 'off'
          ? false
          : ['read', 'needs-access', 'unreadable'].includes(state)
            ? true
            : undefined,
      projects: state === 'read' ? 1 : 0,
      disabled: 0,
      missing: 0,
      remote: 0,
      duplicateKeys: 0,
    },
    definitions: state === 'read' ? [sampleDefinition()] : [],
    diagnostics: [],
  };
}

function setup(state: ProjectManagerReadState = 'undecided') {
  let current = catalog(state);
  const request = vi.fn(async (input: WorkspaceDefinitionFileRequest) => {
    if (input.kind === 'project-manager')
      current = { ...catalog(input.enabled ? 'read' : 'off'), revision: current.revision + 1 };
    return current;
  });
  Object.assign(window, {
    viewer: {
      save: vi.fn(async () => {}),
      list: vi.fn(async () => ({ entries: [] })),
      onEvent: () => () => {},
      workspaceDefinitionFile: request,
    },
  });
  initialize({
    home: '/fixtures',
    platform: 'darwin',
    state: null,
    openPaths: [],
    locations: [],
    definitions: current,
  });
  const registry = new CommandRegistry();
  registry.register('window', {
    context: () => ({
      scope: 'window',
      workspaceID: activeWorkspace().id,
      paneID: activeWorkspace().panes[0]!.id,
      rootID: 'none',
      directory: '/fixtures',
      selection: [],
      jobs: [],
      clipboard: null,
    }),
    definitions: () => [],
  });
  return { request, registry };
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(async () => {
  cleanup();
  await flushState(false);
});

it.each([true, false])(
  'Manage offers an undecided list only on Defined and persists the choice (%s)',
  async (enabled) => {
    const f = setup();
    const view = render(
      <WorkspacesDialog onClose={() => {}} onOpen={async () => {}} onAction={() => {}} />,
    );
    expect(view.queryByText(projectManagerConsentText)).toBeNull();
    expect(getState().notice).toBeNull();
    fireEvent.click(view.getByRole('tab', { name: 'Defined (0)' }));
    expect(view.getByText(projectManagerConsentText)).toBeTruthy();
    expect(view.queryByText(/0 VS Code projects/)).toBeNull();
    const use = view.getByRole('button', { name: 'Use VS Code projects' });
    expect(use.className).toContain('primary');
    fireEvent.click(enabled ? use : view.getByRole('button', { name: 'Don’t use' }));
    await waitFor(() =>
      expect(f.request).toHaveBeenCalledWith({ kind: 'project-manager', enabled }),
    );
    await waitFor(() => expect(view.queryByText(projectManagerConsentText)).toBeNull());
    expect(view.getByRole('tab', { name: 'Defined (' + (enabled ? 1 : 0) + ')' })).toBeTruthy();
  },
);

it('Settings starts off without a project count, then its switch decides in both directions', async () => {
  const f = setup();
  const view = render(<WorkspaceDefinitionsSettings />);
  await waitFor(() => expect(view.getByText(projectManagerConsentText)).toBeTruthy());
  const toggle = view.getByRole('switch', {
    name: 'Use VS Code Project Manager projects',
  }) as HTMLInputElement;
  expect(toggle.checked).toBe(false);
  expect(view.queryByText(/0 VS Code projects/)).toBeNull();
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle.checked).toBe(true));
  expect(f.request).toHaveBeenCalledWith({ kind: 'project-manager', enabled: true });
  expect(view.queryByText(projectManagerConsentText)).toBeNull();
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle.checked).toBe(false));
  expect(f.request).toHaveBeenCalledWith({ kind: 'project-manager', enabled: false });
  expect(view.getByText('VS Code Project Manager is off.')).toBeTruthy();
});

it('the muted workspace row opens Manage on Defined without taking a decision', async () => {
  const f = setup();
  function Harness() {
    const [palette, setPalette] = useState(true);
    const [dialog, setDialog] = useState<WindowDialog>();
    return (
      <>
        {palette && (
          <CommandPalette
            mode="workspaces"
            onMode={() => {}}
            onClose={() => setPalette(false)}
            onManageDefinitions={() =>
              setDialog({
                type: 'workspace',
                kind: 'manage',
                id: activeWorkspace().id,
                tab: 'defined',
              })
            }
          />
        )}
        <WindowDialogs
          dialog={dialog}
          onChange={setDialog}
          onClose={() => setDialog(undefined)}
          workspace={{} as WorkspaceController}
          transitionWorkspace={(change) => change()}
        />
      </>
    );
  }
  const view = render(
    <CommandsContext.Provider value={f.registry}>
      <WorkspaceContext.Provider value={{} as WorkspaceController}>
        <Harness />
      </WorkspaceContext.Provider>
    </CommandsContext.Provider>,
  );
  const offer = view.getByRole('option', { name: 'Use VS Code Project Manager’s projects…' });
  expect(offer.className).toContain('is-muted');
  expect(view.getByText('Defined')).toBeTruthy();
  fireEvent.click(offer);
  await waitFor(() =>
    expect(view.getByRole('tab', { name: 'Defined (0)' }).getAttribute('aria-selected')).toBe(
      'true',
    ),
  );
  expect(view.getByText(projectManagerConsentText)).toBeTruthy();
  expect(f.request.mock.calls.some(([input]) => input.kind === 'project-manager')).toBe(false);
});

it.each(['absent', 'off', 'read'] as const)(
  'shows no consent offer anywhere when the source is %s',
  async (state) => {
    const f = setup(state);
    const view = render(
      <CommandsContext.Provider value={f.registry}>
        <WorkspaceContext.Provider value={{} as WorkspaceController}>
          <WorkspacesDialog
            initialTab="defined"
            onClose={() => {}}
            onOpen={async () => {}}
            onAction={() => {}}
          />
          <CommandPalette
            mode="workspaces"
            onMode={() => {}}
            onClose={() => {}}
            onManageDefinitions={() => {}}
          />
          <WorkspaceDefinitionsSettings />
        </WorkspaceContext.Provider>
      </CommandsContext.Provider>,
    );
    await waitFor(() =>
      expect(view.getByRole('heading', { name: 'VS Code Project Manager' })).toBeTruthy(),
    );
    expect(view.queryByText(projectManagerConsentText)).toBeNull();
    expect(view.queryByRole('button', { name: 'Use VS Code projects' })).toBeNull();
    expect(view.queryByRole('button', { name: 'Don’t use' })).toBeNull();
    expect(
      view.queryByRole('option', { name: 'Use VS Code Project Manager’s projects…' }),
    ).toBeNull();
    if (state === 'absent')
      expect(
        view.queryByRole('switch', { name: 'Use VS Code Project Manager projects' }),
      ).toBeNull();
  },
);

it.each(['undecided', 'off'] as const)(
  'Manage keeps an unavailable project linked and offers Close while the source is %s',
  (state) => {
    setup(state);
    const definition = sampleDefinition();
    const space = {
      ...activeWorkspace(),
      name: 'Sample',
      definition: { key: definition.key, basis: definition.basis },
    };
    initialize({
      ...getState().bootstrap,
      state: { ...getState().saved, workspaces: [space] },
    });
    const view = render(
      <WorkspacesDialog onClose={() => {}} onOpen={async () => {}} onAction={() => {}} />,
    );
    expect(view.getByRole('button', { name: 'Close Sample' })).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Delete Sample' })).toBeNull();
    expect(view.getByText(/VS Code Project Manager is not in use/)).toBeTruthy();
    expect(view.queryByText(/Its definition was removed/)).toBeNull();
  },
);
