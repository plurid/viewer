/**
 * THESIS: Folders and previews form one working space, with focused file tasks a dock away.
 * OWN-WORLD: Current Plurid graphite surfaces, system typography, dense native file rows.
 * STORY: Browse local files, open linked previews, organize safely, restore the workspace.
 * FIRST VIEWPORT: 210px location rail, 56px native titlebar, a 960px explorer plane in space;
 * the Open Folder action and linked preview command remain within reach.
 * FORM: User-approved Plurid application family; the implementation plan fixes the structure.
 * SIGNATURE: Open a file beside its folder, orbit a model independently, dock either plane.
 * MOTION: Engine camera transitions; bounded media/model activity; reduced-motion support.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review,
 * the verdict, DESIGN.md, and every shipping raster carrying its provenance.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PluridApplicationHandle } from '@plurid/plurid-react';
import { PLURID_PUBSUB_TOPIC } from '@plurid/plurid-data';
import type { FileEntry } from '../domain/contracts';
import {
  activeWorkspace,
  addPane,
  dismissNotice,
  flushState,
  getState,
  navigate,
  newWorkspace,
  quickPreview,
  receiveJob,
  reconcilePanes,
  renameWorkspace,
  report,
  setActivePane,
  setJobs,
  setOperationsOpen,
  switchWorkspace,
  toggleLook,
  useViewer,
} from './state/store';
import { WorkspaceContext, type WorkspaceController } from './workspace/context';
import {
  flattenTree,
  frameWorkspace,
  hostID,
  WorkspaceSurface,
} from './workspace/WorkspaceSurface';
import { Icon } from './ui/Icon';
import { Dialog, ErrorBoundary, IconButton, NameDialog } from './ui/primitives';
import { OperationsPanel } from './operations/OperationsPanel';
import { PreviewHost } from './previews/PreviewHost';

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
export function App() {
  const engine = useRef<PluridApplicationHandle>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [workspaceDialog, setWorkspaceDialog] = useState<'new' | 'rename' | null>(null);
  const initialOpenHandled = useRef(false);
  const saved = useViewer((state) => state.saved);
  const space = useViewer(activeWorkspace);
  const active = useViewer((state) => state.activePane);
  const bootstrap = useViewer((state) => state.bootstrap);
  const notice = useViewer((state) => state.notice);
  const quick = useViewer((state) => state.quickPreview);
  const jobs = useViewer((state) => state.jobs);
  const operationsOpen = useViewer((state) => state.operationsOpen);
  const controller = useMemo<WorkspaceController>(
    () => ({
      open(entry: FileEntry, parentEngineID?: string) {
        const api = engine.current;
        const linked =
          !!parentEngineID &&
          !!api &&
          flattenTree(api.tree.get()).some((node) => node.planeID === parentEngineID);
        const pane = addPane(entry.path, entry.directory ? 'folder' : 'preview', !linked);
        setActivePane(pane.id);
        if (api && linked)
          api.pubsub.publish({
            topic: PLURID_PUBSUB_TOPIC.SPACE_SPAWN_PLANE,
            data: {
              route: `/${entry.directory ? 'folders' : 'previews'}/${pane.id}`,
              parentPlaneID: parentEngineID!,
              framing: 'pair',
            },
          });
      },
      async openPath(path: string) {
        const entry = await window.viewer.stat(path);
        const current = activeWorkspace().panes.find((pane) => pane.id === getState().activePane);
        if (entry.directory && current?.type === 'folder') {
          navigate(current.id, entry.path);
          controller.focusPane(current.id);
        } else controller.open(entry);
      },
      focusPane(id: string) {
        const node =
          engine.current &&
          flattenTree(engine.current.tree.get()).find((node) => hostID(node) === id);
        if (node) {
          engine.current?.tree.open(node.planeID);
          engine.current?.camera.frame({ planeID: node.planeID }, { animate: true });
        }
        setActivePane(id);
      },
      frameAll: () => frameWorkspace(engine, surface),
      dock: () => {
        const api = engine.current;
        if (!api) return;
        const node = flattenTree(api.tree.get()).find(
          (node) => hostID(node) === getState().activePane,
        );
        if (api.camera.docked()) api.camera.reveal({ animate: true });
        else api.camera.dock(node?.planeID, { animate: true });
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
  useEffect(() => {
    const remove = window.viewer.onEvent((event) => {
      if (event.type === 'job') receiveJob(event.job);
      else if (event.type === 'open')
        for (const path of event.paths) void controller.openPath(path).catch(report);
      else if (event.type === 'flush')
        void flushState()
          .then(() => window.viewer.flushed(event.token))
          .catch(report);
      else if (event.type === 'command') {
        if (event.command === 'choose-folder')
          void window.viewer
            .chooseFolder()
            .then((path) => {
              if (path) return controller.openPath(path);
            })
            .catch(report);
        else if (event.command === 'frame-all') controller.frameAll();
        else if (event.command === 'dock') controller.dock();
        else if (event.command === 'undo-arrangement') controller.undo();
        else if (event.command === 'redo-arrangement') controller.redo();
        else if (event.command === 'undo-file') {
          const job = getState().jobs.find((job) => job.undoable);
          if (job) void window.viewer.undo(job.id).catch(report);
        } else
          window.dispatchEvent(
            new CustomEvent('viewer:folder-command', {
              detail: { id: getState().activePane, command: event.command },
            }),
          );
      }
    });
    void window.viewer.jobs().then(setJobs).catch(report);
    return remove;
  }, [controller]);
  useEffect(() => {
    if (ready && !initialOpenHandled.current) {
      initialOpenHandled.current = true;
      for (const path of bootstrap.openPaths) void controller.openPath(path).catch(report);
    }
  }, [ready, bootstrap.openPaths, controller]);
  useEffect(() => {
    document.documentElement.dataset.look = saved.look;
    document.documentElement.style.colorScheme = saved.look;
  }, [saved.look]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && getState().quickPreview) quickPreview(null);
      if ((event.metaKey || event.ctrlKey) && event.key === '0') {
        event.preventDefault();
        controller.frameAll();
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        controller.dock();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [controller]);
  const inProgress = jobs.filter((job) =>
    ['queued', 'running', 'collision'].includes(job.status),
  ).length;
  return (
    <WorkspaceContext.Provider value={controller}>
      <div className="app-shell" data-look={saved.look}>
        <header className="app-titlebar">
          <div className="traffic-space" />
          <span className="app-wordmark">
            viewer
            <span className="wordmark-dot" />
          </span>
          <span className="titlebar-divider" />
          <select
            aria-label="Workspace"
            value={space.id}
            onChange={(event) => {
              setReady(false);
              void switchWorkspace(event.target.value).catch(report);
            }}
          >
            {saved.workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
          <IconButton icon="plus" label="New workspace" onClick={() => setWorkspaceDialog('new')} />
          <IconButton
            icon="rename"
            label="Rename workspace"
            onClick={() => setWorkspaceDialog('rename')}
          />
          <span className="toolbar-spacer" />
          <button
            className="open-folder-button"
            onClick={() => {
              void window.viewer
                .chooseFolder()
                .then((path) => {
                  if (path) return controller.openPath(path);
                })
                .catch(report);
            }}
          >
            <Icon name="folder" size={16} />
            Open folder
          </button>
          <IconButton
            icon={saved.look === 'dark' ? 'sun' : 'moon'}
            label={`Switch to ${saved.look === 'dark' ? 'light' : 'dark'} look`}
            onClick={toggleLook}
          />
        </header>
        <div className="app-main">
          <aside className="location-sidebar" aria-label="Locations">
            <div className="sidebar-group">
              <h2>Locations</h2>
              {bootstrap.locations.map((location) => {
                const current = space.panes.find((pane) => pane.id === active);
                return (
                  <button
                    className={`location ${current?.path === location.path ? 'selected' : ''}`}
                    key={location.path}
                    title={location.path}
                    onClick={(event) => {
                      if (event.altKey)
                        void window.viewer
                          .stat(location.path)
                          .then((entry) => controller.open(entry))
                          .catch(report);
                      else void controller.openPath(location.path).catch(report);
                    }}
                  >
                    <Icon
                      name={
                        location.name === 'Home'
                          ? 'home'
                          : location.name === 'Volumes' || location.name === 'Computer'
                            ? 'disk'
                            : 'folder'
                      }
                      size={17}
                    />
                    <span>{location.name}</span>
                  </button>
                );
              })}
            </div>
            <div className="sidebar-group">
              <h2>Favorites</h2>
              {!saved.favorites.length && (
                <p className="sidebar-hint">Star a folder to keep it here.</p>
              )}
              {saved.favorites.map((location) => (
                <button
                  className="location"
                  key={location.path}
                  title={location.path}
                  onClick={() => {
                    void controller.openPath(location.path).catch(report);
                  }}
                >
                  <Icon name="star" size={17} />
                  <span>{location.name}</span>
                </button>
              ))}
            </div>
            <div className="sidebar-group">
              <h2>Recent</h2>
              {saved.recents.slice(0, 5).map((path) => (
                <button
                  className="location"
                  key={path}
                  title={path}
                  onClick={() => {
                    void controller.openPath(path).catch(report);
                  }}
                >
                  <Icon name="clock" size={16} />
                  <span>{basename(path)}</span>
                </button>
              ))}
            </div>
            <div className="sidebar-bottom">
              <button
                className={operationsOpen ? 'selected' : ''}
                onClick={() => setOperationsOpen(!operationsOpen)}
              >
                <Icon name="copy" size={17} />
                <span>File operations</span>
                {inProgress > 0 && <span className="count-badge">{inProgress}</span>}
              </button>
              <div className="sidebar-caption">Local files. A wider view.</div>
            </div>
          </aside>
          <main className="workspace-main">
            <div className="workspace-header">
              <div className="plane-tabs" aria-label="Open planes">
                {space.panes.map((pane) => (
                  <button
                    className={pane.id === active ? 'active' : ''}
                    key={pane.id}
                    title={pane.path}
                    onClick={() => controller.focusPane(pane.id)}
                  >
                    <Icon name={pane.type === 'folder' ? 'folder' : 'file'} size={15} />
                    <span>{basename(pane.path)}</span>
                  </button>
                ))}
              </div>
              <div className="workspace-tools">
                <IconButton icon="left" label="Undo arrangement" onClick={controller.undo} />
                <IconButton icon="right" label="Redo arrangement" onClick={controller.redo} />
                <IconButton
                  icon="columns"
                  label="Arrange planes horizontally"
                  onClick={() => controller.arrange('x')}
                />
                <IconButton icon="frame" label="Frame all planes" onClick={controller.frameAll} />
                <IconButton
                  icon="dock"
                  label="Dock or reveal active plane"
                  onClick={controller.dock}
                />
              </div>
            </div>
            <ErrorBoundary>
              <WorkspaceSurface engine={engine} surface={surface} onReady={() => setReady(true)} />
            </ErrorBoundary>
            <footer className="workspace-footer">
              <span>
                <span className="status-dot" />
                {space.panes.length} {space.panes.length === 1 ? 'plane' : 'planes'}
              </span>
              <span>
                ⌥ open linked plane <span className="separator">·</span> Space quick preview{' '}
                <span className="separator">·</span> ⌘↵ dock
              </span>
            </footer>
          </main>
          <OperationsPanel />
        </div>
        {notice && (
          <div className="notice" role="alert">
            <Icon name="warning" />
            <span>{notice}</span>
            <IconButton icon="close" label="Dismiss message" onClick={dismissNotice} />
          </div>
        )}
        {quick && (
          <Dialog title={basename(quick)} wide onClose={() => quickPreview(null)}>
            <div className="quick-preview">
              <PreviewHost path={quick} />
            </div>
            <footer>
              <button
                onClick={() => {
                  void window.viewer.openExternal(quick).catch(report);
                }}
              >
                Open in default app
              </button>
              <button
                className="primary"
                onClick={() => {
                  void window.viewer
                    .stat(quick)
                    .then((entry) => {
                      const node =
                        engine.current &&
                        flattenTree(engine.current.tree.get()).find(
                          (node) => hostID(node) === getState().activePane,
                        );
                      controller.open(entry, node?.planeID);
                      quickPreview(null);
                    })
                    .catch(report);
                }}
              >
                Open linked plane
              </button>
            </footer>
          </Dialog>
        )}
        {workspaceDialog && (
          <NameDialog
            title={workspaceDialog === 'new' ? 'New workspace' : 'Rename workspace'}
            maxLength={100}
            initial={workspaceDialog === 'rename' ? space.name : ''}
            action={workspaceDialog === 'new' ? 'Create' : 'Rename'}
            onClose={() => setWorkspaceDialog(null)}
            onSubmit={async (name) => {
              name = name.trim();
              if (!name) throw new Error('Enter a workspace name.');
              if (workspaceDialog === 'new') {
                setReady(false);
                await newWorkspace(name);
              } else renameWorkspace(name);
            }}
          />
        )}
      </div>
    </WorkspaceContext.Provider>
  );
}
