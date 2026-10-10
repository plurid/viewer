import { useEffect, useMemo, useState, useSyncExternalStore, type RefObject } from 'react';
import {
  PluridApplication,
  usePluridApi,
  usePluridPlane,
  type PluridApplicationHandle,
} from '@plurid/plurid-react';
import type {
  PluridPlaneChromeContext,
  PluridPartialConfiguration,
  PluridPlane,
  TreePlane,
} from '@plurid/plurid-data';
import {
  activeWorkspace,
  removePanes,
  setActivePane,
  storageAdapter,
  useViewer,
} from '../state/store';
import { FolderExplorer } from '../explorer/FolderExplorer';
import { PreviewHost } from '../previews/PreviewHost';
import { Icon } from '../ui/Icon';
import { Empty, IconButton } from '../ui/primitives';
import { useWorkspace } from './context';
import { looks } from './look';

export function flattenTree(tree: TreePlane[]): TreePlane[] {
  return tree.flatMap((node) => [node, ...flattenTree(node.children ?? [])]);
}
export function hostID(node: TreePlane): string {
  return node.routeDivisions.plane.parameters.id || node.routeDivisions.path.parameters.id || '';
}
export function frameWorkspace(
  engine: RefObject<PluridApplicationHandle | null>,
  surface: RefObject<HTMLDivElement | null>,
): void {
  const api = engine.current;
  const element = surface.current;
  if (!api || !element) return;
  const deadline = performance.now() + 1000;
  const frame = () => {
    if (engine.current !== api || !element.isConnected) return;
    const view = api.getSnapshot().space.viewSize;
    // Plurid debounces its ResizeObserver. Wait for its live viewport before
    // fitting; a later resize commit would otherwise shift the fitted camera.
    if (
      (view.width !== element.clientWidth || view.height !== element.clientHeight) &&
      performance.now() < deadline
    ) {
      requestAnimationFrame(frame);
      return;
    }
    api.camera.fit({ animate: true });
  };
  requestAnimationFrame(frame);
}
function FolderContent() {
  const plane = usePluridPlane();
  return <FolderExplorer id={plane.parameters.id} engineID={plane.planeID} />;
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
    <div className="preview-plane" onPointerDown={() => setActivePane(record.id)}>
      <PreviewHost
        path={record.path}
        active={plane.shown && plane.culled === 'visible'}
        interactive={interactive}
      />
    </div>
  );
}
const planes: PluridPlane<React.ComponentType>[] = [
  { route: '/folders/:id', component: FolderContent },
  { route: '/previews/:id', component: PreviewContent },
];
function PlaneControls({
  context,
  engine,
}: {
  context: PluridPlaneChromeContext;
  engine: RefObject<PluridApplicationHandle | null>;
}) {
  const node = context.treePlane as TreePlane;
  const id = hostID(node);
  const record = useViewer((state) => activeWorkspace(state).panes.find((item) => item.id === id));
  const name = record?.path.split(/[\\/]/).pop() || record?.path || 'Viewer';
  return (
    <div
      className="plane-controls"
      onPointerDown={() => {
        if (record) setActivePane(record.id);
      }}
    >
      <Icon name={record?.type === 'folder' ? 'folder' : 'file'} size={17} />
      <span className="plane-title" title={record?.path} data-plurid-drag-handle>
        {name}
      </span>
      <span className="plane-type">{record?.type === 'folder' ? 'Explorer' : 'Preview'}</span>
      <IconButton
        icon="frame"
        label="Frame plane"
        onClick={() =>
          engine.current?.camera.frame({ planeID: context.planeID }, { animate: true })
        }
      />
      <IconButton
        icon="dock"
        label="Dock plane"
        onClick={() => engine.current?.camera.dock(context.planeID, { animate: true })}
      />
      <IconButton
        icon="close"
        label="Close plane"
        onClick={() => {
          engine.current?.tree.remove(context.planeID);
          removePanes(flattenTree([node]).map(hostID));
        }}
      />
    </div>
  );
}
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
  const [size, setSize] = useState({ width: 992, height: 692 });
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0)
        setSize({ width: Math.round(width), height: Math.round(height) });
    });
    if (surface.current) observer.observe(surface.current);
    return () => observer.disconnect();
  }, [surface]);
  const view = useMemo(
    () =>
      space.roots.map((id) => {
        const pane = space.panes.find((item) => item.id === id);
        return `/${pane?.type === 'folder' ? 'folders' : 'previews'}/${id}`;
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
        navigation: { onClose: 'parent' },
      },
      elements: {
        minimap: { show: true },
        // Viewer owns frame/dock commands in the workspace header. The engine's
        // floating duplicate controls would cover preview actions when docked.
        dockRail: { show: false },
        // Automatic dimensions use the engine's live configuration; changing the
        // registered routes would reconstruct its store and discard linked planes.
        plane: {
          width: Math.max(380, Math.min(960, size.width - 32)),
          height: Math.max(300, Math.min(660, size.height - 72)),
          resizable: true,
        },
      },
    }),
    [look, size],
  );
  return (
    <div className="workspace-surface" ref={surface}>
      <PluridApplication
        key={space.id}
        ref={engine}
        id={`viewer-${space.id}`}
        planes={planes}
        view={view}
        configuration={configuration}
        useLocalStorage
        storageAdapter={storage}
        onReady={onReady}
        renderPlaneControls={(context) => <PlaneControls context={context} engine={engine} />}
        renderEmpty={() => (
          <Empty
            title="Make room for your files"
            detail="Open a folder from the sidebar to start exploring."
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
