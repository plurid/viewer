import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DefinitionCatalog } from '../src/domain/workspaces/definitions/schema';
import type { WindowActions } from '../src/renderer/commands/window-commands/scope';
import { windowScopes } from '../src/renderer/commands/window-commands/scope';
import { workspacesCommands } from '../src/renderer/commands/window-commands/workspaces';
import { catalogCommands } from '../src/renderer/commands/window-commands/catalog';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { paletteRows, workspaceRows } from '../src/renderer/commands/palette-sections';
import { contextMenuSections } from '../src/renderer/commands/menu';
import { rankWorkspaceChoices } from '../src/domain/workspaces/definitions/query';
import { activeWorkspace, getState, initialize } from '../src/renderer/state/store';
import { deleteWorkspace } from '../src/renderer/state/workspaces';
import { flushState } from '../src/renderer/state/persistence';
import { sampleDefinition } from './workspace-definition-fixtures';

const definition = sampleDefinition('sample');
let catalog: DefinitionCatalog;
beforeEach(() => {
  vi.stubGlobal('window', {
    dispatchEvent: vi.fn(),
    viewer: { save: vi.fn(async () => {}), workspaceClaim: vi.fn(async () => true) },
  });
  initialize({
    home: '/home/sample',
    platform: 'darwin',
    state: null,
    openPaths: [],
    locations: [],
  });
  const space = {
    ...activeWorkspace(),
    name: 'Sample',
    definition: { key: definition.key, basis: definition.basis },
  };
  catalog = {
    revision: 1,
    file: { path: '/data/workspaces.jsonc', state: 'read' },
    projectManager: {
      path: '/source/projects.json',
      state: 'read',
      enabled: true,
      projects: 0,
      disabled: 0,
      remote: 0,
      missing: 0,
      duplicateKeys: 0,
    },
    definitions: [definition],
    diagnostics: [],
  };
  initialize({
    ...getState().bootstrap,
    state: { ...getState().saved, workspaces: [space] },
    definitions: catalog,
  });
});
afterEach(async () => {
  await flushState(false);
  vi.unstubAllGlobals();
});
const actions = () =>
  ({
    ready: true,
    workspaceDialog: vi.fn(),
    switchWorkspace: vi.fn(async () => {}),
  }) as unknown as WindowActions;
const context = () => ({
  scope: 'window' as const,
  workspaceID: activeWorkspace().id,
  selection: [],
  jobs: [],
  clipboard: null,
});

it('both Delete guards refuse a defined workspace with a usable definition', async () => {
  const commands = workspacesCommands(windowScopes(actions()));
  expect(commands.find((item) => item.id === 'delete-workspace')!.when(context())).toBe(false);
  await expect(deleteWorkspace(activeWorkspace().id)).rejects.toThrow('Close it');
  expect(getState().saved.workspaces[0]!.definition).toEqual({
    key: definition.key,
    basis: definition.basis,
  });
});

it('allows Delete and Save as when a valid catalog confirms the linked key was removed', async () => {
  initialize({
    ...getState().bootstrap,
    state: getState().saved,
    definitions: { ...catalog, definitions: [] },
  });
  const scopes = windowScopes(actions());
  const commands = workspacesCommands(scopes);
  expect(commands.find((item) => item.id === 'delete-workspace')!.when(context())).toBe(true);
  expect(commands.find((item) => item.id === 'save-workspace-as-definition')!.when(context())).toBe(
    true,
  );
  expect(catalogCommands(scopes).find((item) => item.id.startsWith('workspace:'))!.detail).toBe(
    'Its definition was removed from workspaces.jsonc.',
  );
  await deleteWorkspace(activeWorkspace().id);
  expect(getState().deletedWorkspace?.workspace.definition?.key).toBe(definition.key);
});

it('allows a removed standalone workspace to be deleted while Project Manager is unused', async () => {
  const space = activeWorkspace();
  initialize({
    ...getState().bootstrap,
    state: {
      ...getState().saved,
      workspaces: [
        {
          ...space,
          definition: { ...space.definition!, source: 'standalone' },
        },
      ],
    },
    definitions: {
      ...catalog,
      definitions: [],
      projectManager: { ...catalog.projectManager, state: 'off', enabled: false },
    },
  });
  const scopes = windowScopes(actions());
  const commands = workspacesCommands(scopes);
  expect(commands.find((item) => item.id === 'delete-workspace')!.when(context())).toBe(true);
  expect(commands.find((item) => item.id === 'save-workspace-as-definition')!.when(context())).toBe(
    true,
  );
  expect(catalogCommands(scopes).find((item) => item.id.startsWith('workspace:'))!.detail).toBe(
    'Its definition was removed from workspaces.jsonc.',
  );
  await deleteWorkspace(activeWorkspace().id);
});

it.each(['undecided', 'off', 'absent'] as const)(
  'keeps Close available and Delete refused while the project source is %s',
  async (state) => {
    const link = activeWorkspace().definition;
    initialize({
      ...getState().bootstrap,
      state: getState().saved,
      definitions: {
        ...catalog,
        projectManager: {
          ...catalog.projectManager,
          state,
          enabled: state === 'off' ? false : undefined,
        },
        definitions: [],
      },
    });
    const scopes = windowScopes(actions());
    const commands = workspacesCommands(scopes);
    expect(commands.find((item) => item.id === 'delete-workspace')!.when(context())).toBe(false);
    expect(commands.find((item) => item.id === 'close-workspace')!.when(context())).toBe(true);
    await expect(deleteWorkspace(activeWorkspace().id)).rejects.toThrow('Close it');
    expect(catalogCommands(scopes).find((item) => item.id.startsWith('workspace:'))!.detail).toBe(
      state === 'undecided'
        ? 'VS Code Project Manager is not in use. Choose Use VS Code projects in Manage workspaces to restore its projects.'
        : state === 'off'
          ? 'VS Code Project Manager is not in use. Turn it on in Settings → Configuration → Workspace definitions.'
          : 'VS Code Project Manager’s list was not found. This workspace keeps its definition link.',
    );
    initialize({ ...getState().bootstrap, state: getState().saved, definitions: catalog });
    expect(activeWorkspace().definition).toEqual(link);
    expect(
      catalogCommands(windowScopes(actions())).find((item) => item.id.startsWith('workspace:'))!
        .detail,
    ).toBe(definition.key);
  },
);

it.each(['last-valid', 'unreadable'] as const)(
  'keeps the link protected while the file is %s',
  async (state) => {
    initialize({
      ...getState().bootstrap,
      state: getState().saved,
      definitions: { ...catalog, file: { ...catalog.file, state }, definitions: [] },
    });
    const commands = workspacesCommands(windowScopes(actions()));
    expect(
      commands.find((item) => item.id === 'save-workspace-as-definition')!.when(context()),
    ).toBe(false);
    await expect(deleteWorkspace(activeWorkspace().id)).rejects.toThrow('Close it');
  },
);

it('places an executable Reset action next to the changed row in both palettes and the switcher', async () => {
  initialize({
    ...getState().bootstrap,
    state: getState().saved,
    definitions: { ...catalog, definitions: [{ ...definition, basis: 'b'.repeat(64) }] },
  });
  const host = actions();
  const registry = new CommandRegistry();
  registry.register('window', { context, definitions: () => catalogCommands(windowScopes(host)) });
  const commands = registry.list({ scope: 'window' });
  const space = activeWorkspace();
  const choices = rankWorkspaceChoices([space], catalog.definitions, 'sample');
  const resetID = 'reset-definition:' + space.id;
  for (const view of [
    workspaceRows(commands, choices, 'sample', 1),
    paletteRows(commands, 'sample', [], choices),
    paletteRows(commands, 's', [], choices),
  ]) {
    const index = view.rows.findIndex((item) => item.id === 'workspace:' + space.id);
    expect(view.rows[index + 1]!.id).toBe(resetID);
  }
  const switcher = contextMenuSections(commands, [], false, [], [], ['workspace:' + space.id]);
  expect(switcher[0]!.entries.map((item) => item.id)).toEqual(['workspace:' + space.id, resetID]);
  await expect(
    registry.invoke(resetID, { context: { ...context(), invocation: 'custom-action' } }),
  ).rejects.toThrow('Choose it directly');
  expect(host.workspaceDialog).not.toHaveBeenCalled();
  expect(await registry.run(commands.find((item) => item.id === resetID)!)).toBe(true);
  expect(host.workspaceDialog).toHaveBeenCalledExactlyOnceWith('reset');
});

it('offers Close and Reset for found workspaces while Save has no written entry', () => {
  const space = activeWorkspace();
  initialize({
    ...getState().bootstrap,
    state: {
      ...getState().saved,
      workspaces: [{ ...space, definition: { ...space.definition!, source: 'found' } }],
    },
    definitions: { ...catalog, definitions: [{ ...definition, source: 'found' }] },
  });
  const commands = workspacesCommands(windowScopes(actions()));
  expect(commands.find((item) => item.id === 'close-workspace')!.when(context())).toBe(true);
  expect(commands.find((item) => item.id === 'reset-workspace')!.when(context())).toBe(true);
  expect(commands.find((item) => item.id === 'save-workspace-definition')!.when(context())).toBe(
    false,
  );
});
