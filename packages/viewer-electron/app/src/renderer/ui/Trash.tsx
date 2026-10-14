import { useCallback, useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { TrashSnapshot } from '../../domain/trash';
import { trashName } from '../../domain/trash';
import { formatBytes } from '../../domain/files';
import { useViewer } from '../state/store';
import { Dialog, Empty, Loading } from './primitives';
import { Icon } from './Icon';

export function Trash({ onClose }: { onClose(): void }) {
  const platform = useViewer((state) => state.bootstrap.platform);
  const title = trashName(platform);
  const [snapshot, setSnapshot] = useState<TrashSnapshot>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const live = useRef(true),
    sequence = useRef(0),
    reading = useRef(false);
  const refresh = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    const token = ++sequence.current;
    try {
      const value = await window.viewer.trashList();
      if (live.current && token === sequence.current) {
        setSnapshot(value);
        setError('');
      }
    } catch (error) {
      if (live.current && token === sequence.current) {
        setError((error as Error).message);
        setSnapshot(undefined);
      }
    } finally {
      reading.current = false;
      if (live.current && token === sequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    live.current = true;
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 5000);
    const focus = () => {
      void refresh();
    };
    window.addEventListener('focus', focus);
    return () => {
      live.current = false;
      sequence.current++;
      clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [refresh]);
  const items = snapshot?.items ?? [];
  const hasOrigins = items.some((item) => !!item.originalPath);
  const rows = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 48,
    overscan: 8,
  });
  const unavailable =
    snapshot?.locations.filter((location) => location.state === 'unavailable') ?? [];
  async function action(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
      await refresh();
    } catch (error) {
      if (live.current) setError((error as Error).message);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  return (
    <Dialog title={title} onClose={onClose} className="trash-dialog">
      <div className="trash-body">
        {loading && <Loading label={`Loading ${title}…`} />}
        {error && (
          <p className="error trash-message" role="alert">
            {error}
          </p>
        )}
        {unavailable.length > 0 && (
          <div className="trash-access" aria-label="Unavailable Trash locations">
            {unavailable.map((location) => (
              <div key={location.id}>
                <div>
                  <strong>{location.name}</strong>
                  <p>{location.message}</p>
                </div>
                {location.canRequestAccess && (
                  <button
                    disabled={busy}
                    onClick={() => void action(() => window.viewer.trashAccess(location.id))}
                  >
                    {location.access === 'privacy'
                      ? 'Open Privacy Settings…'
                      : 'Allow folder access…'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {!loading && !error && items.length === 0 && (
          <Empty
            icon="trash"
            title={unavailable.length ? `${title} is unavailable` : `${title} is empty`}
          />
        )}
        {items.length > 0 && (
          <div
            className={`trash-inventory ${hasOrigins ? 'with-origins' : ''}`}
            role="table"
            aria-label={`${title} items`}
            aria-rowcount={items.length + 1}
          >
            <div className="trash-row trash-heading" role="row">
              <span role="columnheader">Name</span>
              {hasOrigins && <span role="columnheader">Original location</span>}
              <span role="columnheader">Trash location</span>
              <span role="columnheader">Size</span>
            </div>
            <div className="trash-scroll" ref={scroll}>
              <div style={{ height: rows.getTotalSize(), position: 'relative' }}>
                {rows.getVirtualItems().map((row) => {
                  const item = items[row.index];
                  return (
                    <div
                      role="row"
                      aria-rowindex={row.index + 2}
                      className="trash-row"
                      key={item.id}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        height: row.size,
                        transform: `translateY(${row.start}px)`,
                      }}
                    >
                      <span role="cell" className="trash-filename" title={item.name}>
                        <Icon name={item.directory ? 'folder' : 'file'} size={17} />
                        <span>{item.name}</span>
                      </span>
                      {hasOrigins && (
                        <span role="cell" className="muted" title={item.originalPath}>
                          {item.originalPath || '—'}
                        </span>
                      )}
                      <span role="cell">{item.location}</span>
                      <span role="cell">{item.directory ? '—' : formatBytes(item.size)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        {snapshot?.truncated && (
          <p className="trash-message" role="status">
            Showing the first {items.length.toLocaleString()} items. Emptying is unavailable while
            the list is incomplete.
          </p>
        )}
        {items.length > 0 && unavailable.length > 0 && (
          <p className="trash-message" role="status">
            Some Trash locations cannot be read. Emptying is unavailable.
          </p>
        )}
      </div>
      <footer className="trash-footer">
        <span className="muted" role="status">
          {snapshot
            ? `${items.length.toLocaleString()} ${items.length === 1 ? 'item' : 'items'}${unavailable.length ? ' visible' : ''}`
            : ''}
        </span>
        <button disabled={busy || loading} onClick={() => void refresh()}>
          Refresh
        </button>
        <button
          aria-haspopup="menu"
          disabled={busy || !snapshot?.canEmpty || !window.viewerNative}
          onClick={() => {
            if (snapshot) void action(() => window.viewer.trashMenu(snapshot.revision));
          }}
        >
          Trash actions <Icon name="down" size={12} />
        </button>
        <button onClick={onClose}>Done</button>
      </footer>
    </Dialog>
  );
}
