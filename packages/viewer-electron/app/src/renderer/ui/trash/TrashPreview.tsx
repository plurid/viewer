import { useEffect, useState } from 'react';
import type { Resource } from '../../../domain/contracts';
import type { TrashItem } from '../../../domain/files/trash';
import { formatBytes } from '../../../domain/files/entries';
import { PreviewHost } from '../../previews/PreviewHost';
import { Dialog, Empty, IconButton, Loading } from '../primitives';

/** Quick Look for files in the Trash, read through the desktop's scoped Trash resource. */
export function TrashPreview({
  items,
  initial,
  onClose,
  restore,
}: {
  items: TrashItem[];
  initial: number;
  onClose(): void;
  restore(ids: string[], destination: 'original' | 'choose'): Promise<boolean>;
}) {
  const [index, setIndex] = useState(initial);
  const [resource, setResource] = useState<Resource>();
  const [error, setError] = useState('');
  const [restoreError, setRestoreError] = useState('');
  const [busy, setBusy] = useState(false);
  // Quick Look opens with at least one item, and stepping wraps within them.
  const item = items[Math.min(index, items.length - 1)]!;
  useEffect(() => {
    let closed = false,
      owned: Resource | undefined;
    setResource(undefined);
    setError('');
    setRestoreError('');
    void window.viewer
      .trashPreview(item.id)
      .then((value) => {
        if (closed) {
          void window.viewer.release(value.id);
          return;
        }
        owned = value;
        setResource(value);
      })
      .catch((error) => {
        if (!closed) setError((error as Error).message);
      });
    return () => {
      closed = true;
      if (owned) void window.viewer.release(owned.id);
    };
  }, [item.id]);
  const step = (delta: number) => setIndex((index + delta + items.length) % items.length);
  const footer = (size: number, label?: string) => (
    <>
      {restoreError && (
        <p className="error trash-message" role="alert">
          {restoreError}
        </p>
      )}
      <footer className="quick-preview-footer">
        <span className="quick-preview-metadata">
          {label && <>{label} · </>}
          {formatBytes(size)} · {item.location}
        </span>
        <div className="quick-preview-actions">
          {items.length > 1 && (
            <div className="quick-preview-navigation">
              <IconButton icon="left" label="Previous file" onClick={() => step(-1)} />
              <span>
                {index + 1} / {items.length}
              </span>
              <IconButton icon="right" label="Next file" onClick={() => step(1)} />
            </div>
          )}
          <button
            disabled={busy || !window.viewerNative}
            onClick={() => {
              setBusy(true);
              setRestoreError('');
              void restore([item.id], item.originalPath ? 'original' : 'choose')
                .then((restored) => {
                  if (restored) onClose();
                })
                .catch((error) => setRestoreError((error as Error).message))
                .finally(() => setBusy(false));
            }}
          >
            {item.originalPath ? 'Restore' : 'Restore to…'}
          </button>
        </div>
      </footer>
    </>
  );
  return (
    <Dialog
      title={item.name}
      className="quick-preview-dialog trash-preview-dialog"
      onClose={onClose}
      onKeyDown={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('input, textarea, select, button')
        )
          return;
        if (items.length > 1 && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          step(event.key === 'ArrowLeft' ? -1 : 1);
        }
      }}
    >
      <div className="quick-preview">
        {error ? (
          <Empty icon="warning" title="File unavailable" detail={error} />
        ) : resource ? (
          <PreviewHost
            resource={resource}
            renderFooter={(loaded, module) => footer(loaded.entry.size, module.label)}
          />
        ) : (
          <Loading label="Opening preview…" />
        )}
      </div>
      {(!resource || error) && footer(item.size)}
    </Dialog>
  );
}
