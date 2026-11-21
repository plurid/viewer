import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ArchiveListing, Resource } from '../../../domain/contracts';
import { formatBytes } from '../../../domain/files/entries';
import type { PreviewContext } from '../contracts';
import { PreviewHost } from '../PreviewHost';
import { PreviewToolbar } from '../controls';
import { headerItem } from '../../workspace/header-overflow';
import { IconButton, Loading } from '../../ui/primitives';
import { PreviewFailure } from '../PreviewFailure';
import { plural } from '../../../domain/plural';
import { Icon } from '../../ui/Icon';
import { FileName } from '../../ui/FileName';
import { errorMessage } from '../../../domain/errors';

/** An archive entry's own name, `Button.tsx` for `src/components/Button.tsx/`. */
function entryBase(name: string): string {
  const trimmed = name.replace(/\/+$/, '');
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || name;
}
/** The folders inside the archive that hold it, `src/components`, or nothing at its root. */
function entryFolder(name: string): string {
  const trimmed = name.replace(/\/+$/, '');
  return trimmed.includes('/') ? trimmed.slice(0, trimmed.lastIndexOf('/')) : '';
}
export default function ArchivePreview(context: PreviewContext) {
  const { resource, services, signal, active } = context;
  const [listing, setListing] = useState<ArchiveListing | null>(null);
  const [error, setError] = useState('');
  const [entryError, setEntryError] = useState('');
  const [query, setQuery] = useState('');
  const [child, setChild] = useState<Resource | null>(null);
  const [opening, setOpening] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = useRef<Resource | null>(null);
  // where the list was when an entry opened, so Back returns there, not to the top
  const listScroll = useRef(0);
  useEffect(() => {
    void services
      .archive(resource.id)
      .then((value) => {
        if (!signal.aborted) setListing(value);
      })
      .catch((error) => {
        if (!signal.aborted) setError(error.message);
      });
    return () => {
      if (selected.current) void services.release(selected.current.id);
    };
  }, [resource.id, services, signal]);
  const entries =
    listing?.entries.filter((entry) =>
      entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    ) ?? [];
  useLayoutEffect(() => {
    if (!child && ref.current && listScroll.current) ref.current.scrollTop = listScroll.current;
  }, [child]);
  const virtual = useVirtualizer({
    count: entries.length,
    getScrollElement: () => ref.current,
    estimateSize: () => 36,
    overscan: 10,
  });
  if (error)
    return (
      <PreviewFailure
        context={context}
        icon="archive"
        title="Can't read this archive"
        detail={error}
      />
    );
  if (!listing) return <Loading label="Reading archive index…" />;
  if (child)
    return (
      <div className="archive-child">
        <PreviewToolbar context={context}>
          <IconButton
            icon="left"
            label="Back to archive"
            onClick={() => {
              setChild(null);
              void services.release(child.id);
              selected.current = null;
            }}
          />
          <span {...headerItem('archive-child', 9, 'detail')}>{child.entry.name}</span>
        </PreviewToolbar>
        {/* the archive's own footer is the plane's; the entry adds no second one */}
        <PreviewHost resource={child} active={active} renderFooter={() => null} />
      </div>
    );
  return (
    <div className="archive-viewer">
      <PreviewToolbar context={context}>
        <span className="muted" {...headerItem('archive-count', 9, 'detail')}>
          {plural(listing.entries.length, 'entry', 'entries')}
        </span>
        <span className="toolbar-spacer" />
        <input
          aria-label="Filter archive entries"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter archive"
        />
      </PreviewToolbar>
      {listing.truncated && <p className="inline-warning">Showing the first 20,000 entries.</p>}
      {/* over the list, so the rows stay under the pointer while an entry opens */}
      {opening && (
        <div className="archive-opening">
          <Loading label="Opening entry…" />
        </div>
      )}
      {entryError && (
        <p className="inline-warning" role="alert">
          {entryError}
        </p>
      )}
      <div className="archive-scroll" ref={ref}>
        <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
          {virtual.getVirtualItems().map((item) => {
            const entry = entries[item.index];
            if (!entry) return null;
            return (
              <button
                className="archive-row"
                key={item.key}
                disabled={!entry.previewable || opening}
                style={{ position: 'absolute', top: item.start, height: item.size, width: '100%' }}
                onClick={async () => {
                  setOpening(true);
                  setEntryError('');
                  try {
                    const value = await services.archiveEntry(resource.id, entry.name);
                    if (signal.aborted) {
                      await services.release(value.id);
                      return;
                    }
                    selected.current = value;
                    listScroll.current = ref.current?.scrollTop ?? 0;
                    setChild(value);
                  } catch (error) {
                    if (!signal.aborted) setEntryError(errorMessage(error));
                  } finally {
                    if (!signal.aborted) setOpening(false);
                  }
                }}
                title={
                  entry.previewable
                    ? entry.name
                    : `${entry.name}: ${entry.directory ? "a folder doesn't open here" : "encrypted, or a kind Viewer can't show"}`
                }
              >
                <Icon name={entry.directory ? 'folder' : 'file'} />
                {/* its own name first, losing its middle; the folder inside the archive after it */}
                <span className="archive-entry-name">
                  <FileName name={entryBase(entry.name)} />
                  {entryFolder(entry.name) && (
                    <small className="muted">{entryFolder(entry.name)}</small>
                  )}
                </span>
                <span className="muted tabular">
                  {entry.directory ? 'Folder' : formatBytes(entry.size)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
