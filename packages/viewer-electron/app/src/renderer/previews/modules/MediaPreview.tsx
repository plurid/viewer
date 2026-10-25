import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PreviewToolbar, usePreviewCommands } from '../controls';
import type { PreviewContext } from '../contracts';
import { Empty } from '../../ui/primitives';
import { Icon } from '../../ui/Icon';
import { NativeOpenActions } from '../../ui/navigation/NativeOpenActions';
import { usePreviewState } from '../state';

export default function MediaPreview(context: PreviewContext) {
  const { resource, active } = context;
  const ref = useRef<HTMLMediaElement>(null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [pictureUnavailable, setPictureUnavailable] = useState(false);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [position, setPosition] = usePreviewState(context, 'media.position', 0);
  const restored = useRef(false);
  useEffect(() => {
    if (ready && context.evidence?.anchor.kind === 'media' && ref.current)
      ref.current.currentTime = context.evidence.anchor.seconds;
  }, [ready, context.evidence]);
  const audio = resource.entry.mime.startsWith('audio/');
  const markReady = useCallback(() => {
    const media = ref.current;
    if (!audio && media instanceof HTMLVideoElement && media.videoWidth === 0) {
      restored.current = false;
      setPictureUnavailable(true);
      setReady(false);
      return;
    }
    setReady(true);
    setSlow(false);
  }, [audio]);
  useEffect(() => {
    if (ready || error || !active) return;
    // Some partial/cached decodes expose HAVE_CURRENT_DATA without emitting the
    // expected video-ready events. Read native state until readiness or the
    // existing slow-load boundary, then leave ordinary media events in charge.
    const synchronize = () => {
      if ((ref.current?.readyState ?? 0) >= 2) markReady();
    };
    synchronize();
    const poll = setInterval(synchronize, 200);
    const timer = setTimeout(() => {
      synchronize();
      clearInterval(poll);
      setSlow(true);
    }, 8000);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
    };
  }, [ready, error, active, attempt, pictureUnavailable, resource.id, markReady]);
  useEffect(() => {
    if (!active) ref.current?.pause();
  }, [active]);
  useEffect(() => {
    const media = ref.current;
    return () => {
      if (media) {
        media.pause();
        media.removeAttribute('src');
        media.load();
      }
    };
  }, [error, attempt, resource.id, pictureUnavailable]);
  usePreviewCommands(
    context,
    useMemo(
      () => [
        {
          id: 'media-playback',
          label: playing ? 'Pause' : 'Play',
          aliases: ['pl'],
          primary: true,
          available: ready && !error,
          run: async () => {
            const media = ref.current;
            if (media) {
              if (media.paused) await media.play();
              else media.pause();
            }
          },
        },
        {
          id: 'media-restart',
          label: 'Restart playback',
          available: ready && !error,
          run: () => {
            if (ref.current) ref.current.currentTime = 0;
          },
        },
      ],
      [playing, ready, error],
    ),
  );
  if (error)
    return (
      <Empty icon={audio ? 'audio' : 'video'} title="Media could not be played" detail={error}>
        <NativeOpenActions path={resource.entry.path} />
        <button
          onClick={() => {
            setError('');
            setReady(false);
            setSlow(false);
            setAttempt((value) => value + 1);
          }}
        >
          Retry
        </button>
      </Empty>
    );
  const props = {
    src: resource.url,
    controls: true,
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onLoadedData: markReady,
    onCanPlay: markReady,
    onLoadedMetadata: () => {
      const media = ref.current;
      if (media && !restored.current) {
        media.currentTime = Math.min(
          position,
          Number.isFinite(media.duration) ? media.duration : position,
        );
        restored.current = true;
      }
    },
    onTimeUpdate: () => {
      const seconds = ref.current?.currentTime;
      if (seconds !== undefined && Math.abs(seconds - position) >= 1) setPosition(seconds);
    },
    preload: 'metadata' as const,
    onError: () => setError('Open this file in its default app or choose another player.'),
  };
  const media =
    audio || pictureUnavailable ? (
      <div className="audio-viewer">
        <Icon name="audio" size={64} />
        <h2>{resource.entry.name}</h2>
        <audio ref={ref as React.RefObject<HTMLAudioElement>} {...props} />
      </div>
    ) : (
      <div className="video-viewer">
        <video ref={ref as React.RefObject<HTMLVideoElement>} {...props} />
      </div>
    );
  return (
    <div className="media-preview">
      {context.editMedia && (
        <PreviewToolbar context={context}>
          <button onClick={context.editMedia}>Edit media…</button>
        </PreviewToolbar>
      )}
      {media}
      {ready && pictureUnavailable && (
        <p className="inline-warning" role="status">
          No video picture is available. Audio can still play.
        </p>
      )}
      {!ready && (
        <div className="media-loading" role="status">
          <span>{slow ? 'Media is taking longer to load.' : 'Loading media…'}</span>
          <NativeOpenActions path={resource.entry.path} />
        </div>
      )}
    </div>
  );
}
