import { effectiveWindowSettings } from '../../state/effective-ui';
import type { Pane } from '../../../domain/contracts';
import { parentPath } from '../../../domain/workspaces/planes';
import {
  nextLayout,
  resizeTile,
  tileLayoutLabels,
  tileLayouts,
  type TileLayout,
} from '../../../domain/workspaces/tiling';
import {
  activeWorkspace,
  addRootFolder,
  addScratchPane,
  addTerminalPane,
  getState,
} from '../../state/store';
import { setTiling } from '../../state/workspaces';
import { readingOrder, visiblePlanes } from '../../keys/planes';
import type { CommandDefinition, CommandContext } from '../registry';
import type { WindowScopes } from './scope';
import type { WorkspaceController } from '../../workspace/context';

/** The plane a split adds beside `pane`: one like it, or the kind Settings → Space names. */
function splitPane(
  pane: Pane,
  kind: 'same' | 'folder' | 'terminal' | 'scratch',
): string | undefined {
  const folder =
    pane.type === 'folder' || pane.type === 'terminal' || pane.type === 'server'
      ? pane.path
      : pane.type === 'preview'
        ? parentPath(pane.path)
        : getState().bootstrap.home;
  const chosen =
    kind === 'same'
      ? pane.type === 'terminal'
        ? 'terminal'
        : pane.type === 'scratch'
          ? 'scratch'
          : 'folder'
      : kind;
  if (chosen === 'terminal')
    return addTerminalPane(
      folder,
      pane.type === 'terminal' ? pane.profileID : getState().settings.settings.terminals.profileID,
      true,
    ).id;
  if (chosen === 'scratch') return addScratchPane().id;
  return addRootFolder({ path: folder, workspaceID: activeWorkspace().id })?.id;
}
/**
 * A split of the active plane, right or down: the plane `add` makes (by default what Settings → Space
 * names) joins the tiling after it. `:sp path` and `:vs path` add a plane showing the path. False
 * when nothing was added.
 */
export function splitTile(
  workspace: WorkspaceController,
  direction: 'right' | 'down',
  add?: (pane: Pane) => string | undefined,
): boolean {
  const space = activeWorkspace();
  const active = getState().activePane;
  const tiling = space.tiling;
  const settings = effectiveWindowSettings(getState()).tiling;
  const pane = space.panes.find((item) => item.id === active);
  if (!pane) return false;
  const added = add ? add(pane) : splitPane(pane, settings.splitWith);
  if (!added) return false;
  const base = tiling ? [...tiling.panes] : [active];
  if (!base.includes(active)) base.push(active);
  base.splice(base.indexOf(active) + 1, 0, added);
  setTiling({
    panes: base,
    // a first split goes the way it was asked; later ones keep the layout, as tmux's presets do
    layout:
      base.length === 2
        ? direction === 'right'
          ? 'even-horizontal'
          : 'even-vertical'
        : (tiling?.layout ?? settings.defaultLayout),
    main: tiling?.main ?? 0.6,
  });
  workspace.retile(tiling);
  return true;
}
/**
 * TILING AS TMUX'S PANES (2026-10-23): split the active plane right (prefix %) or down (prefix "),
 * tile the planes in view, step through the layouts (prefix Space), swap, promote to main, grow or
 * shrink the main plane, and untile. The layout follows the window's size.
 */
export function tilingCommands({ actions, state, windowScope }: WindowScopes): CommandDefinition[] {
  const space = activeWorkspace();
  const tiling = space.tiling;
  const active = state.activePane;
  const settings = effectiveWindowSettings(state).tiling;
  const tiled = (context: Parameters<CommandDefinition['when']>[0]) =>
    windowScope(context) && actions.ready && !!tiling;
  const apply = (next: Parameters<typeof setTiling>[0]) => {
    setTiling(next);
    actions.workspace.retile(tiling);
  };
  const split = (direction: 'right' | 'down') => () => {
    splitTile(actions.workspace, direction);
  };
  const swap = (delta: number) => () => {
    if (!tiling) return;
    const panes = [...tiling.panes];
    const index = panes.indexOf(active);
    if (index < 0) return;
    const other = (index + delta + panes.length) % panes.length;
    [panes[index], panes[other]] = [panes[other]!, panes[index]!];
    apply({ ...tiling, panes, tree: undefined });
  };
  const layout = (next: TileLayout) => () =>
    tiling && apply({ ...tiling, layout: next, tree: undefined });
  const main = (delta: number) => () =>
    tiling &&
    apply({ ...tiling, main: Math.min(0.8, Math.max(0.2, tiling.main + delta)), tree: undefined });
  const command = (definition: Omit<CommandDefinition, 'group'>): CommandDefinition => ({
    ...definition,
    group: 'Space',
  });
  return [
    ...(['left', 'right', 'up', 'down'] as const).map((direction) => ({
      id: `tile-resize-${direction}`,
      label: `Grow tile ${direction}`,
      group: 'Space',
      icon: 'frame' as const,
      aliases: ['resize', 'tile'],
      when: (context: CommandContext) => tiled(context) && !!tiling?.panes.includes(active),
      run: () => {
        if (tiling) apply(resizeTile(tiling, active, direction));
      },
    })),
    command({
      id: 'tile-split-right',
      label: 'Split right',
      icon: 'side-by-side',
      aliases: ['split', 'tile', 'tmux', 'vertical split', '%'],
      when: (context) => windowScope(context) && actions.ready && space.panes.length < 200,
      run: split('right'),
    }),
    command({
      id: 'tile-split-down',
      label: 'Split down',
      icon: 'stacked',
      aliases: ['split', 'tile', 'tmux', 'horizontal split'],
      when: (context) => windowScope(context) && actions.ready && space.panes.length < 200,
      run: split('down'),
    }),
    command({
      id: 'tile-visible',
      label: 'Tile the planes in view',
      icon: 'grid',
      aliases: ['tile', 'tiling', 'tmux', 'arrange'],
      when: (context) => windowScope(context) && actions.ready,
      run: () => {
        const planes = readingOrder(visiblePlanes());
        const panes = [...new Set(planes.map((plane) => plane.paneID))].slice(0, 30);
        if (!panes.length) return;
        apply({
          panes,
          layout: panes.length > 3 ? 'tiled' : settings.defaultLayout,
          main: tiling?.main ?? 0.6,
        });
      },
    }),
    command({
      id: 'tile-next-layout',
      label: 'Next tiling layout',
      icon: 'grid',
      aliases: ['layout', 'tmux', 'cycle'],
      when: tiled,
      run: () => tiling && apply({ ...tiling, layout: nextLayout(tiling.layout), tree: undefined }),
    }),
    ...tileLayouts.map((name) =>
      command({
        id: `tile-layout-${name}`,
        label: `Tiling: ${tileLayoutLabels[name]}`,
        icon: tiling?.layout === name ? 'check' : 'grid',
        aliases: ['layout', 'tmux', name],
        when: tiled,
        run: layout(name),
      }),
    ),
    command({
      id: 'tile-swap-next',
      label: 'Swap with the next tile',
      icon: 'right',
      aliases: ['swap', 'tmux'],
      when: (context) => tiled(context) && !!tiling?.panes.includes(active),
      run: swap(1),
    }),
    command({
      id: 'tile-swap-previous',
      label: 'Swap with the previous tile',
      icon: 'left',
      aliases: ['swap', 'tmux'],
      when: (context) => tiled(context) && !!tiling?.panes.includes(active),
      run: swap(-1),
    }),
    command({
      id: 'tile-promote',
      label: 'Make this the main tile',
      icon: 'star',
      aliases: ['main', 'promote', 'tmux'],
      when: (context) => tiled(context) && !!tiling?.panes.includes(active),
      run: () =>
        tiling &&
        apply({
          ...tiling,
          panes: [active, ...tiling.panes.filter((id) => id !== active)],
          tree: undefined,
        }),
    }),
    command({
      id: 'tile-main-grow',
      label: 'Grow the main tile',
      icon: 'resize',
      aliases: ['resize', 'bigger', 'tmux'],
      when: tiled,
      run: main(1 / 12),
    }),
    command({
      id: 'tile-main-shrink',
      label: 'Shrink the main tile',
      icon: 'resize',
      aliases: ['resize', 'smaller', 'tmux'],
      when: tiled,
      run: main(-1 / 12),
    }),
    command({
      id: 'untile',
      label: 'Stop tiling',
      icon: 'close',
      aliases: ['untile', 'free', 'tmux'],
      when: tiled,
      run: () => setTiling(undefined),
    }),
  ];
}
