import { routeFileKeyboard } from './explorer/selection';
import { AgentReview } from './actions/AgentReview';
import { captureTarget } from './commands/programs';
import { useWorkspaceController } from './workspace/controller';
import { executeAgentNavigation } from './workspace/agent-navigation';
import { programCommands } from './commands/programs';
import { ExecutionPanel } from './terminals/ExecutionPanel';
import { trimTerminals, terminalEditing } from './terminals/sessions';
import { explorerCommandIDs, keyCommand } from './explorer/input';
/** Native window chrome stays quiet; commands follow the active file, folder or preview. */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { type PluridApplicationHandle } from '@plurid/plurid-react';
import { PLURID_PUBSUB_TOPIC } from '@plurid/plurid-data';
import type { FolderPane } from '../domain/contracts';
import { selectedFiles } from './workspace/sessions';
import {
  activeWorkspace,
  deleteWorkspace,
  dismissNotice,
  flushState,
  getState,
  needsOperations,
  newWorkspace,
  quickPreview,
  stepQuickPreview,
  receiveJob,
  receiveSettings,
  receiveFileChanges,
  receiveProgress,
  rememberCommand,
  renameShortcut,
  renameWorkspace,
  report,
  restoreWorkspace,
  setJobs,
  setOperationsOpen,
  switchWorkspace,
  refreshClipboard,
  useViewer,
} from './state/store';
import { WorkspaceContext } from './workspace/context';
import { WorkspaceSurface } from './workspace/WorkspaceSurface';
import { Icon } from './ui/Icon';
import { Dialog, ErrorBoundary, IconButton, NameDialog } from './ui/primitives';
import { ProjectControls, ProjectFileNotice } from './workspace/projects';
import { InspectionControls } from './ui/Inspection';
import { CheckpointControls } from './ui/Checkpoints';
import { OperationReviewControls } from './ui/OperationReview';
import { ComparisonControls } from './ui/Comparison';
import { CollectionControls } from './ui/Collections';
import { WorkflowControls } from './ui/Workflows';
import { RelationshipControls } from './ui/Relationships';
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
import { Volumes } from './ui/Volumes';
import { Trash } from './ui/Trash';
import { openWorkspacePath } from './workspace/open-path';
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
  const [volumesOpen, setVolumesOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  useEffect(() => {
    const open = () => setTrashOpen(true);
    window.addEventListener('viewer:trash', open);
    return () => window.removeEventListener('viewer:trash', open);
  }, []);
  useEffect(() => {
    const open = () => setVolumesOpen(true);
    window.addEventListener('viewer:volumes', open);
    return () => window.removeEventListener('viewer:volumes', open);
  }, []);
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

  const [palette, setPalette] = useState<'commands' | 'files' | 'workspaces' | null>(null);
  const [goTo, setGoTo] = useState(false);
  const [terminalName, setTerminalName] = useState<string>();
  const terminalConfig = useViewer((state) => state.settings.settings.terminals);
  useEffect(() => {
    let live = true;
    void window.viewer
      .terminalApplication()
      .then((app) => {
        if (live) setTerminalName(app.name);
      })
      .catch(() => {
        if (live) setTerminalName(undefined);
      });
    return () => {
      live = false;
    };
  }, [terminalConfig.application]);
  const [busy, setBusy] = useState(false);
  const [showWorkspaceUndo, setShowWorkspaceUndo] = useState(false);
  const initialOpenHandled = useRef(false);
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
  const controller = useWorkspaceController({ engine, surface, readyRef });
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
      rootID: controller.rootID(state.activePane),
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
      definitions: () => [
        ...programCommands(
          controller,
          async (id, context) => {
            await registry.invoke(id, { paneID: context.paneID, context });
          },
          terminalName,
        ),
        ...windowCommands({
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
      ],
      valid: (invocation) =>
        invocation.workspaceID === getState().saved.activeWorkspace &&
        (!invocation.paneID ||
          activeWorkspace().panes.some(
            (pane) =>
              pane.id === invocation.paneID &&
              (!invocation.folder || pane.path === invocation.folder.path),
          )),
    },
    [saved, ready, tool, jobs, terminalName],
  );
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const publish = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const workspaces = {
          activeWorkspace: getState().saved.activeWorkspace,
          workspaces: getState().saved.workspaces.map((space) => ({
            id: space.id,
            name: space.name,
            roots: space.roots,
            panes: space.panes.map((pane) => ({
              id: pane.id,
              type: pane.type,
              path: pane.path,
              ...(pane.type === 'folder' ? { mode: pane.mode } : {}),
              ...(pane.type === 'search' ? { allLocations: pane.allLocations } : {}),
            })),
          })),
        };
        const context = registry.context(getState().activePane) || windowContext();
        if (!context.directory && !context.folder) {
          const space = activeWorkspace();
          const pane = space.panes.find((pane) => pane.id === getState().activePane);
          void window.viewer
            .commandsPublish(
              {
                workspaceID: space.id,
                rootID: (pane && controller.rootID(pane.id)) || 'none',
                paneID: pane?.id || 'none',
                panePath: pane?.path,
                directory: pane
                  ? pane.type === 'preview'
                    ? pane.path.slice(0, pane.path.lastIndexOf('/')) || '/'
                    : pane.path
                  : getState().bootstrap.home,
                selection: [],
              },
              [],
              workspaces,
            )
            .catch(report);
          return;
        }
        const target = captureTarget(context, controller);
        const commands =
          target.selection.length > 2000
            ? []
            : registry
                .list({
                  paneID: context.paneID,
                  scope: context.selection.length ? 'files' : 'folder',
                  context,
                })
                .map(({ id, label, group, aliases, shortcut }) => ({
                  id,
                  label,
                  group,
                  aliases: [...aliases],
                  shortcut,
                }));
        if (target.selection.length > 2000) target.selection = [];
        void window.viewer.commandsPublish(target, commands, workspaces).catch(report);
      }, 80);
    };
    const off = registry.subscribe(publish);
    publish();
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [registry, controller, getState().activePane]);
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
  useEffect(() => {
    trimTerminals(
      new Set(
        saved.workspaces.flatMap((space) =>
          space.panes.filter((pane) => pane.type === 'terminal').map((pane) => pane.id),
        ),
      ),
    );
  }, [saved.workspaces]);
  const invoke = async (id: string) => {
    if (
      document.activeElement?.closest('.terminal-plane') &&
      (await terminalEditing(getState().activePane, id))
    )
      return;
    const edit = textEditFor(id, editable(document.activeElement));
    if (edit) {
      await window.viewer.textEdit(edit);
      return;
    }
    if (editable(document.activeElement) && explorerCommandIDs.has(id)) return;
    if (
      document.querySelector('dialog[open], .context-menu') &&
      !['palette', 'settings'].includes(id)
    )
      return;
    const context = registry.context(getState().activePane) || windowContext();
    if (id === 'paste' || id === 'paste-move') await refreshClipboard();
    await registry.invoke(id, {
      paneID: context.paneID,
      scope: 'window',
      context: { ...context, clipboard: getState().clipboard },
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
      if (event.type === 'service-error') report(event.message);
      else if (event.type === 'folder-size') receiveFolderSize(event.task);
      else if (event.type === 'folder-changed') invalidateFolderSizes(event.path);
      else if (event.type === 'file-access') {
        invalidateFolderSizes(event.path);
        window.dispatchEvent(new Event('viewer:refresh'));
      } else if (event.type === 'settings') receiveSettings(event.snapshot);
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
      else if (event.type === 'agent-command') {
        const finish = (error?: string) => {
          void window.viewer.agentCommandResult(event.id, error?.slice(0, 2000)).catch(report);
        };
        const deadline = performance.now() + 3000;
        const execute = () => {
          if (document.querySelector('dialog[open]')) {
            if (performance.now() < deadline) requestAnimationFrame(execute);
            else {
              report('Close the open dialog and request the action again.');
              finish('Another dialog prevented the action.');
            }
            return;
          }
          const { target } = event;
          const space = activeWorkspace();
          const pane = space.panes.find((pane) => pane.id === target.paneID);
          const emptyOrigin =
            event.navigation &&
            !space.panes.length &&
            target.paneID === 'none' &&
            target.rootID === 'none';
          if (
            space.id !== target.workspaceID ||
            (!emptyOrigin &&
              (!pane ||
                (target.panePath && pane.path !== target.panePath) ||
                controller.rootID(pane.id) !== target.rootID))
          ) {
            report('The originating plane is no longer available. Request a new proposal.');
            finish('The originating plane or folder changed.');
            return;
          }
          if (event.navigation) {
            void executeAgentNavigation(event.navigation, target, controller, switchTo)
              .then(() => finish())
              .catch((error: Error) => {
                report(error);
                finish(error.message);
              });
            return;
          }
          if (!pane) {
            finish('The originating plane is unavailable.');
            return;
          }
          void registry
            .invoke(event.command, {
              paneID: target.paneID,
              scope: target.selection.length ? 'files' : 'folder',
              context: {
                workspaceID: target.workspaceID,
                rootID: target.rootID,
                paneID: target.paneID,
                directory: target.directory,
                selection: target.selection,
                path: pane.path,
                folder: pane.type === 'folder' ? pane : undefined,
              },
            })
            .then((executed) =>
              finish(executed ? undefined : 'The command is no longer available for this context.'),
            )
            .catch((error: Error) => {
              report(error);
              finish(error.message);
            });
        };
        requestAnimationFrame(execute);
      } else if (event.type === 'command') void invokeRef.current(event.command).catch(report);
    });
    resync();
    const focus = () => {
      void refreshClipboard(true);
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
      const id = keyCommand(event, getState().settings.settings);
      if (
        (event.target as Element).closest('.terminal-plane') &&
        !['palette', 'settings'].includes(id || '')
      )
        return;
      if (editable(event.target) && !['palette', 'settings'].includes(id || '')) return;
      if (id && explorerCommandIDs.has(id)) {
        if (!document.querySelector('dialog[open], .context-menu'))
          routeFileKeyboard(getState().activePane, event);
        return;
      }
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
      <ProjectControls />
      <InspectionControls />
      <CheckpointControls />
      <OperationReviewControls />
      <ComparisonControls />
      <CollectionControls />
      <WorkflowControls />
      <RelationshipControls />
      <div className="app-shell" data-look={saved.look} data-density={density}>
        <ProjectFileNotice />
        <AgentReview />
        <ExecutionPanel />
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
        {trashOpen && <Trash onClose={() => setTrashOpen(false)} />}
        {volumesOpen && (
          <Volumes
            onClose={() => setVolumesOpen(false)}
            open={(path) =>
              openWorkspacePath(
                path,
                {
                  paneID: getState().activePane || undefined,
                  directory: true,
                },
                controller,
              )
            }
          />
        )}
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
