import { useTheme } from '../ui/theme';
import { gitTerminalProfileID } from '../../domain/comparison/git-actions';
import {
  effectiveWindowLook,
  effectiveWindowSettings,
  effectiveWindowUI,
} from '../state/effective-ui';
import { useSpatialOverview, type SpatialOverviewHandle } from './overlays/useSpatialOverview';
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
import { planeIsActive, PreviewActivity } from '../previews/activity';
import { PreviewFrame } from './preview-frame';
import { Empty } from '../ui/primitives';
import { Sidebar } from '../ui/navigation/Sidebar';
import { PlaneHeader } from './PlaneHeader';
import { frameWorkspace, refitWorkspace } from './framing';
import { focusFiles } from './sessions';
import { applyTiling } from './tiling';
import { useWorkspace } from './context';
import { minimapShown, surfaceConfiguration } from './surface-configuration';
import { placeRoots } from './root-placement';
import { routeFileKeyboard } from '../explorer/selection';

import { flattenTree, hostID } from './tree';
import { allowTerminalStart, terminalStartDeferred } from '../terminals/sessions';
import { surfaceRoutes } from './tree';
export { frameWorkspace } from './framing';
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
  const active = planeIsActive(plane);
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
  if (record.type === 'note')
    return (
      <PreviewFrame activate={() => setActivePane(record.id)}>
        <Suspense fallback={<Empty title="Opening note…" />}>
          <LazyNotePlane pane={record} visible={planeIsActive(plane)} />
        </Suspense>
      </PreviewFrame>
    );
  // a scratch plane renders where a preview does, so Save As makes it the file's in place
  if (record.type === 'scratch')
    return (
      <PreviewFrame activate={() => setActivePane(record.id)}>
        <Suspense fallback={<Empty title="Opening scratch plane…" />}>
          <LazyScratchPlane pane={record} visible={planeIsActive(plane)} />
        </Suspense>
      </PreviewFrame>
    );
  return (
    <PreviewFrame activate={() => setActivePane(record.id)}>
      <PreviewHost
        path={record.path}
        evidence={record.type === 'preview' ? record.evidence : undefined}
        paneID={record.id}
        active={planeIsActive(plane)}
        interactive={interactive}
        editable
      />
    </PreviewFrame>
  );
}
const LazyScratchPlane = lazy(() => import('../editing/ScratchPlane'));
const LazyNotePlane = lazy(() => import('../notes/NotePlane'));
const LazyDiffPlane = lazy(() => import('../diff/DiffPlane'));
const LazyGitChanges = lazy(() => import('../git/GitChanges'));
const LazyChatPlane = lazy(() => import('../chat/ChatPlane'));
const LazySessionPlane = lazy(() => import('../chat/SessionPlane'));
const LazyServerPlane = lazy(() => import('../local-servers/ServerPlane'));
const LazyBrowserPlane = lazy(() => import('../browser/BrowserPlane'));
const LazyMediaPlane = lazy(() => import('../media/MediaPlane'));
const LazyLayoutPlane = lazy(() => import('../layout/LayoutPlane'));
const LazyJournalPlane = lazy(() => import('../journal/JournalPlane'));
const LazyOverviewPlane = lazy(() => import('../overview/OverviewPlane'));
const LazyTaskPlane = lazy(() => import('../tasks/TaskPlane'));
const LazyReceiptPlane = lazy(() => import('../tasks/ReceiptPlane'));

function TaskContent() {
  const plane = usePluridPlane();
  const pane = useViewer((state) =>
    activeWorkspace(state).panes.find((item) => item.id === plane.parameters.id),
  );
  if (pane?.type !== 'task' && pane?.type !== 'receipt')
    return <Empty title="Task view unavailable" />;
  const active = planeIsActive(plane);
  return (
    <PreviewFrame activate={() => setActivePane(pane.id)}>
      <Suspense fallback={<Empty title="Opening task context…" />}>
        {pane.type === 'task' ? (
          <LazyTaskPlane pane={pane} active={active} />
        ) : (
          <LazyReceiptPlane pane={pane} active={active} />
        )}
      </Suspense>
    </PreviewFrame>
  );
}

function JournalContent() {
  const plane = usePluridPlane();
  const pane = useViewer((state) =>
    activeWorkspace(state).panes.find((item) => item.id === plane.parameters.id),
  );
  if (pane?.type !== 'journal') return <Empty title="Journal unavailable" />;
  return (
    <PreviewFrame activate={() => setActivePane(pane.id)}>
      <Suspense fallback={<Empty title="Opening Journal…" />}>
        <LazyJournalPlane pane={pane} active={planeIsActive(plane)} />
      </Suspense>
    </PreviewFrame>
  );
}

function OverviewContent() {
  const plane = usePluridPlane();
  const pane = useViewer((state) =>
    activeWorkspace(state).panes.find((item) => item.id === plane.parameters.id),
  );
  if (pane?.type !== 'overview') return <Empty title="Overview unavailable" />;
  return (
    <PreviewFrame activate={() => setActivePane(pane.id)}>
      <Suspense fallback={<Empty title="Opening Overview…" />}>
        <LazyOverviewPlane pane={pane} />
      </Suspense>
    </PreviewFrame>
  );
}

function BrowserContent() {
  const plane = usePluridPlane();
  const pane = useViewer((state) =>
    activeWorkspace(state).panes.find((item) => item.id === plane.parameters.id),
  );
  if (pane?.type !== 'browser') return <Empty title="Browser unavailable" />;
  return (
    <PreviewFrame activate={() => setActivePane(pane.id)}>
      <Suspense fallback={<Empty title="Opening browser…" />}>
        <LazyBrowserPlane pane={pane} active={planeIsActive(plane)} />
      </Suspense>
    </PreviewFrame>
  );
}
function MediaContent() {
  const plane = usePluridPlane();
  const pane = useViewer((state) =>
    activeWorkspace(state).panes.find((item) => item.id === plane.parameters.id),
  );
  if (pane?.type !== 'media') return <Empty title="Media draft unavailable" />;
  return (
    <PreviewFrame activate={() => setActivePane(pane.id)}>
      <Suspense fallback={<Empty title="Opening media tools…" />}>
        <LazyMediaPlane pane={pane} active={planeIsActive(plane)} />
      </Suspense>
    </PreviewFrame>
  );
}
function LayoutContent() {
  const plane = usePluridPlane();
  const pane = useViewer((state) =>
    activeWorkspace(state).panes.find((item) => item.id === plane.parameters.id),
  );
  if (pane?.type !== 'layout') return <Empty title="Layout unavailable" />;
  return (
    <PreviewFrame activate={() => setActivePane(pane.id)}>
      <Suspense fallback={<Empty title="Opening Layout…" />}>
        <LazyLayoutPlane pane={pane} />
      </Suspense>
    </PreviewFrame>
  );
}
function ServerContent() {
  const plane = usePluridPlane();
  const pane = useViewer((state) =>
    activeWorkspace(state).panes.find((item) => item.id === plane.parameters.id),
  );
  if (pane?.type !== 'server') return <Empty title="Server unavailable" />;
  return (
    <PreviewFrame activate={() => setActivePane(pane.id)}>
      <Suspense fallback={<Empty title="Opening server controls…" />}>
        <LazyServerPlane pane={pane} active={planeIsActive(plane)} />
      </Suspense>
    </PreviewFrame>
  );
}

function ChatContent() {
  const plane = usePluridPlane();
  const pane = useViewer((state) =>
    activeWorkspace(state).panes.find((item) => item.id === plane.parameters.id),
  );
  if (pane?.type !== 'chat') return <Empty title="Chat unavailable" />;
  return (
    <PreviewFrame activate={() => setActivePane(pane.id)}>
      <Suspense fallback={<Empty title="Opening Chat…" />}>
        {pane.externalSessionID ? <LazySessionPlane pane={pane} /> : <LazyChatPlane pane={pane} />}
      </Suspense>
    </PreviewFrame>
  );
}

function ComparisonContent() {
  const plane = usePluridPlane();
  const record = useViewer((state) =>
    activeWorkspace(state).panes.find((item) => item.id === plane.parameters.id),
  );
  if (record?.type !== 'diff' && record?.type !== 'git-changes')
    return <Empty title="Comparison unavailable" />;
  return (
    <PreviewFrame activate={() => setActivePane(record.id)}>
      <Suspense fallback={<Empty title="Opening comparison…" />}>
        {record.type === 'diff' ? (
          <LazyDiffPlane pane={record} />
        ) : (
          <LazyGitChanges
            path={record.path}
            paneID={record.id}
            manual={record.activation === 'manual'}
          />
        )}
      </Suspense>
    </PreviewFrame>
  );
}
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
    !pane.gitAction &&
    pane.profileID !== gitTerminalProfileID &&
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
/**
 * Each plane's content carries its pane's id: a plane is found by it whether or not its
 * header shows (focus, hints, directional focus). `display: contents` leaves the layout as it was.
 */
const marked = (Content: React.ComponentType): React.ComponentType =>
  function MarkedPlane() {
    const plane = usePluridPlane();
    return (
      <div className="pane-marker" data-viewer-pane={plane.parameters.id ?? ''}>
        <Content />
      </div>
    );
  };
const planes: PluridPlane<React.ComponentType>[] = [
  { route: '/tasks/:id', component: marked(TaskContent) },
  { route: '/receipts/:id', component: marked(TaskContent) },
  { route: '/servers/:id', component: marked(ServerContent) },
  { route: '/browsers/:id', component: marked(BrowserContent) },
  { route: '/media/:id', component: marked(MediaContent) },
  { route: '/layouts/:id', component: marked(LayoutContent) },
  { route: '/journals/:id', component: marked(JournalContent) },
  { route: '/overviews/:id', component: marked(OverviewContent) },
  { route: '/chats/:id', component: marked(ChatContent) },
  { route: '/diffs/:id', component: marked(ComparisonContent) },
  { route: '/git-changes/:id', component: marked(ComparisonContent) },
  { route: '/terminals/:id', component: marked(TerminalContent) },
  { route: '/folders/:id', component: marked(FolderContent) },
  { route: '/searches/:id', component: marked(SearchContent) },
  { route: '/collections/:id', component: marked(CollectionContent) },
  { route: '/previews/:id', component: marked(PreviewContent) },
];
export function WorkspaceSurface({
  engine,
  surface,
  onReady,
  onOverviewChange,
}: {
  engine: RefObject<PluridApplicationHandle | null>;
  surface: RefObject<HTMLDivElement | null>;
  onReady: () => void;
  onOverviewChange?: (overview: SpatialOverviewHandle | undefined) => void;
}) {
  const space = useViewer(activeWorkspace);
  const look = useViewer(effectiveWindowLook);
  const workspace = useWorkspace();
  // this workspace's own settings over the general ones (domain/preferences/overrides.ts)
  const general = useViewer(effectiveWindowUI);
  // the theme's colours for plurid, only a custom theme's: the built-in ones are plurid's look already
  const theme = useTheme(useViewer(effectiveWindowSettings), look);
  const palette = useMemo(
    () =>
      theme.id.startsWith('viewer-')
        ? undefined
        : {
            space: theme.shell.space,
            surface: theme.shell.surface,
            ink: theme.shell.ink,
            accent: theme.shell.accent,
          },
    [theme],
  );
  const preferences = useMemo(() => general.space, [general]);
  // automatic, the minimap comes with the third plane and goes with it
  const minimap = minimapShown(preferences, space.panes.length);
  const [size, setSize] = useState({ width: 992, height: 692 });
  const [api, setApi] = useState<PluridApi | null>(null);
  const overview = useSpatialOverview({
    root: surface,
    enabled: (minimap || preferences.viewcube) && !!api,
    epoch: space.id + ':' + (space.epoch ?? 0),
    labelsVersion: space.panes,
    subscribeEngine: (listener) => workspace.subscribeEngine(listener),
    isDocked: () => workspace.isDocked(),
    labelForPlane: (engineID) => {
      const node = engine.current
        ? flattenTree(engine.current.tree.get()).find((item) => item.planeID === engineID)
        : undefined;
      const pane = node ? space.panes.find((item) => item.id === hostID(node)) : undefined;
      if (!pane) return undefined;
      return {
        label: pane.path.split('/').filter(Boolean).at(-1) ?? pane.type,
        path: pane.path,
      };
    },
    onNavigate: (engineID) => {
      const node = engine.current
        ? flattenTree(engine.current.tree.get()).find((item) => item.planeID === engineID)
        : undefined;
      if (!node || !activeWorkspace().panes.some((item) => item.id === hostID(node))) return;
      setActivePane(hostID(node));
      focusFiles(hostID(node));
    },
  });
  useEffect(() => onOverviewChange?.(overview), [overview, onOverviewChange]);
  useEffect(() => () => onOverviewChange?.(undefined), [onOverviewChange]);
  // each engine, once ready: new roots open beside the plane in use, and no root moves
  useEffect(() => {
    if (api && engine.current) return placeRoots(engine.current);
  }, [api, engine]);
  useEffect(() => {
    let retiling: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        const next = { width: Math.round(width), height: Math.round(height) };
        setSize((previous) =>
          previous.width === next.width && previous.height === next.height ? previous : next,
        );
        // tiled planes keep their layout in the new size, as tmux's panes do
        if (activeWorkspace().tiling) {
          clearTimeout(retiling);
          retiling = setTimeout(() => applyTiling(engine, surface), 120);
        } else refitWorkspace(engine, surface);
      }
    });
    if (surface.current) observer.observe(surface.current);
    return () => {
      observer.disconnect();
      clearTimeout(retiling);
    };
  }, [surface, engine]);
  // a tiled plane closed, or the workspace opened tiled: the rest take its place
  const tiled = space.tiling?.panes
    .filter((id) => space.panes.some((pane) => pane.id === id))
    .join('\n');
  useEffect(() => {
    if (tiled) applyTiling(engine, surface);
  }, [tiled, engine, surface]);
  // The engine needs a stable `view` array: rebuild it only when a route changes.
  const routes = surfaceRoutes(space);
  const view = useMemo(() => (routes ? routes.split('\n') : []), [routes]);
  // A new epoch (workspace reset) needs a fresh adapter for the same workspace ID.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const storage = useMemo(() => storageAdapter(space.id), [space.id, space.epoch]);
  const configuration = useMemo(
    () =>
      surfaceConfiguration({
        look,
        size,
        preferences,
        minimap,
        color: space.spaceColor,
        palette,
        tiled: !!space.tiling,
      }),
    [look, size, preferences, minimap, space.spaceColor, palette, space.tiling],
  );
  useEffect(() => {
    if (!api) return;
    let publishing = false;
    let disposed = false;
    let scheduled = false;
    const synchronize = () => {
      if (publishing || api.store !== engine.current?.store) return;
      const { elements, space: engineSpace } = api.getSnapshot().configuration;
      if (
        elements.toolbar.show === preferences.toolbar &&
        elements.minimap?.show === minimap &&
        elements.viewcube.show === preferences.viewcube &&
        elements.planeBridge?.show === !space.tiling &&
        elements.planeLinks?.show === !space.tiling &&
        elements.plane.controls.show === preferences.planeHeaders &&
        elements.plane.resizable === preferences.resizing &&
        elements.plane.backface === 'visible' &&
        engineSpace.gestures?.wheel === configuration.space?.gestures?.wheel &&
        engineSpace.gestures?.dragHandle === configuration.space?.gestures?.dragHandle &&
        engineSpace.navigation?.childFraming === 'plane' &&
        engineSpace.bridge?.planeAngle === 90.1 &&
        engineSpace.transformOrigin.show === preferences.origin
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
  }, [api, configuration, preferences, minimap, engine, space.tiling]);
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
        if (overview.expanded) return;
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
