import { lazy, Suspense, useState } from 'react';
import type { CapturedTarget, CustomAction } from '../../domain/automation/actions';
import { CommitDialog } from '../git/CommitDialog';
import { WorktreesDialog } from '../git/worktrees/WorktreesDialog';
import { ActionParameters } from '../commands/ActionParameters';
import { SessionsDialog } from '../chat/SessionsDialog';
import { ServersDialog } from '../local-servers/ServersDialog';
import { RunCommandDialog } from '../terminals/RunCommandDialog';
import { NotesDialog } from '../notes/NotesDialog';
import { ImageToolsDialog } from '../media/ImageToolsDialog';
import { OptimizeDialog } from '../media/OptimizeDialog';
import { PDFToolsDialog } from '../pdf-tools/PDFToolsDialog';
import type { FileEntry } from '../../domain/contracts';
import type { ImageExportPreset, PDFExportPreset } from '../../domain/operations/export-presets';
import type { WorkspaceController } from '../workspace/context';
import { Dialog, NameDialog } from '../ui/primitives';
import { WorkspaceBackgroundDialog } from '../ui/workspace/WorkspaceBackgroundDialog';
import { ViewsDialog } from '../ui/workspace/ViewsDialog';
import { captureCurrentLayout, saveLayoutTemplate } from '../commands/window-commands/templates';
import { captureProfile, saveProfile } from '../commands/window-commands/profiles';
import { commandName } from '../command-line/names';
import { userCommands } from '../command-line/run';
import {
  activeWorkspace,
  announce,
  deleteWorkspace,
  getState,
  newWorkspace,
  receiveSettings,
  renameShortcut,
  renameWorkspace,
  report,
  saveCollection,
  useViewer,
} from '../state/store';

const LazyTasksDialog = lazy(() =>
  import('../tasks/TasksDialog').then((module) => ({ default: module.TasksDialog })),
);
export type WindowDialog =
  | { type: 'tasks'; target?: CapturedTarget }
  | { type: 'notes' }
  | { type: 'agent-sessions'; directory?: string }
  | { type: 'run-command'; target: CapturedTarget }
  | { type: 'servers' }
  | { type: 'browser'; paneID?: string }
  | { type: 'image-tools'; files: FileEntry[]; paneID?: string; preset?: ImageExportPreset }
  | { type: 'optimize'; files: FileEntry[]; paneID?: string; preset?: PDFExportPreset }
  | { type: 'pdf-tools'; files: FileEntry[]; paneID?: string }
  | { type: 'workspace'; kind: 'new' | 'rename' | 'delete' | 'background'; id: string }
  | { type: 'view'; kind: 'save' | 'manage' }
  | { type: 'profile' | 'template' | 'go-to' | 'connect' | 'tag' }
  | { type: 'macro'; commands: string[] }
  | { type: 'git-commit'; id: string; target: CapturedTarget }
  | { type: 'git-worktrees'; id: string; target: CapturedTarget }
  | { type: 'branch-task'; id: string; target: CapturedTarget }
  | { type: 'shortcut'; path: string; name: string };

/** Window-level dialogs have one owner; opening another replaces the previous request. */
export function WindowDialogs({
  dialog,
  onClose: closeRequest,
  workspace: controller,
  transitionWorkspace,
}: {
  dialog: WindowDialog | undefined;
  onClose(request: WindowDialog | undefined): void;
  workspace: WorkspaceController;
  transitionWorkspace(change: () => Promise<void>): Promise<void>;
}) {
  const onClose = () => closeRequest(dialog);
  const saved = useViewer((state) => state.saved);
  const bootstrap = useViewer((state) => state.bootstrap);
  const [busy, setBusy] = useState(false);
  const workspaceDialog = dialog?.type === 'workspace' ? dialog : undefined;
  const targetWorkspace = saved.workspaces.find((item) => item.id === workspaceDialog?.id);
  const viewDialog = dialog?.type === 'view' ? dialog.kind : undefined;
  const profileDialog = dialog?.type === 'profile';
  const templateDialog = dialog?.type === 'template';
  const macroDraft = dialog?.type === 'macro' ? dialog.commands : undefined;
  const shortcutDialog = dialog?.type === 'shortcut' ? dialog : undefined;
  const goTo = dialog?.type === 'go-to';
  const connecting = dialog?.type === 'connect';
  const tagging = dialog?.type === 'tag';
  return (
    <>
      <ActionParameters />
      {dialog?.type === 'agent-sessions' && (
        <SessionsDialog directory={dialog.directory} onClose={onClose} />
      )}
      {dialog?.type === 'notes' && <NotesDialog workspace={controller} onClose={onClose} />}
      {dialog?.type === 'tasks' && (
        <Suspense fallback={null}>
          <LazyTasksDialog workspace={controller} target={dialog.target} onClose={onClose} />
        </Suspense>
      )}
      {dialog?.type === 'run-command' && (
        <RunCommandDialog target={dialog.target} onClose={onClose} />
      )}
      {dialog?.type === 'servers' && <ServersDialog workspace={controller} onClose={onClose} />}
      {dialog?.type === 'optimize' && (
        <OptimizeDialog
          key={JSON.stringify([dialog.files.map((file) => file.path), dialog.preset])}
          initial={dialog.preset}
          files={dialog.files}
          paneID={dialog.paneID}
          onClose={onClose}
        />
      )}
      {dialog?.type === 'pdf-tools' && (
        <PDFToolsDialog files={dialog.files} paneID={dialog.paneID} onClose={onClose} />
      )}
      {dialog?.type === 'image-tools' && (
        <ImageToolsDialog
          key={JSON.stringify([dialog.files.map((file) => file.path), dialog.preset])}
          initial={dialog.preset}
          files={dialog.files}
          paneID={dialog.paneID}
          onClose={onClose}
        />
      )}
      {dialog?.type === 'browser' && (
        <NameDialog
          title="Open web page"
          label="Web address"
          maxLength={8192}
          action="Open"
          onClose={onClose}
          onSubmit={(address) => {
            controller.openBrowser(address, dialog.paneID);
            onClose();
          }}
        />
      )}
      {(dialog?.type === 'git-worktrees' || dialog?.type === 'branch-task') && (
        <WorktreesDialog
          key={dialog.id}
          target={dialog.target}
          taskMode={dialog.type === 'branch-task'}
          workspace={controller}
          onClose={onClose}
        />
      )}
      {dialog?.type === 'git-commit' && (
        <CommitDialog
          key={dialog.id}
          directory={dialog.target.directory}
          onClose={onClose}
          onSubmit={(message) =>
            controller.newGitAction(dialog.target, { kind: 'commit', message })
          }
        />
      )}
      {workspaceDialog?.kind === 'background' && (
        <WorkspaceBackgroundDialog onClose={() => onClose()} />
      )}
      {workspaceDialog &&
        workspaceDialog.kind !== 'delete' &&
        workspaceDialog.kind !== 'background' && (
          <NameDialog
            title={workspaceDialog.kind === 'new' ? 'New workspace' : 'Rename workspace'}
            maxLength={100}
            initial={workspaceDialog.kind === 'rename' ? targetWorkspace?.name : ''}
            action={workspaceDialog.kind === 'new' ? 'Create' : 'Rename'}
            onClose={() => onClose()}
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
            if (!busy) onClose();
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
            <button disabled={busy} onClick={() => onClose()}>
              Cancel
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void transitionWorkspace(() => deleteWorkspace(targetWorkspace.id))
                  .then(() => onClose())
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
          onClose={() => onClose()}
          onSubmit={(name) => {
            name = name.trim();
            if (!name) throw new Error('Enter a name for the view.');
            controller.saveBookmark(name);
            onClose();
          }}
        />
      )}
      {profileDialog && (
        <NameDialog
          title="Save profile as"
          label="Profile name"
          maxLength={100}
          action="Save"
          onClose={() => onClose()}
          onSubmit={async (name) => {
            name = name.trim();
            if (!name) throw new Error('Enter a name for the profile.');
            await saveProfile(captureProfile(name));
            onClose();
          }}
        />
      )}
      {templateDialog && (
        <NameDialog
          title="Save layout as template"
          label="Layout name"
          maxLength={100}
          action="Save"
          onClose={() => onClose()}
          onSubmit={async (name) => {
            name = name.trim();
            if (!name) throw new Error('Enter a name for the layout.');
            await saveLayoutTemplate(captureCurrentLayout(name));
            onClose();
          }}
        />
      )}
      {viewDialog === 'manage' && <ViewsDialog workspace={controller} onClose={() => onClose()} />}
      {macroDraft && (
        <NameDialog
          title="Save macro"
          label="Macro name"
          initial="Macro"
          maxLength={100}
          action="Save"
          onClose={() => onClose()}
          onSubmit={async (name) => {
            name = name.trim();
            if (!name) throw new Error('Enter a name for the macro.');
            const actions = getState().settings.settings.customActions;
            const slug = name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '');
            const command = commandName(name);
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
              // its name as a command too, `:OpenDocs`, when no other has it (2026-10-23)
              executor: {
                kind: 'sequence',
                commands: macroDraft,
                ...(command && !userCommands().has(command) ? { command } : {}),
              },
            };
            receiveSettings(
              await window.viewer.settingsPatch(
                [{ path: 'settings.customActions', value: [...actions, action] }],
                getState().settings.revision,
              ),
            );
            onClose();
            const kept = action.executor.kind === 'sequence' && action.executor.command;
            announce(kept ? `Saved “${name}”; run it with :${kept}.` : `Saved “${name}”.`);
          }}
        />
      )}
      {shortcutDialog && (
        <NameDialog
          title="Rename shortcut"
          initial={shortcutDialog.name}
          maxLength={200}
          action="Rename"
          onClose={() => onClose()}
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
          onClose={() => onClose()}
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
          onClose={() => onClose()}
          onSubmit={(address) => window.viewer.connectServer(address.trim())}
        />
      )}
      {tagging && (
        <NameDialog
          title="Find files with tag"
          label="Tag"
          action="Find"
          onClose={() => onClose()}
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
    </>
  );
}
