import { expect, it } from 'vitest';
import { contextMenuSections } from '../src/renderer/commands/menu';
import type { ResolvedCommand } from '../src/renderer/commands/registry';
import {
  maximumWorkspaces,
  mergeWorkspaceVisits,
  recentWorkspaceIDs,
} from '../src/domain/workspaces/catalog';
import { stateSchema } from '../src/desktop/persistence/storage';
import type { SavedState } from '../src/domain/contracts';

const catalog: SavedState = {
  version: 11,
  look: 'dark',
  activeWorkspace: 'workspace-0',
  favorites: [],
  recents: [],
  workspaces: Array.from({ length: maximumWorkspaces }, (_, index) => ({
    id: `workspace-${index}`,
    name: `Workspace ${index}`,
    panes: [],
    roots: [],
    arrangement: {},
  })),
  workspaceVisits: {
    'workspace-0': 1,
    'workspace-5': 50,
    'workspace-3': 30,
    'workspace-4': 40,
    'workspace-2': 20,
    'workspace-1': 10,
  },
};
it('shows only three recently closed definitions below the five recent open workspaces', () => {
  const commands = [
    ...Array.from({ length: 6 }, (_, index) => ({
      id: 'defined:sample-' + index,
      label: 'Sample ' + index,
      group: 'Workspaces',
    })),
    { id: 'workspace:open', label: 'Open', group: 'Workspaces' },
    { id: 'manage-workspaces', label: 'Manage', group: 'Workspaces' },
  ] as ResolvedCommand[];
  const sections = contextMenuSections(
    commands,
    [],
    false,
    [],
    [],
    ['workspace:open'],
    Array.from({ length: 6 }, (_, index) => 'defined:sample-' + index),
  );
  expect(sections[0]!.entries.map((row) => row.id)).toEqual(['workspace:open']);
  expect(sections[1]!.label).toBe('Recently closed');
  expect(sections[1]!.entries.map((row) => row.id)).toEqual([
    'defined:sample-0',
    'defined:sample-1',
    'defined:sample-2',
  ]);
  expect(JSON.stringify(sections)).not.toContain('defined:sample-3');
});
it('keeps a large workspace catalog out of flyouts while retaining the full command menu', () => {
  const commands = [
    ...['new-workspace', 'rename-workspace', 'manage-workspaces', 'delete-workspace'].map((id) => ({
      id,
      label: id,
      group: 'Workspaces',
    })),
    { id: 'settings', label: 'Settings', group: 'App' },
    ...catalog.workspaces.map((space) => ({
      id: `workspace:${space.id}`,
      label: space.name,
      group: 'Workspaces',
    })),
  ] as ResolvedCommand[];
  const sections = contextMenuSections(commands, [], false, [], [], recentWorkspaceIDs(catalog));
  expect(sections[0].entries.map((row) => row.id)).toEqual([
    'workspace:workspace-0',
    'workspace:workspace-5',
    'workspace:workspace-4',
    'workspace:workspace-3',
    'workspace:workspace-2',
  ]);
  expect(sections[1].entries.map((row) => row.id)).toEqual(['manage-workspaces']);
  const groups = sections
    .flatMap((section) => section.entries)
    .filter((entry) => entry.kind === 'submenu');
  expect(groups.map((group) => group.label)).toEqual(['App', 'Workspaces']);
  expect(
    groups
      .flatMap((group) => group.sections.flatMap((section) => section.entries))
      .some((row) => row.id.startsWith('workspace:')),
  ).toBe(false);
});
it('preserves recent visits and accepts 1,000 workspaces in persistent state', () => {
  expect(stateSchema.parse(catalog).workspaces).toHaveLength(1000);
  expect(
    stateSchema.safeParse({
      ...catalog,
      workspaces: [...catalog.workspaces, { ...catalog.workspaces[0], id: 'overflow' }],
    }).success,
  ).toBe(false);
  const merged = mergeWorkspaceVisits(catalog.workspaces, catalog.workspaceVisits, {
    'workspace-5': 2,
    'workspace-1': 90,
    gone: 100,
  });
  expect(merged['workspace-5']).toBe(50);
  expect(merged.gone).toBeUndefined();
  expect(recentWorkspaceIDs({ ...catalog, workspaceVisits: merged }).slice(0, 3)).toEqual([
    'workspace:workspace-0',
    'workspace:workspace-1',
    'workspace:workspace-5',
  ]);
  expect(recentWorkspaceIDs({ ...catalog, workspaceVisits: undefined })).toEqual([
    'workspace:workspace-0',
  ]);
});
