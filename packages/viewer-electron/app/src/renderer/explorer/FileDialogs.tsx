import { useEffect, useMemo, useRef, useState } from 'react';
import type { CommandContext } from '../commands/registry';
import type { FolderActions } from '../commands/folder';
import { DestinationDialog } from '../commands/DestinationDialog';
import { FileInformation } from './FileInformation';
import { Dialog, NameDialog } from '../ui/primitives';
import { getState, report, settledJob } from '../state/store';
import { useWorkspace } from '../workspace/context';
import { OpenWithDialog } from '../ui/OpenWithDialog';
import { RenameActions } from '../actions/RenameActions';
import { sourceVersion } from '../../domain/inspection';
import { formatBytes } from '../../domain/files';
import { calculateSize, cancelFolderSize, useFolderSize } from './sizes';
const moveToTrash = async (context: CommandContext) => {
  await window.viewer.operate({
    kind: 'trash',
    sources: context.selection.map((file) => file.path),
    expectedSources: context.selection.map((file) => ({
      path: file.path,
      version: sourceVersion(file),
    })),
  });
};

/** What a Trash confirmation covers: selected folders are measured in the background
 * (read-only, cancellable) so their full contents are visible before confirming. */
export function TrashContents({ context }: { context: CommandContext }) {
  const folders = context.selection.filter((file) => file.directory).length;
  const paths = useMemo(
    () => [...new Set(context.selection.map((file) => file.path))].sort(),
    [context],
  );
  const size = useFolderSize(paths);
  const initial = useRef(size);
  useEffect(() => {
    if (!folders) return;
    const owned = !initial.current || initial.current.stale;
    if (owned) void calculateSize(context.selection).catch(() => {});
    return () => {
      if (owned) void cancelFolderSize(paths).catch(() => {});
    };
  }, [context, folders, paths]);
  if (!folders) return null;
  const task = size?.task;
  const counts = task
    ? `${task.files.toLocaleString()} ${task.files === 1 ? 'file' : 'files'} in ${(task.folders || folders).toLocaleString()} ${(task.folders || folders) === 1 ? 'folder' : 'folders'}, ${formatBytes(task.bytes)}`
    : '';
  return (
    <p className="dialog-copy muted" role="status">
      {task?.status === 'running'
        ? `Counting folder contents… ${counts}`
        : task?.status === 'completed'
          ? `Including folder contents: ${counts}${task.skipped ? ` (${task.skipped.toLocaleString()} unreadable)` : ''}.`
          : `Selected folders are moved with everything inside them.`}
    </p>
  );
}
/** New Folder with Selection: two ordinary jobs, each with its own Undo. The move
 * targets the folder actually created and only the items as they were chosen. */
export async function groupSelection(context: CommandContext, name: string): Promise<void> {
  const created = await settledJob(
    await window.viewer.operate({
      kind: 'mkdir',
      name,
      sources: [],
      destination: context.directory,
    }),
  );
  const folder = created.status === 'completed' ? created.completed[0]?.destination : undefined;
  if (!folder) throw new Error(created.errors[0]?.message || 'The folder was not created.');
  await window.viewer.operate({
    kind: 'move',
    sources: context.selection.map((file) => file.path),
    destination: folder,
    expectedSources: context.selection.map((file) => ({
      path: file.path,
      version: sourceVersion(file),
    })),
  });
}
function TrashConfirmation({ context, onClose }: { context: CommandContext; onClose(): void }) {
  const submitted = useRef(false);
  const confirm = () => {
    if (submitted.current) return;
    submitted.current = true;
    void moveToTrash(context).catch(report);
    onClose();
  };
  return (
    <Dialog
      title="Move to Trash?"
      onClose={onClose}
      className="trash-dialog"
      onKeyDown={(event) => {
        if (
          event.key !== 'Enter' ||
          event.repeat ||
          event.nativeEvent.isComposing ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          event.shiftKey
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        confirm();
      }}
    >
      <p className="dialog-copy">
        Move{' '}
        {context.selection.length === 1
          ? `“${context.selection[0]?.name}”`
          : `${context.selection.length} items`}{' '}
        to the system Trash?
      </p>
      <TrashContents context={context} />
      <footer>
        <button
          className="dialog-keyboard-action"
          aria-label="Cancel"
          aria-keyshortcuts="Escape"
          onClick={onClose}
        >
          <kbd aria-hidden="true">Esc</kbd> Cancel
        </button>
        <button
          className="danger dialog-keyboard-action"
          aria-label="Move to Trash"
          aria-keyshortcuts="Enter"
          data-autofocus
          onClick={confirm}
        >
          <kbd aria-hidden="true">Enter</kbd> Move to Trash
        </button>
      </footer>
    </Dialog>
  );
}
/** Physical folders and virtual results share the same file-operation dialogs. */
export function useFileDialogs(): {
  actions: Pick<FolderActions, 'dialog' | 'destination' | 'info' | 'trash' | 'openWith'>;
  content: React.ReactNode;
} {
  const workspace = useWorkspace();
  const [name, setName] = useState<{
    kind: 'rename' | 'mkdir' | 'mkfile' | 'group' | 'go-to';
    context: CommandContext;
  }>();
  const [destination, setDestination] = useState<{
    kind: 'copy' | 'move';
    context: CommandContext;
  }>();
  const [info, setInfo] = useState<CommandContext>();
  const [applications, setApplications] = useState<CommandContext>();
  const applicationPaths = useMemo(
    () => applications?.selection.map((file) => file.path) || [],
    [applications],
  );
  const [trash, setTrash] = useState<CommandContext>();
  return {
    actions: {
      dialog: (kind, context) => setName({ kind, context }),
      destination: (kind, context) => setDestination({ kind, context }),
      info: setInfo,
      openWith: setApplications,
      trash: (context) => {
        if (getState().settings.settings.browsing.confirmTrash) setTrash(context);
        else return moveToTrash(context);
      },
    },
    content: (
      <>
        {applications && (
          <OpenWithDialog paths={applicationPaths} onClose={() => setApplications(undefined)} />
        )}
        {name && (
          <NameDialog
            title={
              name.kind === 'rename'
                ? 'Rename file'
                : name.kind === 'mkdir'
                  ? 'New folder'
                  : name.kind === 'mkfile'
                    ? 'New file'
                    : name.kind === 'group'
                      ? `New folder with ${name.context.selection.length} ${name.context.selection.length === 1 ? 'item' : 'items'}`
                      : 'Go to folder'
            }
            label={name.kind === 'go-to' ? 'Folder path' : 'Name'}
            initial={
              name.kind === 'rename'
                ? name.context.selection[0]?.name
                : name.kind === 'go-to'
                  ? name.context.directory
                  : name.kind === 'group'
                    ? 'New Folder With Items'
                    : name.kind === 'mkfile'
                      ? 'untitled.txt'
                      : ''
            }
            maxLength={name.kind === 'go-to' ? 32768 : 255}
            action={name.kind === 'rename' ? 'Rename' : name.kind === 'go-to' ? 'Go' : 'Create'}
            secondaryAction={
              name.kind === 'rename'
                ? (busy) => (
                    <RenameActions
                      context={name.context}
                      disabled={busy}
                      onChoose={() => setName(undefined)}
                    />
                  )
                : undefined
            }
            onClose={() => setName(undefined)}
            onSubmit={async (value) => {
              if (name.kind === 'go-to') {
                const resolved =
                  value === '~' || value.startsWith('~/')
                    ? getState().bootstrap.home + value.slice(1)
                    : value;
                const entry = await window.viewer.stat(resolved);
                if (!entry.directory) throw new Error('Choose a folder path.');
                await workspace.openPath(entry.path, {
                  paneID: name.context.paneID,
                  workspaceID: name.context.workspaceID,
                });
              } else if (name.kind === 'group') await groupSelection(name.context, value);
              else
                await window.viewer.operate({
                  kind: name.kind,
                  name: value,
                  sources:
                    name.kind === 'rename' ? name.context.selection.map((file) => file.path) : [],
                  destination: name.kind === 'rename' ? undefined : name.context.directory,
                });
            }}
          />
        )}
        {destination && (
          <DestinationDialog {...destination} onClose={() => setDestination(undefined)} />
        )}
        {info && (
          <FileInformation entries={[...info.selection]} onClose={() => setInfo(undefined)} />
        )}
        {trash && <TrashConfirmation context={trash} onClose={() => setTrash(undefined)} />}
      </>
    ),
  };
}
