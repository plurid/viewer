import { useRef } from 'react';
import type { ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { PreviewContext } from '../contracts';
import type { TorrentFacts } from '../../../domain/previews/data/torrent';
import { formatBytes } from '../../../domain/files/entries';
import { Empty, Loading } from '../../ui/primitives';
import { PreviewToolbar } from '../controls';
import { usePreviewScroll } from '../scroll';
import { dateText, useInspected } from '../useInspected';
import './inspection.css';

const rowHeight = 28;
const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;
const versions: Readonly<Record<TorrentFacts['version'], string>> = {
  v1: 'BitTorrent v1',
  v2: 'BitTorrent v2',
  hybrid: 'BitTorrent v1 and v2',
};

function Facts({ facts }: { facts: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="inspection-facts">
      {facts.map(
        ([label, value]) =>
          value !== undefined &&
          value !== '' && (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ),
      )}
    </dl>
  );
}

function Files({ torrent, context }: { torrent: TorrentFacts; context: PreviewContext }) {
  const scroll = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: torrent.files.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });
  usePreviewScroll(context.state, scroll, 'torrent');
  return (
    <div className="torrent-files" ref={scroll} role="list" aria-label="Files" tabIndex={0}>
      <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
        {virtual.getVirtualItems().map((item) => {
          const file = torrent.files[item.index]!;
          return (
            <div
              key={item.key}
              role="listitem"
              className="torrent-file"
              style={{
                position: 'absolute',
                top: item.start,
                left: 0,
                right: 0,
                height: rowHeight,
              }}
            >
              <span title={file.path}>{file.path}</span>
              <span className="tabular">{formatBytes(file.size)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A torrent's metainfo: its name, size, pieces, files, trackers and info-hash. Trackers and web
 * seeds are only listed: Viewer contacts none of them.
 */
export default function TorrentPreview(context: PreviewContext) {
  const inspection = useInspected(context, 'torrent');
  if (inspection.status === 'loading') return <Loading label="Reading torrent…" />;
  if (inspection.status === 'failed')
    return (
      <Empty icon="warning" title="The torrent could not be read" detail={inspection.message} />
    );
  const torrent = inspection.file;
  const addresses = (items: readonly string[]) =>
    items.length ? (
      <ul>
        {items.map((item) => (
          <li key={item} className="inspection-mono">
            {item}
          </li>
        ))}
      </ul>
    ) : undefined;
  return (
    <div className="inspection-viewer">
      <PreviewToolbar context={context}>
        <span className="toolbar-spacer" />
        <span className="muted tabular">
          {plural(torrent.fileCount, 'file', 'files')} · {formatBytes(torrent.size)}
        </span>
      </PreviewToolbar>
      <div className="inspection-scroll torrent-summary">
        <article className="inspection-card" aria-label="Torrent">
          <header>
            <h3>{torrent.name || 'Untitled torrent'}</h3>
            {torrent.private && <span className="inspection-badge">Private</span>}
          </header>
          <Facts
            facts={[
              [
                'Total size',
                `${formatBytes(torrent.size)} (${torrent.size.toLocaleString()} bytes)`,
              ],
              [
                'Piece size',
                torrent.pieceSize
                  ? `${formatBytes(torrent.pieceSize)}${torrent.pieces ? `, ${plural(torrent.pieces, 'piece', 'pieces')}` : ''}`
                  : undefined,
              ],
              ['Files', torrent.fileCount.toLocaleString()],
              ['Format', versions[torrent.version]],
              ['Created', dateText(torrent.created)],
              ['Created by', torrent.createdBy],
              ['Comment', torrent.comment],
              [
                'Info-hash',
                torrent.infoHash && <span className="inspection-mono">{torrent.infoHash}</span>,
              ],
              [
                'Info-hash (v2)',
                torrent.infoHashV2 && <span className="inspection-mono">{torrent.infoHashV2}</span>,
              ],
              ['Trackers', addresses(torrent.trackers)],
              ['Web seeds', addresses(torrent.seeds)],
            ]}
          />
          <p className="inspection-note">Viewer does not contact the trackers or web seeds.</p>
        </article>
        {torrent.fileCount > torrent.files.length && (
          <p className="inspection-note">
            Showing the first {torrent.files.length.toLocaleString()} files.
          </p>
        )}
      </div>
      <Files torrent={torrent} context={context} />
    </div>
  );
}
