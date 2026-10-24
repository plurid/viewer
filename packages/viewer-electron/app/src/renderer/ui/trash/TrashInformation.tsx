import type { TrashItem } from '../../../domain/files/trash';
import { formatBytes } from '../../../domain/files/entries';
import { Dialog } from '../primitives';
import { originUnavailable, trashDate } from './items';

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
    <Dialog title={item.name} className="trash-info-dialog" onClose={onClose}>
      <dl>
        <dt>Kind</dt>
        <dd>
          {item.directory
            ? 'Folder'
            : item.symbolicLink
              ? 'Symbolic link'
              : item.previewable === false
                ? 'Other'
                : 'File'}
        </dd>
        <dt>Size</dt>
        <dd>{item.directory ? 'Not calculated' : formatBytes(item.size)}</dd>
        <dt>Modified</dt>
        <dd>{trashDate(item.modified)}</dd>
        <dt>{item.deleted ? 'Deleted' : 'Added to Trash'}</dt>
        <dd>
          {item.deleted ? (
            trashDate(item.deleted)
          ) : item.addedToTrash ? (
            <>
              {trashDate(item.addedToTrash)}
              <span className="trash-info-note muted">
                macOS date added to this Trash folder; not a recorded deletion time.
              </span>
            </>
          ) : (
            'Unavailable — no date was provided for this item.'
          )}
        </dd>
        <dt>Original location</dt>
        <dd className="trash-original-path">{item.originalPath || originUnavailable}</dd>
        <dt>Trash location</dt>
        <dd>{item.location}</dd>
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
            Open original folder in plane
          </button>
        )}
        <button
          disabled={!window.viewerNative}
          onClick={() => {
            onClose();
            restore(item);
          }}
        >
          {item.originalPath ? 'Restore' : 'Restore to…'}
        </button>
        <button onClick={onClose}>Done</button>
      </footer>
    </Dialog>
  );
}
