import { expect, it } from 'vitest';
import { agentWorkspaceCopy } from '../src/domain/agents/requests';
import {
  withDefinitionOrigins,
  uniqueDefinitionLinks,
  definitionSourceNotice,
  definitionWasRemoved,
} from '../src/domain/workspaces/catalog';
import { buildDefinition } from '../src/domain/workspaces/definitions/build';
import { sampleDefinition, sampleWorkspace } from './workspace-definition-fixtures';
import type {
  DefinitionCatalog,
  WorkspaceDefinitionSource,
} from '../src/domain/workspaces/definitions/schema';
import { workspaceSchema } from '../src/desktop/persistence/storage';
import { stateSchema } from '../src/desktop/persistence/storage';
import { restoreBackupState } from '../src/desktop/persistence/backup-state';

const catalog = (source: WorkspaceDefinitionSource): DefinitionCatalog => ({
  revision: 1,
  file: { path: '/data/workspaces.jsonc', state: 'read' },
  projectManager: {
    path: '/source/projects.json',
    state: 'off',
    enabled: false,
    projects: 0,
    missing: 0,
    disabled: 0,
    remote: 0,
    duplicateKeys: 0,
  },
  found: { state: 'ready', count: 0, hidden: 0 },
  definitions: [sampleDefinition('sample', { source })],
  diagnostics: [],
});
it.each(['project-manager', 'override', 'standalone', 'found'] as const)(
  'records and validates link origin for %s',
  (source) => {
    const definition = sampleDefinition('sample', { source });
    const space = buildDefinition(definition, {
      home: '/Users/sample',
      terminalProfile: 'login',
      id: () => 'fresh',
      folder: (path) => ({
        id: 'folder',
        type: 'folder',
        path,
        mode: 'list',
        sort: 'name',
        descending: false,
        showHidden: false,
        history: [path],
        historyIndex: 0,
      }),
      scratch: (path) => ({ id: 'scratch', type: 'scratch', path, bufferID: 'scratch' }),
    });
    expect(space.definition!.source).toBe(source);
    expect(workspaceSchema.parse(space).definition!.source).toBe(source);
  },
);
it('migrates known links from the catalog and conservatively keeps an unknown origin', () => {
  const known = sampleWorkspace('known', { definition: { key: 'sample', basis: 'a'.repeat(64) } });
  const unknown = sampleWorkspace('unknown', {
    definition: { key: 'unknown', basis: 'a'.repeat(64) },
  });
  const [migrated, kept] = withDefinitionOrigins([known, unknown], catalog('standalone'));
  expect(migrated!.definition!.source).toBe('standalone');
  expect(kept!.definition!.source).toBeUndefined();
  const absent = { ...catalog('standalone'), definitions: [] };
  expect(definitionWasRemoved(migrated!, absent)).toBe(true);
  expect(definitionWasRemoved(kept!, absent)).toBe(false);
  expect(definitionSourceNotice(migrated!, absent)).toBeUndefined();
});
it('waits for finding to finish before reporting that a found root went away', () => {
  const space = sampleWorkspace('found', {
    definition: { key: 'missing', basis: 'a'.repeat(64), source: 'found' },
  });
  const absent = { ...catalog('found'), definitions: [] };
  expect(definitionSourceNotice(space, absent)).toBe('Viewer no longer finds this folder.');
  expect(definitionWasRemoved(space, absent)).toBe(true);
  const loading = { ...absent, found: { state: 'loading' as const, count: 0, hidden: 0 } };
  expect(definitionWasRemoved(space, loading)).toBe(false);
  expect(definitionSourceNotice(space, loading)).toBeUndefined();
});
it('strips origins with the whole link from agent copies and duplicate repairs', () => {
  const space = sampleWorkspace('one', {
    definition: { key: 'sample', basis: 'a'.repeat(64), source: 'found' },
    panes: [
      {
        id: 'terminal',
        type: 'terminal',
        path: '/projects/sample',
        profileID: 'login',
        definitionPlane: 0,
      },
    ],
  });
  expect(
    agentWorkspaceCopy({
      ...space,
      panes: space.panes.map((pane) => ({ id: pane.id, type: pane.type, path: pane.path })),
    }),
  ).not.toHaveProperty('definition');
  const duplicate = uniqueDefinitionLinks([space, { ...space, id: 'two' }])[1]!;
  expect(duplicate).not.toHaveProperty('definition');
  expect(duplicate.panes[0]).not.toHaveProperty('definitionPlane');
});

it('backup restores drop a found link and its terminal indexes, without found catalog data', () => {
  const space = sampleWorkspace('one', {
    definition: { key: 'sample', basis: 'a'.repeat(64), source: 'found' },
    panes: [
      {
        id: 'terminal',
        type: 'terminal',
        path: '/projects/sample',
        profileID: 'login',
        definitionPlane: 0,
      },
    ],
  });
  const state = stateSchema.parse({
    version: 13,
    activeWorkspace: space.id,
    workspaces: [space],
    favorites: [],
    recents: [],
    look: 'dark',
  });
  const restored = restoreBackupState(state, new Map(), []);
  expect(restored.workspaces[0]!.definition).toBeUndefined();
  expect(restored.workspaces[0]!.panes[0]).not.toHaveProperty('definitionPlane', 0);
  expect(JSON.stringify(restored)).not.toContain('found-workspaces');
});
