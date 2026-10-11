import { useEffect, useMemo, useState, useSyncExternalStore, type RefObject } from 'react';
import {
  PluridApplication,
  usePluridApi,
  usePluridPlane,
  type PluridApplicationHandle,
} from '@plurid/plurid-react';
import type { PluridPartialConfiguration, PluridPlane, TreePlane } from '@plurid/plurid-data';
import { activeWorkspace, setActivePane, storageAdapter, useViewer } from '../state/store';
import { FolderExplorer } from '../explorer/FolderExplorer';
import { PreviewHost } from '../previews/PreviewHost';
import { Empty, IconButton } from '../ui/primitives';
import { PlaneHeader } from './PlaneHeader';
import { frameWorkspace, refitWorkspace } from './framing';
export { frameWorkspace } from './framing';
import { useWorkspace } from './context';
import { looks } from './look';

export function flattenTree(tree: TreePlane[]): TreePlane[] {
  return tree.flatMap((node) => [node, ...flattenTree(node.children ?? [])]);
}
export function hostID(node: TreePlane): string {
  return node.routeDivisions.plane.parameters.id || node.routeDivisions.path.parameters.id || '';
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
const planes: PluridPlane<React.ComponentType>[] = [
  { route: '/folders/:id', component: FolderContent },
  { route: '/previews/:id', component: PreviewContent },
];
export function WorkspaceSurface({
  engine,
  surface,
  onReady,
  tool,
  onToolDone,
}: {
  engine: RefObject<PluridApplicationHandle | null>;
  surface: RefObject<HTMLDivElement | null>;
  onReady: () => void;
  tool: 'rotate' | 'scale' | 'translate' | null;
  onToolDone(): void;
}) {
  const space = useViewer(activeWorkspace);
  const look = useViewer((state) => state.saved.look);
  const workspace = useWorkspace();
  const preferences = useViewer((state) => state.saved.ui.space);
  const [size, setSize] = useState({ width: 992, height: 692 });
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        setSize({ width: Math.round(width), height: Math.round(height) });
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
        transformOrigin: { show: preferences.origin },
        transformMode:
          tool === 'rotate'
            ? 'ROTATION'
            : tool === 'scale'
              ? 'SCALE'
              : tool === 'translate'
                ? 'TRANSLATION'
                : 'ALL',
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
        navigation: { onClose: 'parent', framing: { fill: 0.82 }, childFraming: 'pair' },
      },
      elements: {
        minimap: { show: preferences.minimap },
        viewcube: { show: preferences.viewcube },
        toolbar: { show: false },
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
          resizable: true,
          backface: preferences.backs ? 'visible' : 'hidden',
        },
      },
    }),
    [look, size, preferences, tool],
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
        onReady={() => {
          onReady();
          if (!Object.keys(space.arrangement).length)
            requestAnimationFrame(() => frameWorkspace(engine, surface));
        }}
        renderPlaneControls={(context) => <PlaneHeader context={context} />}
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
      {tool && (
        <div className="spatial-tool" role="toolbar" aria-label="Spatial tool">
          <span>{tool[0].toUpperCase() + tool.slice(1)} space</span>
          <IconButton icon="check" label="Finish spatial tool" onClick={onToolDone} />
        </div>
      )}
    </div>
  );
}
