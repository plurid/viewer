import { useEffect, useState } from 'react';
import type { Resource } from '../../domain/contracts';
import type { MediaDraft } from '../../domain/media/documents';
import { mediaTime } from '../../domain/operations/transforms';

export function SourceStrip({
  draft,
  source,
  active,
  onSeek,
}: {
  draft: MediaDraft;
  source: number;
  active: boolean;
  onSeek(seconds: number): void;
}) {
  const [frames, setFrames] = useState<{ time: number; resource: Resource }[]>([]);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [failure, setFailure] = useState(''),
    [retry, setRetry] = useState(0);
  const info = draft.sources[source]?.info;
  useEffect(() => {
    if (!active || !info) return;
    let live = true;
    const owned: Resource[] = [],
      requests: string[] = [];
    setFrames([]);
    setPeaks([]);
    setFailure('');
    if (info.video)
      for (let index = 0; index < 4; index++) {
        const time = (info.duration * (index + 0.5)) / 4,
          requestID = crypto.randomUUID();
        requests.push(requestID);
        void window.viewer
          .media({ kind: 'frame', id: draft.id, source, seconds: time, requestID })
          .then((value) => {
            if (!value || !('url' in value)) return;
            if (!live) {
              void window.viewer.release(value.id).catch(() => {});
              return;
            }
            owned.push(value);
            setFrames((previous) =>
              [...previous, { time, resource: value }].sort((a, b) => a.time - b.time),
            );
          })
          .catch((error) => {
            if (live) setFailure(String(error.message || error));
          });
      }
    if (info.audio) {
      const requestID = crypto.randomUUID();
      requests.push(requestID);
      void window.viewer
        .media({ kind: 'waveform', id: draft.id, source, requestID })
        .then((value) => {
          if (live && value && 'peaks' in value) setPeaks(value.peaks);
        })
        .catch((error) => {
          if (live) setFailure(String(error.message || error));
        });
    }
    return () => {
      live = false;
      for (const requestID of requests)
        void window.viewer.media({ kind: 'cancel-preview', requestID }).catch(() => {});
      for (const resource of owned) void window.viewer.release(resource.id).catch(() => {});
    };
  }, [draft.id, source, active, info, retry]);
  if (!info) return null;
  const points =
    peaks.map((value, index) => `${index},${32 - value * 30}`).join(' ') +
    ' ' +
    peaks
      .map(
        (value, index) =>
          `${peaks.length - index - 1},${32 + peaks[peaks.length - index - 1]! * 30}`,
      )
      .join(' ');
  return (
    <div className="media-source-strip">
      {info.video && (
        <div className="media-filmstrip" aria-label="Source filmstrip">
          {frames.length ? (
            frames.map((frame) => (
              <button
                key={frame.time}
                title={mediaTime(frame.time)}
                onClick={() => onSeek(frame.time)}
              >
                <img src={frame.resource.url} alt={`Frame at ${mediaTime(frame.time)}`} />
                <span>{mediaTime(frame.time)}</span>
              </button>
            ))
          ) : (
            <span className="muted">
              {failure ? 'Frames unavailable' : 'Reading source frames…'}
            </span>
          )}
        </div>
      )}
      {info.audio && (
        <div className="media-waveform" aria-label="Source audio waveform">
          {peaks.length ? (
            <svg viewBox={`0 0 ${peaks.length} 64`} preserveAspectRatio="none" aria-hidden="true">
              <polygon points={points} />
            </svg>
          ) : (
            <span className="muted">{failure ? 'Waveform unavailable' : 'Reading waveform…'}</span>
          )}
        </div>
      )}
      {failure && (
        <p className="inline-warning" role="status">
          {failure} <button onClick={() => setRetry((value) => value + 1)}>Retry inspection</button>
        </p>
      )}
    </div>
  );
}
