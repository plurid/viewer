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
import type { FolderPane } from '../domain/contracts';
import { agentDispatchRefusal } from '../domain/agent-safety';
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
  receiveJob,
  receiveSettings,
  receiveFileChanges,
  receiveProgress,
  rememberCommand,
  renameShortcut,
  renameWorkspace,
  report,
  saveCollection,
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
import { Dialog, ErrorBoundary, IconButton, NameDialog } from './ui/primitives';
import { ProjectControls, ProjectFileNotice } from './workspace/projects';
import { InspectionControls } from './ui/Inspection';
import { CheckpointControls } from './ui/Checkpoints';
import { OperationReviewControls } from './ui/OperationReview';
import { ComparisonControls } from './ui/Comparison';
import { DuplicateControls } from './ui/Duplicates';
import { CollectionControls } from './ui/Collections';
import { WorkflowControls } from './ui/Workflows';
import { RelationshipControls } from './ui/Relationships';
import { ActionHub } from './actions/ActionHub';
import { OperationsPanel } from './operations/OperationsPanel';
import { QuickPreview, quickPreviewEdit } from './previews/QuickPreview';
import { useTitlebar } from './ui/titlebar';
import { useTheme, useThemeVariables } from './ui/theme';
import { useKeySequences } from './keys/sequences';
import { recordCommand, useMacroRecording } from './keys/macro';
import type { CustomAction } from '../domain/automation';
import { WhichKey } from './keys/WhichKey';
import { PlaneHints } from './keys/PlaneHints';
import { WorkspaceBackgroundDialog } from './ui/WorkspaceBackgroundDialog';
import { ViewsDialog } from './ui/ViewsDialog';
import { captureCurrentLayout, saveLayoutTemplate } from './commands/window-commands/templates';
import { captureProfile, saveProfile } from './commands/window-commands/profiles';
import { openTerminalFind } from './terminals/find';
import { CommandsContext, useCommands, useCommandSource } from './commands/context';
import { CommandRegistry, type CommandContext } from './commands/registry';
import { windowCommands } from './commands/window';
import { CommandPalette, type PaletteMode } from './commands/CommandPalette';
import { editable, textEditFor } from './commands/editing';
import { routeToEditor, subscribeEditingPlanes } from './editing/planes';
import { recoverBuffers } from './editing/unsaved';
import { Sidebar } from './ui/Sidebar';

import { ContextMenu } from './ui/ContextMenu';
import { OpenWithDialog } from './ui/OpenWithDialog';
import { Volumes } from './ui/Volumes';
import { Trash } from './ui/Trash';
import { openWorkspacePath } from './workspace/open-path';
import { invalidateFolderSizes, receiveFolderSize } from './explorer/sizes';
import { commandShortcutID } from '../domain/shortcuts';
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
  readyRef.current = ready;
  // once, at launch: unsaved text no plane holds comes back as planes (2026-10-23)
  const recovered = useRef(false);
  useEffect(() => {
    if (!ready || recovered.current) return;
    recovered.current = true;
    void recoverBuffers().catch(report);
  }, [ready]);
  const [workspaceDialog, setWorkspaceDialog] = useState<{
    kind: 'new' | 'rename' | 'delete' | 'background';
    id: string;
  } | null>(null);
  const [shortcutDialog, setShortcutDialog] = useState<{ path: string; name: string } | null>(null);
  const [macroDraft, setMacroDraft] = useState<string[] | null>(null);
  const [viewDialog, setViewDialog] = useState<'save' | 'manage' | null>(null);
  const [templateDialog, setTemplateDialog] = useState(false);
  const [profileDialog, setProfileDialog] = useState(false);
  const recordingMacro = useMacroRecording();
  const [workspaceMenu, setWorkspaceMenu] = useState<{ x: number; y: number } | null>(null);

  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const [goTo, setGoTo] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [tagging, setTagging] = useState(false);
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
  // ⌥⌘T hides the title bar; it comes back at the window's top edge (ui/titlebar.ts)
  const titlebarOverride = useViewer(
    (state) => activeWorkspace(state).overrides?.['ui.titlebar.visible'],
  );
  const titlebar = useTitlebar(
    typeof titlebarOverride === 'boolean' ? titlebarOverride : saved.ui.titlebar.visible,
  );
  const activePane = useViewer((state) => state.activePane);
  const space = useViewer(activeWorkspace);
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
  const density = useViewer((state) => state.settings.settings.browsing.density);
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
      setReady(false);
      spatialTool(null);
      try {
        await change();
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
      await transitionWorkspace(() => switchWorkspace(id));
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
      directory: pane?.type === 'folder' ? pane.path : undefined,
      folder: pane?.type === 'folder' ? (pane as FolderPane) : undefined,
      selection: selectedFiles(state.activePane),
      jobs: state.jobs,
      clipboard: state.clipboard,
    };
  }, [controller]);
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
        ),
        ...windowCommands({
          workspace: controller,
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
          connectServer: () => setConnecting(true),
          findTagged: () => setTagging(true),
          openWith: setOpenWithPaths,
          saveMacro: setMacroDraft,
          viewDialog: setViewDialog,
          templateDialog: () => setTemplateDialog(true),
          profileDialog: () => setProfileDialog(true),
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
    [saved, ready, tool, jobsSignature, terminalName],
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
  }, [registry, controller, activePane, windowContext]);
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
        saved.workspaces.flatMap((space) =>
          space.panes.filter((pane) => pane.type === 'terminal').map((pane) => pane.id),
        ),
      ),
    );
  }, [saved.workspaces]);
  const invoke = async (id: string) => {
    // Edit menu Undo, Redo and Select All reach a CodeMirror editor, which `webContents` does not
    if (routeToEditor(id, getState().activePane)) return;
    // ⌘E in Quick Preview edits the text file it shows, as its plane
    if (id === 'edit-file' && quickPreviewEdit()) return;
    // ⌘F in a terminal searches its output, rather than opening the file palette
    if (id === 'find-file') {
      const terminal = document.activeElement?.closest<HTMLElement>('.terminal-plane');
      if (terminal?.dataset.terminalId && openTerminalFind(terminal.dataset.terminalId)) return;
    }
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
    if (overlayOpen() && !['palette', 'settings'].includes(id)) return;
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
  // the prefix and leader keys' sequences (keys/sequences.ts): before App's own key handler
  useKeySequences(invoke);
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
              remember: false,
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
  }, [controller, registry, switchTo]);
  useEffect(() => {
    if (ready && !initialOpenHandled.current) {
      initialOpenHandled.current = true;
      for (const path of bootstrap.openPaths) void controller.openPath(path).catch(report);
    }
  }, [ready, bootstrap.openPaths, controller]);
  // the theme's colours as the page's variables (2026-10-23)
  useThemeVariables(
    useTheme(
      useViewer((state) => state.settings.settings),
      saved.look,
    ),
  );
  useEffect(() => {
    document.documentElement.dataset.look = saved.look;
    document.documentElement.style.colorScheme = saved.look;
  }, [saved.look]);
  // A see-through space (2026-10-23): the window lets what is behind it through (backdrop.ts); the
  // page draws the space at the chosen opacity, the planes opaque over it.
  const backdrop = saved.ui.space.backdrop;
  const backdropOpacity = saved.ui.space.backdropOpacity;
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
      <DuplicateControls />
      <CollectionControls />
      <WorkflowControls />
      <RelationshipControls />
      <div
        className="app-shell"
        data-look={saved.look}
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
        {workspaceDialog?.kind === 'background' && (
          <WorkspaceBackgroundDialog onClose={() => setWorkspaceDialog(null)} />
        )}
        {workspaceDialog &&
          workspaceDialog.kind !== 'delete' &&
          workspaceDialog.kind !== 'background' && (
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
        {viewDialog === 'save' && (
          <NameDialog
            title="Save view"
            label="View name"
            maxLength={100}
            action="Save"
            onClose={() => setViewDialog(null)}
            onSubmit={(name) => {
              name = name.trim();
              if (!name) throw new Error('Enter a name for the view.');
              controller.saveBookmark(name);
              setViewDialog(null);
            }}
          />
        )}
        {profileDialog && (
          <NameDialog
            title="Save profile as"
            label="Profile name"
            maxLength={100}
            action="Save"
            onClose={() => setProfileDialog(false)}
            onSubmit={async (name) => {
              name = name.trim();
              if (!name) throw new Error('Enter a name for the profile.');
              await saveProfile(captureProfile(name));
              setProfileDialog(false);
            }}
          />
        )}
        {templateDialog && (
          <NameDialog
            title="Save layout as template"
            label="Layout name"
            maxLength={100}
            action="Save"
            onClose={() => setTemplateDialog(false)}
            onSubmit={async (name) => {
              name = name.trim();
              if (!name) throw new Error('Enter a name for the layout.');
              await saveLayoutTemplate(captureCurrentLayout(name));
              setTemplateDialog(false);
            }}
          />
        )}
        {viewDialog === 'manage' && (
          <ViewsDialog workspace={controller} onClose={() => setViewDialog(null)} />
        )}
        {macroDraft && (
          <NameDialog
            title="Save macro"
            label="Macro name"
            initial="Macro"
            maxLength={100}
            action="Save"
            onClose={() => setMacroDraft(null)}
            onSubmit={async (name) => {
              name = name.trim();
              if (!name) throw new Error('Enter a name for the macro.');
              const actions = getState().settings.settings.customActions;
              const slug = name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '');
              // a command sequence: it can be given a shortcut or a prefix key in Settings
              const action: CustomAction = {
                id: `macro-${slug || 'macro'}-${Date.now().toString(36)}`,
                name,
                aliases: ['macro'],
                icon: 'command',
                shortcut: '',
                order: actions.length,
                pinned: false,
                when: { target: 'any', extensions: [], min: 0, max: 10000 },
                executor: { kind: 'sequence', commands: macroDraft },
              };
              receiveSettings(
                await window.viewer.settingsPatch(
                  [{ path: 'settings.customActions', value: [...actions, action] }],
                  getState().settings.revision,
                ),
              );
              setMacroDraft(null);
            }}
          />
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
        {connecting && (
          <NameDialog
            title="Connect to server"
            label="Server address"
            maxLength={2048}
            initial="smb://"
            action="Connect"
            onClose={() => setConnecting(false)}
            onSubmit={(address) => window.viewer.connectServer(address.trim())}
          />
        )}
        {tagging && (
          <NameDialog
            title="Find files with tag"
            label="Tag"
            action="Find"
            onClose={() => setTagging(false)}
            onSubmit={async (name) => {
              const tag = name.trim();
              const roots = getState().settings.settings.search.roots;
              const sources = roots.length ? roots : [getState().bootstrap.home];
              // Spotlight is asked first, so an unusable tag or build reports here.
              await window.viewer.taggedFiles(tag, sources);
              const id = crypto.randomUUID();
              saveCollection({ id, name: tag, kind: 'tag', tag, sources });
              controller.openCollection(id);
            }}
          />
        )}
      </div>
    </WorkspaceContext.Provider>
  );
}
