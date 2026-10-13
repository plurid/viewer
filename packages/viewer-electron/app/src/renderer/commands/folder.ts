import { actionCommands } from '../actions/commands';
import { columnCommands } from './columns';
import { copyPathCommand } from './copy-path';
import { calculateSize } from '../explorer/sizes';
import type { FileEntry, ViewMode } from '../../domain/contracts';
import { parentPath } from '../../domain/planes';
export { parentPath } from '../../domain/planes';
import {
  favorite,
  getState,
  historyNavigate,
  navigate,
  quickPreview,
  refreshClipboard,
  updatePane,
  writeFileClipboard,
} from '../state/store';
import type { CommandContext, CommandDefinition } from './registry';

export interface FolderActions {
  open(entries: readonly FileEntry[], linked: boolean, another?: boolean): void;
  dialog(kind: 'rename' | 'mkdir' | 'go-to', context: CommandContext): void;
  trash(context: CommandContext): void | Promise<void>;
  info(context: CommandContext): void;
  openWith(context: CommandContext): void;
  destination(kind: 'copy' | 'move', context: CommandContext): void;
  search(): void;
  path(): void;
  refresh(): void;
  selectAll(): void;
}
export function folderCommands(actions: FolderActions): CommandDefinition[] {
  const folder = (context: CommandContext) =>
    !!context.folder && ['window', 'folder', 'files'].includes(context.scope);
  const selected = (context: CommandContext) =>
    ['window', 'files', 'folder'].includes(context.scope) && context.selection.length > 0;
  const paths = (context: CommandContext) => context.selection.map((entry) => entry.path);
  const commands: CommandDefinition[] = [
    {
      id: 'compress',
      label: 'Compress to ZIP',
      group: 'Files',
      icon: 'archive',
      aliases: ['zip', 'archive', 'compress'],
      when: selected,
      run: async (context) => {
        await window.viewer.operate({
          kind: 'compress',
          sources: paths(context),
          destination: context.directory,
          name: context.selection.length === 1 ? context.selection[0].name + '.zip' : 'Archive.zip',
        });
      },
    },
    {
      id: 'extract',
      label: 'Extract archive',
      group: 'Files',
      icon: 'archive',
      aliases: ['unzip', 'untar', 'extract'],
      when: (context) =>
        selected(context) &&
        context.selection.every(
          (entry) => !entry.directory && /\.(?:zip|tar|tar\.gz|tgz)$/i.test(entry.name),
        ),
      run: async (context) => {
        await window.viewer.operate({
          kind: 'extract',
          sources: paths(context),
          destination: context.directory,
        });
      },
    },
    {
      id: 'open-default',
      label: 'Open in Default App',
      group: 'Files',
      icon: 'external',
      aliases: ['default', 'external', 'od'],
      when: selected,
      run: async (context) => {
        for (const path of paths(context)) await window.viewer.openExternal(path);
      },
    },
    {
      id: 'open-with',
      label: 'Open With…',
      group: 'Files',
      icon: 'external',
      aliases: ['ow', 'application'],
      when: selected,
      run: actions.openWith,
    },
    {
      id: 'calculate-size',
      label: 'Calculate Size',
      group: 'Files',
      icon: 'info',
      aliases: ['size', 'cs', 'folder size'],
      when: (context) => selected(context) && context.selection.some((file) => file.directory),
      run: (context) => calculateSize(context.selection),
    },
    {
      id: 'open-selection',
      label: 'Open',
      group: 'Files',
      icon: 'folder',
      aliases: ['op'],
      shortcut: '⌘O',
      primary: true,
      when: selected,
      run: (context) => actions.open(context.selection, false),
    },
    {
      id: 'linked',
      label: 'Open linked plane',
      group: 'Files',
      icon: 'link',
      aliases: ['ol', 'linked'],
      primary: true,
      when: selected,
      run: (context) => actions.open(context.selection, true),
    },
    {
      id: 'quick-preview',
      label: 'Quick preview',
      group: 'Files',
      icon: 'eye',
      aliases: ['qp', 'preview'],
      shortcut: 'Space',
      primary: true,
      when: (context) => selected(context) && context.selection.some((file) => !file.directory),
      run: (context) =>
        quickPreview(
          context.selection.filter((file) => !file.directory).map((file) => file.path),
          context,
        ),
    },
    {
      id: 'another-plane',
      label: 'Open in another plane',
      group: 'Files',
      icon: 'plus',
      detail: 'Independent root plane',
      aliases: ['another', 'copy plane', 'root plane', 'independent plane'],
      when: selected,
      run: (context) => actions.open(context.selection, true, true),
    },
    {
      id: 'rename',
      label: 'Rename…',
      group: 'Files',
      icon: 'rename',
      aliases: ['rn'],
      shortcut: '↵',
      primary: true,
      when: (context) => selected(context) && context.selection.length === 1,
      run: (context) => actions.dialog('rename', context),
    },
    {
      id: 'info',
      label: 'Get info…',
      group: 'Files',
      icon: 'info',
      aliases: ['gi', 'properties'],
      shortcut: '⌘I',
      when: selected,
      run: actions.info,
    },
    {
      id: 'copy',
      label: 'Copy',
      group: 'Files',
      icon: 'copy',
      aliases: ['cp'],
      shortcut: '⌘C',
      when: selected,
      run: (context) => writeFileClipboard(paths(context), false),
    },
    copyPathCommand,
    {
      id: 'cut',
      label: 'Cut',
      group: 'Files',
      icon: 'move',
      aliases: ['ct'],
      shortcut: '⌘X',
      when: selected,
      run: (context) => writeFileClipboard(paths(context), true),
    },
    {
      id: 'paste',
      label: 'Paste here',
      group: 'Files',
      icon: 'copy',
      aliases: ['ps'],
      shortcut: '⌘V',
      when: (context) => folder(context) && !!context.clipboard?.paths.length,
      run: async (context) => {
        await refreshClipboard();
        const clipboard = getState().clipboard;
        if (clipboard)
          await window.viewer.operate({
            kind: clipboard.cut ? 'move' : 'copy',
            sources: clipboard.paths,
            destination: context.directory,
          });
      },
    },
    {
      id: 'paste-move',
      label: 'Move copied items here',
      group: 'Files',
      icon: 'move',
      shortcut: '⌥⌘V',
      when: (context) => folder(context) && !!context.clipboard?.paths.length,
      run: async (context) => {
        await refreshClipboard();
        const clipboard = getState().clipboard;
        if (clipboard)
          await window.viewer.operate({
            kind: 'move',
            sources: clipboard.paths,
            destination: context.directory,
          });
      },
    },
    {
      id: 'copy-to',
      label: 'Copy to…',
      group: 'Files',
      icon: 'copy',
      aliases: ['cpto'],
      when: selected,
      run: (context) => actions.destination('copy', context),
    },
    {
      id: 'move-to',
      label: 'Move to…',
      group: 'Files',
      icon: 'move',
      aliases: ['mv'],
      when: selected,
      run: (context) => actions.destination('move', context),
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      group: 'Files',
      icon: 'copy',
      aliases: ['du'],
      shortcut: '⌘D',
      when: selected,
      run: async (context) => {
        await window.viewer.operate({ kind: 'duplicate', sources: paths(context) });
      },
    },
    {
      id: 'new-folder',
      label: 'New folder…',
      group: 'Folder',
      icon: 'plus',
      aliases: ['nf', 'mkdir'],
      shortcut: '⇧⌘N',
      primary: (context) => !context.selection.length,
      when: folder,
      run: (context) => actions.dialog('mkdir', context),
    },
    {
      id: 'favorite',
      label: (context) =>
        getState().saved.favorites.some((item) => item.path === context.directory)
          ? 'Remove folder from Favorites'
          : 'Add folder to Favorites',
      group: 'Folder',
      icon: 'star',
      aliases: ['fav', 'star'],
      when: folder,
      run: (context) => {
        const path = context.directory!;
        favorite(path, path.split(/[\\/]/).pop() || path);
      },
    },
    {
      id: 'hidden',
      label: (context) => (context.folder?.showHidden ? 'Hide hidden files' : 'Show hidden files'),
      group: 'Folder',
      icon: 'eye',
      aliases: ['hf'],
      shortcut: '⇧⌘.',
      when: folder,
      run: (context) => updatePane(context.paneID!, { showHidden: !context.folder!.showHidden }),
    },
    {
      id: 'refresh',
      label: 'Refresh',
      group: 'Folder',
      icon: 'refresh',
      aliases: ['rf'],
      when: folder,
      run: actions.refresh,
    },
    {
      id: 'trash',
      label: () =>
        getState().settings.settings.browsing.confirmTrash ? 'Move to Trash…' : 'Move to Trash',
      group: 'Files',
      icon: 'trash',
      aliases: ['tr'],
      shortcut: '⌘⌫',
      when: selected,
      run: actions.trash,
    },
    {
      id: 'reveal',
      label: 'Reveal in Finder',
      group: 'Files',
      icon: 'external',
      aliases: ['rv'],
      when: (context) => selected(context) && context.selection.length === 1,
      run: (context) => window.viewer.reveal(context.selection[0].path),
    },
    {
      id: 'search',
      label: (context) => (context.searchOpen ? 'Close folder search' : 'Search this folder…'),
      group: 'Navigation',
      icon: 'search',
      aliases: ['sf', 'filter'],
      when: folder,
      run: actions.search,
    },
    {
      id: 'path',
      label: 'Show folder path',
      group: 'Navigation',
      icon: 'folder',
      aliases: ['pa', 'breadcrumb'],
      when: folder,
      run: actions.path,
    },
    {
      id: 'go-to',
      label: 'Go to folder…',
      group: 'Navigation',
      icon: 'folder',
      aliases: ['gf', 'goto'],
      shortcut: '⌘L',
      when: folder,
      run: (context) => actions.dialog('go-to', context),
    },
    {
      id: 'back',
      label: 'Back',
      group: 'Navigation',
      icon: 'left',
      when: (context) => folder(context) && context.folder!.historyIndex > 0,
      run: (context) => historyNavigate(context.paneID!, -1),
    },
    {
      id: 'forward',
      label: 'Forward',
      group: 'Navigation',
      icon: 'right',
      when: (context) =>
        folder(context) && context.folder!.historyIndex < context.folder!.history.length - 1,
      run: (context) => historyNavigate(context.paneID!, 1),
    },
    {
      id: 'parent',
      label: 'Parent folder',
      group: 'Navigation',
      icon: 'up',
      shortcut: '⌘↑',
      when: (context) =>
        folder(context) && context.folder!.path !== parentPath(context.folder!.path),
      run: (context) => navigate(context.paneID!, parentPath(context.folder!.path)),
    },
    {
      id: 'select-all',
      label: 'Select all files',
      group: 'Files',
      icon: 'check',
      shortcut: '⌘A',
      when: folder,
      run: actions.selectAll,
    },
  ];
  for (const mode of ['list', 'grid', 'columns', 'gallery'] as ViewMode[])
    commands.push({
      id: `view-${mode}`,
      label: `${mode[0].toUpperCase()}${mode.slice(1)} view`,
      group: 'View',
      icon: mode,
      when: folder,
      run: (context) => updatePane(context.paneID!, { mode }),
    });
  return [...commands, ...columnCommands(), ...actionCommands()];
}
