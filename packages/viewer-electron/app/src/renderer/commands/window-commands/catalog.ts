import type { CommandDefinition } from '../registry';
import { baseName, paneTitle } from '../../../domain/workspaces/planes';
import type { WindowScopes } from './scope';
import { orderedWorkspaces } from '../../../domain/workspaces/catalog';
import { searchableDefinition } from '../../../domain/workspaces/definitions/query';
import { openDefinition } from '../../state/definitions';

/** Dynamic entries: workspaces, open planes, places and saved searches. */
export function catalogCommands({
  actions,
  state,
  space,
  windowScope,
  workspaceScope,
}: WindowScopes): CommandDefinition[] {
  const commands: CommandDefinition[] = [];
  for (const entry of orderedWorkspaces(state.saved))
    commands.push({
      id: `workspace:${entry.id}`,
      label: entry.name,
      group: 'Workspaces',
      detail:
        entry.definition &&
        state.bootstrap.definitions?.definitions.some(
          (item) => item.key === entry.definition!.key && item.basis !== entry.definition!.basis,
        )
          ? entry.definition.key + ' · Definition changed · Reset to definition…'
          : (entry.definition?.key ??
            `${entry.panes.length} open ${entry.panes.length === 1 ? 'plane' : 'planes'}`),
      icon: entry.id === space.id ? 'check' : 'dock',
      aliases: ['workspace', `switch to ${entry.name}`],
      remember: false,
      when: workspaceScope,
      run: () => actions.switchWorkspace(entry.id),
    });
  const opened = new Set(
    state.saved.workspaces.flatMap((entry) => (entry.definition ? [entry.definition.key] : [])),
  );
  for (const definition of state.bootstrap.definitions?.definitions ?? []) {
    if (!searchableDefinition(definition) || opened.has(definition.key)) continue;
    const command = definition.planes.find(
      (item) => item.plane.kind === 'terminal' && item.plane.command,
    )?.plane;
    commands.push({
      id: `defined:${definition.key}`,
      label: definition.name,
      group: 'Workspaces',
      icon: 'dock',
      detail: `${definition.key} · ${definition.remembered ? 'Remembers ' + definition.remembered.planes : definition.planes.length} ${(definition.remembered?.planes ?? definition.planes.length) === 1 ? 'plane' : 'planes'}${command?.kind === 'terminal' ? ` · ${command.command}` : ''}`,
      aliases: definition.aliases,
      humanOnly: true,
      remember: false,
      when: workspaceScope,
      run: () => openDefinition(definition.key),
    });
  }
  commands.push({
    id: 'edit-workspace-definitions',
    label: 'Edit workspace definitions',
    group: 'Workspace',
    icon: 'code',
    aliases: ['workspaces.jsonc', 'defined workspaces'],
    humanOnly: true,
    when: windowScope,
    run: async () => {
      await window.viewer.workspaceDefinitionFile({ kind: 'edit' });
    },
  });
  for (const pane of space.panes)
    commands.push({
      id: `plane:${pane.id}`,
      label:
        pane.type === 'task'
          ? pane.title
          : pane.type === 'receipt'
            ? 'Command receipt'
            : pane.type === 'journal'
              ? 'Journal'
              : pane.type === 'overview'
                ? 'File overview'
                : pane.type === 'layout'
                  ? paneTitle(pane)
                  : pane.type === 'scratch' || pane.type === 'note'
                    ? (pane.title ?? 'Untitled')
                    : baseName(pane.path),
      group: 'Open planes',
      detail:
        pane.type === 'note' ? 'Saved note' : pane.type === 'scratch' ? 'Unsaved text' : pane.path,
      aliases: ['plane', 'switch'],
      icon: pane.type === 'folder' ? 'folder' : 'file',
      remember: false,
      when: (context) => windowScope(context) && actions.ready,
      run: () => actions.workspace.focusPane(pane.id),
    });
  for (const area of space.taskAreas ?? [])
    commands.push({
      id: 'task:' + area.id,
      label: area.name,
      group: 'Tasks',
      detail: area.checkout.path,
      aliases: ['task', 'task area', area.checkout.branch ?? ''],
      icon: 'dock',
      remember: false,
      when: (context) => windowScope(context) && actions.ready,
      run: () => actions.workspace.openTaskArea(area.id),
    });
  const destinations = [
    ...state.saved.favorites,
    ...state.bootstrap.locations,
    ...state.saved.recents.map((path) => ({ path, name: baseName(path) })),
  ].filter((item, index, all) => all.findIndex((other) => other.path === item.path) === index);
  for (const item of destinations)
    commands.push({
      id: `location:${item.path}`,
      label: state.saved.ui.sidebar.labels[item.path] || item.name,
      group: 'Places',
      detail: item.path,
      icon: 'folder',
      aliases: ['goto', 'location'],
      remember: false,
      when: windowScope,
      run: () => actions.workspace.openPath(item.path, { directory: true }),
    });
  for (const search of state.settings.settings.savedSearches)
    commands.push({
      id: `saved-search:${search.id}`,
      label: search.name,
      group: 'Saved searches',
      aliases: ['search', search.query],
      detail: search.query,
      icon: 'search',
      when: windowScope,
      run: () =>
        actions.workspace.newSearch(
          search.query,
          search.name,
          search.root,
          search.recursive,
          search.content,
        ),
    });
  return commands;
}
