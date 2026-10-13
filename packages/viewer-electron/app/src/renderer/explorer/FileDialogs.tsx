import { useMemo, useRef, useState } from 'react';
import type { CommandContext } from '../commands/registry';
import type { FolderActions } from '../commands/folder';
import { DestinationDialog } from '../commands/DestinationDialog';
import { FileInformation } from './FileInformation';
import { Dialog, NameDialog } from '../ui/primitives';
import { getState, report } from '../state/store';
import { useWorkspace } from '../workspace/context';
import { OpenWithDialog } from '../ui/OpenWithDialog';
import { RenameActions } from '../actions/RenameActions';
const moveToTrash = async (context: CommandContext) => {
  await window.viewer.operate({
    kind: 'trash',
    sources: context.selection.map((file) => file.path),
  });
};

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
    kind: 'rename' | 'mkdir' | 'go-to';
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
                  : 'Go to folder'
            }
            label={name.kind === 'go-to' ? 'Folder path' : 'Name'}
            initial={
              name.kind === 'rename'
                ? name.context.selection[0]?.name
                : name.kind === 'go-to'
                  ? name.context.directory
                  : ''
            }
            maxLength={name.kind === 'go-to' ? 32768 : 255}
            action={name.kind === 'rename' ? 'Rename' : name.kind === 'mkdir' ? 'Create' : 'Go'}
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
              } else
                await window.viewer.operate({
                  kind: name.kind === 'rename' ? 'rename' : 'mkdir',
                  name: value,
                  sources: name.context.selection.map((file) => file.path),
                  destination: name.kind === 'mkdir' ? name.context.directory : undefined,
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
