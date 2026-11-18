import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Resource } from '../../../domain/contracts';
import type { TrashItem } from '../../../domain/files/trash';
import { formatBytes } from '../../../domain/files/entries';
import { PreviewHost } from '../../previews/PreviewHost';
import { PreviewFacts } from '../../previews/PreviewFileInfo';
import { Dialog, Empty, IconButton, Loading } from '../primitives';
import { originalTrashFolder } from '../../../domain/files/trash';
import { homeText } from '../../../domain/files/path-label';
import { useHome } from '../PathLabel';
import { errorMessage } from '../../../domain/errors';

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
        if (!closed) setError(errorMessage(error));
      });
    return () => {
      closed = true;
      if (owned) void window.viewer.release(owned.id);
    };
  }, [item.id]);
  const home = useHome();
  const step = (delta: number) => setIndex((index + delta + items.length) % items.length);
  // where it came from, which Put Back returns it to; else which Trash holds it
  const origin = item.originalPath
    ? homeText(originalTrashFolder(item.originalPath), home)
    : item.location;
  const footer = (size: number, label?: string, details: readonly string[] = []) => (
    <>
      {restoreError && (
        <p className="error trash-message" role="alert">
          {restoreError}
        </p>
      )}
      <footer className="quick-preview-footer">
        {/* the dialog's title names the item; where it was comes last and gives way first */}
        <PreviewFacts kind={label ?? ''} size={formatBytes(size)} details={[...details, origin]} />
        <div className="quick-preview-actions">
          {items.length > 1 && (
            <div className="quick-preview-navigation">
              <IconButton icon="left" label="Previous file" onClick={() => step(-1)} />
              <span className="readout" style={{ '--readout-width': '7ch' } as CSSProperties}>
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
                .catch((error) => setRestoreError(errorMessage(error)))
                .finally(() => setBusy(false));
            }}
          >
            {item.originalPath ? 'Put Back' : 'Put Back To…'}
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
        // the buttons here take no arrows, so ← and → still step after a click on Next
        if (event.target instanceof Element && event.target.closest('input, textarea, select'))
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
          <Empty icon="warning" title="Can't show this file" detail={error} />
        ) : resource ? (
          <PreviewHost
            resource={resource}
            renderFooter={(loaded, module, _hex, details) =>
              footer(loaded.entry.size, module.label, details)
            }
          />
        ) : (
          <Loading label="Opening preview…" />
        )}
      </div>
      {(!resource || error) && footer(item.size)}
    </Dialog>
  );
}
