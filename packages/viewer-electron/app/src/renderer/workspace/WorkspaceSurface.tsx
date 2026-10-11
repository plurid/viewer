import { memo, useEffect, useMemo, useState, useSyncExternalStore, type RefObject } from 'react';
import {
  PluridApplication,
  usePluridApi,
  usePluridPlane,
  type PluridApplicationHandle,
} from '@plurid/plurid-react';
import {
  PLURID_PUBSUB_TOPIC,
  type PluridApi,
  type PluridPartialConfiguration,
  type PluridPlane,
  type TreePlane,
} from '@plurid/plurid-data';
import { activeWorkspace, setActivePane, storageAdapter, useViewer } from '../state/store';
import { SearchExplorer } from '../explorer/SearchExplorer';
import { FolderExplorer } from '../explorer/FolderExplorer';
import { PreviewHost } from '../previews/PreviewHost';
import { Empty } from '../ui/primitives';
import { Sidebar } from '../ui/Sidebar';
import { PlaneHeader } from './PlaneHeader';
import { frameWorkspace, refitWorkspace } from './framing';
export { frameWorkspace } from './framing';
import { focusFiles } from './sessions';
import { useWorkspace } from './context';
import { looks } from './look';

export function flattenTree(tree: TreePlane[]): TreePlane[] {
  return tree.flatMap((node) => [node, ...flattenTree(node.children ?? [])]);
}
export function hostID(node: TreePlane): string {
  return node.routeDivisions.plane.parameters.id || node.routeDivisions.path.parameters.id || '';
}
const FolderScene = memo(function FolderScene({ id, engineID }: { id: string; engineID?: string }) {
  return (
    <div className="folder-plane">
      <Sidebar paneID={id} />
      <FolderExplorer id={id} engineID={engineID} />
    </div>
  );
});
function FolderContent() {
  const plane = usePluridPlane();
  return <FolderScene id={plane.parameters.id} engineID={plane.planeID} />;
}
function PreviewContent() {
  const plane = usePluridPlane();
  const api = usePluridApi();
  const record = useViewer((state) =>
    activeWorkspace(state).panes.find((item) => item.id === plane.parameters.id),
  );
  const interactive = useSyncExternalStore(
    api.store.subscribe,
    () =>
      !api.getSnapshot().ui.grabMode &&
      api.getSnapshot().configuration.space.transformMode === 'ALL',
  );
  if (!record) return <Empty title="Preview is unavailable" />;
  return (
    <div className="preview-plane" onPointerDownCapture={() => setActivePane(record.id)}>
      <PreviewHost
        path={record.path}
        paneID={record.id}
        active={plane.shown && plane.culled === 'visible'}
        interactive={interactive}
      />
    </div>
  );
}
function SearchContent() {
  const plane = usePluridPlane();
  return <SearchExplorer id={plane.parameters.id} />;
}
const planes: PluridPlane<React.ComponentType>[] = [
  { route: '/folders/:id', component: FolderContent },
  { route: '/searches/:id', component: SearchContent },
  { route: '/previews/:id', component: PreviewContent },
];
export function WorkspaceSurface({
  engine,
  surface,
  onReady,
}: {
  engine: RefObject<PluridApplicationHandle | null>;
  surface: RefObject<HTMLDivElement | null>;
  onReady: () => void;
}) {
  const space = useViewer(activeWorkspace);
  const look = useViewer((state) => state.saved.look);
  const workspace = useWorkspace();
  const preferences = useViewer((state) => state.saved.ui.space);
  const [size, setSize] = useState({ width: 992, height: 692 });
  const [api, setApi] = useState<PluridApi | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        const next = { width: Math.round(width), height: Math.round(height) };
        setSize((previous) =>
          previous.width === next.width && previous.height === next.height ? previous : next,
        );
        refitWorkspace(engine, surface);
      }
    });
    if (surface.current) observer.observe(surface.current);
    return () => observer.disconnect();
  }, [surface]);
  const view = useMemo(
    () =>
      space.roots.map((id) => {
        const pane = space.panes.find((item) => item.id === id);
        return `/${pane?.type === 'folder' ? 'folders' : pane?.type === 'search' ? 'searches' : 'previews'}/${id}`;
      }),
    [space.roots],
  );
  const storage = useMemo(() => storageAdapter(space.id), [space.id]);
  const configuration = useMemo<PluridPartialConfiguration>(
    () => ({
      global: { look: looks[look] },
      space: {
        dimensions: { width: '100%', height: '100%' },
        presentation: 'space',
        transformOrigin: { show: preferences.origin },
        // Workspace persistence owns navigation; a shared window URL must not
        // restore a plane belonging to another workspace.
        docking: { url: false },
        clipboard: false,
        gestures: { wheel: 'plane', dragHandle: 'chrome' },
        shortcuts: {
          disabled: ['palette', 'copy', 'cut', 'paste', 'undo', 'redo', 'duplicateSelection'],
        },
        culling: {
          enabled: true,
          distance: 6000,
          freezeDistance: 3500,
          detach: { mode: 'unmount', delay: 1500, max: 40 },
        },
        navigation: { onClose: 'parent', framing: { fill: 0.82 }, childFraming: 'plane' },
      },
      elements: {
        minimap: { show: preferences.minimap },
        viewcube: { show: preferences.viewcube },
        toolbar: { show: preferences.toolbar },
        shortcuts: { show: false },
        palette: { show: false },
        // Viewer owns frame/dock commands in the workspace header. The engine's
        // floating duplicate controls would cover preview actions when docked.
        dockRail: { show: false },
        // Automatic dimensions use the engine's live configuration; changing the
        // registered routes would reconstruct its store and discard linked planes.
        plane: {
          width: Math.max(380, Math.min(960, size.width - 32)),
          height: Math.max(300, Math.min(660, size.height - 72)),
          controls: { show: preferences.planeHeaders },
          resizable: preferences.resizing,
          backface: 'visible',
        },
      },
    }),
    [look, size, preferences],
  );
  useEffect(() => {
    if (!api) return;
    let publishing = false;
    const synchronize = () => {
      if (publishing || api.store !== engine.current?.store) return;
      const { elements, space } = api.getSnapshot().configuration;
      if (
        elements.toolbar.show === preferences.toolbar &&
        elements.minimap?.show === preferences.minimap &&
        elements.viewcube.show === preferences.viewcube &&
        elements.plane.controls.show === preferences.planeHeaders &&
        elements.plane.resizable === preferences.resizing &&
        elements.plane.backface === 'visible' &&
        space.navigation?.childFraming === 'plane' &&
        space.transformOrigin.show === preferences.origin
      )
        return;
      // Saved engine configuration must not undo the host's preference migration,
      // including when the engine restores its measured tree after hydration.
      publishing = true;
      api.pubsub.publish({ topic: PLURID_PUBSUB_TOPIC.CONFIGURATION, data: configuration });
      publishing = false;
    };
    synchronize();
    return api.store.subscribe(synchronize);
  }, [api, configuration, preferences, engine]);
  return (
    <div
      className="workspace-surface"
      ref={surface}
      onKeyDownCapture={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const hit = (event.target as Element).closest<HTMLButtonElement>(
          'button[data-plurid-minimap-plane]',
        );
        if (!hit) return;
        // Keep the engine/window Enter and Space shortcuts from taking a native
        // minimap button's activation. Its click owns one camera navigation.
        event.preventDefault();
        event.stopPropagation();
        hit.click();
      }}
      onClickCapture={(event) => {
        const hit = (event.target as Element).closest<HTMLElement>('[data-plurid-minimap-plane]');
        if (!hit || !engine.current) return;
        const node = flattenTree(engine.current.tree.get()).find(
          (node) => node.planeID === hit.dataset.pluridMinimapPlane,
        );
        if (node && activeWorkspace().panes.some((pane) => pane.id === hostID(node))) {
          setActivePane(hostID(node));
          if (event.detail) focusFiles(hostID(node));
        }
        // Native minimap navigation frames the plane. Only bind the host context here;
        // issuing a second camera command would interrupt the engine's tween.
      }}
    >
      <PluridApplication
        key={space.id}
        ref={engine}
        id={`viewer-${space.id}`}
        planes={planes}
        view={view}
        configuration={configuration}
        useLocalStorage
        storageAdapter={storage}
        onReady={(api) => {
          setApi(api);
          onReady();
          if (!Object.keys(space.arrangement).length)
            requestAnimationFrame(() => frameWorkspace(engine, surface));
          else {
            const active = space.activePane || space.roots[0];
            if (active)
              requestAnimationFrame(() =>
                frameWorkspace(engine, surface, [active], { recover: true }),
              );
          }
        }}
        renderPlaneControls={(context) => <PlaneHeader context={context} engine={engine} />}
        renderEmpty={() => (
          <Empty
            title="Open a folder"
            detail="Choose a folder or select a location in the sidebar."
          >
            <button
              className="primary"
              onClick={() => {
                void window.viewer.chooseFolder().then((path) => {
                  if (path) return workspace.openPath(path);
                });
              }}
            >
              Open folder
            </button>
          </Empty>
        )}
      />
    </div>
  );
}
