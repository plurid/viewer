import { useEffect, useState } from 'react';
import type { PreviewContext } from './contracts';
import { usePreviewState } from './state';
import { errorMessage } from '../../domain/errors';
import { formatBytes } from '../../domain/files/entries';
import { baseName, parentPath } from '../../domain/workspaces/planes';
import {
  sidecarLimits,
  subtitleSidecars,
  type SubtitleSidecar,
} from '../../domain/previews/data/subtitle-sidecars';
import { subtitleFormat, subtitleTrack } from '../../domain/previews/data/subtitles';

export interface SubtitleTrackSource {
  name: string;
  /** A WebVTT blob this view owns. */
  url: string;
  language?: string;
  cues: number;
  truncated: boolean;
}

export interface VideoSubtitles {
  files: readonly SubtitleSidecar[];
  /** The shown file's name, or `''` when subtitles are off. */
  chosen: string;
  choose(name: string): void;
  track?: SubtitleTrackSource;
  problem?: string;
}

interface TrackLoad {
  path: string;
  value?: SubtitleTrackSource;
  problem?: string;
}

/**
 * Subtitle files beside a video, offered as its tracks. Each is read through its own authorized
 * resource, bounded and converted to WebVTT, and the choice is remembered with the file's view. A
 * file inside an archive or a comparison has no folder of its own and offers none.
 */
export function useSubtitleSidecars(context: PreviewContext): VideoSubtitles {
  const { resource, services, active } = context;
  const entry = resource.entry;
  const [listed, setListed] = useState<{ source: string; files: SubtitleSidecar[] }>();
  const [saved, setSaved] = usePreviewState<string | undefined>(
    context,
    'media.subtitles',
    undefined,
  );
  const [load, setLoad] = useState<TrackLoad>();
  const video = !entry.mime.startsWith('audio/');
  const local = parentPath(entry.path) === entry.parent && baseName(entry.path) === entry.name;
  const { list, resource: grant, read, release } = services;
  useEffect(() => {
    if (!active || !video || !local || !list) return;
    let live = true;
    void list(entry.parent).then(
      (listing) => {
        if (live)
          setListed({ source: entry.path, files: subtitleSidecars(entry, listing.entries) });
      },
      // a folder that cannot be listed offers no subtitles
      () => {},
    );
    return () => {
      live = false;
    };
  }, [active, video, local, list, entry]);
  const files = listed?.source === entry.path ? listed.files : [];
  const chosen = saved === '' ? undefined : (files.find((file) => file.name === saved) ?? files[0]);
  const path = chosen?.path,
    name = chosen?.name,
    language = chosen?.language;
  useEffect(() => {
    if (!active || !path || !name || !grant) return;
    let live = true,
      url: string | undefined;
    void (async () => {
      const sidecar = await grant(path);
      try {
        if (!live) return;
        const text = await read(sidecar.id, sidecarLimits.bytes);
        if (!live) return;
        const format = text.binary ? undefined : subtitleFormat(sidecar.entry.extension, text.text);
        const track = format && !text.truncated && subtitleTrack(text.text, format, sidecarLimits);
        if (!track || !track.cues) {
          const limit = formatBytes(sidecarLimits.bytes);
          setLoad({
            path,
            problem: text.truncated
              ? `${name} is larger than the ${limit} subtitle limit.`
              : `${name} has no timed subtitles.`,
          });
          return;
        }
        url = URL.createObjectURL(new Blob([track.vtt], { type: 'text/vtt' }));
        setLoad({
          path,
          value: { name, url, language, cues: track.cues, truncated: track.truncated },
        });
      } finally {
        void release(sidecar.id).catch(() => {});
      }
    })().catch((error) => {
      if (live) setLoad({ path, problem: `${name} could not be read. ${errorMessage(error)}` });
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [active, path, name, language, grant, read, release]);
  const current = load?.path === path ? load : undefined;
  return {
    files,
    chosen: chosen?.name ?? '',
    choose: setSaved,
    track: current?.value,
    problem: current?.problem,
  };
}
