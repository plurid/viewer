import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ArchiveListing, Resource } from '../../../domain/contracts';
import { formatBytes } from '../../../domain/files';
import type { PreviewContext } from '../contracts';
import { PreviewHost } from '../PreviewHost';
import { Empty, IconButton, Loading } from '../../ui/primitives';
import { Icon } from '../../ui/Icon';

export default function ArchivePreview({ resource, services, signal, active }: PreviewContext) {
  const [listing, setListing] = useState<ArchiveListing | null>(null);
  const [error, setError] = useState('');
  const [entryError, setEntryError] = useState('');
  const [query, setQuery] = useState('');
  const [child, setChild] = useState<Resource | null>(null);
  const [opening, setOpening] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = useRef<Resource | null>(null);
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
  const virtual = useVirtualizer({
    count: entries.length,
    getScrollElement: () => ref.current,
    estimateSize: () => 36,
    overscan: 10,
  });
  if (error) return <Empty icon="archive" title="Archive could not be read" detail={error} />;
  if (!listing) return <Loading label="Reading archive index…" />;
  if (child)
    return (
      <div className="archive-child">
        <div className="preview-toolbar">
          <IconButton
            icon="left"
            label="Back to archive"
            onClick={() => {
              setChild(null);
              void services.release(child.id);
              selected.current = null;
            }}
          />
          <span>{child.entry.name}</span>
        </div>
        <PreviewHost resource={child} active={active} />
      </div>
    );
  return (
    <div className="archive-viewer">
      <div className="preview-toolbar">
        <span className="muted">{listing.entries.length.toLocaleString()} entries</span>
        <span className="toolbar-spacer" />
        <input
          aria-label="Filter archive entries"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter archive"
        />
      </div>
      {listing.truncated && (
        <p className="inline-warning">The archive index is limited to 20,000 entries.</p>
      )}
      {opening && <Loading label="Opening entry…" />}
      {entryError && (
        <p className="inline-warning" role="alert">
          {entryError}
        </p>
      )}
      <div className="archive-scroll" ref={ref}>
        <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
          {virtual.getVirtualItems().map((item) => {
            const entry = entries[item.index];
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
                    setChild(value);
                  } catch (error) {
                    if (!signal.aborted) setEntryError((error as Error).message);
                  } finally {
                    if (!signal.aborted) setOpening(false);
                  }
                }}
                title={
                  entry.previewable ? 'Preview entry' : 'Folder, encrypted, or unsupported entry'
                }
              >
                <Icon name={entry.directory ? 'folder' : 'file'} />
                <span>{entry.name}</span>
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
