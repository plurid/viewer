import type { TrashItem } from '../../../domain/files/trash';
import { formatBytes, kindLabel } from '../../../domain/files/entries';
import { Dialog, PathField } from '../primitives';
import { asFile, originUnavailable, trashDate } from './items';

/** Get Info for a Trash item, with its recorded dates and original location. */
export function TrashInformation({
  item,
  busy,
  onClose,
  openOriginal,
  restore,
}: {
  item: TrashItem;
  busy: boolean;
  onClose(): void;
  openOriginal(item: TrashItem): void;
  restore(item: TrashItem): void;
}) {
  return (
    <Dialog
      title={`“${item.name}” Info`}
      className="trash-info-dialog"
      onClose={onClose}
      closeOnBackdrop
    >
      <dl>
        <dt>Kind</dt>
        <dd>{kindLabel(asFile(item))}</dd>
        <dt>Size</dt>
        <dd>{item.directory ? '--' : formatBytes(item.size)}</dd>
        <dt>Modified</dt>
        <dd>{trashDate(item.modified)}</dd>
        <dt>{item.deleted ? 'Deleted' : 'Added to Trash'}</dt>
        <dd>
          {item.deleted
            ? trashDate(item.deleted)
            : item.addedToTrash
              ? // the heading says what this date is: when it arrived, not when it was deleted
                trashDate(item.addedToTrash)
              : 'Unknown'}
        </dd>
        <dt>Original location</dt>
        <dd>
          {item.originalPath ? (
            <PathField className="trash-original-path" path={item.originalPath} />
          ) : (
            originUnavailable
          )}
        </dd>
        <dt>Trash location</dt>
        <dd>
          <PathField path={item.location} />
        </dd>
      </dl>
      <footer>
        {item.originalPath && (
          <button
            disabled={busy}
            onClick={() => {
              onClose();
              openOriginal(item);
            }}
          >
            Show Original Folder
          </button>
        )}
        <button
          disabled={!window.viewerNative}
          onClick={() => {
            onClose();
            restore(item);
          }}
        >
          {item.originalPath ? 'Put Back' : 'Put Back To…'}
        </button>
        <button onClick={onClose}>Done</button>
      </footer>
    </Dialog>
  );
}
