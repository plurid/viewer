import { useSyncExternalStore } from 'react';
import {
  describeAnchor,
  fileName,
  findingGradeLabels,
  type TourStop,
} from '../../../domain/tours/tour';
import { IconButton } from '../../ui/primitives';
import { openedTour, stopTour, subscribeTour, tourControls, tourPlayback } from '../tour';
import type { TourPlayback } from './player';
import { editTour, tourDraft } from './recorder';
import './tours.css';

/** Where in the workspace a stop goes: its file and the place in it, or the saved view. */
function stopPlace(stop: TourStop, changed: boolean): string {
  const target = stop.target;
  if (target.kind === 'view') return `Saved view “${target.bookmark}”`;
  const name = fileName(target.path);
  return target.anchor && !changed ? `${name} · ${describeAnchor(target.anchor)}` : name;
}
/** How the end reads: how many stops showed, and how many were skipped. */
function summary({ tour, skipped }: TourPlayback): { title: string; detail: string } {
  const total = tour.stops.length;
  const shown = total - skipped;
  return {
    title: shown ? `End of “${tour.name}”` : `Nothing in “${tour.name}” could be shown`,
    detail: skipped
      ? `${shown} of ${total} stops shown · ${skipped} skipped`
      : `${total} ${total === 1 ? 'stop' : 'stops'}`,
  };
}
/**
 * What a screen reader hears, in one live region that is always in the window, so the first stop
 * is read as well as the later ones and the end: the stop and its caption once the camera is
 * there, why a stop is skipped, a pause, and the summary.
 */
function announcement(playback: TourPlayback | null): string {
  if (!playback) return '';
  const { tour, index, status, paused, notice } = playback;
  if (status === 'ended') {
    const { title, detail } = summary(playback);
    // a tour that showed nothing ends at once: its last stop's reason was not read yet
    const reason = notice && playback.skipped === tour.stops.length ? ' ' + notice.text : '';
    return `${title}. ${detail}.${reason}`;
  }
  const stop = tour.stops[index];
  if (!stop || status === 'travelling') return '';
  const place = `Stop ${index + 1} of ${tour.stops.length}`;
  if (paused) return `Tour paused at ${place.toLowerCase()}.`;
  if (status === 'skipping') return `${place} skipped. ${notice?.text ?? ''}`.trim();
  const changed = notice?.state === 'changed' ? ' Changed since recorded.' : '';
  return `${place}: ${stop.caption}.${changed}${notice ? ' ' + notice.text : ''}`;
}
function Ended({ playback, onEdit }: { playback: TourPlayback; onEdit?: () => void }) {
  const { tour, skipped, notice } = playback;
  const shown = tour.stops.length - skipped;
  const { title, detail } = summary(playback);
  return (
    <section className="tour-bar" data-status="ended" aria-label={`Tour “${tour.name}”`}>
      <div className="tour-bar-text">
        <strong>{title}</strong>
        <span className="muted">{detail}</span>
        {notice && <p className="tour-notice">{notice.text}</p>}
      </div>
      <div className="tour-bar-controls">
        {onEdit && <button onClick={onEdit}>Edit stops</button>}
        {shown > 0 && <button onClick={tourControls.restart}>Play again</button>}
        <IconButton icon="close" label="Close tour (Esc)" onClick={stopTour} />
      </div>
    </section>
  );
}
function Running({ playback }: { playback: TourPlayback }) {
  const { tour, index, status, paused, notice, loop } = playback;
  const stop = tour.stops[index];
  if (!stop) return null;
  const total = tour.stops.length;
  const changed = notice?.state === 'changed';
  const grade = stop.finding?.grade;
  return (
    <section
      className="tour-bar"
      data-status={status}
      data-paused={paused || undefined}
      aria-label={`Tour “${tour.name}”`}
      aria-busy={status === 'travelling'}
    >
      <span className="tour-bar-count tabular" title={tour.name}>
        {index + 1} / {total}
      </span>
      <div className="tour-bar-text">
        <strong className="tour-bar-caption">{stop.caption}</strong>
        {stop.note && <p className="tour-bar-note">{stop.note}</p>}
        <span className="tour-bar-place">
          {grade && (
            <span className="tour-grade" data-grade={grade}>
              {findingGradeLabels[grade]}
            </span>
          )}
          <span className="muted">
            {status === 'skipping' ? 'Skipped' : stopPlace(stop, changed)}
            {paused ? ' · Paused' : ''}
          </span>
        </span>
        {notice && (
          <p className="tour-notice" data-state={notice.state}>
            {changed && <strong>Changed since recorded. </strong>}
            {notice.text}
          </p>
        )}
      </div>
      <div className="tour-bar-controls">
        <IconButton
          icon="left"
          label="Previous stop (←)"
          disabled={index === 0}
          onClick={tourControls.previous}
        />
        {paused ? (
          <IconButton icon="play" label="Resume tour (Space)" onClick={tourControls.resume} />
        ) : (
          <IconButton icon="pause" label="Pause tour (Space)" onClick={tourControls.pause} />
        )}
        <IconButton
          icon="right"
          label={
            index < total - 1
              ? 'Next stop (→)'
              : loop
                ? 'Back to the first stop (→)'
                : 'End tour (→)'
          }
          onClick={tourControls.next}
        />
        <IconButton icon="close" label="Stop tour (Esc)" onClick={stopTour} />
      </div>
    </section>
  );
}
/**
 * The running tour: this stop's caption and note, where it is, how far along, and what is not as
 * recorded. ← → step, Space pauses, Escape stops (`tour.ts` binds the keys).
 */
export function TourBar() {
  const playback = useSyncExternalStore(subscribeTour, tourPlayback);
  // the tour file as read, when that is what plays: its stops open for editing, and a draft of
  // that same file already open for editing stays as it is
  const document = openedTour();
  const editable =
    playback && document && playback.tour.file === document.file
      ? () => {
          stopTour();
          if (tourDraft()?.file !== document.file) editTour(document);
        }
      : undefined;
  return (
    <>
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement(playback)}
      </div>
      {playback &&
        (playback.status === 'ended' ? (
          <Ended playback={playback} onEdit={editable} />
        ) : (
          <Running playback={playback} />
        ))}
    </>
  );
}
