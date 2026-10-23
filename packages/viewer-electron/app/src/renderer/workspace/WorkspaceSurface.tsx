import {
  lazy,
  Suspense,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import {
  PluridApplication,
  usePluridApi,
  usePluridPlane,
  type PluridApplicationHandle,
} from '@plurid/plurid-react';
import { PLURID_PUBSUB_TOPIC, type PluridApi, type PluridPlane } from '@plurid/plurid-data';
import { activeWorkspace, report, setActivePane, storageAdapter, useViewer } from '../state/store';
import { SearchExplorer } from '../explorer/SearchExplorer';
import { CollectionExplorer } from '../explorer/CollectionExplorer';
import { FolderExplorer } from '../explorer/FolderExplorer';
import { PreviewHost } from '../previews/PreviewHost';
import { PreviewActivity } from '../previews/activity';
import { PreviewFrame } from './preview-frame';
import { Empty } from '../ui/primitives';
import { Sidebar } from '../ui/Sidebar';
import { PlaneHeader } from './PlaneHeader';
import { frameWorkspace, refitWorkspace } from './framing';
export { frameWorkspace } from './framing';
import { focusFiles } from './sessions';
import { useWorkspace } from './context';
import { surfaceConfiguration } from './surface-configuration';
import { routeFileKeyboard } from '../explorer/selection';

import { flattenTree, hostID } from './tree';
import { allowTerminalStart, terminalStartDeferred } from '../terminals/sessions';
import { paneRoute } from './tree';
export { flattenTree, hostID } from './tree';
const FolderScene = memo(function FolderScene({ id }: { id: string }) {
  return (
    <div className="folder-plane">
      <Sidebar paneID={id} />
      <FolderExplorer id={id} />
    </div>
  );
});
/** Whether the space lets a plane's content take pointer input (no grab mode, every transform). */
function useInteractive(): boolean {
  const api = usePluridApi();
  return useSyncExternalStore(
    api.store.subscribe,
    () =>
      !api.getSnapshot().ui.grabMode &&
      api.getSnapshot().configuration.space.transformMode === 'ALL',
  );
}
function FolderContent() {
  const plane = usePluridPlane();
  const interactive = useInteractive();
  const active = plane.shown && plane.culled === 'visible';
  // A folder's embedded previews follow its plane, as a preview plane does (see PreviewActivity).
  const activity = useMemo(() => ({ active, interactive }), [active, interactive]);
  return (
    <PreviewActivity.Provider value={activity}>
      <FolderScene id={plane.parameters.id ?? ''} />
    </PreviewActivity.Provider>
  );
}
function PreviewContent() {
  const plane = usePluridPlane();
  const record = useViewer((state) =>
    activeWorkspace(state).panes.find((item) => item.id === plane.parameters.id),
  );
  const interactive = useInteractive();
  if (!record) return <Empty title="Preview is unavailable" />;
  // a scratch plane renders where a preview does, so Save As makes it the file's in place
  if (record.type === 'scratch')
    return (
      <PreviewFrame activate={() => setActivePane(record.id)}>
        <Suspense fallback={<Empty title="Opening scratch plane…" />}>
          <LazyScratchPlane pane={record} visible={plane.shown && plane.culled === 'visible'} />
        </Suspense>
      </PreviewFrame>
    );
  return (
    <PreviewFrame activate={() => setActivePane(record.id)}>
      <PreviewHost
        path={record.path}
        evidence={record.type === 'preview' ? record.evidence : undefined}
        paneID={record.id}
        active={plane.shown && plane.culled === 'visible'}
        interactive={interactive}
        editable
      />
    </PreviewFrame>
  );
}
const LazyScratchPlane = lazy(() => import('../editing/ScratchPlane'));
const LazyTerminalPlane = lazy(() =>
  import('../terminals/TerminalPlane').then((module) => ({ default: module.TerminalPlane })),
);
function TerminalContent() {
  const plane = usePluridPlane();
  const pane = useViewer((state) =>
    activeWorkspace(state).panes.find((pane) => pane.id === plane.parameters.id),
  );
  const [started, setStarted] = useState(false);
  if (
    pane?.type === 'terminal' &&
    (pane.startOnOpen === false || terminalStartDeferred(pane.id)) &&
    !started
  )
    return (
      <Empty icon="terminal" title="Terminal ready" detail={pane.path}>
        <button
          className="primary"
          onClick={() => {
            allowTerminalStart(pane.id);
            setStarted(true);
          }}
        >
          Start terminal
        </button>
      </Empty>
    );
  return pane?.type === 'terminal' ? (
    <Suspense fallback={<Empty title="Opening terminal…" />}>
      <LazyTerminalPlane pane={pane} />
    </Suspense>
  ) : (
    <Empty title="Terminal unavailable" />
  );
}
function SearchContent() {
  const plane = usePluridPlane();
  return <SearchExplorer id={plane.parameters.id ?? ''} />;
}
function CollectionContent() {
  const plane = usePluridPlane();
  return <CollectionExplorer id={plane.parameters.id ?? ''} />;
}
const planes: PluridPlane<React.ComponentType>[] = [
  { route: '/terminals/:id', component: TerminalContent },
  { route: '/folders/:id', component: FolderContent },
  { route: '/searches/:id', component: SearchContent },
  { route: '/collections/:id', component: CollectionContent },
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
      if (!entry) return;
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
  }, [surface, engine]);
  // The engine needs a stable `view` array: rebuild it only when a route changes.
  const routes = (space.layout ? space.panes.map((pane) => pane.id) : space.roots)
    .map((id) => paneRoute(space.panes.find((item) => item.id === id)?.type ?? 'preview', id))
    .join('\n');
  const view = useMemo(() => (routes ? routes.split('\n') : []), [routes]);
  // A new epoch (workspace reset) needs a fresh adapter for the same workspace ID.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const storage = useMemo(() => storageAdapter(space.id), [space.id, space.epoch]);
  const configuration = useMemo(
    () => surfaceConfiguration({ look, size, preferences, color: space.spaceColor }),
    [look, size, preferences, space.spaceColor],
  );
  useEffect(() => {
    if (!api) return;
    let publishing = false;
    let disposed = false;
    let scheduled = false;
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
        space.gestures?.wheel === configuration.space?.gestures?.wheel &&
        space.gestures?.dragHandle === configuration.space?.gestures?.dragHandle &&
        space.navigation?.childFraming === 'plane' &&
        space.bridge?.planeAngle === 90.1 &&
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
    // A configuration publish dispatches several engine actions. Reapplying
    // preferences between those actions can restore the previous transform
    // mode through the engine's live configuration bridge.
    const unsubscribe = api.store.subscribe(() => {
      if (publishing || disposed || scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (!disposed) synchronize();
      });
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [api, configuration, preferences, engine]);
  // Stable callbacks: the engine memoizes plane chrome on their identity, so inline
  // functions would re-render every plane header on each store change.
  const handleReady = (api: PluridApi) => {
    setApi(api);
    onReady();
    if (space.layout) {
      requestAnimationFrame(() => {
        try {
          workspace.restoreLayout(space.layout!);
        } catch (error) {
          report(error);
        }
      });
    } else if (!Object.keys(space.arrangement).length)
      requestAnimationFrame(() => frameWorkspace(engine, surface));
    else {
      const active = space.activePane || space.roots[0];
      if (active)
        requestAnimationFrame(() => frameWorkspace(engine, surface, [active], { recover: true }));
    }
  };
  const readyRef = useRef(handleReady);
  readyRef.current = handleReady;
  const onEngineReady = useCallback((api: PluridApi) => readyRef.current(api), []);
  const renderPlaneControls = useCallback(
    (context: Parameters<typeof PlaneHeader>[0]['context']) => <PlaneHeader context={context} />,
    [],
  );
  const renderEmpty = useCallback(
    () => (
      <Empty title="No open planes" detail="Create a folder plane or choose a folder.">
        <div className="empty-actions">
          <button className="primary" disabled={!api} onClick={() => workspace.newRootFolder()}>
            New folder plane
          </button>
          <button
            disabled={!api}
            onClick={() => {
              void window.viewer
                .chooseFolder()
                .then((path) => {
                  if (path) return workspace.openPath(path);
                })
                .catch(report);
            }}
          >
            Open folder…
          </button>
        </div>
      </Empty>
    ),
    [api, workspace],
  );
  return (
    <div
      className="workspace-surface"
      ref={surface}
      onKeyDownCapture={(event) => {
        if (!(event.target as Element).closest('.terminal-plane') && event.key !== undefined) {
          const header = (event.target as Element).closest<HTMLElement>('[data-viewer-plane]');
          if (header) routeFileKeyboard(header.dataset.viewerPlane!, event);
          if (event.isPropagationStopped()) return;
        }
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
        key={space.id + ':' + (space.epoch ?? 0)}
        ref={engine}
        id={`viewer-${space.id}`}
        planes={planes}
        view={view}
        configuration={configuration}
        useLocalStorage
        storageAdapter={storage}
        onReady={onEngineReady}
        renderPlaneControls={renderPlaneControls}
        renderEmpty={renderEmpty}
      />
    </div>
  );
}
