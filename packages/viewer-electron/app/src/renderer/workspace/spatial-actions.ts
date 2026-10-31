import type { RefObject } from 'react';
import { pluridStateModules, type PluridApplicationHandle } from '@plurid/plurid-react';
import type { PluridStack, TreePlane } from '@plurid/plurid-data';
import type { ProjectLayout } from '../../domain/workspaces/project';
import type { WorkspaceController } from './context';
import { activeWorkspace } from '../state/store';
import { setTiling } from '../state/workspaces';
import { flattenTree, hostID } from './tree';
import { applyTiling } from './tiling';
import { rememberTiling } from './tiling-history';
import { frameWorkspace } from './framing';

/** Saved arrangements use host identities, including the placements a stack will restore. */
export function captureStacks(api: PluridApplicationHandle): NonNullable<ProjectLayout['stacks']> {
  const ids = new Map(flattenTree(api.tree.get()).map((node) => [node.planeID, hostID(node)]));
  return api.planes.stacks().flatMap((stack) => {
    const members = stack.planeIDs.filter((id) => ids.get(id) && stack.previous[id]);
    return members.length < 2
      ? []
      : [
          {
            id: stack.stackID,
            panes: members.map((id) => ids.get(id)!),
            previous: Object.fromEntries(
              members.map((id) => [ids.get(id)!, structuredClone(stack.previous[id]!)]),
            ),
          },
        ];
  });
}

export function restoreStacks(
  stacks: ProjectLayout['stacks'],
  nodes: ReadonlyMap<string, TreePlane>,
): Record<string, PluridStack> {
  return Object.fromEntries(
    (stacks ?? []).flatMap((stack) => {
      const members = stack.panes.filter((id) => nodes.has(id) && stack.previous[id]);
      return members.length < 2
        ? []
        : [
            [
              stack.id,
              {
                stackID: stack.id,
                planeIDs: members.map((id) => nodes.get(id)!.planeID),
                previous: Object.fromEntries(
                  members.map((id) => [
                    nodes.get(id)!.planeID,
                    structuredClone(stack.previous[id]!),
                  ]),
                ),
              },
            ],
          ];
    }),
  );
}

/** Pinning and evidence arrangements share the engine's history and the existing readable tiler. */
export function spatialActions(
  engine: RefObject<PluridApplicationHandle | null>,
  surface: RefObject<HTMLDivElement | null>,
  waitForPlanes: (ids: readonly string[], workspaceID: string) => Promise<void>,
): Pick<
  WorkspaceController,
  | 'pinPane'
  | 'placePane'
  | 'planePinState'
  | 'collapsePinnedPane'
  | 'selectedPaneIDs'
  | 'stackPanes'
  | 'unstackPanes'
  | 'planeStacks'
  | 'comparePanes'
  | 'restorePaneLayout'
> {
  const node = (id: string) =>
    engine.current && flattenTree(engine.current.tree.get()).find((item) => hostID(item) === id);
  const resolve = (ids: readonly string[]) =>
    [...new Set(ids)].flatMap((id) => {
      const found = node(id);
      return found ? [found.planeID] : [];
    });
  return {
    pinPane(id, options) {
      const api = engine.current,
        found = node(id),
        element = surface.current;
      if (!api || !found || !element) return false;
      rememberTiling(api.tree.get(), activeWorkspace().tiling);
      const pinned = api.planes.pin(
        found.planeID,
        options
          ? {
              x: 12,
              y: 12,
              width: Math.max(120, Math.min(options.width ?? 420, element.clientWidth - 24)),
              height: Math.max(
                80,
                Math.min(options.height ?? element.clientHeight - 24, element.clientHeight - 24),
              ),
              anchor: 'top-right',
            }
          : undefined,
      );
      if (pinned && activeWorkspace().tiling?.panes.includes(id)) {
        const tiling = activeWorkspace().tiling!;
        const panes = tiling.panes.filter((member) => member !== id);
        setTiling(panes.length ? { ...tiling, panes } : undefined);
      }
      if (pinned) rememberTiling(api.tree.get(), activeWorkspace().tiling);
      return pinned;
    },
    async placePane(id) {
      const api = engine.current,
        found = node(id);
      if (!api || !found) return 'refused';
      rememberTiling(api.tree.get(), activeWorkspace().tiling);
      const result = await api.planes.place(found.planeID);
      if (engine.current === api && result === 'placed')
        rememberTiling(api.tree.get(), activeWorkspace().tiling);
      return result;
    },
    planePinState(id) {
      const api = engine.current,
        found = node(id);
      return {
        pinnable: !!api && !!found && api.planes.pinnable(found.planeID),
        pinned: !!found?.pinned,
        collapsed: !!found?.pinned?.collapsed,
      };
    },
    collapsePinnedPane(id, collapsed) {
      const api = engine.current,
        found = node(id);
      return !!api && !!found && api.planes.collapse(found.planeID, collapsed);
    },
    selectedPaneIDs() {
      const api = engine.current;
      if (!api) return [];
      const selected = new Set(api.selection.get());
      return flattenTree(api.tree.get())
        .filter((item) => selected.has(item.planeID) && item.show)
        .map(hostID);
    },
    stackPanes(ids) {
      const api = engine.current;
      if (!api || ids.length < 2 || ids.length > 12) return;
      const members = resolve(ids);
      if (members.length !== new Set(ids).size) return;
      rememberTiling(api.tree.get(), activeWorkspace().tiling);
      const stack = api.planes.stack(members);
      if (stack) {
        const tiling = activeWorkspace().tiling;
        if (tiling?.panes.some((id) => ids.includes(id))) setTiling(undefined);
        rememberTiling(api.tree.get(), activeWorkspace().tiling);
        frameWorkspace(engine, surface, [...ids]);
      }
      return stack;
    },
    unstackPanes(reference) {
      const api = engine.current;
      return (
        !!api && api.planes.unstack(typeof reference === 'string' ? reference : resolve(reference))
      );
    },
    planeStacks() {
      const api = engine.current;
      return api ? captureStacks(api).map(({ id, panes }) => ({ id, panes })) : [];
    },
    async comparePanes(ids) {
      const owner = activeWorkspace().id;
      const panes = [...new Set(ids)];
      if (panes.length < 2 || panes.length > 12)
        throw new Error('Choose between two and twelve evidence planes to compare.');
      await waitForPlanes(panes, owner);
      const api = engine.current;
      if (!api || activeWorkspace().id !== owner)
        throw new Error('The workspace changed. Open the comparison again.');
      if (panes.some((id) => node(id)?.pinned))
        throw new Error('Place the evidence planes in space before comparing them.');
      if (
        captureStacks(api).some(
          (stack) =>
            stack.panes.some((id) => panes.includes(id)) &&
            stack.panes.some((id) => !panes.includes(id)),
        )
      )
        throw new Error('Unstack the existing group before comparing only some of its planes.');
      rememberTiling(api.tree.get(), activeWorkspace().tiling);
      api.store.dispatch(pluridStateModules.space.actions.historyBegin());
      try {
        api.planes.unstack(resolve(panes), { animate: false });
        setTiling({ panes, layout: panes.length === 2 ? 'even-horizontal' : 'tiled', main: 0.5 });
        applyTiling(engine, surface);
      } finally {
        api.store.dispatch(pluridStateModules.space.actions.historyEnd());
      }
    },
    restorePaneLayout(layout, ids) {
      const api = engine.current;
      if (!api) return;
      const wanted = new Set(ids);
      const placements = new Map(
        layout.placements.filter((item) => wanted.has(item.id)).map((item) => [item.id, item]),
      );
      const replace = (tree: TreePlane[]): TreePlane[] =>
        tree.map((item) => {
          const placement = placements.get(hostID(item));
          return {
            ...item,
            ...(placement
              ? {
                  location: { ...placement.location },
                  width: placement.width,
                  height: placement.height,
                  show: placement.show,
                  pinned: placement.pinned && structuredClone(placement.pinned),
                  manuallyPositioned: true,
                  sizeMode: 'manual' as const,
                }
              : {}),
            children: item.children && replace(item.children),
          };
        });
      const tree = replace(api.tree.get());
      const nodes = new Map(flattenTree(tree).map((item) => [hostID(item), item]));
      const retained = captureStacks(api).flatMap((stack) => {
        const panes = stack.panes.filter((id) => !wanted.has(id));
        return panes.length < 2
          ? []
          : [
              {
                ...stack,
                panes,
                previous: Object.fromEntries(panes.map((id) => [id, stack.previous[id]!])),
              },
            ];
      });
      const restored = (layout.stacks ?? []).filter((stack) =>
        stack.panes.every((id) => wanted.has(id)),
      );
      rememberTiling(api.tree.get(), activeWorkspace().tiling);
      api.store.dispatch(
        pluridStateModules.space.actions.restoreArrangement({
          tree,
          links: api.getSnapshot().space.links,
          stacks: restoreStacks([...retained, ...restored], nodes),
        }),
      );
      if (activeWorkspace().tiling?.panes.some((id) => wanted.has(id))) setTiling(undefined);
      rememberTiling(api.tree.get(), activeWorkspace().tiling);
      frameWorkspace(engine, surface, [...placements.keys()]);
    },
  };
}
