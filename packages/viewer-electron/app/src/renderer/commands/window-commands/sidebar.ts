import { reorder } from '../../../domain/preferences';
import { addFavorite, changePreferences, getState, removeFavorite } from '../../state/store';
import type { CommandContext, CommandDefinition } from '../registry';
import type { WindowScopes } from './scope';

/** Sidebar shortcuts and sections. */
export function sidebarCommands({
  actions,
  state,
  space,
  sidebar,
  shortcut,
}: WindowScopes): CommandDefinition[] {
  const commands: CommandDefinition[] = [
    {
      id: 'shortcut-open',
      label: 'Open folder',
      group: 'Sidebar',
      icon: 'folder',
      when: shortcut,
      run: (context) =>
        actions.workspace.openPath(context.sidebar!.path!, {
          paneID: context.paneID,
          workspaceID: context.workspaceID,
          directory: true,
        }),
    },
    {
      id: 'shortcut-new-root',
      label: 'Open in new root plane',
      group: 'Sidebar',
      icon: 'plus',
      aliases: ['np', 'root'],
      when: (context) => shortcut(context) && actions.ready && space.panes.length < 200,
      run: (context) =>
        actions.workspace.newRootFolder({
          path: context.sidebar!.path!,
          paneID: context.paneID,
          workspaceID: context.workspaceID,
        }),
    },
    {
      id: 'shortcut-rename',
      label: 'Rename shortcut…',
      group: 'Sidebar',
      icon: 'rename',
      aliases: ['rn'],
      when: shortcut,
      run: (context) => actions.renameShortcut(context.sidebar!.path!, context.sidebar!.name!),
    },
    {
      id: 'shortcut-favorite',
      label: 'Add to Favorites',
      group: 'Sidebar',
      icon: 'star',
      when: (context) =>
        shortcut(context) &&
        !state.saved.favorites.some((item) => item.path === context.sidebar!.path),
      run: (context) => addFavorite(context.sidebar!.path!, context.sidebar!.name!),
    },
    {
      id: 'shortcut-remove',
      label: 'Remove from Favorites',
      group: 'Sidebar',
      icon: 'close',
      when: (context) => shortcut(context) && context.sidebar!.section === 'favorites',
      run: (context) => removeFavorite(context.sidebar!.path!),
    },
    {
      id: 'shortcut-hide',
      label: 'Hide location',
      group: 'Sidebar',
      icon: 'eye',
      when: (context) => shortcut(context) && context.sidebar!.section === 'locations',
      run: (context) =>
        changePreferences((ui) => ({
          ...ui,
          sidebar: { ...ui.sidebar, hidden: [...ui.sidebar.hidden, context.sidebar!.path!] },
        })),
    },
    {
      id: 'section-collapse',
      label: (context) =>
        state.saved.ui.sidebar.collapsed.includes(context.sidebar!.section)
          ? 'Expand section'
          : 'Collapse section',
      group: 'Sidebar',
      icon: 'down',
      when: sidebar,
      run: (context) =>
        changePreferences((ui) => ({
          ...ui,
          sidebar: {
            ...ui.sidebar,
            collapsed: ui.sidebar.collapsed.includes(context.sidebar!.section)
              ? ui.sidebar.collapsed.filter((item) => item !== context.sidebar!.section)
              : [...ui.sidebar.collapsed, context.sidebar!.section],
          },
        })),
    },
  ];
  for (const direction of [-1, 1]) {
    commands.push({
      id: `section-${direction < 0 ? 'up' : 'down'}`,
      label: `Move section ${direction < 0 ? 'up' : 'down'}`,
      group: 'Sidebar',
      icon: direction < 0 ? 'up' : 'down',
      when: (context) =>
        sidebar(context) &&
        state.saved.ui.sidebar.order.indexOf(context.sidebar!.section) + direction >= 0 &&
        state.saved.ui.sidebar.order.indexOf(context.sidebar!.section) + direction < 3,
      run: (context) =>
        changePreferences((ui) => {
          const order = [...ui.sidebar.order];
          const index = order.indexOf(context.sidebar!.section);
          [order[index], order[index + direction]] = [order[index + direction], order[index]];
          return { ...ui, sidebar: { ...ui.sidebar, order } };
        }),
    });
    const ordered = (context: CommandContext) =>
      context.sidebar!.section === 'favorites'
        ? getState().saved.favorites.map((item) => item.path)
        : [
            ...getState().saved.ui.sidebar.locations,
            ...getState()
              .bootstrap.locations.map((item) => item.path)
              .filter((path) => !getState().saved.ui.sidebar.locations.includes(path)),
          ];
    commands.push({
      id: `shortcut-${direction < 0 ? 'up' : 'down'}`,
      label: `Move shortcut ${direction < 0 ? 'up' : 'down'}`,
      group: 'Sidebar',
      icon: direction < 0 ? 'up' : 'down',
      when: (context) => {
        if (!shortcut(context) || context.sidebar!.section === 'recents') return false;
        const index = ordered(context).indexOf(context.sidebar!.path!);
        return index >= 0 && index + direction >= 0 && index + direction < ordered(context).length;
      },
      run: (context) => {
        const order = ordered(context);
        const index = order.indexOf(context.sidebar!.path!);
        const before = direction < 0 ? order[index - 1] : order[index + 2];
        if (context.sidebar!.section === 'favorites')
          addFavorite(context.sidebar!.path!, context.sidebar!.name!, before);
        else
          changePreferences((ui) => ({
            ...ui,
            sidebar: { ...ui.sidebar, locations: reorder(order, context.sidebar!.path!, before) },
          }));
      },
    });
  }
  return commands;
}
