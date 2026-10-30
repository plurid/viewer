import { actionCommands } from '../actions/commands';
import { columnCommands } from './columns';
import { folderCommandPath } from './folder-target';
import { copyPathCommand } from './copy-path';
import { calculateSize } from '../explorer/sizes';
import type { FileEntry, ViewMode } from '../../domain/contracts';
import { parentPath, baseName } from '../../domain/workspaces/planes';
import { convertibleImage, inConversionFormat } from '../../domain/operations/image-conversions';
import {
  favorite,
  getState,
  historyNavigate,
  navigate,
  quickPreview,
  refreshClipboard,
  folderPresentation,
  updateFolderPresentation,
  updatePane,
  writeFileClipboard,
} from '../state/store';
import type { CommandContext, CommandDefinition } from './registry';
import { choosePreview } from '../previews/registry';
import { isOfficeFormat } from '../../domain/previews/documents/layout';
import { previewsAsFile } from '../../domain/previews/documents/embedded';
export { parentPath } from '../../domain/workspaces/planes';

export interface FolderActions {
  open(entries: readonly FileEntry[], linked: boolean, another?: boolean): void;
  /** Browses into an application or other bundle, where the plane can (Show Package Contents). */
  contents?(entry: FileEntry): void;
  /** Opens a text file editing, in a plane linked to its folder. */
  edit?(entry: FileEntry): void;
  dialog(kind: 'rename' | 'mkdir' | 'mkfile' | 'group' | 'go-to', context: CommandContext): void;
  trash(context: CommandContext): void | Promise<void>;
  info(context: CommandContext): void;
  openWith(context: CommandContext): void;
  destination(kind: 'copy' | 'move', context: CommandContext): void;
  search(context: CommandContext): void;
  path(context: CommandContext): void;
  refresh(context: CommandContext): void;
  selectAll(): void;
  invertSelection(): void;
}
export function folderCommands(actions: FolderActions): CommandDefinition[] {
  const folder = (context: CommandContext) =>
    !!context.folder && ['window', 'folder', 'files'].includes(context.scope);
  const selected = (context: CommandContext) =>
    ['window', 'files', 'folder'].includes(context.scope) && context.selection.length > 0;
  const paths = (context: CommandContext) => context.selection.map((entry) => entry.path);
  const images = (context: CommandContext) =>
    selected(context) && context.selection.every(convertibleImage);
  const commands: CommandDefinition[] = [
    {
      id: 'invert-selection',
      label: 'Invert selection',
      group: 'Files',
      icon: 'check',
      aliases: ['invert', 'reverse selection', 'unselected'],
      when: (context) => !!context.paneID && ['window', 'folder', 'files'].includes(context.scope),
      run: actions.invertSelection,
    },
    {
      id: 'tags',
      label: 'Tags and comments…',
      group: 'Files',
      icon: 'tag',
      aliases: ['tags', 'labels', 'color', 'comments'],
      when: (context) => selected(context) && getState().bootstrap.platform === 'darwin',
      run: actions.info,
    },
    {
      id: 'make-alias',
      label: 'Make alias',
      group: 'Files',
      icon: 'alias',
      aliases: ['alias', 'shortcut', 'link'],
      when: (context) => selected(context) && getState().bootstrap.platform === 'darwin',
      run: (context) =>
        window.viewer.operate({ kind: 'alias', sources: paths(context) }).then(() => {}),
    },
    {
      id: 'native-quick-look',
      label: 'Quick Look in macOS',
      group: 'Files',
      icon: 'eye',
      aliases: ['quick look', 'native preview', 'office preview'],
      when: (context) =>
        selected(context) &&
        context.selection.length <= 100 &&
        getState().bootstrap.platform === 'darwin',
      run: (context) => window.viewer.nativeFilePanel('preview', paths(context)),
    },
    {
      id: 'share',
      label: 'Share…',
      group: 'Files',
      icon: 'share',
      aliases: ['share', 'airdrop', 'send'],
      when: (context) =>
        selected(context) &&
        context.selection.length <= 100 &&
        getState().bootstrap.platform === 'darwin',
      run: (context) => window.viewer.nativeFilePanel('share', paths(context)),
    },
    {
      id: 'show-package-contents',
      label: 'Show Package Contents',
      group: 'Files',
      icon: 'folder',
      aliases: ['package', 'bundle', 'application contents', 'view contents', 'inside'],
      when: (context) =>
        selected(context) &&
        context.selection.length === 1 &&
        !!context.selection[0]?.directory &&
        context.selection[0].name.includes('.') &&
        getState().bootstrap.platform === 'darwin',
      run: async (context) => {
        const [entry] = context.selection;
        if (!entry) return;
        const info = await window.viewer.fileInformation(entry.path);
        if (!info.package) throw new Error('This folder is not a macOS package.');
        // Open starts an application now (nativeOpening): browse into it, or show it in a plane
        if (actions.contents) actions.contents(entry);
        else actions.open([entry], true);
      },
    },
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
          name:
            context.selection.length === 1 && context.selection[0]
              ? context.selection[0].name + '.zip'
              : 'Archive.zip',
        });
      },
    },
    ...(
      [
        ['rotate-left', 'rotate-copy-left', 'Rotated copy, left', ['rotate left', 'turn left']],
        [
          'rotate-right',
          'rotate-copy-right',
          'Rotated copy, right',
          ['rotate right', 'turn right'],
        ],
        ['jpeg', 'convert-jpeg', 'Convert copy to JPEG', ['jpg', 'jpeg', 'convert image']],
        ['png', 'convert-png', 'Convert copy to PNG', ['png', 'convert image']],
      ] as const
    ).map(([conversion, id, label, aliases]) => ({
      id,
      label,
      group: 'Quick actions',
      icon: 'image' as const,
      aliases: [...aliases],
      // A selection already in the format is not offered it; in a mixed one, such an image gets a
      // copy beside it.
      when: (context: CommandContext) =>
        images(context) &&
        !context.selection.every((entry) => inConversionFormat(entry, conversion)),
      run: async (context: CommandContext) => {
        await window.viewer.operate({ kind: 'convert', conversion, sources: paths(context) });
      },
    })),
    {
      id: 'save-pdf-copy',
      label: 'Save PDF copy',
      group: 'Quick actions',
      icon: 'pdf',
      aliases: ['pdf', 'export pdf', 'convert to pdf'],
      when: (context) =>
        selected(context) &&
        context.selection.every((entry) => !entry.directory && isOfficeFormat(entry.extension)),
      run: async (context) => {
        await window.viewer.operate({
          kind: 'convert',
          conversion: 'office-pdf',
          sources: paths(context),
        });
      },
    },
    {
      id: 'images-to-pdf',
      label: 'Create PDF from images',
      group: 'Quick actions',
      icon: 'pdf',
      aliases: ['pdf', 'combine images', 'make pdf'],
      when: (context) => images(context) && !!context.directory,
      run: async (context) => {
        const first = (context.selection[0]?.name ?? 'Images').replace(/\.[^.]+$/, '');
        await window.viewer.operate({
          kind: 'convert',
          conversion: 'pdf',
          sources: paths(context),
          destination: context.directory,
          name: (context.selection.length === 1 ? first : first + ' and others') + '.pdf',
        });
      },
    },
    {
      id: 'edit-selected',
      label: 'Edit text',
      group: 'Files',
      icon: 'rename',
      aliases: ['edit', 'modify', 'open in editor'],
      when: (context) =>
        !!actions.edit &&
        context.selection.length === 1 &&
        !context.selection[0]!.directory &&
        choosePreview(context.selection[0]!).editing === 'text',
      run: (context) => actions.edit?.(context.selection[0]!),
    },
    {
      id: 'extract',
      label: 'Extract here',
      group: 'Files',
      icon: 'archive',
      aliases: ['unzip', 'untar', 'extract', 'extract archive', 'decompress'],
      when: (context) =>
        selected(context) &&
        context.selection.every(
          (entry) => !entry.directory && /\.(?:zip|tar|tar\.gz|tgz)$/i.test(entry.name),
        ),
      run: async (context) => {
        // beside each archive: search results come from many folders and have no folder of their own
        const byFolder = new Map<string, string[]>();
        for (const entry of context.selection) {
          const folder = context.directory ?? entry.parent;
          byFolder.set(folder, [...(byFolder.get(folder) ?? []), entry.path]);
        }
        for (const [destination, sources] of byFolder)
          await window.viewer.operate({ kind: 'extract', sources, destination });
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
      when: (context) => selected(context) && context.selection.some(previewsAsFile),
      run: (context) =>
        quickPreview(
          context.selection.filter(previewsAsFile).map((file) => file.path),
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
      unavailable: 'Select exactly one file or folder.',
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
      unavailable: 'Open a folder plane to create a folder inside it.',
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
      id: 'new-file',
      label: 'New file…',
      group: 'Folder',
      icon: 'file',
      aliases: ['touch', 'create file', 'empty file'],
      when: folder,
      run: (context) => actions.dialog('mkfile', context),
    },
    {
      id: 'new-folder-with-selection',
      label: 'New folder with selection…',
      group: 'Folder',
      icon: 'plus',
      aliases: ['group', 'nfs', 'folder from selection'],
      shortcut: '⌃⌘N',
      when: (context) =>
        folder(context) &&
        context.selection.length > 0 &&
        context.selection.every((file) => file.parent === context.directory),
      run: (context) => actions.dialog('group', context),
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
        favorite(path, baseName(path));
      },
    },
    {
      id: 'hidden',
      label: (context) =>
        context.folder && folderPresentation(folderCommandPath(context)!).showHidden
          ? 'Hide hidden files'
          : 'Show hidden files',
      group: 'Folder',
      icon: 'eye',
      aliases: ['hf'],
      shortcut: '⇧⌘.',
      when: folder,
      run: (context) => {
        const path = folderCommandPath(context)!;
        updateFolderPresentation(path, { showHidden: !folderPresentation(path).showHidden });
      },
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
      run: async (context) => {
        const [entry] = context.selection;
        if (entry) await window.viewer.reveal(entry.path);
      },
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
        folder(context) && folderCommandPath(context)! !== parentPath(folderCommandPath(context)!),
      run: (context) => navigate(context.paneID!, parentPath(folderCommandPath(context)!)),
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
  for (const mode of ['list', 'grid', 'columns', 'gallery', 'map'] as ViewMode[])
    commands.push({
      id: `view-${mode}`,
      label: `${mode.charAt(0).toUpperCase()}${mode.slice(1)} view`,
      group: 'View',
      icon: mode,
      when: folder,
      run: (context) => {
        const path = folderCommandPath(context)!;
        if (context.folder!.mode !== mode && path !== context.folder!.path)
          navigate(context.paneID!, path);
        updatePane(context.paneID!, { mode });
      },
    });
  return [...commands, ...columnCommands(), ...actionCommands()];
}
