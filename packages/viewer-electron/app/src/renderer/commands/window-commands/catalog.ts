import type { CommandDefinition } from '../registry';
import { baseName, paneTitle } from '../../../domain/workspaces/planes';
import type { WindowScopes } from './scope';

/** Dynamic entries: workspaces, open planes, places and saved searches. */
export function catalogCommands({
  actions,
  state,
  space,
  windowScope,
  workspaceScope,
}: WindowScopes): CommandDefinition[] {
  const commands: CommandDefinition[] = [];
  for (const entry of state.saved.workspaces)
    commands.push({
      id: `workspace:${entry.id}`,
      label: entry.name,
      group: 'Workspaces',
      detail: `${entry.panes.length} open ${entry.panes.length === 1 ? 'plane' : 'planes'}`,
      icon: entry.id === space.id ? 'check' : 'dock',
      aliases: ['workspace', `switch to ${entry.name}`],
      remember: false,
      when: workspaceScope,
      run: () => actions.switchWorkspace(entry.id),
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
