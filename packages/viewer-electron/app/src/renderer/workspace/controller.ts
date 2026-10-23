import type { PlanePlacement } from '../../domain/project';
import { useMemo, useRef, type RefObject } from 'react';
import { pluridStateModules, type PluridApplicationHandle } from '@plurid/plurid-react';
import { PLURID_PUBSUB_TOPIC, type TreePlane, type TreePlaneLocation } from '@plurid/plurid-data';
import type { FileEntry } from '../../domain/contracts';
import { sameSourceVersion, sourceVersion, type EvidenceNavigation } from '../../domain/inspection';
import { baseName, matchingPane, normalizedPanePath } from '../../domain/planes';
import {
  activeWorkspace,
  addPane,
  addRootFolder,
  addScratchPane,
  addSearchPane,
  addTerminalPane,
  addCollectionPane,
  getState,
  installProject,
  consumeProjectLayout,
  updatePane,
  changePreferences,
  report,
  reconcilePanes,
  removePanes,
  setActivePane,
} from '../state/store';
import { focusPlane, rootOwners } from './sessions';
import { editingPlane } from '../editing/planes';
import { continueEditing } from '../editing/sessions';
import { choosePreview } from '../previews/registry';
import { repeatedPreviews } from './recovery';
import { flattenTree, hostID, paneRoute, parentPaneID, linkedPaneID } from './tree';
import { cancelWorkspaceFraming, frameWorkspace } from './framing';
import { applyTiling } from './tiling';
import { explodePlan } from '../../domain/explode';
import { folderPairArea, folderPairGeometry } from './folder-pair';
import { frontPlaneDepth, planeLayoutGeometry } from './plane-layout';
import type { WorkspaceController } from './context';
import { openWorkspacePath } from './open-path';
/** Owns host-plane identity and creation. Engine routes/IDs stay inside the adapter. */
/**
 * Makes a plane the active one, as following a link does: it takes the wheel (plurid's
 * click-to-scroll owner, whose header is tinted) and the keys. The camera alone moved there, and the
 * plane clicked from stayed active (2026-10-23). Plurid's selection, for moving planes, is left as
 * it is. A plane just spawned is activated once it is in the tree.
 */
function activatePlane(engine: RefObject<PluridApplicationHandle | null>, id: string): void {
  const until = performance.now() + 1500;
  const attempt = () => {
    const api = engine.current;
    const node = api && flattenTree(api.tree.get()).find((item) => hostID(item) === id);
    if (api && node) {
      api.store.dispatch(pluridStateModules.ui.actions.setScrollPlaneID(node.planeID));
      focusPlane(id);
    } else if (performance.now() < until) requestAnimationFrame(attempt);
  };
  attempt();
}
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
        // An exact arrangement write: setTree reconciles against the live tree and would
        // keep every plane that is already pinned, including by an earlier restore, in place.
        api.store.dispatch(
          pluridStateModules.space.actions.restoreArrangement({
            tree: roots,
            links: api.getSnapshot().space.links,
          }),
        );
        // Planes outside the arrangement have left the engine. Close their records before
        // the roots change, so none lingers unseen and arrangement Undo restores it as it was.
        reconcilePanes(flattenTree(roots).map(hostID));
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
      newScratch() {
        if (!engine.current || !readyRef.current) return;
        const pane = addScratchPane();
        setActivePane(pane.id);
        frameWorkspace(engine, surface, [pane.id], {
          dock: getState().saved.ui.space.opening === 'dock',
        });
      },
      newRootFolder(target) {
        if (!engine.current || !readyRef.current) return;
        const pane = addRootFolder(target);
        if (pane)
          frameWorkspace(engine, surface, [pane.id], {
            dock: getState().saved.ui.space.opening === 'dock',
          });
      },
      splitFolder(target, axis) {
        const api = engine.current;
        const element = surface.current;
        const space = activeWorkspace();
        const folder = space.panes.find((pane) => pane.id === target.paneID);
        if (
          !api ||
          !element ||
          !readyRef.current ||
          target.workspaceID !== space.id ||
          folder?.type !== 'folder' ||
          folder.path !== target.path
        )
          return;
        if (space.panes.length >= 200)
          throw new Error(
            'This workspace has 200 planes. Close a plane or create another workspace.',
          );
        const previous = api.tree.get();
        const nodes = flattenTree(previous);
        const source = nodes.find((node) => hostID(node) === folder.id);
        if (!source) throw new Error('The originating folder plane is no longer available.');
        // Bring the pair in front of existing sheets, including a previous split.
        // Bound every rotated corner so an older plane cannot cover either half.
        const front = frontPlaneDepth(nodes);
        const links = api.getSnapshot().space.links;
        const geometry = folderPairGeometry(
          { width: element.clientWidth, height: element.clientHeight },
          folderPairArea(element),
          { ...source.location, translateZ: front },
          axis,
        );
        cancelWorkspaceFraming(api);
        let copyID: string | undefined;
        api.store.dispatch(pluridStateModules.space.actions.historyBegin());
        try {
          const copy = addPane(folder.path, 'folder', true);
          copyID = copy.id;
          updatePane(copy.id, {
            sidebar: folder.sidebar ? { ...folder.sidebar } : undefined,
          });
          // The topic builds the root synchronously; this Plurid version's setView
          // handle only schedules it. Read the live view so rapid invocations keep every root.
          api.pubsub.publish({
            topic: PLURID_PUBSUB_TOPIC.VIEW_SET_PLANES,
            data: {
              view: [
                ...api
                  .getSnapshot()
                  .space.view.map((entry) => (typeof entry === 'string' ? entry : entry.plane)),
                paneRoute('folder', copy.id),
              ],
            },
          });
          const added = api.tree.get().find((node) => hostID(node) === copy.id);
          if (!added) throw new Error('The second folder plane could not open. Try again.');
          const place = (node: TreePlane, location: TreePlaneLocation): TreePlane => ({
            ...node,
            width: geometry.width,
            height: geometry.height,
            location,
            sizeMode: 'manual',
            manuallyPositioned: true,
            show: true,
          });
          const replace = (nodes: TreePlane[]): TreePlane[] =>
            nodes.map((node) =>
              node.planeID === source.planeID
                ? place(node, geometry.first)
                : node.children?.length
                  ? { ...node, children: replace(node.children) }
                  : node,
            );
          // setTree reconciles authored nodes against their old manual size/pose.
          // An exact arrangement write also permits splitting an already pinned plane.
          api.store.dispatch(
            pluridStateModules.space.actions.restoreArrangement({
              tree: [...replace(previous), place(added, geometry.second)],
              links,
            }),
          );
          api.pubsub.publish({ topic: PLURID_PUBSUB_TOPIC.ISOLATE_PLANE, data: { planeID: '' } });
          setActivePane(folder.id);
          // A docked plane follows geometry changes for a commit. Frame after that
          // and the measured boxes settle, so the old dock cannot reclaim this camera.
          frameWorkspace(engine, surface, [folder.id, copy.id], { camera: geometry.camera });
        } catch (error) {
          api.pubsub.publish({ topic: PLURID_PUBSUB_TOPIC.SET_TREE, data: { tree: previous } });
          api.store.dispatch(
            pluridStateModules.space.actions.restoreArrangement({ tree: previous, links }),
          );
          if (copyID) removePanes([copyID]);
          throw error;
        } finally {
          api.store.dispatch(pluridStateModules.space.actions.historyEnd());
        }
      },
      open(
        entry: FileEntry,
        parentPaneID?: string,
        options?: {
          another?: boolean;
          link?: string;
          evidence?: EvidenceNavigation;
          activate?: boolean;
          edit?: boolean;
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
          controller.focusPane(existing.id, { activate: options?.activate });
          if (options?.edit) editingPlane(existing.id)?.edit?.();
          return;
        }
        const linked = !!parent && !options?.another;
        const pane = addPane(entry.path, entry.directory ? 'folder' : 'preview', !linked, {
          keepSeparate: options?.another,
        });
        pending.set(pane.id, linked ? (rootID ?? pane.id) : pane.id);
        if (pane.type === 'preview' && options?.evidence)
          updatePane(pane.id, { evidence: options.evidence });
        // its text preview starts editing when it mounts; any other preview has no editor to start
        if (options?.edit && pane.type === 'preview' && choosePreview(entry).id === 'text')
          continueEditing(pane.id, crypto.randomUUID());
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
        if (options?.activate) activatePlane(engine, pane.id);
      },
      openPath: (path, target): Promise<void> =>
        openWorkspacePath(path, target, controller).then(() => {}),
      focusPane(id, options) {
        if (!activeWorkspace().panes.some((pane) => pane.id === id)) return;
        const node =
          engine.current &&
          flattenTree(engine.current.tree.get()).find((node) => hostID(node) === id);
        const api = engine.current;
        // a plane already on screen (hints, directional focus) becomes active where it is
        if (options?.frame === false) {
          setActivePane(id);
          if (options.activate) activatePlane(engine, id);
          return;
        }
        if (node && api) {
          api.tree.open(node.planeID);
          const docked = api.camera.docked();
          // Folder navigation retains the current presentation. Framing a docked
          // page would reveal space, even when the destination is the same plane.
          if (docked && docked !== node.planeID) api.camera.dock(node.planeID, { animate: true });
          else if (!docked) frameWorkspace(engine, surface, [id]);
        } else frameWorkspace(engine, surface, [id]);
        setActivePane(id);
        if (options?.activate) activatePlane(engine, id);
      },
      frameAll: () => frameWorkspace(engine, surface),
      // the space's named views are plurid's bookmarks, saved with the workspace's arrangement
      bookmarks: () =>
        (engine.current?.bookmarks.get() ?? [])
          .filter((entry) => entry.source === 'bookmark' && !!entry.camera)
          .map(({ name, label }) => ({ name, label })),
      saveBookmark: (name) => engine.current?.bookmarks.save(name),
      goBookmark(name, options) {
        const api = engine.current;
        if (
          !api?.bookmarks.get().some((entry) => entry.source === 'bookmark' && entry.name === name)
        )
          return false;
        api.bookmarks.go(name, { animate: true, easing: 'in-out-cubic', ...options });
        return true;
      },
      removeBookmark: (name) => engine.current?.bookmarks.remove(name),
      retile: () => applyTiling(engine, surface),
      async explode(id, depth) {
        const api = engine.current;
        const space = activeWorkspace();
        const pane = space.panes.find((item) => item.id === id);
        if (!api || !readyRef.current || pane?.type !== 'folder') return 0;
        const limit = Math.min(60, 200 - space.panes.length);
        if (limit <= 0) throw new Error('This workspace has 200 planes. Close some first.');
        const plan = await explodePlan(
          pane.path,
          depth,
          (path) => window.viewer.list(path).then((listing) => listing.entries),
          { limit, showHidden: pane.showHidden },
        );
        if (!plan.length) throw new Error(`“${baseName(pane.path)}” has no subfolders to open.`);
        // the workspace or the plane changed while the folders were read
        const root = flattenTree(api.tree.get()).find((node) => hostID(node) === id);
        if (activeWorkspace().id !== space.id || !root) return 0;
        const pending = pendingOwners.current.get(space.id) || new Map<string, string>();
        pendingOwners.current.set(space.id, pending);
        const owner = controller.rootID(id) || id;
        const planes = new Map([[pane.path, root.planeID]]);
        cancelWorkspaceFraming(api);
        api.history.transaction(() => {
          for (const { path, parent } of plan) {
            const parentPlane = planes.get(parent);
            if (!parentPlane) continue;
            const child = addPane(path, 'folder', false, { keepSeparate: true, remember: false });
            updatePane(child.id, { exploded: id });
            pending.set(child.id, owner);
            const planeID = api.tree.spawn(paneRoute('folder', child.id), parentPlane);
            if (planeID) planes.set(path, planeID);
          }
        });
        setActivePane(id);
        frameWorkspace(engine, surface);
        return planes.size - 1;
      },
      collapse(id) {
        const api = engine.current;
        const exploded = activeWorkspace().panes.filter(
          (pane) => pane.type === 'folder' && pane.exploded === id,
        );
        if (!api || !exploded.length) return;
        // closing a plane closes those under it: each exploded plane once, from the top
        api.history.transaction(() => {
          for (const pane of exploded)
            if (activeWorkspace().panes.some((item) => item.id === pane.id))
              controller.closePane(pane.id);
        });
        setActivePane(id);
        frameWorkspace(engine, surface, [id]);
      },
      renameBookmark: (from, to) => engine.current?.bookmarks.rename(from, to),
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
      subtree: (id) => {
        const api = engine.current;
        const node = api && flattenTree(api.tree.get()).find((node) => hostID(node) === id);
        return node ? flattenTree([node]).map(hostID) : [id];
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
      layoutPlane(target, edit) {
        const api = engine.current;
        const element = surface.current;
        const space = activeWorkspace();
        if (
          !api ||
          !element ||
          !readyRef.current ||
          target.workspaceID !== space.id ||
          !space.panes.some((pane) => pane.id === target.paneID)
        )
          return;
        const previous = api.tree.get();
        const nodes = flattenTree(previous);
        const source = nodes.find((node) => hostID(node) === target.paneID);
        if (!source) return;
        const geometry = planeLayoutGeometry(
          { width: element.clientWidth, height: element.clientHeight },
          folderPairArea(element),
          source,
          api.camera.get(),
          edit,
          frontPlaneDepth(nodes),
        );
        const replace = (tree: TreePlane[]): TreePlane[] =>
          tree.map((node) =>
            node.planeID === source.planeID
              ? {
                  ...node,
                  width: geometry.width,
                  height: geometry.height,
                  location: geometry.location,
                  sizeMode: 'manual',
                  manuallyPositioned: true,
                  show: true,
                }
              : node.children?.length
                ? { ...node, children: replace(node.children) }
                : node,
          );
        cancelWorkspaceFraming(api);
        api.store.dispatch(pluridStateModules.space.actions.historyBegin());
        try {
          api.store.dispatch(
            pluridStateModules.space.actions.restoreArrangement({
              tree: replace(previous),
              links: api.getSnapshot().space.links,
            }),
          );
          api.pubsub.publish({ topic: PLURID_PUBSUB_TOPIC.ISOLATE_PLANE, data: { planeID: '' } });
        } finally {
          api.store.dispatch(pluridStateModules.space.actions.historyEnd());
        }
        setActivePane(target.paneID);
        frameWorkspace(engine, surface, [target.paneID], { camera: geometry.camera });
      },
      editPlane(target, mode) {
        const api = engine.current;
        if (
          !api ||
          !readyRef.current ||
          target.workspaceID !== activeWorkspace().id ||
          !activeWorkspace().panes.some((pane) => pane.id === target.paneID)
        )
          return;
        const node = flattenTree(api.tree.get()).find((node) => hostID(node) === target.paneID);
        if (!node) return;
        if (api.camera.docked()) controller.layoutPlane(target, {});
        else cancelWorkspaceFraming(api);
        changePreferences((ui) => ({
          ...ui,
          space: {
            ...ui.space,
            planeHeaders: true,
            ...(mode === 'move' ? { dragging: true } : { resizing: true }),
          },
        }));
        controller.setTransformTool(null);
        if (mode === 'resize')
          api.pubsub.publish({
            topic: PLURID_PUBSUB_TOPIC.CONFIGURATION,
            data: { elements: { plane: { resizable: true } } },
          });
        api.pubsub.publish({ topic: PLURID_PUBSUB_TOPIC.SPACE_GRAB, data: { on: false } });
        api.selection.set([node.planeID]);
        setActivePane(target.paneID);
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
