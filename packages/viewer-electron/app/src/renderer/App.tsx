/** Native window chrome stays quiet; commands follow the active file, folder or preview. */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { pluridStateModules, type PluridApplicationHandle } from '@plurid/plurid-react';
import { PLURID_PUBSUB_TOPIC } from '@plurid/plurid-data';
import type { FileEntry, FolderPane } from '../domain/contracts';
import { rootOwners, selectedFiles } from './workspace/sessions';
import { defaultShortcuts, matchesShortcut } from '../domain/shortcuts';
import { matchingPane } from '../domain/planes';
import { repeatedPreviews } from './workspace/recovery';
import {
  activeWorkspace,
  addPane,
  addSearchPane,
  addRootFolder,
  deleteWorkspace,
  dismissNotice,
  flushState,
  getState,
  navigate,
  needsOperations,
  newWorkspace,
  quickPreview,
  stepQuickPreview,
  receiveJob,
  receiveSettings,
  receiveFileChanges,
  receiveProgress,
  reconcilePanes,
  rememberCommand,
  removePanes,
  renameShortcut,
  renameWorkspace,
  report,
  restoreWorkspace,
  setActivePane,
  setJobs,
  setOperationsOpen,
  switchWorkspace,
  refreshClipboard,
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
import { ActionHub } from './actions/ActionHub';
import { OperationsPanel } from './operations/OperationsPanel';
import { QuickPreview } from './previews/QuickPreview';
import { CommandsContext, useCommands, useCommandSource } from './commands/context';
import { CommandRegistry, type CommandContext } from './commands/registry';
import { windowCommands } from './commands/window';
import { CommandPalette } from './commands/CommandPalette';
import { editable, textEditFor } from './commands/editing';
import { Sidebar } from './ui/Sidebar';

import { ContextMenu } from './ui/ContextMenu';
import { OpenWithDialog } from './ui/OpenWithDialog';
import { invalidateFolderSizes, receiveFolderSize } from './explorer/sizes';

export function App() {
  const registry = useMemo(
    () => new CommandRegistry(rememberCommand, (id) => getState().settings.settings.shortcuts[id]),
    [],
  );
  return (
    <CommandsContext.Provider value={registry}>
      <AppWindow />
    </CommandsContext.Provider>
  );
}
function AppWindow() {
  const registry = useCommands();
  const [openWithPaths, setOpenWithPaths] = useState<string[]>();
  const engine = useRef<PluridApplicationHandle>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  readyRef.current = ready;
  const [workspaceDialog, setWorkspaceDialog] = useState<{
    kind: 'new' | 'rename' | 'delete';
    id: string;
  } | null>(null);
  const [shortcutDialog, setShortcutDialog] = useState<{ path: string; name: string } | null>(null);
  const [workspaceMenu, setWorkspaceMenu] = useState<{ x: number; y: number } | null>(null);

  const [palette, setPalette] = useState<'commands' | 'files' | null>(null);
  const [goTo, setGoTo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showWorkspaceUndo, setShowWorkspaceUndo] = useState(false);
  const initialOpenHandled = useRef(false);
  const pendingOwners = useRef(new Map<string, Map<string, string>>());
  const saved = useViewer((state) => state.saved);
  const space = useViewer(activeWorkspace);
  const subscribeEngine = useCallback(
    (listener: () => void) => engine.current?.store.subscribe(listener) ?? (() => {}),
    [ready, space.id],
  );
  const mode = useSyncExternalStore(
    subscribeEngine,
    () => engine.current?.getSnapshot().configuration.space.transformMode ?? 'ALL',
  );
  const tool =
    mode === 'ROTATION'
      ? 'rotate'
      : mode === 'SCALE'
        ? 'scale'
        : mode === 'TRANSLATION'
          ? 'translate'
          : null;
  const spatialTool = useCallback((value: 'rotate' | 'scale' | 'translate' | null) => {
    engine.current?.pubsub.publish({
      topic: PLURID_PUBSUB_TOPIC.CONFIGURATION,
      data: {
        space: {
          transformMode:
            value === 'rotate'
              ? 'ROTATION'
              : value === 'scale'
                ? 'SCALE'
                : value === 'translate'
                  ? 'TRANSLATION'
                  : 'ALL',
        },
      },
    });
  }, []);
  const bootstrap = useViewer((state) => state.bootstrap);
  const notice = useViewer((state) => state.notice);
  const quick = useViewer((state) => state.quickPreview);
  const density = useViewer((state) => state.settings.settings.browsing.density);
  const jobs = useViewer((state) => state.jobs);
  const operationsOpen = useViewer((state) => state.operationsOpen);
  const showOperations = useViewer(needsOperations);
  const deleted = useViewer((state) => state.deletedWorkspace);
  useEffect(() => {
    setShowWorkspaceUndo(!!deleted);
    if (!deleted) return;
    const timer = setTimeout(() => setShowWorkspaceUndo(false), 8000);
    return () => clearTimeout(timer);
  }, [deleted]);
  const controller = useMemo<WorkspaceController>(
    () => ({
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
        parentEngineID?: string,
        options?: { another?: boolean; link?: string },
      ) {
        const api = engine.current;
        if (!api || !readyRef.current) return;
        const space = activeWorkspace();
        const tree = api.tree.get();
        const parent =
          parentEngineID && flattenTree(tree).find((node) => node.planeID === parentEngineID);
        if (parentEngineID && !parent)
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
              parentPlaneID: parentEngineID!,
              link: options?.link,
              framing: 'none',
            },
          });
          const parent = flattenTree(api.tree.get()).find(
            (node) => node.planeID === parentEngineID,
          );
          const opening = getState().saved.ui.space.opening;
          frameWorkspace(
            engine,
            surface,
            opening === 'pair' && parent ? [hostID(parent), pane.id] : [pane.id],
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
          const node =
            engine.current &&
            flattenTree(engine.current.tree.get()).find((node) => hostID(node) === current?.id);
          controller.open(entry, node?.planeID, { another: target?.another, link: target?.link });
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
  async function transitionWorkspace(change: () => Promise<void>) {
    setReady(false);
    spatialTool(null);
    try {
      await change();
    } catch (error) {
      setReady(!!engine.current);
      throw error;
    }
  }
  async function switchTo(id: string) {
    if (id === getState().saved.activeWorkspace) return;
    await transitionWorkspace(() => switchWorkspace(id));
  }
  const windowContext = (): CommandContext => {
    const state = getState();
    const pane = activeWorkspace().panes.find((pane) => pane.id === state.activePane);
    return {
      scope: 'window',
      workspaceID: state.saved.activeWorkspace,
      paneID: state.activePane || undefined,
      path: pane?.path,
      directory: pane?.type === 'folder' ? pane.path : undefined,
      folder: pane?.type === 'folder' ? (pane as FolderPane) : undefined,
      selection: selectedFiles(state.activePane),
      jobs: state.jobs,
      clipboard: state.clipboard,
    };
  };
  useCommandSource(
    'window',
    {
      context: windowContext,
      definitions: () =>
        windowCommands({
          workspace: controller,
          engine,
          ready,
          tool,
          palette: setPalette,
          settings: () => {
            void window.viewer.openSettings().catch(report);
          },
          workspaceDialog: (kind) => setWorkspaceDialog({ kind, id: activeWorkspace().id }),
          renameShortcut: (path, name) => setShortcutDialog({ path, name }),
          switchWorkspace: switchTo,
          restoreWorkspace: () => transitionWorkspace(restoreWorkspace),
          spatialTool,
          goTo: () => setGoTo(true),
          openWith: setOpenWithPaths,
        }),
      valid: (invocation) => invocation.workspaceID === getState().saved.activeWorkspace,
    },
    [saved, ready, tool, jobs],
  );
  useEffect(() => {
    const api = engine.current;
    if (!ready || !api) return;
    let previous = '';
    return api.store.subscribe(() => {
      const history = api.history.get();
      const value = `${history.undoDepth}/${history.redoDepth}/${api.camera.docked()}`;
      if (value !== previous) {
        previous = value;
        registry.touch();
      }
    });
  }, [ready, registry]);
  const invoke = async (id: string) => {
    const edit = textEditFor(id, editable(document.activeElement));
    if (edit) {
      await window.viewer.textEdit(edit);
      return;
    }
    if (
      document.querySelector('dialog[open], .context-menu') &&
      !['palette', 'settings'].includes(id)
    )
      return;
    const context = registry.context(getState().activePane) || windowContext();
    await refreshClipboard();
    await registry.invoke(id, {
      paneID: context.paneID,
      scope: 'window',
      context,
    });
  };
  const invokeRef = useRef(invoke);
  invokeRef.current = invoke;
  useEffect(() => {
    let syncing: Promise<void> | undefined;
    let resyncAgain = false;
    const resync = () => {
      if (syncing) {
        resyncAgain = true;
        return;
      }
      syncing = window.viewer
        .jobs()
        .then(setJobs)
        .catch(report)
        .finally(() => {
          syncing = undefined;
          if (resyncAgain) {
            resyncAgain = false;
            resync();
          }
        });
    };
    const remove = window.viewer.onEvent((event) => {
      if (event.type === 'folder-size') receiveFolderSize(event.task);
      else if (event.type === 'folder-changed') invalidateFolderSizes(event.path);
      else if (event.type === 'settings') receiveSettings(event.snapshot);
      else if (event.type === 'file-changes') {
        receiveFileChanges(event.changes);
        for (const change of event.changes) {
          invalidateFolderSizes(change.source);
          invalidateFolderSizes(change.destination);
        }
      } else if (event.type === 'job') receiveJob(event.job);
      else if (event.type === 'job-progress' && !receiveProgress(event.progress)) resync();
      else if (event.type === 'open')
        for (const path of event.paths) void controller.openPath(path).catch(report);
      else if (event.type === 'flush')
        void flushState()
          .then(() => window.viewer.flushed(event.token))
          .catch(report);
      else if (event.type === 'command') void invokeRef.current(event.command).catch(report);
    });
    resync();
    const focus = () => {
      void refreshClipboard().catch(report);
    };
    window.addEventListener('focus', focus);
    focus();
    return () => {
      remove();
      window.removeEventListener('focus', focus);
    };
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
      if (
        getState().quickPreview &&
        !editable(event.target) &&
        !event.isComposing &&
        !event.repeat &&
        [' ', 'Escape', 'ArrowLeft', 'ArrowRight'].includes(event.key)
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
          stepQuickPreview(event.key === 'ArrowLeft' ? -1 : 1);
        else quickPreview(null);
        return;
      }
      if (
        event.key === ' ' &&
        !event.repeat &&
        !event.isComposing &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !editable(event.target) &&
        !(event.target as Element).closest(
          'button, [role="button"], select, video, audio, .preview-host',
        ) &&
        !document.querySelector('dialog[open], .context-menu')
      ) {
        const context = registry.context(getState().activePane) || windowContext();
        if (context.selection.some((file) => !file.directory)) {
          event.preventDefault();
          event.stopPropagation();
          quickPreview(
            context.selection.filter((file) => !file.directory).map((file) => file.path),
            { paneID: context.paneID, workspaceID: context.workspaceID },
          );
          return;
        }
      }
      if (
        event.key === 'Escape' &&
        tool &&
        !document.querySelector('dialog[open], .context-menu')
      ) {
        spatialTool(null);
        event.preventDefault();
      }
      if (!(event.metaKey || event.ctrlKey) || event.isComposing || event.repeat) return;
      const settings = getState().settings.settings;
      const bindings = {
        ...defaultShortcuts,
        ...settings.shortcuts,
        ...Object.fromEntries(
          settings.recipes
            .filter((recipe) => recipe.shortcut)
            .map((recipe) => ['recipe.' + recipe.id, recipe.shortcut!]),
        ),
      };
      const id = Object.entries(bindings).find(([, shortcut]) =>
        matchesShortcut(shortcut, event),
      )?.[0];
      if (editable(event.target) && !['palette', 'settings'].includes(id || '')) return;
      if (id) {
        event.preventDefault();
        event.stopPropagation();
        void invokeRef.current(id).catch(report);
      }
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, [tool]);
  const targetWorkspace = saved.workspaces.find(
    (workspace) => workspace.id === workspaceDialog?.id,
  );
  const inProgress = jobs.filter((job) =>
    ['queued', 'running', 'collision'].includes(job.status),
  ).length;
  return (
    <WorkspaceContext.Provider value={controller}>
      <div className="app-shell" data-look={saved.look} data-density={density}>
        <header className="app-titlebar">
          <div className="traffic-space" />
          <IconButton
            icon="sidebar"
            label={saved.ui.sidebar.visible ? 'Hide window navigation' : 'Show window navigation'}
            aria-pressed={saved.ui.sidebar.visible}
            onClick={() => {
              void registry.invoke('toggle-sidebar', { sources: ['window'] }).catch(report);
            }}
          />
          <button
            className="workspace-switcher"
            aria-label="Workspace"
            aria-haspopup="dialog"
            aria-expanded={!!workspaceMenu}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setWorkspaceMenu({ x: rect.left, y: rect.bottom + 6 });
            }}
          >
            <span>{space.name}</span>
            <Icon name="down" size={13} />
          </button>
          <IconButton
            icon="plus"
            label="New folder plane (⌘N)"
            disabled={!ready || space.panes.length >= 200}
            onClick={() => {
              void invoke('new-root-folder').catch(report);
            }}
          />
          <span className="toolbar-spacer" />
          <ActionHub />
          {showOperations && (
            <button
              className="operations-button"
              aria-label="File operations"
              aria-expanded={operationsOpen}
              onClick={() => setOperationsOpen(!operationsOpen)}
            >
              <Icon name="copy" size={17} />
              {inProgress > 0 && <span className="count-badge">{inProgress}</span>}
            </button>
          )}
          <IconButton
            icon="command"
            label="Commands (⌘K)"
            onClick={() => {
              void invoke('palette').catch(report);
            }}
          />
        </header>
        <div className="app-main">
          <Sidebar />
          <main className="workspace-main">
            <ErrorBoundary>
              <WorkspaceSurface engine={engine} surface={surface} onReady={() => setReady(true)} />
            </ErrorBoundary>
          </main>
        </div>
        <OperationsPanel />
        {openWithPaths && (
          <OpenWithDialog paths={openWithPaths} onClose={() => setOpenWithPaths(undefined)} />
        )}
        {workspaceMenu && (
          <ContextMenu
            position={workspaceMenu}
            request={{ sources: ['window'], scope: 'workspace' }}
            label="Workspaces"
            onClose={() => setWorkspaceMenu(null)}
          />
        )}
        {palette && (
          <CommandPalette mode={palette} onMode={setPalette} onClose={() => setPalette(null)} />
        )}
        {notice && (
          <div className="notice" role="alert">
            <Icon name="warning" />
            <span>{notice}</span>
            <IconButton icon="close" label="Dismiss message" onClick={dismissNotice} />
          </div>
        )}
        {deleted && showWorkspaceUndo && (
          <div className="workspace-recovery" role="status">
            <span>Deleted “{deleted.workspace.name}” workspace</span>
            <button
              onClick={() => {
                void transitionWorkspace(restoreWorkspace).catch(report);
              }}
            >
              Undo
            </button>
          </div>
        )}
        {quick && <QuickPreview session={quick} />}
        {workspaceDialog && workspaceDialog.kind !== 'delete' && (
          <NameDialog
            title={workspaceDialog.kind === 'new' ? 'New workspace' : 'Rename workspace'}
            maxLength={100}
            initial={workspaceDialog.kind === 'rename' ? targetWorkspace?.name : ''}
            action={workspaceDialog.kind === 'new' ? 'Create' : 'Rename'}
            onClose={() => setWorkspaceDialog(null)}
            onSubmit={async (name) => {
              name = name.trim();
              if (!name) throw new Error('Enter a workspace name.');
              if (workspaceDialog.kind === 'new') {
                await transitionWorkspace(() => newWorkspace(name));
              } else if (targetWorkspace?.id === activeWorkspace().id) renameWorkspace(name);
            }}
          />
        )}
        {workspaceDialog?.kind === 'delete' && targetWorkspace && (
          <Dialog
            title="Delete workspace?"
            onClose={() => {
              if (!busy) setWorkspaceDialog(null);
            }}
          >
            <div className="dialog-copy">
              <p>
                Delete “{targetWorkspace.name}” and its {targetWorkspace.panes.length} open{' '}
                {targetWorkspace.panes.length === 1 ? 'plane' : 'planes'}?
              </p>
              <p>
                Your files and folders stay where they are. File operations continue. You can undo
                this deletion during this session.
              </p>
            </div>
            <footer>
              <button disabled={busy} onClick={() => setWorkspaceDialog(null)}>
                Cancel
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void transitionWorkspace(() => deleteWorkspace(targetWorkspace.id))
                    .then(() => setWorkspaceDialog(null))
                    .catch(report)
                    .finally(() => setBusy(false));
                }}
              >
                Delete workspace
              </button>
            </footer>
          </Dialog>
        )}
        {shortcutDialog && (
          <NameDialog
            title="Rename shortcut"
            initial={shortcutDialog.name}
            maxLength={200}
            action="Rename"
            onClose={() => setShortcutDialog(null)}
            onSubmit={(name) => renameShortcut(shortcutDialog.path, name)}
          />
        )}
        {goTo && (
          <NameDialog
            title="Go to folder"
            label="Folder path"
            maxLength={32768}
            initial={bootstrap.home}
            action="Go"
            onClose={() => setGoTo(false)}
            onSubmit={async (path) => {
              const resolved =
                path === '~' || path.startsWith('~/') ? bootstrap.home + path.slice(1) : path;
              const entry = await window.viewer.stat(resolved);
              if (!entry.directory) throw new Error('Choose a folder.');
              await controller.openPath(entry.path);
            }}
          />
        )}
      </div>
    </WorkspaceContext.Provider>
  );
}
