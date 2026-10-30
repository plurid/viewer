import type { FileEntry } from '../../contracts';

/** A video's subtitles are read whole and converted in its window, so each is held small. */
export const sidecarLimits = {
  bytes: 2_000_000,
  cues: 20_000,
  files: 8,
};

export interface SubtitleSidecar {
  path: string;
  name: string;
  /** The language its name gives after the video's: `en` in `Movie.en.srt`. */
  language?: string;
}

const subtitleExtensions = ['srt', 'vtt', 'ass', 'ssa'];
/** Release tags that read as language codes. */
const notLanguages = ['sdh', 'cc'];

const stem = (name: string) => name.replace(/\.[^.]+$/, '');

function sidecarLanguage(tags: string): string | undefined {
  return tags
    .split('.')
    .reverse()
    .find(
      (tag) =>
        /^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})*$/i.test(tag) &&
        !notLanguages.includes(tag.toLowerCase()),
    )
    ?.replace(/_/g, '-');
}

/**
 * Subtitle files beside a video that carry its name: `Movie.srt`, `Movie.en.vtt`,
 * `Movie.forced.ass`. A file named for a longer video name, `Movie.Part 2.srt` beside
 * `Movie.Part 2.mkv`, is that video's. The exact name comes first; files over the size limit are
 * left out.
 */
export function subtitleSidecars(
  video: FileEntry,
  entries: readonly FileEntry[],
  limits = sidecarLimits,
): SubtitleSidecar[] {
  const own = stem(video.name).toLowerCase();
  const longer = entries
    .filter((entry) => entry.mime.startsWith('video/') && entry.path !== video.path)
    .map((entry) => stem(entry.name).toLowerCase())
    .filter((name) => name.startsWith(own + '.'));
  return entries
    .filter((entry) => {
      const name = stem(entry.name).toLowerCase();
      return (
        entry.kind === 'file' &&
        entry.size <= limits.bytes &&
        subtitleExtensions.includes(entry.extension.toLowerCase()) &&
        (name === own || name.startsWith(own + '.')) &&
        !longer.some((other) => name === other || name.startsWith(other + '.'))
      );
    })
    .map((entry) => ({
      path: entry.path,
      name: entry.name,
      language: sidecarLanguage(stem(entry.name).slice(own.length + 1)),
      exact: stem(entry.name).toLowerCase() === own,
    }))
    .sort(
      (a, b) =>
        Number(b.exact) - Number(a.exact) ||
        a.name.localeCompare(b.name, undefined, { numeric: true }),
    )
    .slice(0, limits.files)
    .map(({ path, name, language }) => ({ path, name, language }));
}
