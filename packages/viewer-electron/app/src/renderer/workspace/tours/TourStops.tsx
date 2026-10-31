import { useState, useSyncExternalStore } from 'react';
import { describeAnchor, fileName, tourFileName } from '../../../domain/tours/tour';
import { activeWorkspace, report, useViewer } from '../../state/store';
import { DictationButton } from '../../speech/DictationButton';
import { countText } from '../../../domain/layout/nesting/format';
import { Panel } from '../../ui/Panel';
import { Button, IconButton, Row } from '../../ui/primitives';
import { useWorkspace } from '../context';
import { playTour } from '../tour';
import {
  changeDraft,
  closeDraft,
  draftFile,
  draftFolder,
  draftTour,
  moveStop,
  recordStop,
  removeStop,
  saveDraft,
  subscribeDraft,
  tourDraft,
  updateStop,
  type DraftStop,
} from './recorder';
import './tours.css';

function place(stop: DraftStop): string {
  const target = stop.target;
  if (target.kind === 'view') return `Saved view “${target.bookmark}”`;
  return target.anchor
    ? `${fileName(target.file)} · ${describeAnchor(target.anchor)}`
    : fileName(target.file);
}
/**
 * The stops of a tour being recorded or edited: each caption written or dictated, the order
 * changed, a stop removed; the active file plane added as the next stop; then played or saved.
 */
export function TourStops() {
  const draft = useSyncExternalStore(subscribeDraft, tourDraft);
  const workspace = useWorkspace();
  const [busy, setBusy] = useState(false);
  // the file plane "Add" would record, named on the button
  const activeFile = useViewer((state) => {
    const pane = activeWorkspace(state).panes.find((item) => item.id === state.activePane);
    return pane?.type === 'preview' ? pane.path : undefined;
  });
  if (!draft) return null;
  const folder = draftFolder(draft),
    file = draftFile(draft);
  const run = (work: () => Promise<unknown>) => {
    setBusy(true);
    void work()
      .catch(report)
      .finally(() => setBusy(false));
  };
  const destination = draft.file
    ? `Saves to ${fileName(draft.file)}`
    : file && folder
      ? `Saves ${fileName(file)} in “${fileName(folder)}”, beside its files`
      : 'Add file planes as stops; the tour saves in the folder that holds them.';
  return (
    <Panel
      className="tour-stops"
      label="Tour stops"
      title="Tour stops"
      status={countText(draft.stops.length, 'stop')}
      onClose={closeDraft}
      closeLabel="Close tour stops"
      footer={
        <>
          <Button
            variant="secondary"
            disabled={busy || !activeFile || draft.stops.length >= 200}
            title={activeFile ? activeFile : 'Click a file’s plane to add it as a stop.'}
            onClick={() => run(() => recordStop(workspace))}
          >
            {activeFile ? `Add “${fileName(activeFile)}”` : 'Add a file plane'}
          </Button>
          <span className="tour-stops-destination muted">{destination}</span>
          <Button
            variant="secondary"
            disabled={busy || !draft.stops.length}
            onClick={() =>
              run(async () => {
                playTour(workspace, draftTour(draft));
              })
            }
          >
            Play
          </Button>
          <Button
            variant="primary"
            disabled={busy || !draft.stops.length || !file}
            onClick={() => run(saveDraft)}
          >
            {draft.file ? `Save ${tourFileName(draft.file)}` : 'Save tour'}
          </Button>
        </>
      }
    >
      <Row
        compact
        label="Name"
        control={
          <input
            aria-label="Tour name"
            placeholder={folder ? fileName(folder) : 'Tour name'}
            value={draft.name}
            disabled={!!draft.file}
            title={draft.file ? 'A saved tour keeps its file name.' : undefined}
            maxLength={100}
            onChange={(event) =>
              changeDraft((current) => ({ ...current, name: event.target.value }))
            }
          />
        }
      />
      {draft.stops.length ? (
        <ol className="tour-stop-list">
          {draft.stops.map((stop, index) => (
            <li key={stop.id} className="tour-stop">
              <span className="tour-stop-number tabular">{index + 1}</span>
              <div className="tour-stop-body">
                <input
                  aria-label={`Caption for stop ${index + 1}`}
                  value={stop.caption}
                  maxLength={500}
                  onChange={(event) => updateStop(stop.id, { caption: event.target.value })}
                />
                <span className="muted" title={stop.target.kind === 'file' ? stop.target.file : ''}>
                  {place(stop)}
                </span>
              </div>
              <div className="tour-stop-actions">
                <DictationButton
                  target={JSON.stringify([file, stop.id])}
                  destination={`Caption for stop ${index + 1}: ${place(stop)}`}
                  maxLength={500}
                  onUse={(text) => updateStop(stop.id, { caption: text.trim() || stop.caption })}
                />
                <IconButton
                  icon="up"
                  label={`Move stop ${index + 1} earlier`}
                  disabled={index === 0}
                  onClick={() => moveStop(stop.id, -1)}
                />
                <IconButton
                  icon="down"
                  label={`Move stop ${index + 1} later`}
                  disabled={index === draft.stops.length - 1}
                  onClick={() => moveStop(stop.id, 1)}
                />
                <IconButton
                  icon="close"
                  label={`Remove stop ${index + 1}`}
                  onClick={() => removeStop(stop.id)}
                />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="tour-stops-empty muted">
          Open a file, show the place to point at (a page, a zoomed region, a camera view), then
          choose Add.
        </p>
      )}
    </Panel>
  );
}
