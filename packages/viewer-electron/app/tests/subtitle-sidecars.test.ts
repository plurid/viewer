import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../src/domain/contracts';
import { sidecarLimits, subtitleSidecars } from '../src/domain/previews/data/subtitle-sidecars';
import { subtitlesToVTT, subtitleTrack } from '../src/domain/previews/data/subtitles';

const file = (name: string, size = 100, mime = 'text/plain'): FileEntry => ({
  path: `/Movies/${name}`,
  name,
  parent: '/Movies',
  extension: name.split('.').pop()!,
  mime,
  size,
  kind: 'file',
  directory: false,
  identity: name,
  modified: 0,
  created: 0,
  hidden: false,
});
const video = file('Movie.mp4', 1e9, 'video/mp4');

describe('subtitle files beside a video', () => {
  it('finds files that carry the video name, the exact name first, with their language', () => {
    const entries = [
      video,
      file('Movie.en.srt'),
      file('Movie.srt'),
      file('Movie.pt_BR.forced.ass'),
      file('MOVIE.SDH.EN.VTT'),
      file('Movie.ssa'),
      file('Movie.txt'),
      file('Movies.srt'),
      file('Other.srt'),
    ];
    expect(subtitleSidecars(video, entries)).toEqual([
      { path: '/Movies/Movie.srt', name: 'Movie.srt', language: undefined },
      { path: '/Movies/Movie.ssa', name: 'Movie.ssa', language: undefined },
      { path: '/Movies/Movie.en.srt', name: 'Movie.en.srt', language: 'en' },
      {
        path: '/Movies/Movie.pt_BR.forced.ass',
        name: 'Movie.pt_BR.forced.ass',
        language: 'pt-BR',
      },
      { path: '/Movies/MOVIE.SDH.EN.VTT', name: 'MOVIE.SDH.EN.VTT', language: 'EN' },
    ]);
  });

  it('leaves a longer video name its own subtitles', () => {
    const entries = [
      video,
      file('Movie.Part 2.mkv', 1e9, 'video/x-matroska'),
      file('Movie.Part 2.srt'),
      file('Movie.Part 2.en.srt'),
      file('Movie.fr.srt'),
    ];
    expect(subtitleSidecars(video, entries).map((sidecar) => sidecar.name)).toEqual([
      'Movie.fr.srt',
    ]);
    expect(subtitleSidecars(entries[1]!, entries).map((sidecar) => sidecar.name)).toEqual([
      'Movie.Part 2.srt',
      'Movie.Part 2.en.srt',
    ]);
  });

  it('bounds their size and number, and skips folders', () => {
    const many = Array.from({ length: 12 }, (_, index) => file(`Movie.${index + 1}.srt`));
    const entries = [
      video,
      file('Movie.srt', sidecarLimits.bytes + 1),
      { ...file('Movie.vtt'), kind: 'directory' as const, directory: true },
      ...many,
    ];
    const found = subtitleSidecars(video, entries);
    expect(found).toHaveLength(sidecarLimits.files);
    expect(found[0]!.name).toBe('Movie.1.srt');
    expect(found.some((sidecar) => ['Movie.srt', 'Movie.vtt'].includes(sidecar.name))).toBe(false);
  });
});

describe('a subtitle track for the player', () => {
  const time = (second: number, fraction: string) =>
    `00:00:${String(second).padStart(2, '0')},${fraction}`;
  const srt = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      [index + 1, `${time(index, '000')} --> ${time(index, '900')}`, `Line ${index + 1}`, ''].join(
        '\n',
      ),
    ).join('\n');

  it('converts and counts the cues, keeping WebVTT as written', () => {
    expect(subtitleTrack(srt(2), 'srt')).toEqual({
      vtt: [
        'WEBVTT',
        '',
        '1',
        '00:00:00.000 --> 00:00:00.900',
        'Line 1',
        '',
        '2',
        '00:00:01.000 --> 00:00:01.900',
        'Line 2',
        '',
      ].join('\n'),
      cues: 2,
      truncated: false,
    });
    const vtt =
      'WEBVTT\n\nSTYLE\n::cue { color: yellow }\n\n00:00:01.000 --> 00:00:02.000\nHello\n';
    expect(subtitleTrack(vtt, 'vtt')).toEqual({ vtt, cues: 1, truncated: false });
    expect(subtitlesToVTT(vtt, 'vtt')).toBe(vtt);
  });

  it('keeps the first cues within the limit, even of WebVTT', () => {
    const track = subtitleTrack(srt(5), 'srt', { cues: 3 });
    expect(track).toMatchObject({ cues: 3, truncated: true });
    expect(track.vtt).toContain('Line 3');
    expect(track.vtt).not.toContain('Line 4');
    const vtt = subtitleTrack(subtitleTrack(srt(5), 'srt').vtt, 'vtt', { cues: 2 });
    expect(vtt).toMatchObject({ cues: 2, truncated: true });
    expect(vtt.vtt).not.toContain('Line 3');
  });
});
