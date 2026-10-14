import type { PluridApplicationHandle } from '@plurid/plurid-react';
import type { RefObject } from 'react';
import { reorder } from '../../domain/preferences';
import {
  activeWorkspace,
  addFavorite,
  changePreferences,
  getState,
  removeFavorite,
  setOperationsOpen,
  updatePane,
} from '../state/store';
import type { WorkspaceController } from '../workspace/context';
import { actionCommands } from '../actions/commands';
import { basketEntries, addToBasket } from '../state/store';
import { sourceVersion } from '../../domain/inspection';
import { copyPathCommand } from './copy-path';
import { repeatedPreviews } from '../workspace/recovery';
import type { CommandContext, CommandDefinition } from './registry';
import { requestProject, type ProjectCommand } from '../workspace/projects';

export interface WindowActions {
  workspace: WorkspaceController;
  engine: RefObject<PluridApplicationHandle | null>;
  ready: boolean;
  palette(mode: 'commands' | 'files' | 'workspaces'): void;
  settings(): void;
  workspaceDialog(kind: 'new' | 'rename' | 'delete'): void;
  renameShortcut(path: string, name: string): void;
  switchWorkspace(id: string): Promise<void>;
  restoreWorkspace(): Promise<void>;
  spatialTool(tool: 'rotate' | 'scale' | 'translate' | null): void;
  tool: 'rotate' | 'scale' | 'translate' | null;
  goTo(): void;
  openWith(paths: string[]): void;
}
export function windowCommands(actions: WindowActions): CommandDefinition[] {
  const state = getState();
  const space = activeWorkspace();
  const windowScope = (context: CommandContext) => context.scope === 'window';
  const workspaceScope = (context: CommandContext) =>
    ['window', 'workspace'].includes(context.scope);
  const paneScope = (context: CommandContext) =>
    ['window', 'folder', 'files', 'preview'].includes(context.scope) &&
    !!context.paneID &&
    space.panes.some((pane) => pane.id === context.paneID) &&
    actions.ready;
  const sidebar = (context: CommandContext) => context.scope === 'sidebar' && !!context.sidebar;
  const shortcut = (context: CommandContext) => sidebar(context) && !!context.sidebar?.path;
  const commands: CommandDefinition[] = [
    {
      id: 'related-files',
      label: 'Related files…',
      group: 'Files',
      icon: 'link',
      aliases: ['provenance', 'dependencies', 'source links', 'relationships'],
      when: (context) => context.selection.length > 0 || !!context.path,
      run: (context) => {
        const paths = context.selection.length
          ? context.selection.map((file) => file.path)
          : context.path
            ? [context.path]
            : [];
        window.dispatchEvent(
          new CustomEvent('viewer:relationships', { detail: { paths, paneID: context.paneID } }),
        );
      },
    },
    {
      id: 'workflows',
      label: 'Workflows…',
      group: 'Workspace',
      icon: 'file',
      aliases: ['pipeline', 'run workflow', 'workflow file'],
      when: () => true,
      run: (context) => {
        window.dispatchEvent(
          new CustomEvent('viewer:workflows', {
            detail: {
              context,
              ...(context.selection.length === 1 &&
              /(?:^|\.)workflow\.jsonc$/.test(context.selection[0].name)
                ? { file: context.selection[0].path }
                : {}),
            },
          }),
        );
      },
    },
    {
      id: 'add-to-basket',
      label: 'Add to basket',
      group: 'Files',
      icon: 'check',
      aliases: ['collect', 'basket', 'keep selection'],
      when: (context) => context.selection.length > 0,
      run: (context) => {
        basketEntries(context.selection);
      },
    },
    {
      id: 'collections',
      label: 'Collections and basket…',
      group: 'Workspace',
      icon: 'folder',
      aliases: ['collection', 'basket', 'virtual folder'],
      when: windowScope,
      run: () => {
        window.dispatchEvent(new Event('viewer:collections'));
      },
    },
    {
      id: 'basket-all-query',
      label: 'Add all indexed matches to basket',
      group: 'Files',
      icon: 'search',
      aliases: ['all results', 'snapshot selection'],
      when: (context) =>
        !!space.panes.find((pane) => pane.id === context.paneID && pane.type === 'search'),
      run: async (context) => {
        const pane = space.panes.find((pane) => pane.id === context.paneID);
        if (pane?.type !== 'search') return;
        const snapshot = await window.viewer.querySnapshot({
          query: pane.query,
          root: pane.allLocations ? undefined : pane.path,
          content: pane.content ?? false,
          recursive: pane.recursive ?? true,
        });
        addToBasket(
          snapshot.entries.map((entry) => ({ path: entry.path, version: sourceVersion(entry) })),
        );
      },
    },
    {
      id: 'compare-locations',
      label: 'Compare locations…',
      group: 'Files',
      icon: 'columns',
      aliases: ['compare folders', 'diff', 'reconcile'],
      when: () => true,
      run: (context) => {
        window.dispatchEvent(
          new CustomEvent('viewer:compare', {
            detail:
              context.selection.length === 2
                ? context.selection.map((file) => file.path)
                : context.directory
                  ? [context.directory]
                  : [],
          }),
        );
      },
    },
    {
      id: 'checkpoints',
      label: 'Content checkpoints…',
      group: 'App',
      icon: 'file',
      aliases: ['recovery', 'snapshots', 'restore checkpoint'],
      when: windowScope,
      run: () => {
        window.dispatchEvent(new Event('viewer:checkpoints'));
      },
    },
    {
      id: 'inspect-file',
      label: 'Inspect file…',
      group: 'Files',
      icon: 'file',
      aliases: ['facts', 'document metadata', 'pages', 'dimensions'],
      when: (context) =>
        context.selection.length === 1 || (context.scope === 'preview' && !!context.path),
      run: (context) => {
        window.dispatchEvent(
          new CustomEvent('viewer:inspect', {
            detail: context.selection[0]?.path || context.path,
          }),
        );
      },
    },
    {
      id: 'plane-notes',
      label: 'Plane notes…',
      group: 'Plane',
      icon: 'file',
      aliases: ['annotate', 'notes'],
      when: paneScope,
      run: (context) => {
        window.dispatchEvent(new CustomEvent('viewer:notes', { detail: context.paneID }));
      },
    },
    ...(
      [
        ['create', 'Create project…'],
        ['open', 'Open project…'],
        ['save', 'Save project'],
        ['reload', 'Reload project…'],
        ['arrangements', 'Saved arrangements…'],
        ['bindings', 'Project folders…'],
      ] as [ProjectCommand, string][]
    ).map(([command, label]) => ({
      id: 'project-' + command,
      label,
      group: 'Project',
      icon: 'folder' as const,
      aliases: ['project', command],
      when: () => actions.ready && (['create', 'open'].includes(command) || !!space.project),
      run: () => requestProject(command),
    })),
    {
      id: 'volumes',
      label: 'Volumes…',
      group: 'Navigation',
      icon: 'drive',
      aliases: ['disks', 'drives', 'eject', 'mounts'],
      when: () => state.bootstrap.platform === 'darwin',
      run: () => {
        window.dispatchEvent(new Event('viewer:volumes'));
      },
    },
    {
      ...copyPathCommand,
      when: (context) =>
        ['preview', 'sidebar'].includes(context.scope) && copyPathCommand.when(context),
    },
    {
      id: 'new-root-folder',
      label: 'New folder plane',
      group: 'Plane',
      icon: 'plus',
      aliases: ['np', 'new plane', 'add plane', 'root'],
      shortcut: '⌘N',
      primary: true,
      when: (context) =>
        ['window', 'workspace', 'folder', 'files', 'preview'].includes(context.scope) &&
        actions.ready &&
        space.panes.length < 200,
      run: (context) =>
        actions.workspace.newRootFolder({
          paneID: context.paneID,
          workspaceID: context.workspaceID,
        }),
    },
    {
      id: 'palette',
      label: 'Commands…',
      group: 'App',
      icon: 'command',
      shortcut: '⌘K',
      when: windowScope,
      run: () => actions.palette('commands'),
    },
    {
      id: 'find-file',
      label: 'Find file…',
      group: 'Navigation',
      icon: 'search',
      aliases: ['ff', 'find'],
      shortcut: '⌘F',
      primary: true,
      when: windowScope,
      run: () => actions.palette('files'),
    },
    {
      id: 'choose-folder',
      label: 'Open folder…',
      group: 'Navigation',
      icon: 'folder',
      aliases: ['of'],
      shortcut: '⇧⌘O',
      primary: true,
      when: windowScope,
      run: async () => {
        const path = await window.viewer.chooseFolder();
        if (path) await actions.workspace.openPath(path);
      },
    },
    {
      id: 'settings',
      label: 'Settings…',
      group: 'App',
      icon: 'settings',
      aliases: ['st', 'preferences', 'appearance', 'minimap', 'viewcube'],
      shortcut: '⌘,',
      when: windowScope,
      run: actions.settings,
    },
    {
      id: 'toggle-sidebar',
      label: state.saved.ui.sidebar.visible ? 'Hide window navigation' : 'Show window navigation',
      group: 'View',
      icon: 'sidebar',
      aliases: ['sb', 'window sidebar'],
      shortcut: '⌥⌘S',
      when: (context) => windowScope(context) || (sidebar(context) && !context.paneID),
      run: () =>
        changePreferences((ui) => ({
          ...ui,
          sidebar: { ...ui.sidebar, visible: !ui.sidebar.visible },
        })),
    },
    {
      id: 'plane-sidebar',
      label: (context) =>
        context.folder?.sidebar?.visible !== false
          ? 'Hide plane navigation'
          : 'Show plane navigation',
      group: 'Plane',
      icon: 'sidebar',
      aliases: ['ps', 'sidebar', 'navigation'],
      when: (context) => paneScope(context) && !!context.folder,
      run: (context) => {
        const pane = activeWorkspace().panes.find((pane) => pane.id === context.paneID);
        if (pane?.type === 'folder')
          updatePane(pane.id, {
            sidebar: {
              visible: pane.sidebar?.visible === false,
              width: pane.sidebar?.width ?? 210,
            },
          });
      },
    },
    {
      id: 'change-workspace',
      label: 'Change workspace…',
      group: 'Workspaces',
      icon: 'dock',
      aliases: ['cw', 'switch workspace', 'workspaces'],
      primary: true,
      when: workspaceScope,
      run: () => actions.palette('workspaces'),
    },
    {
      id: 'new-workspace',
      label: 'New workspace…',
      group: 'Workspaces',
      icon: 'plus',
      aliases: ['nw'],
      when: (context) => workspaceScope(context) && state.saved.workspaces.length < 30,
      run: () => actions.workspaceDialog('new'),
    },
    {
      id: 'rename-workspace',
      label: 'Rename workspace…',
      group: 'Workspaces',
      icon: 'rename',
      aliases: ['rw'],
      when: workspaceScope,
      run: () => actions.workspaceDialog('rename'),
    },
    {
      id: 'delete-workspace',
      label: 'Delete workspace…',
      group: 'Workspaces',
      icon: 'trash',
      aliases: ['dw'],
      detail: `${space.panes.length} open ${space.panes.length === 1 ? 'plane' : 'planes'} · layout only`,
      when: workspaceScope,
      run: () => actions.workspaceDialog('delete'),
    },
    {
      id: 'restore-workspace',
      label: 'Undo workspace deletion',
      group: 'Workspaces',
      icon: 'refresh',
      primary: true,
      when: (context) => workspaceScope(context) && !!state.deletedWorkspace,
      run: actions.restoreWorkspace,
    },
    {
      id: 'recent-operations',
      label: 'Recent file operations',
      group: 'Files',
      icon: 'copy',
      aliases: ['jobs', 'operations', 'progress'],
      when: (context) => windowScope(context) && state.jobs.length > 0,
      run: () => setOperationsOpen(true, true),
    },
    {
      id: 'undo-file',
      label: 'Undo file operation',
      group: 'Files',
      icon: 'left',
      shortcut: '⌘Z',
      when: (context) => windowScope(context) && state.jobs.some((job) => job.undoable),
      run: async () => {
        const job = getState().jobs.find((job) => job.undoable);
        if (job) await window.viewer.undo(job.id);
      },
    },
    {
      id: 'frame-all',
      label: 'Frame all planes',
      group: 'Space',
      icon: 'frame',
      aliases: ['fa', 'fit'],
      shortcut: '⌘0',
      primary: true,
      when: (context) => windowScope(context) && actions.ready && space.panes.length > 0,
      run: actions.workspace.frameAll,
    },
    {
      id: 'consolidate-previews',
      label: 'Consolidate repeated previews',
      group: 'Space',
      icon: 'copy',
      aliases: ['duplicates', 'repeated', 'clean previews'],
      detail: 'Close redundant views · layout only · Undo arrangement restores them',
      when: (context) =>
        windowScope(context) &&
        actions.ready &&
        !!actions.engine.current &&
        repeatedPreviews(
          space,
          actions.engine.current.tree.get(),
          state.activePane,
          state.bootstrap.platform,
        ).length > 0,
      run: actions.workspace.consolidatePreviews,
    },
    {
      id: 'frame-plane',
      label: 'Frame plane',
      group: 'Plane',
      icon: 'frame',
      aliases: ['fp'],
      when: paneScope,
      run: (context) => actions.workspace.focusPane(context.paneID!),
    },
    {
      id: 'parent-plane',
      label: 'Back to parent plane',
      group: 'Plane',
      icon: 'parent-plane',
      aliases: ['parent plane', 'back to parent'],
      shortcut: '⌥⌘↑',
      when: (context) => paneScope(context) && !!actions.workspace.parentPaneID(context.paneID!),
      run: (context) => {
        const parent = actions.workspace.parentPaneID(context.paneID!);
        if (parent) actions.workspace.focusPane(parent);
      },
    },
    {
      id: 'view-open-plane',
      label: 'View open plane',
      group: 'Files',
      icon: 'link',
      primary: true,
      aliases: ['view linked plane', 'show existing plane', 'vl'],
      when: (context) =>
        !!context.paneID &&
        context.selection.length === 1 &&
        !!actions.workspace.existingPaneID(context.paneID, context.selection[0]),
      run: (context) => {
        const id = actions.workspace.existingPaneID(context.paneID!, context.selection[0]);
        if (!id) throw new Error('This plane is no longer open.');
        actions.workspace.focusPane(id);
      },
    },
    {
      id: 'dock',
      label: actions.engine.current?.camera.docked() ? 'Reveal space' : 'Dock plane',
      group: 'Plane',
      icon: 'dock',
      aliases: ['dk'],
      shortcut: '⌘↵',
      when: paneScope,
      run: (context) => actions.workspace.dock(context.paneID),
    },
    {
      id: 'close-plane',
      label: 'Close plane',
      group: 'Plane',
      icon: 'close',
      aliases: ['cl'],
      when: paneScope,
      run: (context) => actions.workspace.closePane(context.paneID!),
    },
    {
      id: 'undo-arrangement',
      label: 'Undo arrangement',
      group: 'Space',
      icon: 'left',
      aliases: ['ua'],
      shortcut: '⌥⌘Z',
      when: (context) => windowScope(context) && !!actions.engine.current?.history.get().canUndo,
      run: actions.workspace.undo,
    },
    {
      id: 'redo-arrangement',
      label: 'Redo arrangement',
      group: 'Space',
      icon: 'right',
      aliases: ['ra'],
      shortcut: '⇧⌥⌘Z',
      when: (context) => windowScope(context) && !!actions.engine.current?.history.get().canRedo,
      run: actions.workspace.redo,
    },
    {
      id: 'arrange-horizontal',
      label: 'Arrange planes horizontally',
      group: 'Space',
      icon: 'columns',
      aliases: ['ah'],
      when: (context) => windowScope(context) && actions.ready && space.panes.length > 1,
      run: () => actions.workspace.arrange('x'),
    },
    {
      id: 'arrange-vertical',
      label: 'Arrange planes vertically',
      group: 'Space',
      icon: 'list',
      aliases: ['av'],
      when: (context) => windowScope(context) && actions.ready && space.panes.length > 1,
      run: () => actions.workspace.arrange('y'),
    },
    {
      id: 'open-default',
      label: 'Open in Default App',
      group: 'Preview',
      icon: 'external',
      when: (context) =>
        paneScope(context) &&
        space.panes.find((pane) => pane.id === context.paneID)?.type === 'preview',
      run: (context) =>
        window.viewer.openExternal(space.panes.find((pane) => pane.id === context.paneID)!.path),
    },
    {
      id: 'open-with',
      label: 'Open With…',
      group: 'Preview',
      icon: 'external',
      aliases: ['ow', 'application'],
      when: (context) =>
        paneScope(context) &&
        space.panes.find((pane) => pane.id === context.paneID)?.type === 'preview',
      run: (context) =>
        actions.openWith([space.panes.find((pane) => pane.id === context.paneID)!.path]),
    },
    {
      id: 'preview-reveal',
      label: 'Reveal in Finder',
      group: 'Preview',
      icon: 'folder',
      when: (context) =>
        paneScope(context) &&
        space.panes.find((pane) => pane.id === context.paneID)?.type === 'preview',
      run: (context) =>
        window.viewer.reveal(space.panes.find((pane) => pane.id === context.paneID)!.path),
    },
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
  for (const tool of ['rotate', 'scale', 'translate'] as const)
    commands.push({
      id: `space-${tool}`,
      label: `${tool[0].toUpperCase() + tool.slice(1)} space`,
      group: 'Space',
      icon: tool === 'rotate' ? 'refresh' : tool === 'scale' ? 'frame' : 'move',
      when: (context) => windowScope(context) && actions.ready && space.panes.length > 0,
      run: () => actions.spatialTool(tool),
    });
  commands.push({
    id: 'space-done',
    label: 'Finish spatial tool',
    group: 'Space',
    icon: 'check',
    primary: true,
    when: (context) => windowScope(context) && actions.tool !== null,
    run: () => actions.spatialTool(null),
  });
  if (!space.panes.some((pane) => pane.id === state.activePane && pane.type === 'folder'))
    commands.push({
      id: 'go-to',
      label: 'Go to folder…',
      group: 'Navigation',
      icon: 'folder',
      shortcut: '⌘L',
      when: windowScope,
      run: actions.goTo,
    });
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
      label: pane.path.split(/[\\/]/).pop() || pane.path,
      group: 'Open planes',
      detail: pane.path,
      aliases: ['plane', 'switch'],
      icon: pane.type === 'folder' ? 'folder' : 'file',
      remember: false,
      when: (context) => windowScope(context) && actions.ready,
      run: () => actions.workspace.focusPane(pane.id),
    });
  const destinations = [
    ...state.saved.favorites,
    ...state.bootstrap.locations,
    ...state.saved.recents.map((path) => ({ path, name: path.split(/[\\/]/).pop() || path })),
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
  commands.push({
    id: 'tasks',
    label: 'Action tasks…',
    group: 'Actions',
    icon: 'command',
    aliases: ['history', 'proposals'],
    when: windowScope,
    run: () => {
      window.dispatchEvent(new Event('viewer:tasks'));
    },
  });
  return [...commands, ...actionCommands()];
}
