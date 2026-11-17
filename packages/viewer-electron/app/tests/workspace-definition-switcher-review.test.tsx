// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ContextMenu } from '../src/renderer/ui/ContextMenu';
import { CommandsContext } from '../src/renderer/commands/context';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { activeWorkspace, getState, initialize } from '../src/renderer/state/store';
import { flushState } from '../src/renderer/state/persistence';
import { sampleDefinition } from './workspace-definition-fixtures';

afterEach(async () => {
  cleanup();
  await flushState(false);
});
it('excludes an open definition from Recently closed even while the command catalog catches up', () => {
  Object.assign(window, { viewer: { save: vi.fn(async () => {}) } });
  initialize({
    home: '/home/sample',
    platform: 'darwin',
    state: null,
    openPaths: [],
    locations: [],
  });
  const workspace = {
    ...activeWorkspace(),
    definition: { key: 'sample/open', basis: 'a'.repeat(64) },
  };
  initialize({
    ...getState().bootstrap,
    state: { ...getState().saved, workspaces: [workspace] },
    definitions: {
      revision: 1,
      file: { path: '/data/workspaces.jsonc', state: 'read' },
      projectManager: {
        path: '/source/projects.json',
        state: 'off',
        projects: 0,
        missing: 0,
        disabled: 0,
        remote: 0,
        duplicateKeys: 0,
      },
      definitions: [
        sampleDefinition('sample/open', {
          remembered: { at: 2, basis: 'a'.repeat(64), planes: 1 },
        }),
        sampleDefinition('sample/closed', {
          remembered: { at: 1, basis: 'a'.repeat(64), planes: 1 },
        }),
      ],
      diagnostics: [],
    },
  });
  const registry = new CommandRegistry();
  registry.register('window', {
    context: () => ({
      scope: 'window',
      workspaceID: workspace.id,
      selection: [],
      jobs: [],
      clipboard: null,
    }),
    definitions: () =>
      [
        { id: 'workspace:' + workspace.id, label: 'Open workspace' },
        { id: 'defined:sample/open', label: 'Stale defined row' },
        { id: 'defined:sample/closed', label: 'Closed sample' },
      ].map((entry) => ({ ...entry, group: 'Workspaces', when: () => true, run: () => {} })),
  });
  const view = render(
    <CommandsContext.Provider value={registry}>
      <ContextMenu
        position={{ x: 10, y: 10 }}
        request={{ scope: 'window' }}
        workspaceSwitcher
        onClose={() => {}}
      />
    </CommandsContext.Provider>,
  );
  expect(view.getByRole('menuitem', { name: 'Closed sample' })).toBeTruthy();
  expect(view.queryByRole('menuitem', { name: 'Stale defined row' })).toBeNull();
});
