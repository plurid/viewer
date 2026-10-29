import { useCallback, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Workspace } from '../../domain/contracts';
import { journalSummary, type JournalRecord } from '../../domain/journal/events';
import { baseName } from '../../domain/workspaces/planes';

export function journalPlaneName(space: Workspace | undefined, id: string | undefined): string {
  const pane = space?.panes.find((pane) => pane.id === id);
  if (!pane) return id ? 'Closed plane' : '';
  if (pane.type === 'journal') return 'Journal';
  if (pane.type === 'chat') return 'Chat';
  if (pane.type === 'scratch') return pane.title ?? 'Untitled';
  return baseName(pane.path);
}

export function JournalEvents({
  records,
  spaces,
  selected,
  onSelect,
  onPause,
}: {
  records: JournalRecord[];
  spaces: Workspace[];
  selected?: string;
  onSelect(record: JournalRecord): void;
  onPause(): void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const getKey = useCallback((index: number) => records[index]!.id, [records]);
  const virtual = useVirtualizer({
    count: records.length,
    getItemKey: getKey,
    getScrollElement: () => viewport.current,
    estimateSize: () => 36,
    overscan: 8,
    initialRect: { width: 1000, height: 360 },
  });
  return (
    <div
      className="journal-viewport"
      ref={viewport}
      role="grid"
      aria-label="Journal events"
      aria-rowcount={records.length + 1}
      aria-colcount={7}
      tabIndex={0}
      aria-activedescendant={selected ? `journal-event-${selected}` : undefined}
      onScroll={(event) => {
        if (event.currentTarget.scrollTop > 8) onPause();
      }}
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !records.length) return;
        event.preventDefault();
        const current = records.findIndex((record) => record.id === selected);
        const index =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? records.length - 1
              : Math.max(
                  0,
                  Math.min(records.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)),
                );
        onPause();
        onSelect(records[index]!);
        virtual.scrollToIndex(index, { align: 'auto' });
      }}
    >
      <div className="journal-columns journal-table-heading" role="row" aria-rowindex={1}>
        {['Time', 'Level', 'Source', 'Event', 'Duration', 'Workspace', 'Plane'].map((label) => (
          <span key={label} role="columnheader">
            {label}
          </span>
        ))}
      </div>
      <div className="journal-rows" role="rowgroup" style={{ height: virtual.getTotalSize() }}>
        {virtual.getVirtualItems().map((row) => {
          const record = records[row.index]!;
          const space = spaces.find((space) => space.id === record.origin.workspaceID);
          return (
            <div
              className="journal-columns journal-event"
              role="row"
              id={`journal-event-${record.id}`}
              key={record.id}
              aria-rowindex={row.index + 2}
              aria-selected={selected === record.id}
              data-level={record.level}
              style={{ height: row.size, transform: `translateY(${row.start}px)` }}
              onClick={() => {
                onPause();
                onSelect(record);
                viewport.current?.focus();
              }}
            >
              <time
                role="gridcell"
                dateTime={new Date(record.at).toISOString()}
                title={new Date(record.at).toLocaleString()}
              >
                {new Date(record.at).toLocaleTimeString([], { hour12: false })}
              </time>
              <span role="gridcell" className="journal-level">
                {record.level}
              </span>
              <span role="gridcell" className="journal-source">
                {record.source}
              </span>
              <span role="gridcell" title={journalSummary(record)}>
                {journalSummary(record)}
              </span>
              <span role="gridcell">
                {record.durationMs === undefined
                  ? ''
                  : `${Math.round(record.durationMs).toLocaleString()} ms`}
              </span>
              <span role="gridcell" title={record.origin.workspaceID}>
                {space?.name ?? (record.origin.workspaceID ? 'Closed workspace' : '')}
              </span>
              <span role="gridcell" title={record.origin.planeID}>
                {journalPlaneName(space, record.origin.planeID)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
