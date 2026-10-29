import { journalSummary, type JournalRecord } from '../../domain/journal/events';
import type { Workspace } from '../../domain/contracts';
import { IconButton } from '../ui/primitives';
import { journalPlaneName } from './JournalEvents';

export function EventDetails({
  record,
  spaces,
  onClose,
  onTrace,
  onSource,
  onCopy,
}: {
  record: JournalRecord;
  spaces: Workspace[];
  onClose(): void;
  onTrace(): void;
  onSource(): void;
  onCopy(): void;
}) {
  const space = spaces.find((space) => space.id === record.origin.workspaceID);
  const sourceAvailable =
    !!space &&
    (!record.origin.planeID || space.panes.some((pane) => pane.id === record.origin.planeID));
  return (
    <aside className="journal-details" aria-label="Event details">
      <header>
        <strong>{journalSummary(record)}</strong>
        <IconButton icon="close" label="Close event details" onClick={onClose} />
      </header>
      <dl>
        <dt>Time</dt>
        <dd>{new Date(record.at).toLocaleString()}</dd>
        <dt>Source</dt>
        <dd>{record.source} · Desktop service</dd>
        <dt>Outcome</dt>
        <dd>{record.phase}</dd>
        {record.durationMs !== undefined && (
          <>
            <dt>Duration</dt>
            <dd>{record.durationMs.toFixed(1)} ms</dd>
          </>
        )}
        {record.count !== undefined && (
          <>
            <dt>Items completed</dt>
            <dd>{record.count}</dd>
          </>
        )}
        {record.exitCode !== undefined && (
          <>
            <dt>Exit code</dt>
            <dd>{record.exitCode}</dd>
          </>
        )}
        <dt>Workspace</dt>
        <dd>{space?.name ?? record.origin.workspaceID ?? 'App'}</dd>
        <dt>Plane</dt>
        <dd>{journalPlaneName(space, record.origin.planeID) || 'None'}</dd>
        <dt>Event ID</dt>
        <dd className="journal-id">{record.id}</dd>
        <dt>Trace ID</dt>
        <dd className="journal-id">{record.traceID}</dd>
        {record.taskID && (
          <>
            <dt>Task ID</dt>
            <dd className="journal-id">{record.taskID}</dd>
          </>
        )}
        <dt>Session</dt>
        <dd className="journal-id">{record.sessionID}</dd>
      </dl>
      <div className="journal-detail-actions">
        <button type="button" onClick={onTrace}>
          Show trace
        </button>
        <button type="button" onClick={onSource} disabled={!sourceAvailable}>
          {record.origin.planeID ? 'Go to plane' : 'Go to workspace'}
        </button>
        <button type="button" onClick={onCopy}>
          Copy event ID
        </button>
      </div>
      {!sourceAvailable && (
        <p className="journal-note">The source is no longer open. Its event is kept.</p>
      )}
    </aside>
  );
}
