import { WindowDialogs, type WindowDialog } from './app/WindowDialogs';
import { routeFileKeyboard } from './explorer/selection';
import { AgentReview } from './actions/AgentReview';
import { useAgentCatalog } from './app/useAgentCatalog';
import { commandAtAgentOrigin, resolveAgentOrigin } from './app/agent-origin';
import {
  effectiveWindowLook,
  effectiveWindowSettings,
  effectiveWindowUI,
} from './state/effective-ui';
import type { SpatialOverviewHandle } from './workspace/overlays/useSpatialOverview';
import { failedFlush } from '../domain/persistence/flush';
import { prepareNoteTrash, finishNoteTrash } from './notes/sessions';
import { savePatch } from './state/core';
import type { CapturedTarget } from '../domain/automation/actions';
import { receiveWorkspaces } from './state/workspaces';
import type { LaunchRequest } from '../domain/workspaces/launch';
import { parentPath } from '../domain/workspaces/planes';
import { useWorkspaceController } from './workspace/controller';
import { executeAgentNavigation } from './workspace/agent-navigation';
import { programCommands } from './commands/programs';
import { ExecutionPanel } from './terminals/ExecutionPanel';
import { trimTerminals, terminalEditing } from './terminals/sessions';
import { explorerCommandIDs, keyCommand } from './explorer/input';
/** Native window chrome stays quiet; commands follow the active file, folder or preview. */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { type PluridApplicationHandle } from '@plurid/plurid-react';
import type { FolderPane } from '../domain/contracts';
import { agentDispatchRefusal } from '../domain/agents/safety';
import { selectedFiles } from './workspace/sessions';
import {
  activeWorkspace,
  announce,
  dismissNotice,
  flushState,
  getState,
  needsOperations,
  newWorkspace,
  quickPreview,
  receiveJob,
  receiveSettings,
  receiveFileChanges,
  receiveProgress,
  rememberCommand,
  report,
  restoreWorkspace,
  setJobs,
  setOperationsOpen,
  switchWorkspace,
  refreshClipboard,
  useViewer,
} from './state/store';
import { WorkspaceContext, type SpatialTool } from './workspace/context';
import { WorkspaceSurface } from './workspace/WorkspaceSurface';
import { Icon } from './ui/Icon';
import { ErrorBoundary, IconButton } from './ui/primitives';
import { ProjectControls, ProjectFileNotice } from './workspace/projects';
import { InspectionControls } from './ui/inspection/Inspection';
import { CheckpointControls } from './ui/operations/Checkpoints';
import { OperationReviewControls } from './ui/operations/OperationReview';
import { ComparisonControls } from './ui/comparison/Comparison';
import { DuplicateControls } from './ui/comparison/Duplicates';
import { CollectionControls } from './ui/collections/Collections';
import { WorkflowControls } from './ui/automation/Workflows';
import { RelationshipControls } from './ui/relationships/Relationships';
import { ActionHub } from './actions/ActionHub';
import { OperationsPanel } from './operations/OperationsPanel';
import { QuickPreview, quickPreviewEdit } from './previews/QuickPreview';
import { previewDocuments } from './previews/document-cache';
import { useTitlebar } from './ui/titlebar';
import { useTheme, useThemeVariables } from './ui/theme';
import { useKeySequences } from './keys/sequences';
import { recordCommand, recordLine, useMacroRecording } from './keys/macro';
import { WhichKey } from './keys/WhichKey';
import { PlaneHints } from './keys/PlaneHints';
import { openTerminalFind } from './terminals/find';
import { CommandsContext, useCommands, useCommandSource } from './commands/context';
import { CommandRegistry, type CommandContext } from './commands/registry';
import { windowCommands } from './commands/window';
import { CommandPalette } from './commands/CommandPalette';
import type { PaletteMode } from './commands/palette-modes';
import type { LineHost } from './command-line/host';
import { runLine, type LineResult } from './command-line/run';
import { receiveSessionKeys } from './keys/session';
import { editable, textEditFor } from './commands/editing';
import { routeToEditor, subscribeEditingPlanes } from './editing/planes';
import { recoverBuffers } from './editing/unsaved';
import { Sidebar } from './ui/navigation/Sidebar';

import { ContextMenu } from './ui/ContextMenu';
import { OpenWithDialog } from './ui/navigation/OpenWithDialog';
import { Volumes } from './ui/navigation/Volumes';
import { Trash } from './ui/trash/Trash';
import { openWorkspacePath } from './workspace/open-path';
import { invalidateFolderSizes, receiveFolderSize } from './explorer/sizes';
import { commandShortcutID } from '../domain/preferences/shortcuts';
import { dialogOpen, overlayOpen } from './ui/modal';

export function App() {
  const registry = useMemo(
    () =>
      new CommandRegistry(
        (id) => {
          rememberCommand(id);
          // Record macro (keys/macro.ts) collects what the person runs
          recordCommand(id);
        },
        (id) => getState().settings.settings.shortcuts[commandShortcutID(id)],
      ),
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
  const pendingPresentation = useRef<string | undefined>(undefined);
  readyRef.current = ready;
  // once, at launch: unsaved text no plane holds comes back as planes
  const recovered = useRef(false);
  useEffect(() => {
    if (!ready || recovered.current) return;
    recovered.current = true;
    void recoverBuffers().catch(report);
  }, [ready]);
  const [windowDialog, setWindowDialog] = useState<WindowDialog>();
  useEffect(() => {
    const run = (event: Event) => {
      const target = (event as CustomEvent<CapturedTarget>).detail;
      if (target?.paneID) setWindowDialog({ type: 'run-command', target });
    };
    window.addEventListener('viewer:run-command', run);
    return () => window.removeEventListener('viewer:run-command', run);
  }, []);
  const recordingMacro = useMacroRecording();
  const [workspaceMenu, setWorkspaceMenu] = useState<{ x: number; y: number } | null>(null);

  const [palette, setPalette] = useState<PaletteMode | null>(null);
  // what the palette opens with, and each opening's number: a new opening starts it afresh
  const [paletteQuery, setPaletteQuery] = useState({ text: '', opening: 0 });
  const openPalette = useCallback((mode: PaletteMode, query = '') => {
    setPaletteQuery((previous) => ({ text: query, opening: previous.opening + 1 }));
    setPalette(mode);
  }, []);
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
  const [showWorkspaceUndo, setShowWorkspaceUndo] = useState(false);
  const initialOpenHandled = useRef(false);
  const saved = useViewer((state) => state.saved);
  // ⌥⌘T hides the title bar; it comes back at the window's top edge (ui/titlebar.ts)
  const windowUI = useViewer(effectiveWindowUI);
  const titlebar = useTitlebar(windowUI.titlebar.visible);
  const activePane = useViewer((state) => state.activePane);
  const space = useViewer(activeWorkspace);
  const look = useViewer(effectiveWindowLook);
  const settings = useViewer(effectiveWindowSettings);
  const [overview, setOverview] = useState<SpatialOverviewHandle>();
  const bootstrap = useViewer((state) => state.bootstrap);
  const notice = useViewer((state) => state.notice);
  const noticeKind = useViewer((state) => state.noticeKind);
  // information goes by itself after a moment; a problem stays until it is dismissed
  useEffect(() => {
    if (!notice || noticeKind !== 'info') return;
    const timer = setTimeout(() => {
      if (getState().notice === notice) dismissNotice();
    }, 5000);
    return () => clearTimeout(timer);
  }, [notice, noticeKind]);
  const quick = useViewer((state) => state.quickPreview);
  const density = settings.browsing.density;
  const jobs = useViewer((state) => state.jobs);
  const jobsSignature =
    jobs.length +
    ':' +
    jobs
      .filter((job) => job.undoable || job.redoable)
      .map((job) => job.id + (job.undoable ? 'u' : '') + (job.redoable ? 'r' : ''))
      .join(',');
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
  const subscribeEngine = useCallback(
    (listener: () => void) => controller.subscribeEngine(listener),
    // The engine is a ref: readiness, a workspace switch or a new epoch (a project reload, which
    // keeps the workspace and its readiness) means a new instance to subscribe to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, ready, space.id, space.epoch],
  );
  const tool = useSyncExternalStore(subscribeEngine, controller.transformTool);
  const spatialTool = useCallback(
    (value: SpatialTool) => controller.setTransformTool(value),
    [controller],
  );
  const transitionWorkspace = useCallback(
    async (change: () => Promise<void>) => {
      const previous = getState().saved.activeWorkspace;
      setReady(false);
      spatialTool(null);
      try {
        await change();
        if (getState().saved.activeWorkspace === previous) setReady(!!engine.current);
      } catch (error) {
        setReady(!!engine.current);
        throw error;
      }
    },
    [spatialTool],
  );
  const switchTo = useCallback(
    async (id: string) => {
      if (id === getState().saved.activeWorkspace) return;
      pendingPresentation.current =
        getState().saved.workspaces.find((space) => space.id === id)?.profileID === 'present'
          ? id
          : undefined;
      await transitionWorkspace(() => switchWorkspace(id));
      if (getState().saved.activeWorkspace !== id) pendingPresentation.current = undefined;
    },
    [transitionWorkspace],
  );
  const windowContext = useCallback((): CommandContext => {
    const state = getState();
    const pane = activeWorkspace().panes.find((pane) => pane.id === state.activePane);
    return {
      scope: 'window',
      workspaceID: state.saved.activeWorkspace,
      rootID: controller.rootID(state.activePane),
      paneID: state.activePane || undefined,
      path: pane?.path,
      directory:
        pane && ['folder', 'terminal', 'server'].includes(pane.type) ? pane.path : undefined,
      folder: pane?.type === 'folder' ? (pane as FolderPane) : undefined,
      selection: selectedFiles(state.activePane),
      jobs: state.jobs,
      clipboard: state.clipboard,
    };
  }, [controller]);
  // the command line's runner, for sequences' steps with words: set once the line host is
  const lineRunRef = useRef<(text: string) => Promise<LineResult>>(async () => ({ ok: false }));
  useCommandSource(
    'window',
    {
      context: windowContext,
      definitions: () => [
        ...programCommands(
          controller,
          // `false` when nothing of that ID ran: the custom action then says so
          (id, context) => registry.invoke(id, { paneID: context.paneID, context }),
          terminalName,
          () => registry.context(getState().activePane) || windowContext(),
          (text) => lineRunRef.current(text),
          {
            showServers: () => setWindowDialog({ type: 'servers' }),
            showNotes: () => setWindowDialog({ type: 'notes' }),
            showAgentSessions: (directory) =>
              setWindowDialog({ type: 'agent-sessions', directory }),
            showTasks: (target) => setWindowDialog({ type: 'tasks', target }),
            branchTask: (target) =>
              setWindowDialog({ type: 'branch-task', id: crypto.randomUUID(), target }),
            runCommand: (target) => setWindowDialog({ type: 'run-command', target }),
            newBrowser: (paneID) => setWindowDialog({ type: 'browser', paneID }),
            imageTools: (files, paneID, preset) =>
              setWindowDialog({ type: 'image-tools', files, paneID, preset }),
            optimizeFiles: (files, paneID, preset) =>
              setWindowDialog({ type: 'optimize', files, paneID, preset }),
            pdfTools: (files, paneID) => setWindowDialog({ type: 'pdf-tools', files, paneID }),
          },
        ),
        ...windowCommands({
          workspace: controller,
          ready,
          overview: () => overview?.open(),
          overviewAvailable: overview?.available ?? false,
          tool,
          palette: openPalette,
          settings: () => {
            void window.viewer.openSettings().catch(report);
          },
          backup: () => setWindowDialog({ type: 'backup' }),
          capabilities: (context) =>
            setWindowDialog({
              type: 'capabilities',
              request: { paneID: context.paneID, scope: context.scope, context },
            }),
          workspaceDialog: (kind) =>
            setWindowDialog({ type: 'workspace', kind, id: activeWorkspace().id }),
          renameShortcut: (path, name) => setWindowDialog({ type: 'shortcut', path, name }),
          switchWorkspace: switchTo,
          restoreWorkspace: () => transitionWorkspace(restoreWorkspace),
          spatialTool,
          goTo: () => setWindowDialog({ type: 'go-to' }),
          connectServer: () => setWindowDialog({ type: 'connect' }),
          findTagged: () => setWindowDialog({ type: 'tag' }),
          openWith: setOpenWithPaths,
          saveMacro: (commands) => setWindowDialog({ type: 'macro', commands }),
          viewDialog: (kind) => setWindowDialog({ type: 'view', kind }),
          templateDialog: () => setWindowDialog({ type: 'template' }),
          profileDialog: () => setWindowDialog({ type: 'profile' }),
          gitCommit: (target) =>
            setWindowDialog({ type: 'git-commit', id: crypto.randomUUID(), target }),
          gitWorktrees: (target) =>
            setWindowDialog({ type: 'git-worktrees', id: crypto.randomUUID(), target }),
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
    // Progress ticks replace `jobs` many times a second; commands only care whether
    // jobs exist and which can be undone, and read those from the live context.
    [saved, ready, tool, jobsSignature, terminalName, overview],
  );
  useAgentCatalog({ registry, controller, activePane, context: windowContext });
  // a plane that starts or stops editing changes which text commands apply
  useEffect(() => subscribeEditingPlanes(() => registry.touch()), [registry]);
  useEffect(() => {
    if (!ready) return;
    let previous = '';
    // Arrangement Undo/Redo and docking change which window commands apply. On the engine of the
    // moment: a project reload remounts it, and this stayed on the old one's store.
    return controller.subscribeEngine(() => {
      const history = controller.arrangementHistory();
      const value = `${history.canUndo}/${history.canRedo}/${controller.isDocked()}`;
      if (value !== previous) {
        previous = value;
        registry.touch();
      }
    });
  }, [ready, registry, controller, space.id, space.epoch]);
  useEffect(() => {
    trimTerminals(
      new Set(
        getState().saved.workspaces.flatMap((space) =>
          space.panes.filter((pane) => pane.type === 'terminal').map((pane) => pane.id),
        ),
      ),
    );
  }, [saved.workspaces]);
  /** Runs a command where it belongs; false when nothing ran (a line stops there). */
  const invoke = async (id: string, remember = true): Promise<boolean> => {
    // Edit menu Undo, Redo and Select All reach a CodeMirror editor, which `webContents` does not
    if (routeToEditor(id, getState().activePane)) return true;
    // ⌘E in Quick Preview edits the text file it shows, as its plane
    if (id === 'edit-file' && quickPreviewEdit()) return true;
    // ⌘F in a terminal searches its output, rather than opening the file palette
    if (id === 'find-file') {
      const terminal = document.activeElement?.closest<HTMLElement>('.terminal-plane');
      if (terminal?.dataset.terminalId && openTerminalFind(terminal.dataset.terminalId))
        return true;
    }
    if (
      document.activeElement?.closest('.terminal-plane') &&
      (await terminalEditing(getState().activePane, id))
    )
      return true;
    const edit = textEditFor(id, editable(document.activeElement));
    if (edit) {
      await window.viewer.textEdit(edit);
      return true;
    }
    if (editable(document.activeElement) && explorerCommandIDs.has(id)) return false;
    if (overlayOpen() && !['palette', 'settings'].includes(id)) return false;
    const context = registry.context(getState().activePane) || windowContext();
    if (id === 'paste' || id === 'paste-move') await refreshClipboard();
    return registry.invoke(id, {
      paneID: context.paneID,
      scope: 'window',
      context: { ...context, clipboard: getState().clipboard },
      remember,
    });
  };
  const invokeRef = useRef(invoke);
  invokeRef.current = invoke;
  // THE COMMAND LINE: what a line runs against, and running one from the palette
  const lineHost = useMemo<LineHost>(
    () => ({
      invoke: (id, remember) => invokeRef.current(id, remember),
      registry,
      workspace: controller,
      context: () => registry.context(getState().activePane) || windowContext(),
      newWorkspace: (name) => transitionWorkspace(() => newWorkspace(name)),
      switchWorkspace: switchTo,
      palette: openPalette,
    }),
    [registry, controller, windowContext, transitionWorkspace, switchTo, openPalette],
  );
  /** Lines one after another, `count` times, until one cannot run (a key's binding). */
  const runLines = async (lines: readonly string[], count = 1) => {
    for (let time = 0; time < count; time++)
      for (const line of lines) {
        if (!time) recordLine(line);
        const result = await runLine(line, lineHost);
        if (result.message) {
          if (result.ok) announce(result.message);
          else report(new Error(result.message));
        }
        if (!result.ok) return;
      }
  };
  // the prefix, root and leader keys and the modes (keys/sequences.ts): before App's own key handler
  useKeySequences(runLines);
  lineRunRef.current = (text) => runLine(text, lineHost);
  const runFromPalette = (text: string, model = false) => {
    recordLine(text);
    setPalette(null);
    // the palette is a dialog, and commands wait while one is open: run once it has gone
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        void runLine(text, lineHost, model)
          .then((result) => {
            if (result.ok) announce(result.message || 'Command completed.');
            else if (result.message) report(new Error(result.message));
          })
          .catch(report);
      }),
    );
  };
  const commandLabel = (id: string) => {
    const context = registry.context(getState().activePane) || windowContext();
    const available = registry.list({
      ids: [id],
      scope: 'window',
      paneID: context.paneID,
      context,
    })[0];
    if (available) return { label: available.label, available: true };
    const label = registry.label(id, context);
    return label ? { label, available: false } : undefined;
  };
  const handleLaunch = useCallback(
    async (request: LaunchRequest) => {
      const origin = getState().saved.activeWorkspace;
      const deadline = performance.now() + 5000;
      while (!readyRef.current) {
        if (performance.now() > deadline)
          throw new Error('The workspace is still opening. Retry the command.');
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      if (getState().saved.activeWorkspace !== origin) return;
      if (request.terminal) {
        for (const requested of request.paths.length
          ? request.paths
          : [windowContext().directory ?? getState().bootstrap.home]) {
          const item = await window.viewer.stat(requested);
          if (getState().saved.activeWorkspace !== origin) return;
          controller.newTerminal({
            workspaceID: origin,
            rootID: 'none',
            paneID: 'none',
            directory: item.directory ? item.path : parentPath(item.path),
            selection: [],
          });
        }
      } else {
        for (const file of request.paths) await controller.openPath(file);
      }
    },
    [controller, windowContext],
  );
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
    // the session's :bind and :alias, as the main process holds them
    void window.viewer.sessionKeys?.().then(receiveSessionKeys).catch(report);
    const remove = window.viewer.onEvent((event) => {
      if (event.type === 'service-error') report(event.message);
      else if (event.type === 'folder-size') receiveFolderSize(event.task);
      else if (event.type === 'folder-changed') invalidateFolderSizes(event.path);
      else if (event.type === 'file-access') {
        previewDocuments.invalidate(event.path);
        invalidateFolderSizes(event.path);
        window.dispatchEvent(new Event('viewer:refresh'));
      } else if (event.type === 'settings') receiveSettings(event.snapshot);
      else if (event.type === 'session-keys') receiveSessionKeys(event.session);
      else if (event.type === 'workspaces') receiveWorkspaces(event.state);
      else if (event.type === 'launch') void handleLaunch(event.request).catch(report);
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
      else if (event.type === 'prepare-note-trash')
        void prepareNoteTrash(event.id)
          .then(
            () => window.viewer.flushed(event.token, { ok: true }),
            (error) => window.viewer.flushed(event.token, failedFlush(error)),
          )
          .catch(report);
      else if (event.type === 'note-trash-finished') {
        finishNoteTrash(event.id, event.trashed);
        if (event.trashed) {
          for (const pane of activeWorkspace().panes)
            if (pane.type === 'note' && pane.documentID === event.id) controller.closePane(pane.id);
          savePatch({
            workspaces: getState().saved.workspaces.map((space) => {
              const removed = new Set(
                space.panes
                  .filter((pane) => pane.type === 'note' && pane.documentID === event.id)
                  .map((pane) => pane.id),
              );
              const panes = space.panes.filter((pane) => !removed.has(pane.id));
              return {
                ...space,
                panes,
                roots: space.roots.filter((id) => !removed.has(id)),
                activePane:
                  space.activePane && removed.has(space.activePane)
                    ? panes[0]?.id
                    : space.activePane,
                taskAreas: space.taskAreas?.map((area) => ({
                  ...area,
                  members: area.members.filter(
                    (member) =>
                      member.reference.kind !== 'note' || member.reference.documentID !== event.id,
                  ),
                })),
              };
            }),
          });
        }
      } else if (event.type === 'flush')
        void flushState()
          .then(
            () => window.viewer.flushed(event.token, { ok: true }),
            (error) => {
              report(error);
              return window.viewer.flushed(event.token, failedFlush(error));
            },
          )
          .catch(report);
      else if (event.type === 'agent-command') {
        const finish = (error?: string) => {
          void window.viewer.agentCommandResult(event.id, error?.slice(0, 2000)).catch(report);
        };
        const deadline = performance.now() + 3000;
        const execute = () => {
          const refusal = agentDispatchRefusal(event, getState().settings.settings.customActions);
          if (refusal) {
            finish(refusal);
            return;
          }
          if (dialogOpen()) {
            if (performance.now() < deadline) requestAnimationFrame(execute);
            else {
              report('Close the open dialog and request the action again.');
              finish('Another dialog prevented the action.');
            }
            return;
          }
          const { target } = event;
          const origin = resolveAgentOrigin(target, activeWorkspace(), controller);
          if (!origin) {
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
          const command = commandAtAgentOrigin(
            registry,
            event.command,
            target,
            origin,
            windowContext(),
          );
          void (command ? registry.run(command, false) : Promise.resolve(false))
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
  }, [controller, registry, switchTo, handleLaunch, windowContext]);
  useEffect(() => {
    if (ready && !initialOpenHandled.current) {
      initialOpenHandled.current = true;
      for (const path of bootstrap.openPaths) void controller.openPath(path).catch(report);
      for (const request of bootstrap.launches ?? []) void handleLaunch(request).catch(report);
    }
  }, [ready, bootstrap.openPaths, bootstrap.launches, controller, handleLaunch]);
  // the theme's colours as the page's variables
  useThemeVariables(useTheme(settings, look));
  useEffect(() => {
    document.documentElement.dataset.look = look;
    document.documentElement.style.colorScheme = look;
  }, [look]);
  useEffect(() => {
    document.documentElement.dataset.scrollbars = settings.browsing.scrollbars;
  }, [settings.browsing.scrollbars]);
  // A see-through space: the window lets what is behind it through (backdrop.ts); the
  // page draws the space at the chosen opacity, the planes opaque over it.
  const backdrop = windowUI.space.backdrop;
  const backdropOpacity = windowUI.space.backdropOpacity;
  useEffect(() => {
    document.documentElement.dataset.backdrop = backdrop;
    document.documentElement.style.setProperty('--space-opacity', `${backdropOpacity}%`);
  }, [backdrop, backdropOpacity]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      // Quick Preview's own keys are its own (`QuickPreview`), answered after the focus has had them.
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
        !overlayOpen()
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
      if (event.key === 'Escape' && tool && !overlayOpen()) {
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
      // inside a text editor, its file's commands still work: ⌘S, ⇧⌘S, ⌘T
      const textCommands = (event.target as Element).closest?.('.text-editor')
        ? ['save-file', 'save-file-as', 'new-scratch-plane']
        : [];
      if (editable(event.target) && !['palette', 'settings', ...textCommands].includes(id || ''))
        return;
      if (id && explorerCommandIDs.has(id)) {
        if (!overlayOpen()) routeFileKeyboard(getState().activePane, event);
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
  }, [tool, registry, spatialTool, windowContext]);

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
      <DuplicateControls />
      <CollectionControls />
      <WorkflowControls />
      <RelationshipControls />
      <div
        className="app-shell"
        data-look={look}
        data-density={density}
        data-titlebar={titlebar.state}
      >
        <AgentReview />
        <ExecutionPanel />
        <WhichKey label={commandLabel} />
        <PlaneHints />
        {titlebar.state !== 'shown' && (
          <div className="titlebar-reveal" aria-hidden onPointerEnter={titlebar.reveal} />
        )}
        <header
          className="app-titlebar"
          onPointerEnter={titlebar.state === 'shown' ? undefined : titlebar.reveal}
          onPointerLeave={titlebar.state === 'shown' ? undefined : titlebar.conceal}
        >
          <div className="traffic-space" />
          <IconButton
            icon="sidebar"
            label={windowUI.sidebar.visible ? 'Hide window navigation' : 'Show window navigation'}
            aria-pressed={windowUI.sidebar.visible}
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
          {recordingMacro && (
            <button
              className="macro-recording"
              title="Stop recording and name the macro"
              onClick={() => void invoke('record-macro').catch(report)}
            >
              <span aria-hidden className="macro-dot" />
              Recording macro · {recordingMacro.length}
            </button>
          )}
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
        <ProjectFileNotice />
        <div className="app-main">
          <Sidebar />
          <main className="workspace-main">
            <ErrorBoundary>
              <WorkspaceSurface
                engine={engine}
                surface={surface}
                onOverviewChange={setOverview}
                onReady={() => {
                  setReady(true);
                  if (pendingPresentation.current === activeWorkspace().id) {
                    pendingPresentation.current = undefined;
                    controller.present();
                  }
                }}
              />
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
          <CommandPalette
            key={paletteQuery.opening}
            mode={palette}
            onMode={setPalette}
            onClose={() => setPalette(null)}
            initialQuery={paletteQuery.text}
            line={{ host: lineHost, run: runFromPalette }}
          />
        )}
        {notice && (
          <div
            className={`notice ${noticeKind === 'info' ? 'is-info' : ''}`}
            role={noticeKind === 'info' ? 'status' : 'alert'}
          >
            <Icon name={noticeKind === 'info' ? 'info' : 'warning'} />
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
        <WindowDialogs
          dialog={windowDialog}
          onClose={(request) =>
            setWindowDialog((current) => (current === request ? undefined : current))
          }
          workspace={controller}
          transitionWorkspace={transitionWorkspace}
        />
      </div>
    </WorkspaceContext.Provider>
  );
}
