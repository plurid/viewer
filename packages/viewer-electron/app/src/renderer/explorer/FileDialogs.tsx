import { effectiveWindowSettings } from '../state/effective-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CommandContext } from '../commands/registry';
import type { FolderActions } from '../commands/folder';
import { DestinationDialog } from '../commands/DestinationDialog';
import { FileInformation } from './FileInformation';
import { NetworkSharingDialog } from './NetworkSharing';
import { networkSharingEnabled } from './network-sharing-state';
import { Dialog, NameDialog } from '../ui/primitives';
import { GoToFolderDialog } from './GoToFolderDialog';
import { getState, report, settledJob } from '../state/store';
import { useWorkspace } from '../workspace/context';
import { OpenWithDialog } from '../ui/navigation/OpenWithDialog';
import { RenameActions } from '../actions/RenameActions';
import { sourceVersion } from '../../domain/files/inspection';
import { formatBytes } from '../../domain/files/entries';
import { plural } from '../../domain/plural';
import { untitledFileName } from '../../domain/editing/languages';
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
  const task = size?.task;
  if (!folders || (task?.status !== 'running' && task?.status !== 'completed')) return null;
  const counts = `${plural(task.files, 'file')} in ${plural(task.folders || folders, 'folder')}, ${formatBytes(task.bytes)}`;
  return (
    <p className="dialog-copy muted" role="status">
      {task.status === 'running'
        ? `Counting folder contents… ${counts}`
        : `Including folder contents: ${counts}${task.skipped ? ` (${plural(task.skipped, 'item')} not readable)` : ''}.`}
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
  if (!folder) throw new Error(created.errors[0]?.message || "Viewer couldn't create the folder.");
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
      className="trash-confirmation"
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
      <div className="trash-confirmation-copy">
        <p className="dialog-copy">
          {context.selection.length === 1
            ? `“${context.selection[0]?.name}” will be moved to the Trash.`
            : `${plural(context.selection.length, 'item')} will be moved to the Trash.`}
        </p>
        <TrashContents context={context} />
      </div>
      {/* macOS dialogs show no keycaps: Esc cancels and Return confirms, as anywhere */}
      <footer>
        <button className="dialog-keyboard-action" aria-keyshortcuts="Escape" onClick={onClose}>
          Cancel
        </button>
        <button
          className="danger dialog-keyboard-action"
          aria-keyshortcuts="Enter"
          data-autofocus
          onClick={confirm}
        >
          Move to Trash
        </button>
      </footer>
    </Dialog>
  );
}
/** Physical folders and virtual results share the same file-operation dialogs. */
export function useFileDialogs(): {
  actions: Pick<
    FolderActions,
    'dialog' | 'destination' | 'info' | 'trash' | 'openWith' | 'networkSharing'
  >;
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
  const [sharing, setSharing] = useState<string>();
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
      networkSharing: async (context) => {
        const file = context.selection[0];
        if (!file?.directory || context.selection.length !== 1) return;
        if (networkSharingEnabled()) setSharing(file.path);
      },
      openWith: setApplications,
      trash: (context) => {
        if (effectiveWindowSettings(getState()).browsing.confirmTrash) setTrash(context);
        else return moveToTrash(context);
      },
    },
    content: (
      <>
        {sharing && <NetworkSharingDialog path={sharing} onClose={() => setSharing(undefined)} />}
        {applications && (
          <OpenWithDialog paths={applicationPaths} onClose={() => setApplications(undefined)} />
        )}
        {name?.kind === 'go-to' && (
          <GoToFolderDialog
            initial={name.context.directory || getState().bootstrap.home}
            onClose={() => setName(undefined)}
            onOpen={(path) =>
              workspace.openPath(path, {
                paneID: name.context.paneID,
                workspaceID: name.context.workspaceID,
              })
            }
          />
        )}
        {name && name.kind !== 'go-to' && (
          <NameDialog
            title={
              name.kind === 'rename'
                ? `Rename “${name.context.selection[0]?.name ?? ''}”`
                : name.kind === 'mkdir'
                  ? 'New Folder'
                  : name.kind === 'mkfile'
                    ? 'New File'
                    : name.kind === 'group'
                      ? `New Folder with ${plural(name.context.selection.length, 'Item')}`
                      : 'Go to Folder'
            }
            label="Name"
            initial={
              name.kind === 'rename'
                ? name.context.selection[0]?.name
                : name.kind === 'group'
                  ? // Finder's own name for a folder made from a selection
                    'New Folder With Items'
                  : name.kind === 'mkfile'
                    ? untitledFileName(
                        effectiveWindowSettings(getState()).browsing.newFileExtension,
                      )
                    : // Finder's: a name to keep or type over, so Create is ready at once
                      'untitled folder'
            }
            maxLength={255}
            action={name.kind === 'rename' ? 'Rename' : 'Create'}
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
              if (name.kind === 'group') await groupSelection(name.context, value);
              else if (name.kind !== 'go-to')
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
