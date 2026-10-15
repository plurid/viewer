import type { PlanePlacement } from '../../domain/project';
import { useMemo, useRef, type RefObject } from 'react';
import { pluridStateModules, type PluridApplicationHandle } from '@plurid/plurid-react';
import { PLURID_PUBSUB_TOPIC, type TreePlane } from '@plurid/plurid-data';
import type { FileEntry } from '../../domain/contracts';
import { sameSourceVersion, sourceVersion, type EvidenceNavigation } from '../../domain/inspection';
import { matchingPane, normalizedPanePath } from '../../domain/planes';
import {
  activeWorkspace,
  addPane,
  addRootFolder,
  addSearchPane,
  addTerminalPane,
  addCollectionPane,
  getState,
  installProject,
  consumeProjectLayout,
  updatePane,
  report,
  reconcilePanes,
  removePanes,
  setActivePane,
} from '../state/store';
import { rootOwners } from './sessions';
import { repeatedPreviews } from './recovery';
import { flattenTree, hostID, paneRoute, parentPaneID, linkedPaneID } from './tree';
import { frameWorkspace } from './framing';
import type { WorkspaceController } from './context';
import { openWorkspacePath } from './open-path';
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
  const controller: WorkspaceController = useMemo<WorkspaceController>(
    () => ({
      // Rows ask whether a linked plane exists; only tree changes can alter that, not
      // the camera updates the engine store also publishes every frame.
      subscribeLinks: (listener) => {
        const api = engine.current;
        if (!api) return () => {};
        let tree = api.tree.get();
        return api.store.subscribe(() => {
          const next = api.tree.get();
          if (next === tree) return;
          tree = next;
          listener();
        });
      },
      parentPaneID: (id) =>
        engine.current ? parentPaneID(engine.current.tree.get(), id) : undefined,
      linkedPaneID: (id, entry) =>
        engine.current
          ? linkedPaneID(
              engine.current.tree.get(),
              activeWorkspace(),
              id,
              entry,
              getState().bootstrap.platform,
            )
          : undefined,
      existingPaneID(id, entry) {
        const direct = controller.linkedPaneID(id, entry);
        if (direct) return direct;
        const nodes = new Set(
          engine.current ? flattenTree(engine.current.tree.get()).map(hostID) : [],
        );
        const path = normalizedPanePath(entry.path, getState().bootstrap.platform);
        const matches = activeWorkspace().panes.filter(
          (pane) =>
            nodes.has(pane.id) &&
            pane.type === (entry.directory ? 'folder' : 'preview') &&
            normalizedPanePath(pane.path, getState().bootstrap.platform) === path,
        );
        const owners = engine.current
          ? rootOwners(
              engine.current.tree.get(),
              hostID,
              activeWorkspace().roots,
              new Map<string, string>(),
            )
          : new Map<string, string>();
        return (
          matches.find((pane) => owners.get(pane.id) === owners.get(id))?.id ?? matches.at(-1)?.id
        );
      },
      async openEvidence(evidence, parentPaneID) {
        const origin = activeWorkspace().id;
        const entry = await window.viewer.stat(evidence.path);
        if (origin !== activeWorkspace().id)
          throw new Error('The workspace changed. Open the result again.');
        if (!sameSourceVersion(sourceVersion(entry), evidence.version))
          throw new Error(
            'This search evidence is stale. Refresh the index before opening its location.',
          );
        controller.open(entry, parentPaneID, { evidence });
      },
      captureLayout() {
        const api = engine.current;
        if (!api) throw new Error('Wait for the workspace to finish opening.');
        const placements: PlanePlacement[] = [];
        const visit = (nodes: TreePlane[], parent?: string) => {
          for (const node of nodes) {
            const id = hostID(node);
            if (!activeWorkspace().panes.some((pane) => pane.id === id)) continue;
            placements.push({
              id,
              parent,
              location: { ...node.location },
              width: node.width,
              height: node.height,
              show: node.show,
              bridge: {
                length: node.bridgeLength,
                side: node.bridgeSide,
                offset: node.bridgeOffset,
                angle: node.planeAngle,
              },
            });
            visit(node.children || [], id);
          }
        };
        visit(api.tree.get());
        const docked = flattenTree(api.tree.get()).find(
          (node) => node.planeID === api.camera.docked(),
        );
        return {
          placements,
          active: getState().activePane || undefined,
          docked: docked ? hostID(docked) : undefined,
        };
      },
      restoreLayout(layout) {
        const api = engine.current;
        if (!api) throw new Error('Wait for the workspace to finish opening.');
        const nodes = new Map(flattenTree(api.tree.get()).map((node) => [hostID(node), node]));
        const tree = new Map<string, TreePlane>();
        for (const placement of layout.placements) {
          const node = nodes.get(placement.id);
          if (!node)
            throw new Error(
              'This arrangement needs a plane that is no longer open. Reload the saved project to restore it.',
            );
          tree.set(placement.id, {
            ...node,
            children: [],
            location: { ...placement.location },
            width: placement.width,
            height: placement.height,
            show: placement.show,
            manuallyPositioned: true,
            sizeMode: 'manual',
            spawnedByLinkID: undefined,
            bridgeLength: placement.bridge?.length,
            bridgeSide: placement.bridge?.side,
            bridgeOffset: placement.bridge?.offset,
            planeAngle: placement.bridge?.angle,
          });
        }
        const roots: TreePlane[] = [];
        for (const placement of layout.placements) {
          const node = tree.get(placement.id)!;
          if (placement.parent) tree.get(placement.parent)!.children!.push(node);
          else roots.push(node);
        }
        api.store.dispatch(pluridStateModules.space.actions.setTree(roots));
        consumeProjectLayout(layout);
        if (layout.active) setActivePane(layout.active);
        const docked = layout.docked && tree.get(layout.docked);
        if (docked) api.camera.dock(docked.planeID, { animate: false });
        else {
          api.camera.reveal({ animate: false });
          frameWorkspace(engine, surface);
        }
      },
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
              route: paneRoute('terminal', pane.id),
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
      openCollection(id) {
        if (!engine.current || !readyRef.current) return;
        const paneID = addCollectionPane(id);
        frameWorkspace(engine, surface, [paneID]);
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
        options?: {
          another?: boolean;
          link?: string;
          evidence?: EvidenceNavigation;
        },
      ) {
        if (!entry.directory && entry.name === 'viewer.project.jsonc') {
          void window.viewer
            .project({ kind: 'read', file: entry.path })
            .then((document) => {
              if (document && typeof document === 'object') return installProject(document);
            })
            .catch(report);
          return;
        }
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
          if (existing.type === 'preview' && options?.evidence)
            updatePane(existing.id, { evidence: options.evidence });
          controller.focusPane(existing.id);
          return;
        }
        const linked = !!parent && !options?.another;
        const pane = addPane(entry.path, entry.directory ? 'folder' : 'preview', !linked, {
          keepSeparate: options?.another,
        });
        pending.set(pane.id, linked ? (rootID ?? pane.id) : pane.id);
        if (pane.type === 'preview' && options?.evidence)
          updatePane(pane.id, { evidence: options.evidence });
        setActivePane(pane.id);
        if (api && linked) {
          api.pubsub.publish({
            topic: PLURID_PUBSUB_TOPIC.SPACE_SPAWN_PLANE,
            data: {
              route: paneRoute(entry.directory ? 'folder' : 'preview', pane.id),
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
      openPath: (path, target): Promise<void> =>
        openWorkspacePath(path, target, controller).then(() => {}),
      focusPane(id) {
        if (!activeWorkspace().panes.some((pane) => pane.id === id)) return;
        const node =
          engine.current &&
          flattenTree(engine.current.tree.get()).find((node) => hostID(node) === id);
        const api = engine.current;
        if (node && api) {
          api.tree.open(node.planeID);
          const docked = api.camera.docked();
          // Folder navigation retains the current presentation. Framing a docked
          // page would reveal space, even when the destination is the same plane.
          if (docked && docked !== node.planeID) api.camera.dock(node.planeID, { animate: true });
          else if (!docked) frameWorkspace(engine, surface, [id]);
        } else frameWorkspace(engine, surface, [id]);
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
        const keep = groups.find((group) => hostID(group.keep) === active)?.keep ?? groups[0]?.keep;
        if (keep) controller.focusPane(hostID(keep));
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
      arrangementHistory: () => {
        const history = engine.current?.history.get();
        return { canUndo: !!history?.canUndo, canRedo: !!history?.canRedo };
      },
      isDocked: () => !!engine.current?.camera.docked(),
      hasRepeatedPreviews: () =>
        !!engine.current &&
        repeatedPreviews(
          activeWorkspace(),
          engine.current.tree.get(),
          getState().activePane,
          getState().bootstrap.platform,
        ).length > 0,
      transformTool: () => {
        const mode = engine.current?.getSnapshot().configuration.space.transformMode;
        return mode === 'ROTATION'
          ? 'rotate'
          : mode === 'SCALE'
            ? 'scale'
            : mode === 'TRANSLATION'
              ? 'translate'
              : null;
      },
      setTransformTool: (tool) =>
        engine.current?.pubsub.publish({
          topic: PLURID_PUBSUB_TOPIC.CONFIGURATION,
          data: {
            space: {
              transformMode:
                tool === 'rotate'
                  ? 'ROTATION'
                  : tool === 'scale'
                    ? 'SCALE'
                    : tool === 'translate'
                      ? 'TRANSLATION'
                      : 'ALL',
            },
          },
        }),
      selectForDrag: (id) => {
        const api = engine.current;
        const node = api && flattenTree(api.tree.get()).find((item) => hostID(item) === id);
        if (api && node && !api.selection.get().includes(node.planeID))
          api.selection.set([node.planeID]);
      },
      subscribeEngine: (listener) => engine.current?.store.subscribe(listener) ?? (() => {}),
      undo: () => {
        engine.current?.history.undo();
        if (engine.current) reconcilePanes(flattenTree(engine.current.tree.get()).map(hostID));
      },
      redo: () => {
        engine.current?.history.redo();
        if (engine.current) reconcilePanes(flattenTree(engine.current.tree.get()).map(hostID));
      },
    }),
    [engine, readyRef, surface],
  );
  return controller;
}
