import { activeWorkspace, announce } from '../../state/store';
import type { CommandDefinition } from '../registry';
import type { WindowScopes } from './scope';

/**
 * EXPLODE FOLDER (2026-10-23): the active folder plane's subfolders, and theirs to the depth asked,
 * as linked planes around it, in one undo step; Collapse closes them again.
 */
export function explodeCommands({
  actions,
  state,
  windowScope,
}: WindowScopes): CommandDefinition[] {
  const space = activeWorkspace();
  const active = space.panes.find((pane) => pane.id === state.activePane);
  // from the plane exploded, or from one of the planes it opened
  const exploded =
    active?.type === 'folder'
      ? space.panes.some((pane) => pane.type === 'folder' && pane.exploded === active.id)
        ? active.id
        : active.exploded
      : undefined;
  const folder = (context: Parameters<CommandDefinition['when']>[0]) =>
    windowScope(context) && actions.ready && active?.type === 'folder';
  return [
    ...([1, 2, 3] as const).map((depth): CommandDefinition => ({
      id: depth === 1 ? 'explode-folder' : `explode-folder.${depth}`,
      label: depth === 1 ? 'Explode folder' : `Explode folder, ${depth} levels`,
      group: 'Folder',
      icon: 'folder',
      detail: 'Its subfolders as linked planes',
      aliases: ['explode', 'expand', 'tree', 'subfolders', 'spread'],
      when: folder,
      run: async () => {
        if (active?.type !== 'folder') return;
        const opened = await actions.workspace.explode(active.id, depth);
        if (opened) announce(`Opened ${opened} ${opened === 1 ? 'folder' : 'folders'} as planes.`);
      },
    })),
    {
      id: 'collapse-folder',
      label: 'Collapse exploded folders',
      group: 'Folder',
      icon: 'close',
      aliases: ['collapse', 'implode', 'fold'],
      when: (context) => windowScope(context) && actions.ready && !!exploded,
      run: () => {
        if (exploded) actions.workspace.collapse(exploded);
      },
    },
  ];
}
