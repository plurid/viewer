import { useMemo, useRef, type RefObject } from 'react';
import { pluridStateModules, type PluridApplicationHandle } from '@plurid/plurid-react';
import { PLURID_PUBSUB_TOPIC } from '@plurid/plurid-data';
import type { FileEntry } from '../../domain/contracts';
import { matchingPane } from '../../domain/planes';
import {
  activeWorkspace,
  addPane,
  addRootFolder,
  addSearchPane,
  addTerminalPane,
  getState,
  navigate,
  reconcilePanes,
  removePanes,
  setActivePane,
} from '../state/store';
import { rootOwners } from './sessions';
import { repeatedPreviews } from './recovery';
import { flattenTree, hostID } from './tree';
import { frameWorkspace } from './framing';
import type { WorkspaceController } from './context';
/** Owns host-plane identity and creation. Engine routes/IDs stay inside the adapter. */
export function useWorkspaceController({
  engine,
  surface,
  readyRef,
}: {
  engine: RefObject<PluridApplicationHandle | null>;
  surface: RefObject<HTMLDivElement | null>;
  readyRef: RefObject<boolean>;
}): WorkspaceController {
  const pendingOwners = useRef(new Map<string, Map<string, string>>());
  const controller = useMemo<WorkspaceController>(
    () => ({
      newTerminal(target, profileID) {
        const api = engine.current;
        if (!api || !readyRef.current || target.workspaceID !== activeWorkspace().id) return;
        const parent = flattenTree(api.tree.get()).find((node) => hostID(node) === target.paneID);
        if (target.paneID && !parent)
          throw new Error('The originating plane is no longer available.');
        const origin = activeWorkspace().panes.find((pane) => pane.id === target.paneID);
        if (target.panePath && origin?.path !== target.panePath)
          throw new Error('The originating folder changed.');
        const pane = addTerminalPane(
          target.directory,
          profileID || getState().settings.settings.terminals.profileID,
          !parent,
        );
        const pending = pendingOwners.current.get(target.workspaceID) || new Map<string, string>();
        pendingOwners.current.set(target.workspaceID, pending);
        pending.set(pane.id, parent ? target.rootID : pane.id);
        if (parent)
          api.pubsub.publish({
            topic: PLURID_PUBSUB_TOPIC.SPACE_SPAWN_PLANE,
            data: {
              route: `/terminals/${pane.id}`,
              parentPlaneID: parent.planeID,
              framing: 'none',
            },
          });
        frameWorkspace(engine, surface, [pane.id]);
      },
      rootID(id) {
        const space = activeWorkspace();
        return rootOwners(
          engine.current?.tree.get() || [],
          hostID,
          space.roots,
          pendingOwners.current.get(space.id) || new Map(),
        ).get(id);
      },
      newSearch(query, name, root, recursive, content) {
        if (!engine.current || !readyRef.current) return;
        const id = addSearchPane(query, name, root, recursive, content);
        frameWorkspace(engine, surface, [id]);
      },
      newRootFolder(target) {
        if (!engine.current || !readyRef.current) return;
        const pane = addRootFolder(target);
        if (pane)
          frameWorkspace(engine, surface, [pane.id], {
            dock: getState().saved.ui.space.opening === 'dock',
          });
      },
      open(
        entry: FileEntry,
        parentPaneID?: string,
        options?: { another?: boolean; link?: string },
      ) {
        const api = engine.current;
        if (!api || !readyRef.current) return;
        const space = activeWorkspace();
        const tree = api.tree.get();
        const parent =
          parentPaneID && flattenTree(tree).find((node) => hostID(node) === parentPaneID);
        if (parentPaneID && !parent)
          throw new Error('The originating plane is no longer available.');
        const pending = pendingOwners.current.get(space.id) ?? new Map<string, string>();
        pendingOwners.current.set(space.id, pending);
        const owners = rootOwners(tree, hostID, space.roots, pending);
        const rootID = parent ? owners.get(hostID(parent)) : undefined;
        const existing =
          !options?.another &&
          rootID &&
          matchingPane(
            space,
            entry.path,
            entry.directory ? 'folder' : 'preview',
            getState().activePane,
            getState().bootstrap.platform,
            { rootID, owners },
          );
        if (existing) {
          controller.focusPane(existing.id);
          return;
        }
        const linked = !!parent;
        const pane = addPane(entry.path, entry.directory ? 'folder' : 'preview', !linked, {
          keepSeparate: options?.another,
        });
        pending.set(pane.id, rootID ?? pane.id);
        setActivePane(pane.id);
        if (api && linked) {
          api.pubsub.publish({
            topic: PLURID_PUBSUB_TOPIC.SPACE_SPAWN_PLANE,
            data: {
              route: `/${entry.directory ? 'folders' : 'previews'}/${pane.id}`,
              parentPlaneID: parent!.planeID,
              link: options?.link,
              framing: 'none',
            },
          });
          const liveParent = flattenTree(api.tree.get()).find(
            (node) => hostID(node) === parentPaneID,
          );
          const opening = getState().saved.ui.space.opening;
          frameWorkspace(
            engine,
            surface,
            opening === 'pair' && liveParent ? [hostID(liveParent), pane.id] : [pane.id],
            { dock: opening === 'dock' },
          );
        } else
          frameWorkspace(engine, surface, [pane.id], {
            dock: getState().saved.ui.space.opening === 'dock',
          });
      },
      async openPath(path, target) {
        const workspaceID = target?.workspaceID ?? activeWorkspace().id;
        const paneID = target?.paneID ?? getState().activePane;
        const entry = await window.viewer.stat(path);
        if (activeWorkspace().id !== workspaceID) return;
        const current = activeWorkspace().panes.find((pane) => pane.id === paneID);
        if (target?.paneID && !current) return;
        if (entry.directory && current?.type === 'folder' && !target?.linked) {
          navigate(current.id, entry.path);
          controller.focusPane(current.id);
        } else {
          controller.open(entry, current?.id, { another: target?.another, link: target?.link });
        }
      },
      focusPane(id) {
        if (!activeWorkspace().panes.some((pane) => pane.id === id)) return;
        const node =
          engine.current &&
          flattenTree(engine.current.tree.get()).find((node) => hostID(node) === id);
        if (node) {
          engine.current?.tree.open(node.planeID);
        }
        frameWorkspace(engine, surface, [id]);
        setActivePane(id);
      },
      frameAll: () => frameWorkspace(engine, surface),
      dock: (id) => {
        const api = engine.current;
        if (!api) return;
        const node = flattenTree(api.tree.get()).find(
          (node) => hostID(node) === (id || getState().activePane),
        );
        if (node) setActivePane(hostID(node));
        if (api.camera.docked()) api.camera.reveal({ animate: true });
        else api.camera.dock(node?.planeID, { animate: true });
      },
      closePane: (id) => {
        const api = engine.current;
        const node = api && flattenTree(api.tree.get()).find((node) => hostID(node) === id);
        if (!node) return;
        api!.tree.remove(node.planeID);
        removePanes(flattenTree([node]).map(hostID));
      },
      consolidatePreviews: () => {
        const api = engine.current;
        if (!api) return;
        const active = getState().activePane;
        const groups = repeatedPreviews(
          activeWorkspace(),
          api.tree.get(),
          active,
          getState().bootstrap.platform,
        );
        if (!groups.length) return;
        // The exported engine history actions group all removals into one undoable edit.
        api.store.dispatch(pluridStateModules.space.actions.historyBegin());
        try {
          const closed = groups.flatMap((group) => group.close);
          for (const node of closed) api.tree.remove(node.planeID);
          removePanes(closed.map(hostID));
        } finally {
          api.store.dispatch(pluridStateModules.space.actions.historyEnd());
        }
        controller.focusPane(
          hostID(groups.find((group) => hostID(group.keep) === active)?.keep ?? groups[0].keep),
        );
      },
      arrange: (axis) => {
        const api = engine.current;
        if (!api) return;
        api.selection.set(
          flattenTree(api.tree.get())
            .filter((node) => node.show)
            .map((node) => node.planeID),
        );
        api.selection.align(axis === 'x' ? 'top' : 'left');
        api.selection.distribute(axis);
        api.selection.clear();
        frameWorkspace(engine, surface);
      },
      undo: () => {
        engine.current?.history.undo();
        if (engine.current) reconcilePanes(flattenTree(engine.current.tree.get()).map(hostID));
      },
      redo: () => {
        engine.current?.history.redo();
        if (engine.current) reconcilePanes(flattenTree(engine.current.tree.get()).map(hostID));
      },
    }),
    [],
  );
  return controller;
}
