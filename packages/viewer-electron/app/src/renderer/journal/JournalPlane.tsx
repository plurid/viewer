/*
 * THESIS: Inspect an action's lifecycle and return directly to its source plane.
 * OWN-WORLD: Viewer's shared theme, compact controls, tabular rows and plain detail inspector.
 * STORY: Filter activity, pause to inspect, follow one trace, then return to work.
 * First viewport: Two compact filter rows above events; selection opens adjacent details.
 * FORM: Operate-mode extension of existing file/server planes; no new visual identity.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review,
 * the verdict, DESIGN.md, and every shipping raster carrying its provenance.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { JournalPane as Pane } from '../../domain/contracts';
import {
  journalFilterSchema,
  journalSources,
  type JournalExportPreview,
  type JournalFilter,
  type JournalRecord,
} from '../../domain/journal/events';
import { errorMessage } from '../../domain/errors';
import {
  activeWorkspace,
  copyPaths,
  getState,
  switchWorkspace,
  updatePane,
  useViewer,
} from '../state/store';
import { useWorkspace } from '../workspace/context';
import { ChoiceButton, MenuButton } from '../ui/ChoiceMenu';
import { Empty, IconButton, NameDialog } from '../ui/primitives';
import { JournalSession } from './session';
import { JournalEvents, journalPlaneName } from './JournalEvents';
import { EventDetails } from './EventDetails';
import { ExportDialog } from './ExportDialog';
import { plural } from '../../domain/plural';
import './journal.css';

const presets: { value: string; label: string; filter: JournalFilter }[] = [
  { value: 'all', label: 'All activity', filter: {} },
  { value: 'errors', label: 'Errors', filter: { level: 'error' } },
  { value: 'waiting', label: 'Waiting for a decision', filter: { phase: 'waiting' } },
  { value: 'files', label: 'File operations', filter: { source: 'files' } },
  { value: 'git', label: 'Git', filter: { source: 'git' } },
  { value: 'chat', label: 'Chat requests', filter: { source: 'chat' } },
  { value: 'server', label: 'Local servers', filter: { source: 'server' } },
  { value: 'workspace', label: 'Workspace saves', filter: { source: 'workspace' } },
];

const dateInput = (value?: number) =>
  value === undefined
    ? ''
    : new Date(value - new Date(value).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export default function JournalPlane({ pane, active }: { pane: Pane; active: boolean }) {
  const workspace = useWorkspace();
  const spaces = useViewer((state) => state.saved.workspaces);
  const [session] = useState(() => new JournalSession(window.viewer, pane.filter));
  const snapshot = useSyncExternalStore(session.subscribe, session.snapshot);
  const [selected, setSelected] = useState<JournalRecord>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState(false);
  const [preview, setPreview] = useState<JournalExportPreview>();
  const [timeRange, setTimeRange] = useState(false);
  const filterKey = JSON.stringify(journalFilterSchema.parse(pane.filter));
  const { filter, page, following } = snapshot;
  const followLabel = following
    ? 'Following live'
    : snapshot.unseen
      ? `${snapshot.unseen > 999 ? '999+' : snapshot.unseen} new · Show Latest`
      : 'Paused · Resume';
  const scope = spaces.find((space) => space.id === filter.workspaceID);
  const saved = pane.savedFilters ?? [];

  useEffect(() => {
    if (active) return session.connect();
  }, [active, session]);
  useEffect(() => {
    if (filterKey !== JSON.stringify(session.snapshot().filter))
      session.setFilter(JSON.parse(filterKey));
  }, [filterKey, session]);

  const change = (next: JournalFilter) => {
    const valid = journalFilterSchema.safeParse(next);
    if (!valid.success) {
      setError('The end of the time range must follow its start. The previous results are kept.');
      return;
    }
    setError('');
    setSelected(undefined);
    session.setFilter(valid.data);
    updatePane(pane.id, { filter: valid.data });
  };

  const perform = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const goSource = () =>
    perform(async () => {
      if (!selected?.origin.workspaceID) return;
      const target = selected.origin;
      await switchWorkspace(target.workspaceID!);
      if (activeWorkspace().id !== target.workspaceID) return; // Its independent window was focused.
      if (target.planeID) {
        if (!activeWorkspace().panes.some((pane) => pane.id === target.planeID))
          throw new Error('The source plane has closed. Its event is kept.');
        workspace.focusPane(target.planeID, { activate: true });
      }
    });

  return (
    <section className="journal-plane" aria-label="Journal">
      <div className="journal-filterbar">
        <input
          type="search"
          aria-label="Search Journal"
          placeholder="Search events or IDs"
          maxLength={200}
          value={filter.search ?? ''}
          onChange={(event) => change({ ...filter, search: event.target.value || undefined })}
        />
        <ChoiceButton
          label="Event source"
          value={filter.source ?? 'all'}
          choices={[
            { value: 'all', label: 'All sources' },
            ...journalSources.map((value) => ({
              value,
              label:
                value === 'chat'
                  ? 'Chat'
                  : value === 'git'
                    ? 'Git'
                    : value[0]!.toUpperCase() + value.slice(1),
            })),
          ]}
          onChoose={(value) =>
            change({
              ...filter,
              source: value === 'all' ? undefined : (value as JournalFilter['source']),
            })
          }
        />
        <ChoiceButton
          label="Event severity"
          value={filter.level ?? 'all'}
          choices={[
            { value: 'all', label: 'All levels' },
            { value: 'info', label: 'Info' },
            { value: 'warning', label: 'Warning' },
            { value: 'error', label: 'Error' },
          ]}
          onChoose={(value) =>
            change({
              ...filter,
              level: value === 'all' ? undefined : (value as JournalFilter['level']),
            })
          }
        />
        <ChoiceButton
          label="Event time range"
          value={filter.since || filter.until ? 'range' : 'all'}
          choices={[
            { value: 'all', label: 'All time' },
            { value: '15', label: 'Last 15 minutes' },
            { value: '60', label: 'Last hour' },
            { value: '1440', label: 'Last 24 hours' },
            { value: 'range', label: 'Time range…' },
          ]}
          onChoose={(value) => {
            setTimeRange(value === 'range');
            if (value !== 'range')
              change({
                ...filter,
                until: undefined,
                since: value === 'all' ? undefined : Date.now() - Number(value) * 60_000,
              });
          }}
        />
        <IconButton
          icon="refresh"
          label="Refresh Journal"
          disabled={snapshot.loading || busy}
          onClick={() => {
            void session.refresh();
          }}
        />
      </div>
      <div className="journal-scopebar">
        <ChoiceButton
          label="Journal workspace"
          value={filter.workspaceID ?? 'all'}
          choices={[
            { value: 'all', label: 'All workspaces' },
            ...spaces.map((space) => ({ value: space.id, label: space.name })),
            ...(!scope && filter.workspaceID
              ? [{ value: filter.workspaceID, label: 'Closed workspace' }]
              : []),
          ]}
          onChoose={(value) =>
            change({
              ...filter,
              workspaceID: value === 'all' ? undefined : value,
              planeID: undefined,
            })
          }
        />
        <ChoiceButton
          label="Journal plane"
          value={filter.planeID ?? 'all'}
          disabled={!scope}
          choices={[
            { value: 'all', label: 'All planes' },
            ...(scope?.panes.map((pane) => ({
              value: pane.id,
              label: journalPlaneName(scope, pane.id),
            })) ?? []),
            ...(filter.planeID && !scope?.panes.some((pane) => pane.id === filter.planeID)
              ? [{ value: filter.planeID, label: 'Closed plane' }]
              : []),
          ]}
          onChoose={(value) => change({ ...filter, planeID: value === 'all' ? undefined : value })}
        />
        {/* an action menu: it applies a set of filters and keeps no value of its own */}
        <MenuButton
          label="Filters"
          className="journal-filters"
          items={[...presets, ...saved.map((item) => ({ value: item.id, label: item.name }))]}
          onChoose={(value) => {
            const item =
              presets.find((item) => item.value === value) ??
              saved.find((item) => item.id === value);
            if (item) change(item.filter);
          }}
        />
        <IconButton
          icon="plus"
          label="Save Journal filters"
          disabled={saved.length >= 20}
          onClick={() => setNaming(true)}
        />
        <IconButton
          icon="close"
          label="Clear Journal filters"
          disabled={!Object.values(filter).some(Boolean)}
          onClick={() => change({})}
        />
        <span className="journal-control-space" />
        <button
          type="button"
          aria-pressed={following}
          className="journal-follow"
          onClick={() => (following ? session.pause() : session.follow())}
        >
          {/* every label it can show shares one cell, so new events never change its width */}
          {[
            followLabel,
            ...['Following live', 'Paused · Resume', '999+ new · Show Latest'].filter(
              (label) => label !== followLabel,
            ),
          ].map((label, index) => (
            <span key={label} aria-hidden={index > 0 || undefined}>
              {label}
            </span>
          ))}
        </button>
        <button
          type="button"
          disabled={busy || !page?.matched}
          onClick={() => {
            void perform(async () => {
              setPreview(
                await window.viewer.journalExportPreview({ filter, through: page!.through }),
              );
            });
          }}
        >
          Export…
        </button>
      </div>
      {timeRange && (
        <div className="journal-time-range">
          <label>
            From{' '}
            <input
              type="datetime-local"
              aria-label="Journal from time"
              value={dateInput(filter.since)}
              onChange={(event) =>
                change({
                  ...filter,
                  since: event.target.value ? new Date(event.target.value).getTime() : undefined,
                })
              }
            />
          </label>
          <label>
            Until{' '}
            <input
              type="datetime-local"
              aria-label="Journal until time"
              value={dateInput(filter.until)}
              onChange={(event) =>
                change({
                  ...filter,
                  until: event.target.value ? new Date(event.target.value).getTime() : undefined,
                })
              }
            />
          </label>
          <IconButton
            icon="close"
            label="Hide time range controls"
            onClick={() => setTimeRange(false)}
          />
        </div>
      )}
      {filter.traceID && (
        <div className="journal-trace-filter">
          <span>
            Trace <code>{filter.traceID}</code>
          </span>
          <IconButton
            icon="close"
            label="Clear trace filter"
            onClick={() => change({ ...filter, traceID: undefined })}
          />
        </div>
      )}
      {(error || snapshot.error) && (
        <p className="journal-error" role="alert">
          {error || snapshot.error}
        </p>
      )}
      {page && (page.status.state !== 'ready' || page.status.dropped > 0) && (
        <p className="journal-notice" role="status">
          {page.status.state === 'full'
            ? 'Journal is full. Export its events, then move its history to the Trash to record again. '
            : page.status.state === 'unavailable'
              ? 'Journal can’t record right now. Its history is kept, and everything else works. '
              : page.status.state === 'clearing'
                ? 'Waiting for your choice about the history. '
                : ''}
          {page.status.dropped > 0
            ? `${plural(page.status.dropped, 'event')} ${page.status.dropped === 1 ? 'wasn’t' : 'weren’t'} recorded this session.`
            : ''}
        </p>
      )}
      <div className="journal-content">
        <div className="journal-event-area">
          {page?.records.length ? (
            <JournalEvents
              records={page.records}
              spaces={spaces}
              selected={selected?.id}
              onSelect={setSelected}
              onPause={() => session.pause()}
            />
          ) : (
            <Empty
              icon="clock"
              title={
                snapshot.loading && !page
                  ? 'Loading Journal…'
                  : Object.values(filter).some(Boolean)
                    ? 'No matching events'
                    : 'No activity recorded yet'
              }
              detail="File operations, Git, Chat, workspace saves and local server actions appear here."
            />
          )}
          {page?.nextBefore && (
            <button
              type="button"
              className="journal-older"
              disabled={snapshot.loading}
              onClick={() => {
                void session.older();
              }}
            >
              Load Older Events
            </button>
          )}
        </div>
        {selected && (
          <EventDetails
            record={selected}
            spaces={spaces}
            onClose={() => setSelected(undefined)}
            onTrace={() => change({ traceID: selected.traceID })}
            onSource={() => {
              void goSource();
            }}
            onCopy={() => {
              void perform(() => copyPaths([selected.id]));
            }}
          />
        )}
      </div>
      <footer className="journal-footer">
        <span aria-live="polite">
          {page
            ? `${page.records.length.toLocaleString()} of ${plural(page.matched, 'event')}`
            : 'Opening local history'}
        </span>
        <button
          type="button"
          disabled={busy || !page || page.status.state === 'clearing'}
          onClick={() => {
            void perform(async () => {
              if (await window.viewer.journalClear()) {
                setSelected(undefined);
                session.follow();
              }
            });
          }}
        >
          Move History to Trash…
        </button>
      </footer>
      {preview && <ExportDialog preview={preview} onClose={() => setPreview(undefined)} />}
      {naming && (
        <NameDialog
          title="Save Journal Filters"
          action="Save"
          maxLength={80}
          onClose={() => setNaming(false)}
          onSubmit={(name) => {
            if (
              !getState().saved.workspaces.some((space) =>
                space.panes.some((item) => item.id === pane.id),
              )
            )
              return;
            updatePane(pane.id, {
              savedFilters: [
                ...saved,
                { id: crypto.randomUUID(), name: name.trim(), filter: { ...filter } },
              ],
            });
          }}
        />
      )}
    </section>
  );
}
