import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { MediaPane as Pane } from '../../domain/contracts';
import type { MediaTransform } from '../../domain/operations/transforms';
import { mediaTime, transformExtension } from '../../domain/operations/transforms';
import { baseName, parentPath } from '../../domain/workspaces/planes';
import { Failure, IconButton, Loading, tryAgainLabel } from '../ui/primitives';
import { plural } from '../../domain/plural';
import { statusLabel } from '../ui/status-labels';
import { ChoiceButton } from '../ui/ChoiceMenu';
import { DestinationField } from '../ui/DestinationField';
import { FileNameField, fileNameError } from '../ui/FileNameField';
import { FormField } from '../ui/FormField';
import { useHome } from '../ui/PathLabel';
import { report, useViewer, updatePane } from '../state/store';
import { useWorkspace } from '../workspace/context';
import { useResource } from '../previews/useResource';
import { mediaDraft, mediaSession } from './drafts';
import { SourceStrip } from './SourceStrip';
import { Timecode } from './Timecode';
import './media.css';
import { isActiveJob } from '../../domain/operations/jobs';
import { errorMessage } from '../../domain/errors';
import { homeText } from '../../domain/files/path-label';

export default function MediaPlane({ pane, active }: { pane: Pane; active: boolean }) {
  const workspace = useWorkspace();
  const session = useMemo(() => mediaSession(pane.draftID), [pane.draftID]);
  const snapshot = useSyncExternalStore(session.subscribe, session.snapshot);
  const draft = snapshot.draft;
  const [source, setSource] = useState(0),
    [selected, setSelected] = useState(0),
    [position, setPosition] = useState(0);
  const [range, setRange] = useState({ start: 0, end: 1 });
  const [folder, setFolder] = useState(parentPath(pane.path)),
    [name, setName] = useState(baseName(pane.path).replace(/\.[^.]+$/, '') + ' edited');
  const [separate, setSeparate] = useState(false),
    [frame, setFrame] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [jobs, setJobs] = useState<string[]>([]);
  const home = useHome();
  const extension = frame ? 'png' : transformExtension(draft?.plan.format ?? 'mp4');
  const player = useRef<HTMLMediaElement>(null),
    overlay = useRef<HTMLAudioElement>(null);
  const [playingSequence, setPlayingSequence] = useState(false);
  const [playbackAttempt, setPlaybackAttempt] = useState(0),
    [playbackError, setPlaybackError] = useState(''),
    [playbackReady, setPlaybackReady] = useState(false),
    [playbackSlow, setPlaybackSlow] = useState(false),
    [playing, setPlaying] = useState(false);
  const sourceFile = draft?.sources[source];
  const granted = useResource(
    snapshot.unavailable ? undefined : sourceFile?.path,
    undefined,
    active,
    playbackAttempt,
  );
  const overlayFile =
    draft?.plan.audio.source === undefined ? undefined : draft.sources[draft.plan.audio.source];
  const overlayGrant = useResource(
    snapshot.unavailable ? undefined : overlayFile?.path,
    undefined,
    active && !!draft && ['mix', 'replace'].includes(draft.plan.audio.mode),
    playbackAttempt,
  );
  const segment = draft?.plan.segments[selected];
  const selectedRange = segment?.source === source ? segment : range;
  const allJobs = useViewer((state) => state.jobs);
  const outputJobs = allJobs.filter((job) => jobs.includes(job.id));
  const destinations = outputJobs.flatMap((job) =>
    job.completed.flatMap((item) => (item.destination ? [item.destination] : [])),
  );
  const runningExport = outputJobs.find((job) => isActiveJob(job));
  const exportFailure = outputJobs.find((job) => job.status === 'failed');
  const exportNotice = !jobs.length
    ? ''
    : exportFailure
      ? `Export failed${exportFailure.errors[0]?.message ? ` · ${exportFailure.errors[0].message}` : ''}`
      : runningExport
        ? `${runningExport.status === 'queued' ? 'Waiting to export' : 'Exporting'} · ${runningExport.detail || `${runningExport.itemsDone.toLocaleString('en-US')} of ${plural(runningExport.itemsTotal, 'file')}`}`
        : outputJobs.some((job) => job.status === 'cancelled')
          ? `Export canceled · ${plural(destinations.length, 'file')} made`
          : outputJobs.length === jobs.length
            ? `Exported ${plural(destinations.length, 'file')}${destinations.length === 1 ? ' · ' + baseName(destinations[0]!) : ''}`
            : 'Preparing export…';
  const retryPlayback = () => {
    setPlaying(false);
    setPlaybackError('');
    setPlaybackReady(false);
    setPlaybackSlow(false);
    setPlaybackAttempt((value) => value + 1);
  };
  useEffect(() => {
    setPlaybackReady(false);
    setPlaybackSlow(false);
    setPlaybackError('');
    setPlaying(false);
  }, [granted.resource?.id]);
  useEffect(() => {
    if (!active || playbackReady || playbackError) return;
    const timer = setTimeout(() => setPlaybackSlow(true), 8000);
    return () => clearTimeout(timer);
  }, [active, playbackReady, playbackError, playbackAttempt, granted.resource?.id]);
  useEffect(() => {
    if (!active) {
      player.current?.pause();
      overlay.current?.pause();
    }
  }, [active]);
  useEffect(() => {
    const media = player.current,
      sound = overlay.current;
    return () => {
      for (const item of [media, sound])
        if (item) {
          item.pause();
          item.removeAttribute('src');
          item.load();
        }
    };
  }, [granted.resource?.id, overlayGrant.resource?.id]);
  useEffect(() => {
    setName(baseName(pane.path).replace(/\.[^.]+$/, '') + ' edited');
  }, [pane.path]);
  const chooseSegment = (index: number) => {
    const segment = draft?.plan.segments[index];
    if (!segment) return;
    setSelected(index);
    setSource(segment.source);
    setPosition(segment.start);
    if (player.current && source === segment.source) player.current.currentTime = segment.start;
  };
  const seek = (seconds: number) => {
    setPosition(seconds);
    if (player.current) player.current.currentTime = seconds;
  };
  const changeRange = (next: { start: number; end: number }) => {
    if (selected >= 0 && segment?.source === source)
      session.plan((plan) => ({
        ...plan,
        segments: plan.segments.map((segment, index) =>
          index === selected ? { ...segment, ...next } : segment,
        ),
      }));
    else setRange(next);
  };
  const chooseMedia = async (kind: 'audio' | 'video') => {
    setBusy(true);
    setMessage('');
    try {
      await session.flush();
      const value = mediaDraft(
        await window.viewer.media({
          kind: 'choose',
          id: pane.draftID,
          revision: session.snapshot().draft!.revision,
          media: kind,
        }),
      );
      session.replace(value);
    } catch (error) {
      setMessage(String(errorMessage(error) || error));
    } finally {
      setBusy(false);
    }
  };
  const syncAudio = () => {
    if (!draft || !overlay.current || !player.current) return;
    const base = draft.plan.segments
      .slice(0, Math.max(selected, 0))
      .reduce((time, segment) => time + segment.end - segment.start, 0);
    const at = base + player.current.currentTime - selectedRange.start - draft.plan.audio.offset;
    const sound = overlay.current;
    if (at < 0 || (overlayFile && at >= overlayFile.info.duration)) {
      sound.pause();
      return;
    }
    if (Math.abs(sound.currentTime - at) > 0.2) sound.currentTime = at;
    sound.volume = Math.min(1, draft.plan.audio.gain);
    if (!player.current.paused && sound.paused) void sound.play().catch(() => {});
  };
  const exportMedia = async () => {
    if (!draft) return;
    setBusy(true);
    setMessage('');
    try {
      await session.flush();
      const value = await window.viewer.media({
        kind: 'export',
        id: draft.id,
        revision: session.snapshot().draft!.revision,
        destination: folder,
        name: name + '.' + extension,
        separate,
        ...(frame
          ? {
              frame: {
                source,
                seconds: Math.min(position, sourceFile!.info.duration - 0.001),
                format: 'png' as const,
              },
            }
          : {}),
      });
      if (!value || !('jobs' in value)) throw new Error('The export could not be started.');
      setJobs(value.jobs);
    } catch (error) {
      setMessage(String(errorMessage(error) || error));
    } finally {
      setBusy(false);
    }
  };
  if (snapshot.loading) return <Loading label="Opening media draft…" />;
  if (!draft || snapshot.unavailable)
    return (
      <Failure
        icon="warning"
        title="Can't open this media draft"
        detail={snapshot.error}
        onRetry={() => void session.reload()}
      >
        <p>
          Your edits are saved. Apply Saved Edits to Current Files uses them with the files as they
          are now.
        </p>
        <button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void window.viewer
              .media({ kind: 'recover', id: pane.draftID })
              .then((reply) => {
                const recovered = mediaDraft(reply);
                updatePane(pane.id, { draftID: recovered.id });
              })
              .catch(report)
              .finally(() => setBusy(false));
          }}
        >
          Apply Saved Edits to Current Files
        </button>
        <button
          onClick={() =>
            void workspace
              .openMedia(draft?.sources.map((source) => source.path) ?? [pane.path], pane.id, true)
              .catch(report)
          }
        >
          New Draft from Current Files
        </button>
      </Failure>
    );
  const plan = draft.plan,
    info = sourceFile!.info;
  const step = info.video ? 1 / info.fps : 1 / (info.sampleRate || 48000);
  const total = plan.segments.reduce((total, segment) => total + segment.end - segment.start, 0);
  const formats = [
    ...(plan.segments.every((segment) => draft.sources[segment.source]?.info.video)
      ? ['mp4', 'mov']
      : []),
    'm4a',
    'wav',
    'flac',
  ];
  const mediaProps = {
    src: granted.resource?.url,
    controls: true,
    preload: 'metadata' as const,
    muted: ['mute', 'replace'].includes(plan.audio.mode),
    onLoadedData: () => {
      setPlaybackReady(true);
      setPlaybackSlow(false);
    },
    onCanPlay: () => {
      setPlaybackReady(true);
      setPlaybackSlow(false);
    },
    onError: () => {
      setPlaying(false);
      setPlaybackError("Viewer can't play this file. Try again, or export it as MP4 or M4A.");
    },
    onLoadedMetadata: () => {
      if (player.current) {
        if (position > 0) player.current.currentTime = Math.min(position, info.duration);
        if (playingSequence) void player.current.play().catch(report);
      }
    },
    onPlay: () => {
      setPlaying(true);
      if (player.current)
        player.current.volume =
          plan.audio.mode === 'mix' ? Math.min(1, plan.audio.originalGain) : 1;
      if (
        player.current &&
        (player.current.currentTime < selectedRange.start ||
          player.current.currentTime >= selectedRange.end)
      )
        player.current.currentTime = selectedRange.start;
      syncAudio();
    },
    onPause: () => {
      setPlaying(false);
      overlay.current?.pause();
    },
    onTimeUpdate: () => {
      const time = player.current?.currentTime || 0;
      setPosition(time);
      syncAudio();
      if (time >= selectedRange.end && player.current) {
        if (playingSequence && selected + 1 < plan.segments.length) {
          chooseSegment(selected + 1);
        } else {
          player.current.pause();
          setPlayingSequence(false);
        }
      }
    },
  };
  return (
    <section className="media-editor" aria-label="Media editor">
      <div className="preview-toolbar media-editor-toolbar">
        <ChoiceButton
          label="Source"
          value={String(source)}
          choices={draft.sources.map((source, index) => ({
            value: String(index),
            label: baseName(source.path),
          }))}
          onChoose={(value) => {
            const index = Number(value);
            setSource(index);
            setSelected(-1);
            setRange({ start: 0, end: draft.sources[index]!.info.duration });
            setPosition(0);
          }}
        />
        <button disabled={busy} onClick={() => void chooseMedia('video')}>
          Add Media…
        </button>
        <button disabled={busy} onClick={() => void chooseMedia('audio')}>
          Add Audio…
        </button>
        <span className="toolbar-spacer" />
        <span className="muted">
          {snapshot.saving || snapshot.dirty ? 'Saving draft…' : 'Draft saved'}
        </span>
      </div>
      {(snapshot.error || message || exportNotice) && (
        <p className="media-editor-notice" role="status">
          {homeText(snapshot.error || message || exportNotice || '', home)}
          {snapshot.error && (
            <button onClick={() => void session.flush().catch(report)}>{tryAgainLabel}</button>
          )}
        </p>
      )}
      <div className="media-editor-body">
        <div className="media-editor-main">
          <div className="media-editor-player">
            {granted.error || playbackError ? (
              <Failure
                icon="warning"
                title="Can't play this file"
                detail={granted.error || playbackError}
                onRetry={retryPlayback}
              />
            ) : info.video ? (
              <video
                key={granted.resource?.id}
                ref={player as React.RefObject<HTMLVideoElement>}
                {...mediaProps}
                controls={false}
              />
            ) : (
              <audio
                key={granted.resource?.id}
                ref={player as React.RefObject<HTMLAudioElement>}
                {...mediaProps}
              />
            )}
            {overlayGrant.resource && (
              <audio
                key={overlayGrant.resource?.id}
                ref={overlay}
                src={overlayGrant.resource.url}
                preload="metadata"
                onError={() =>
                  setPlaybackError(
                    "Viewer can't play the added audio. Try again, or choose another audio file.",
                  )
                }
              />
            )}
          </div>
          <div className="media-playback-controls">
            <button
              disabled={!playbackReady || !!playbackError}
              onClick={() => {
                const media = player.current;
                if (!media) return;
                if (!media.paused) media.pause();
                else
                  void media
                    .play()
                    .catch((error) =>
                      setPlaybackError(String(error.message || "Playback couldn't start.")),
                    );
              }}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <input
              aria-label="Seek playback"
              type="range"
              min={0}
              max={info.duration}
              step={step}
              value={Math.min(position, info.duration)}
              disabled={!playbackReady}
              onChange={(event) => seek(Number(event.target.value))}
            />
            <span>
              {mediaTime(position)} / {mediaTime(info.duration)}
            </span>
            {!playbackReady && !playbackError && (
              <span role="status">
                {playbackSlow ? 'Playback is taking longer than expected.' : 'Loading playback…'}
              </span>
            )}
            {playbackSlow && !playbackReady && (
              <button onClick={retryPlayback}>{tryAgainLabel}</button>
            )}
          </div>
          <SourceStrip draft={draft} source={source} active={active} onSeek={seek} />
          <div className="media-range-controls">
            <Timecode
              label="In"
              value={selectedRange.start}
              max={Math.max(0, selectedRange.end - step)}
              onChange={(start) => changeRange({ ...selectedRange, start })}
            />
            <button
              onClick={() =>
                changeRange({
                  ...selectedRange,
                  start: Math.min(position, selectedRange.end - step),
                })
              }
            >
              Set In
            </button>
            <Timecode
              label="Out"
              value={selectedRange.end}
              min={selectedRange.start + step}
              max={info.duration}
              onChange={(end) => changeRange({ ...selectedRange, end })}
            />
            <button
              onClick={() =>
                changeRange({
                  ...selectedRange,
                  end: Math.max(position, selectedRange.start + step),
                })
              }
            >
              Set Out
            </button>
            <button
              disabled={plan.segments.length >= 32}
              onClick={() => {
                session.plan((plan) => ({
                  ...plan,
                  cut: 'exact',
                  segments: [...plan.segments, { source, ...selectedRange }],
                }));
                setSelected(plan.segments.length);
              }}
            >
              Add Segment
            </button>
          </div>
          <div className="media-range-sliders">
            <input
              type="range"
              aria-label="Range start"
              min={0}
              max={info.duration}
              step={step}
              value={selectedRange.start}
              onChange={(event) =>
                changeRange({
                  ...selectedRange,
                  start: Math.min(Number(event.target.value), selectedRange.end - step),
                })
              }
            />
            <input
              type="range"
              aria-label="Range end"
              min={0}
              max={info.duration}
              step={step}
              value={selectedRange.end}
              onChange={(event) =>
                changeRange({
                  ...selectedRange,
                  end: Math.max(Number(event.target.value), selectedRange.start + step),
                })
              }
            />
          </div>
          <div className="media-sequence-heading">
            <strong>Sequence</strong>
            <span className="muted">
              {plural(plan.segments.length, 'segment')} · {mediaTime(total)}
            </span>
            <button
              onClick={() => {
                chooseSegment(0);
                setPlayingSequence(true);
                if (source === plan.segments[0]!.source) void player.current?.play().catch(report);
              }}
            >
              Play Sequence
            </button>
          </div>
          <div className="media-segments" role="list" aria-label="Export sequence">
            {plan.segments.map((segment, index) => (
              <div
                className={`media-segment ${index === selected ? 'is-selected' : ''}`}
                role="listitem"
                key={index}
              >
                <button className="media-segment-label" onClick={() => chooseSegment(index)}>
                  <strong>{baseName(draft.sources[segment.source]!.path)}</strong>
                  <span>
                    {mediaTime(segment.start)} → {mediaTime(segment.end)}
                  </span>
                </button>
                <IconButton
                  icon="up"
                  label={`Move segment ${index + 1} up`}
                  disabled={!index}
                  onClick={() => {
                    session.plan((plan) => {
                      const segments = [...plan.segments];
                      [segments[index - 1], segments[index]] = [
                        segments[index]!,
                        segments[index - 1]!,
                      ];
                      return { ...plan, segments };
                    });
                    setSelected(index - 1);
                  }}
                />
                <IconButton
                  icon="down"
                  label={`Move segment ${index + 1} down`}
                  disabled={index === plan.segments.length - 1}
                  onClick={() => {
                    session.plan((plan) => {
                      const segments = [...plan.segments];
                      [segments[index], segments[index + 1]] = [
                        segments[index + 1]!,
                        segments[index]!,
                      ];
                      return { ...plan, segments };
                    });
                    setSelected(index + 1);
                  }}
                />
                <IconButton
                  icon="close"
                  label={`Remove segment ${index + 1}`}
                  disabled={plan.segments.length === 1}
                  onClick={() => {
                    session.plan((plan) => ({
                      ...plan,
                      segments: plan.segments.filter((_, position) => position !== index),
                    }));
                    setSelected(0);
                  }}
                />
              </div>
            ))}
          </div>
        </div>
        <aside className="media-export-options dialog-form" aria-label="Export options">
          <FormField label="Format">
            <ChoiceButton
              label="Export format"
              value={plan.format}
              choices={formats.map((value) => ({
                value,
                label: (
                  {
                    mp4: 'MP4 video',
                    mov: 'QuickTime video',
                    m4a: 'AAC audio',
                    wav: 'WAV audio',
                    flac: 'FLAC audio',
                  } as Record<string, string>
                )[value]!,
              }))}
              onChoose={(format) => {
                setFrame(false);
                session.plan((plan) => ({
                  ...plan,
                  format: format as MediaTransform['format'],
                  cut: 'exact',
                  audio: {
                    ...plan.audio,
                    mode:
                      ['m4a', 'wav', 'flac'].includes(format) && plan.audio.mode === 'mute'
                        ? 'keep'
                        : plan.audio.mode,
                  },
                }));
              }}
            />
          </FormField>
          <FormField label="Quality">
            <ChoiceButton
              label="Export quality"
              value={plan.quality}
              choices={[
                { value: 'small', label: 'Smaller file' },
                { value: 'balanced', label: 'Balanced' },
                { value: 'high', label: 'High quality' },
              ]}
              onChoose={(quality) =>
                session.plan((plan) => ({ ...plan, quality: quality as MediaTransform['quality'] }))
              }
            />
          </FormField>
          <FormField label="Cut">
            <ChoiceButton
              label="Cut accuracy"
              value={plan.cut}
              choices={[
                { value: 'exact', label: 'Exact' },
                ...(plan.segments.length === 1 &&
                ['mp4', 'mov'].includes(plan.format) &&
                ['keep', 'mute'].includes(plan.audio.mode) &&
                info.videoCodec === 'h264' &&
                (!info.audio || info.audioCodec === 'aac')
                  ? [{ value: 'keyframe', label: 'Fast' }]
                  : []),
              ]}
              onChoose={(cut) =>
                session.plan((plan) => ({ ...plan, cut: cut as MediaTransform['cut'] }))
              }
            />
          </FormField>
          {plan.cut === 'keyframe' && (
            <p className="muted">Fast cuts can start a few seconds early.</p>
          )}
          <FormField label="Audio">
            <ChoiceButton
              label="Audio treatment"
              value={plan.audio.mode}
              choices={[
                { value: 'keep', label: 'Keep original' },
                ...(['mp4', 'mov'].includes(plan.format)
                  ? [{ value: 'mute', label: 'Remove audio' }]
                  : []),
                ...(plan.audio.source !== undefined
                  ? [
                      { value: 'replace', label: 'Replace audio' },
                      { value: 'mix', label: 'Mix with original' },
                    ]
                  : []),
              ]}
              onChoose={(mode) =>
                session.plan((plan) => ({
                  ...plan,
                  cut: 'exact',
                  audio: { ...plan.audio, mode: mode as MediaTransform['audio']['mode'] },
                }))
              }
            />
          </FormField>
          {['mix', 'replace'].includes(plan.audio.mode) && (
            <>
              <span className="muted">{overlayFile && baseName(overlayFile.path)}</span>
              <FormField label="Audio offset (seconds)">
                <input
                  aria-label="Audio offset (seconds)"
                  type="number"
                  min={-86400}
                  max={86400}
                  step="0.1"
                  value={plan.audio.offset}
                  onChange={(event) =>
                    session.plan((plan) => ({
                      ...plan,
                      audio: { ...plan.audio, offset: Number(event.target.value) || 0 },
                    }))
                  }
                />
              </FormField>
              <FormField label="Added audio gain">
                <input
                  aria-label="Added audio gain"
                  type="range"
                  min={0}
                  max={1}
                  step="0.05"
                  value={plan.audio.gain}
                  onChange={(event) =>
                    session.plan((plan) => ({
                      ...plan,
                      audio: { ...plan.audio, gain: Number(event.target.value) },
                    }))
                  }
                />
              </FormField>
              {plan.audio.mode === 'mix' && (
                <FormField label="Original gain">
                  <input
                    aria-label="Original gain"
                    type="range"
                    min={0}
                    max={1}
                    step="0.05"
                    value={plan.audio.originalGain}
                    onChange={(event) => {
                      if (player.current) player.current.volume = Number(event.target.value);
                      session.plan((plan) => ({
                        ...plan,
                        audio: { ...plan.audio, originalGain: Number(event.target.value) },
                      }));
                    }}
                  />
                </FormField>
              )}
            </>
          )}
          <label className="dialog-field-toggle">
            <input
              type="checkbox"
              checked={separate}
              onChange={(event) => setSeparate(event.target.checked)}
            />
            Export each segment
          </label>
          {info.video && (
            <label className="dialog-field-toggle">
              <input
                type="checkbox"
                checked={frame}
                onChange={(event) => setFrame(event.target.checked)}
              />
              Export current frame as PNG
            </label>
          )}
          <FileNameField
            value={name}
            extension={extension}
            onChange={setName}
            folder={folder}
            disabled={busy || !!runningExport}
            numberedSuffix={separate ? ' 1' : ''}
          />
          <DestinationField
            path={folder}
            onChange={setFolder}
            disabled={busy || !!runningExport}
          />
          {separate && (
            <p className="muted">
              File names start with {name} 1.{extension}.
            </p>
          )}
          <button
            className="primary"
            disabled={busy || snapshot.saving || !!fileNameError(name, extension, separate ? ' 1' : '') || !folder.trim()}
            onClick={() => void exportMedia()}
          >
            {busy
              ? 'Preparing…'
              : frame
                ? 'Export Frame'
                : separate
                  ? 'Export Segments'
                  : 'Export Sequence'}
          </button>
          {outputJobs.flatMap((job) =>
            job.completed.flatMap((item) =>
              item.destination
                ? [
                    <button
                      key={item.destination}
                      onClick={() =>
                        void workspace
                          .openPath(item.destination!, {
                            paneID: pane.id,
                            linked: true,
                            activate: true,
                          })
                          .catch(report)
                      }
                    >
                      Open {baseName(item.destination)}
                    </button>,
                  ]
                : [],
            ),
          )}
          {outputJobs
            .filter(
              (job) => isActiveJob(job) || job.status === 'failed' || job.status === 'cancelled',
            )
            .map((job) => (
              <div className="media-export-progress" key={job.id}>
                <span role="status">
                  {statusLabel(job.status)} ·{' '}
                  {job.detail
                    ? homeText(job.detail, home)
                    : `${job.itemsDone.toLocaleString('en-US')} of ${plural(job.itemsTotal, 'file')}`}
                </span>
                {isActiveJob(job) && (
                  <>
                    <progress max={1} value={job.progress} />
                    <button onClick={() => void window.viewer.cancelJob(job.id).catch(report)}>
                      Cancel Export
                    </button>
                  </>
                )}
                {job.errors.map((error, index) => (
                  <p className="error" key={index}>
                    {homeText(error.message, home)}
                  </p>
                ))}
              </div>
            ))}
        </aside>
      </div>
    </section>
  );
}
