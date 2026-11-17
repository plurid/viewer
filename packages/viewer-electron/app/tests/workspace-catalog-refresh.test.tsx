// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { CommandPalette } from '../src/renderer/commands/CommandPalette';
import { CommandsContext } from '../src/renderer/commands/context';
import { CommandRegistry } from '../src/renderer/commands/registry';
import type { CommandContext } from '../src/renderer/commands/registry';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { WorkspaceContext } from '../src/renderer/workspace/context';
import { activeWorkspace, getState, initialize } from '../src/renderer/state/store';
import { sampleDefinition } from './workspace-definition-fixtures';

afterEach(cleanup);
it.each(['commands', 'workspaces'] as const)(
  'requests the catalog when %s opens and keeps refusals quiet',
  async (mode) => {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open');
    };
    const refresh = vi.fn(async () => {
      throw new Error('Workspace definitions are available only to the person.');
    });
    Object.assign(window, {
      viewer: {
        save: vi.fn(async () => {}),
        list: vi.fn(async () => ({ entries: [] })),
        workspaceDefinitionFile: refresh,
        onEvent: () => () => {},
      },
    });
    initialize({
      home: '/fixtures',
      platform: 'darwin',
      state: null,
      locations: [],
      openPaths: [],
      definitions: {
        revision: 1,
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
        definitions: [sampleDefinition()],
        diagnostics: [],
      },
    });
    const registry = new CommandRegistry();
    const context: CommandContext = {
      scope: 'window',
      workspaceID: activeWorkspace().id,
      paneID: activeWorkspace().panes[0]!.id,
      rootID: 'none',
      directory: '/fixtures',
      selection: [],
      jobs: [],
      clipboard: null,
    };
    registry.register('window', { context: () => context, definitions: () => [] });
    const view = render(
      <CommandsContext.Provider value={registry}>
        <WorkspaceContext.Provider value={{} as WorkspaceController}>
          <CommandPalette mode={mode} onMode={() => {}} onClose={() => {}} />
        </WorkspaceContext.Provider>
      </CommandsContext.Provider>,
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(view.queryByText('Workspace definitions are available only to the person.')).toBeNull();
    expect(getState().notice).toBeNull();
  },
);
