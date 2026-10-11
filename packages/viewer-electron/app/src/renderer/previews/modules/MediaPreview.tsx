import { useEffect, useMemo, useRef, useState } from 'react';
import { usePreviewCommands } from '../controls';
import type { PreviewContext } from '../contracts';
import { Empty } from '../../ui/primitives';
import { Icon } from '../../ui/Icon';

export default function MediaPreview(context: PreviewContext) {
  const { resource, active } = context;
  const ref = useRef<HTMLMediaElement>(null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const audio = resource.entry.mime.startsWith('audio/');
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
  }, []);
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
      <Empty icon={audio ? 'audio' : 'video'} title="Media could not be played" detail={error} />
    );
  const props = {
    src: resource.url,
    controls: true,
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onLoadedMetadata: () => setReady(true),
    preload: 'metadata' as const,
    onError: () =>
      setError(
        'This codec or container is not supported by the desktop media engine, or the file is damaged.',
      ),
  };
  return audio ? (
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
}
