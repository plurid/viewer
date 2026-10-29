/**
 * SubRip (.srt), WebVTT (.vtt) and SubStation Alpha (.ass, .ssa) subtitles: cues with their times
 * and plain text for reading, and a WebVTT conversion for a media player's sidecar track.
 */

export type SubtitleFormat = 'srt' | 'vtt' | 'ass';

export interface SubtitleCue {
  /** Position in time order, from 1. */
  index: number;
  /** The SRT number or WebVTT identifier, as written. */
  id?: string;
  /** Milliseconds. */
  start: number;
  end: number;
  /** Plain text: markup and override tags removed, lines joined by `\n`. */
  text: string;
  /** WebVTT cue settings, such as `line:0 align:start`. */
  settings?: string;
  /** An ASS style name. */
  style?: string;
  /** An ASS speaker name, or a WebVTT voice. */
  speaker?: string;
}

export interface Subtitles {
  format: SubtitleFormat;
  title?: string;
  cues: SubtitleCue[];
  /** From the start of the media to the latest cue end, in milliseconds. */
  duration: number;
  /** Blocks with no readable timing, left out. */
  skipped: number;
  /** Cues beyond the preview limit were not read. */
  truncated: boolean;
}

export const subtitleLimits = { cues: 100_000 };

/** A cue as written, its text still carrying the format's own markup. */
interface WrittenCue {
  id?: string;
  start: number;
  end: number;
  markup: string;
  settings?: string;
  style?: string;
  speaker?: string;
}

interface WrittenSubtitles {
  title?: string;
  cues: WrittenCue[];
  skipped: number;
  truncated: boolean;
}

const time = String.raw`(?:\d+:)?\d{1,2}:\d{1,2}[,.]\d{1,3}`;
const timing = new RegExp(String.raw`^\s*(${time})[ \t]*-->[ \t]*(${time})(.*)$`);
const cueNumber = /^\s*\d+\s*$/;

export function subtitleFormat(extension: string, text = ''): SubtitleFormat | undefined {
  const start = text.replace(/^﻿/, '').slice(0, 4096);
  if (/^WEBVTT(?:[ \t\r\n]|$)/.test(start)) return 'vtt';
  if (/^\s*\[(?:Script Info|V4\+? Styles|Events)\]/im.test(start)) return 'ass';
  const lower = extension.toLowerCase();
  if (lower === 'srt' || lower === 'vtt') return lower;
  if (lower === 'ass' || lower === 'ssa') return 'ass';
  return undefined;
}

/** Milliseconds of `01:02:03,456`, `02:03.456` (WebVTT) or `1:02:03.45` (ASS centiseconds). */
export function subtitleTime(value: string): number | undefined {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.:](\d{1,3})$/.exec(value.trim());
  if (!match) return undefined;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes > 59 || seconds > 59) return undefined;
  const fraction = Number(match[4]!.padEnd(3, '0'));
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + fraction;
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

/** `HH:MM:SS.mmm`, or with a comma for SubRip. */
export function formatSubtitleTime(milliseconds: number, separator: '.' | ',' = '.'): string {
  const total = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor(total / 60_000) % 60;
  const seconds = Math.floor(total / 1000) % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${separator}${pad(total % 1000, 3)}`;
}

/** `1:32:10`, or `4:05` under an hour. */
export function formatSubtitleDuration(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = total % 60;
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

function lines(text: string): string[] {
  return text.replace(/^﻿/, '').split(/\r\n|\n|\r/);
}

/** Runs of lines that are not blank. */
function blocks(all: string[]): string[][] {
  const result: string[][] = [];
  let block: string[] = [];
  for (const line of all) {
    if (line.trim()) block.push(line);
    else if (block.length) {
      result.push(block);
      block = [];
    }
  }
  if (block.length) result.push(block);
  return result;
}

function timedCue(match: RegExpExecArray): Pick<WrittenCue, 'start' | 'end'> | undefined {
  const start = subtitleTime(match[1]!);
  const end = subtitleTime(match[2]!);
  return start === undefined || end === undefined ? undefined : { start, end };
}

/** SubRip: a number, a timing line and text. A missing blank line between cues is tolerated. */
function srtCues(text: string, limit: number): WrittenSubtitles {
  const cues: WrittenCue[] = [];
  let skipped = 0;
  for (const block of blocks(lines(text))) {
    let found = false;
    for (let index = 0; index < block.length; index++) {
      const match = timing.exec(block[index]!);
      const times = match && timedCue(match);
      if (!times) continue;
      found = true;
      let end = index + 1;
      while (
        end < block.length &&
        !timing.test(block[end]!) &&
        !(cueNumber.test(block[end]!) && timing.test(block[end + 1] ?? ''))
      )
        end++;
      if (cues.length >= limit) return { cues, skipped, truncated: true };
      const previous = block[index - 1];
      cues.push({
        id: previous !== undefined && cueNumber.test(previous) ? previous.trim() : undefined,
        ...times,
        markup: block.slice(index + 1, end).join('\n'),
      });
      index = end - 1;
    }
    if (!found) skipped++;
  }
  return { cues, skipped, truncated: false };
}

/** WebVTT: a header, then cues, notes, styles and regions separated by blank lines. */
function vttCues(text: string, limit: number): WrittenSubtitles {
  const all = blocks(lines(text));
  const header = all[0]?.[0] ?? '';
  const titled = /^WEBVTT[ \t]+(.+)$/.exec(header);
  const cues: WrittenCue[] = [];
  let skipped = 0;
  for (const [position, block] of all.entries()) {
    if (position === 0 && header.startsWith('WEBVTT')) continue;
    const opening = block[0]!;
    if (/^(?:NOTE|STYLE|REGION)(?:[ \t]|$)/.test(opening) && !opening.includes('-->')) continue;
    const at = opening.includes('-->') ? 0 : 1;
    const match = timing.exec(block[at] ?? '');
    const times = match && timedCue(match);
    if (!match || !times) {
      skipped++;
      continue;
    }
    if (cues.length >= limit) return { title: titled?.[1], cues, skipped, truncated: true };
    const markup = block.slice(at + 1).join('\n');
    cues.push({
      id: at === 1 ? opening.trim() : undefined,
      ...times,
      markup,
      settings: match[3]!.trim() || undefined,
      speaker: /<v(?:\.[^\s>]+)*[ \t]+([^>]+)>/.exec(markup)?.[1]?.trim(),
    });
  }
  return { title: titled?.[1]?.trim(), cues, skipped, truncated: false };
}

const assDefaultFields = [
  'layer',
  'start',
  'end',
  'style',
  'name',
  'marginl',
  'marginr',
  'marginv',
  'effect',
  'text',
];

/** SubStation Alpha: `Dialogue:` lines in [Events], fields named by its `Format:` line. */
function assCues(text: string, limit: number): WrittenSubtitles {
  const cues: WrittenCue[] = [];
  let section = '';
  let fields = assDefaultFields;
  let title: string | undefined;
  let skipped = 0;
  let truncated = false;
  for (const line of lines(text)) {
    const heading = /^\s*\[(.+)\]\s*$/.exec(line);
    if (heading) {
      section = heading[1]!.trim().toLowerCase();
      continue;
    }
    const entry = /^\s*([^:;!][^:]*):\s?(.*)$/.exec(line);
    if (!entry) continue;
    const key = entry[1]!.trim().toLowerCase();
    if (section === 'script info' && key === 'title') title = entry[2]!.trim() || undefined;
    if (section !== 'events') continue;
    if (key === 'format') {
      fields = entry[2]!.split(',').map((field) => field.trim().toLowerCase());
      continue;
    }
    if (key !== 'dialogue') continue;
    // the text is the last field, and may itself contain commas
    const values = entry[2]!.split(',');
    const named = new Map(
      fields.map((field, index) => [
        field,
        index === fields.length - 1 ? values.slice(index).join(',') : (values[index] ?? ''),
      ]),
    );
    const start = subtitleTime(named.get('start') ?? '');
    const end = subtitleTime(named.get('end') ?? '');
    if (start === undefined || end === undefined || values.length < fields.length) {
      skipped++;
      continue;
    }
    if (cues.length >= limit) {
      truncated = true;
      break;
    }
    cues.push({
      start,
      end,
      markup: named.get('text') ?? '',
      style: named.get('style')?.trim() || undefined,
      speaker: named.get('name')?.trim() || undefined,
    });
  }
  // events may be written in any order; a stable sort keeps simultaneous lines as written
  cues.sort((a, b) => a.start - b.start);
  return { title, cues, skipped, truncated };
}

function writtenCues(text: string, format: SubtitleFormat, limit: number): WrittenSubtitles {
  switch (format) {
    case 'srt':
      return srtCues(text, limit);
    case 'vtt':
      return vttCues(text, limit);
    case 'ass':
      return assCues(text, limit);
  }
}

const entities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  lrm: '‎',
  rlm: '‏',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith('#')) {
      const code =
        name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return Object.hasOwn(entities, name.toLowerCase()) ? entities[name.toLowerCase()]! : entity;
  });
}

const escapeCueText = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A cue's text and placement once ASS override blocks are read. */
interface CueRendering {
  plain: string;
  vtt: string;
  /** `\an7` to `\an9` place a line at the top. */
  top: boolean;
}

type StyleTag = 'b' | 'i' | 'u';
const styleTags: readonly StyleTag[] = ['b', 'i', 'u'];

/**
 * ASS text: `{\...}` override blocks hold styling, `\N` is a line break, `\n` a space (a break
 * only under wrap style 2) and `\h` a non-breaking space. `\p1` to `\p0` enclose vector
 * drawings, which are not text. Bold, italic and underline carry over to WebVTT; other overrides
 * are dropped.
 */
function renderASS(markup: string): CueRendering {
  const state: Record<StyleTag, boolean> = { b: false, i: false, u: false };
  let open: StyleTag[] = [];
  let plain = '';
  let vtt = '';
  let drawing = false;
  let top = false;
  const sync = () => {
    const wanted = styleTags.filter((tag) => state[tag]);
    if (wanted.join() === open.join()) return;
    for (const tag of [...open].reverse()) vtt += `</${tag}>`;
    for (const tag of wanted) vtt += `<${tag}>`;
    open = wanted;
  };
  for (const part of markup.split(/(\{[^}]*\})/)) {
    if (part.startsWith('{') && part.endsWith('}')) {
      const tags = /\\(?:(r)|([biu])(\d+)|an([1-9])|p(\d+))/g;
      for (const tag of part.matchAll(tags)) {
        if (tag[1]) {
          for (const name of styleTags) state[name] = false;
        } else if (tag[2]) state[tag[2] as StyleTag] = Number(tag[3]) > 0;
        else if (tag[4]) top = Number(tag[4]) >= 7;
        else if (tag[5]) drawing = Number(tag[5]) > 0;
      }
      continue;
    }
    if (drawing || !part) continue;
    const text = part.replace(/\\N/g, '\n').replace(/\\n/g, ' ').replace(/\\h/g, ' ');
    plain += text;
    sync();
    vtt += escapeCueText(text);
  }
  for (const tag of [...open].reverse()) vtt += `</${tag}>`;
  return { plain, vtt, top };
}

/** SubRip text: HTML-like `<i>`, `<b>`, `<u>` and `<font>` tags, and ASS-style `{\an8}`. */
function renderSRT(markup: string): CueRendering {
  let plain = '';
  let vtt = '';
  let top = false;
  for (const part of markup.split(/(<\/?[a-zA-Z][^>]*>|\{\\[^}]*\})/)) {
    const tag = /^<(\/?)([a-zA-Z]+)/.exec(part);
    if (tag && part.endsWith('>')) {
      const name = tag[2]!.toLowerCase();
      if (name === 'b' || name === 'i' || name === 'u') vtt += `<${tag[1]}${name}>`;
      continue;
    }
    if (part.startsWith('{\\') && part.endsWith('}')) {
      const position = /\\an([1-9])/.exec(part);
      if (position) top = Number(position[1]) >= 7;
      continue;
    }
    plain += part;
    vtt += escapeCueText(part);
  }
  return { plain, vtt, top };
}

function renderVTT(markup: string): CueRendering {
  return {
    plain: decodeEntities(markup.replace(/<[^>]*>/g, '')),
    vtt: markup,
    top: false,
  };
}

function render(cue: WrittenCue, format: SubtitleFormat): CueRendering {
  switch (format) {
    case 'srt':
      return renderSRT(cue.markup);
    case 'vtt':
      return renderVTT(cue.markup);
    case 'ass':
      return renderASS(cue.markup);
  }
}

export function parseSubtitles(
  text: string,
  format: SubtitleFormat,
  limits = subtitleLimits,
): Subtitles {
  const written = writtenCues(text, format, limits.cues);
  let duration = 0;
  const cues = written.cues.map((cue, position): SubtitleCue => {
    duration = Math.max(duration, cue.end);
    return {
      index: position + 1,
      id: cue.id,
      start: cue.start,
      end: cue.end,
      text: render(cue, format)
        .plain.split('\n')
        .map((line) => line.trim())
        .join('\n')
        .trim(),
      settings: cue.settings,
      style: cue.style,
      speaker: cue.speaker,
    };
  });
  return {
    format,
    title: written.title,
    cues,
    duration,
    skipped: written.skipped,
    truncated: written.truncated,
  };
}

/** A blank line would end a WebVTT cue early, and `-->` would read as a timing line. */
function cuePayload(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim())
    .join('\n')
    .replace(/-->/g, '--&gt;');
}

export interface SubtitleTrack {
  vtt: string;
  cues: number;
  /** Cues beyond the limit were left out. */
  truncated: boolean;
}

/** WebVTT for a sidecar track. WebVTT input is returned as written, line breaks normalized. */
export function subtitlesToVTT(text: string, format: SubtitleFormat): string {
  return subtitleTrack(text, format).vtt;
}

/** WebVTT for a media player's track, and the cues it holds within the limit. */
export function subtitleTrack(
  text: string,
  format: SubtitleFormat,
  limits = subtitleLimits,
): SubtitleTrack {
  const normalized = lines(text).join('\n');
  const written = writtenCues(text, format, limits.cues);
  if (format === 'vtt' && !written.truncated && /^WEBVTT(?:[ \t\n]|$)/.test(normalized))
    return {
      vtt: normalized.endsWith('\n') ? normalized : normalized + '\n',
      cues: written.cues.length,
      truncated: false,
    };
  const output = ['WEBVTT'];
  for (const cue of written.cues) {
    const rendering = render(cue, format);
    const payload = cuePayload(rendering.vtt);
    if (!payload) continue;
    const settings = [cue.settings, rendering.top ? 'line:0' : undefined].filter(Boolean).join(' ');
    const times = `${formatSubtitleTime(cue.start)} --> ${formatSubtitleTime(cue.end)}`;
    const identifier = cue.id && !cue.id.includes('-->') ? cue.id : undefined;
    output.push(
      [identifier, settings ? `${times} ${settings}` : times, payload]
        .filter((line) => line !== undefined)
        .join('\n'),
    );
  }
  return {
    vtt: output.join('\n\n') + '\n',
    cues: output.length - 1,
    truncated: written.truncated,
  };
}
