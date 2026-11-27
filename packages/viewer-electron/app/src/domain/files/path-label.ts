import { displayLocation, hasRemoteLocationScheme, parseRemoteLocation } from '../remote/location';
import type { RemoteDisplayConnection } from '../remote/location';
import { pathAncestry, relativePathLabel } from './paths';

/** The separator a path is written with: Windows paths keep their backslashes. */
export type PathSeparator = '/' | '\\';

/**
 * A path as a label shows it: where it starts (`~` for the home folder, a root such as `/`, `C:\`
 * or `\\server\share`, a server as `al@build:~`, or the folder that tells two items apart) and the
 * names after it, the last being the item itself.
 */
export interface PathLabelParts {
  anchor: string;
  separator: PathSeparator;
  names: readonly string[];
}

/** A server connection as people name it; its starting folder shows as `~`. */
export interface RemoteLabel extends RemoteDisplayConnection {
  home?: string;
}

/** Finds a server connection's name by its connection ID. */
export type RemoteLabels = (connectionID: string) => RemoteLabel | undefined;

export interface PathLabelOptions {
  remote?: RemoteLabels;
  /**
   * The folder the label is read against, such as the folder a group of copies shares: the label
   * starts at the folder that tells the item apart (`Job 1042/…/part.dxf`). A base that is a root
   * or holds home (`/`, `/Users`) is ignored: `~` and the root read better (`sharedFolder`).
   */
  base?: string;
}

/** Measures a text as the label would show it, in pixels. */
export type TextMeasure = (text: string) => number;

const ellipsis = '…';
const windowsPath = /^[A-Za-z]:[\\/]|^\\\\/;
/** Only a short tail without spaces is an extension: "Release 1.0 notes" has none. */
const extensionTail = /\.[A-Za-z0-9]{1,8}$/;
/** Hebrew, Arabic and the other right-to-left scripts, with their presentation forms. */
const rightToLeft =
  /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;
/** Where a server location starts before its connection is known. */
const unknownServer = 'server:';

function remoteParts(path: string, remote: RemoteLabels | undefined): PathLabelParts {
  try {
    const location = parseRemoteLocation(path);
    const known = remote?.(location.connectionID);
    const names = location.path.split('/').filter(Boolean);
    if (!known) return { anchor: unknownServer + '/', separator: '/', names };
    const server = (known.user ? known.user + '@' : '') + known.host + ':';
    const relative = known.home ? relativePathLabel(known.home, location.path) : location.path;
    if (relative === '.') return { anchor: server + '~', separator: '/', names: [] };
    if (relative !== location.path && !/^\.\.(?:\/|$)/.test(relative))
      return { anchor: server + '~', separator: '/', names: relative.split('/').filter(Boolean) };
    return { anchor: server + '/', separator: '/', names };
  } catch {
    return { anchor: '', separator: '/', names: [path] };
  }
}

/** Display only: navigation keeps the absolute path, and copying copies `pathCopyText`. */
export function pathLabelParts(
  path: string,
  home: string,
  options: PathLabelOptions = {},
): PathLabelParts {
  if (hasRemoteLocationScheme(path)) return remoteParts(path, options.remote);
  const windows = windowsPath.test(path);
  const separator: PathSeparator = windows ? '\\' : '/';
  // A backslash is an ordinary character in a POSIX name.
  const split = (value: string) => value.split(windows ? /[\\/]/ : /\//).filter(Boolean);
  const inside = (folder: string) => within(folder, path);
  const fromBase =
    options.base && usableBase(options.base, home) ? inside(options.base) : undefined;
  if (fromBase && fromBase !== '.') {
    const names = split(fromBase);
    return { anchor: names[0]!, separator, names: names.slice(1) };
  }
  const fromHome = home ? inside(home) : undefined;
  if (fromHome === '.') return { anchor: '~', separator, names: [] };
  if (fromHome) return { anchor: '~', separator, names: split(fromHome) };
  const root =
    path.match(windows ? /^(?:[A-Za-z]:[\\/]?|[\\/]{2}[^\\/]+[\\/][^\\/]+)/ : /^\//)?.[0] ?? '';
  return { anchor: root, separator, names: split(path.slice(root.length)) };
}

/** `path` read from `folder` (`.` for the folder itself), or nothing when it is outside it. */
function within(folder: string, path: string): string | undefined {
  const relative = relativePathLabel(folder, path);
  return relative !== path && !/^\.\.(?:[\\/]|$)/.test(relative) ? relative : undefined;
}

/**
 * Whether labels can be read from `base`: home or a folder inside it, or a folder elsewhere that
 * is not a root and does not hold home. From `/` or `/Users`, copies at home and on a backup
 * volume would read `Users/al/…` and `Volumes/Backup/…`.
 */
function usableBase(base: string, home: string): boolean {
  if (home && within(home, base) !== undefined) return true;
  if (home && within(base, home) !== undefined) return false;
  return pathAncestry(base).length > 1;
}

/** The folder `paths` share when labels can be read from it (`usableBase`), or nothing. */
export function sharedFolder(paths: readonly string[], home: string): string {
  const folder = commonFolder(paths);
  return folder && usableBase(folder, home) ? folder : '';
}

/** A right-to-left name keeps its own direction without reordering the names around it. */
function isolate(name: string): string {
  return rightToLeft.test(name) ? '\u2068' + name + '\u2069' : name;
}

/**
 * The label keeping the last `kept` names, with `…` standing for the ones left out; `leaf`
 * replaces the item's own name when it has to lose its middle.
 */
export function pathLabelText(
  parts: PathLabelParts,
  kept = parts.names.length,
  leaf?: string,
): string {
  const { anchor, separator, names } = parts;
  const shown = names.slice(Math.max(0, names.length - Math.max(1, kept))).map(isolate);
  if (leaf !== undefined && shown.length) shown[shown.length - 1] = isolate(leaf);
  const body = (shown.length < names.length ? [ellipsis, ...shown] : shown).join(separator);
  const start = isolate(anchor);
  if (!body) return start;
  if (!start) return body;
  return /[\\/]$/.test(anchor) ? start + body : start + separator + body;
}

/** An editable local path keeps literal characters, including names in right-to-left scripts. */
export function pathInputText(path: string, home: string): string {
  if (!home || hasRemoteLocationScheme(path)) return path;
  const relative = within(home, path);
  return relative === '.' ? '~' : relative === undefined ? path : '~/' + relative;
}

/** The whole path as a sentence or a choice names it, with home as `~`. */
export function pathText(path: string, home: string, options: PathLabelOptions = {}): string {
  return pathLabelText(pathLabelParts(path, home, options));
}

/**
 * A server location as people type it (`al@build:/home/al/Jobs`) once its connection is known;
 * the location itself before that, so a copy is never a made-up address.
 */
export function pathCopyText(path: string, remote?: RemoteLabels): string {
  if (!hasRemoteLocationScheme(path)) return path;
  try {
    const known = remote?.(parseRemoteLocation(path).connectionID);
    return known ? displayLocation(path, known) : path;
  } catch {
    return path;
  }
}

/** The whole path for a tooltip or a screen reader: as copied, or `server:/path` until known. */
export function pathWholeText(path: string, remote?: RemoteLabels): string {
  if (!hasRemoteLocationScheme(path)) return path;
  try {
    const location = parseRemoteLocation(path);
    const known = remote?.(location.connectionID);
    return known ? displayLocation(path, known) : unknownServer + location.path;
  } catch {
    return path;
  }
}

/**
 * The longest label that fits `room`: the whole path, then fewer names after the anchor, so the
 * item's own name stays; a name too long by itself loses its middle and keeps a short extension.
 * The result is never wider than `room`.
 */
export function fitPathLabel(parts: PathLabelParts, room: number, measure: TextMeasure): string {
  const count = parts.names.length;
  const fits = (text: string) => measure(text) <= room;
  const whole = pathLabelText(parts);
  if (fits(whole)) return whole;
  if (count && fits(pathLabelText(parts, 1))) {
    let low = 1;
    let high = count - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fits(pathLabelText(parts, middle))) low = middle;
      else high = middle - 1;
    }
    return pathLabelText(parts, low);
  }
  const name = count ? parts.names[count - 1]! : parts.anchor;
  const shortened = (compose: (text: string) => string) => {
    const text = compose(middleName(name, (candidate) => fits(compose(candidate))));
    return fits(text) ? text : undefined;
  };
  return (
    (count ? shortened((text) => pathLabelText(parts, 1, text)) : undefined) ??
    shortened(isolate) ??
    (fits(ellipsis) ? ellipsis : '')
  );
}

/** A name's user-perceived characters: an accent or an emoji is never split. */
function graphemes(text: string): string[] {
  if (typeof Intl.Segmenter !== 'function') return Array.from(text);
  return Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
    (part) => part.segment,
  );
}

/**
 * A name losing its middle until it fits, keeping its extension and the end of its stem. A dot
 * file or a dot inside words has no extension. When even `…` with the extension is too wide, the
 * extension goes too.
 */
export function middleName(
  name: string,
  fits: (text: string) => boolean,
  extension = name.slice(1).match(extensionTail)?.[0] ?? '',
): string {
  if (fits(name)) return name;
  const shorten = (stem: readonly string[], end: string) => (count: number) => {
    const start = Math.ceil(count * 0.6);
    const kept = count - start;
    return (
      stem.slice(0, start).join('') + ellipsis + (kept ? stem.slice(-kept).join('') : '') + end
    );
  };
  const longest = (make: (count: number) => string, total: number) => {
    let low = 0;
    let high = Math.max(0, total - 1);
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fits(make(middle))) low = middle;
      else high = middle - 1;
    }
    return make(low);
  };
  const stem = graphemes(extension ? name.slice(0, -extension.length) : name);
  const withExtension = longest(shorten(stem, extension), stem.length);
  if (fits(withExtension) || !extension) return withExtension;
  const whole = graphemes(name);
  return longest(shorten(whole, ''), whole.length);
}

/** The two measured lines of a tile name. An automatic line clamp could cut its extension. */
export function twoLineName(name: string, width: number, measure: TextMeasure): string {
  const whole = name.replace(/[\n\r\t]/g, ' ');
  const suffix = whole.slice(1).match(/\.[A-Za-z0-9]+$/)?.[0] ?? '';
  const keepTogether = suffix.length > 0 && measure(suffix) <= width;
  const split = (text: string): string | undefined => {
    if (measure(text) <= width) return text;
    const characters = graphemes(text);
    let low = 0;
    let high = characters.length - (keepTogether && text.endsWith(suffix) ? suffix.length : 1);
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (measure(characters.slice(0, middle).join('')) <= width) low = middle;
      else high = middle - 1;
    }
    if (!low) return;
    const first = characters.slice(0, low).join('');
    if (measure(text.slice(first.length)) > width) return;
    const space = first.lastIndexOf(' ') + 1;
    const end = space && measure(text.slice(space)) <= width ? space : first.length;
    return text.slice(0, end) + '\n' + text.slice(end);
  };
  const shown = middleName(whole, (text) => split(text) !== undefined, suffix);
  return split(shown) ?? shown;
}

/** The deepest folder that holds every one of `paths`, or nothing when they share none. */
export function commonFolder(paths: readonly string[]): string {
  const chains = paths.map((path) => pathAncestry(path).slice(0, -1));
  const first = chains[0] ?? [];
  let index = -1;
  while (index + 1 < first.length && chains.every((chain) => chain[index + 1] === first[index + 1]))
    index++;
  return index < 0 ? '' : first[index]!;
}

/**
 * A message's paths with home as `~`, quoted ones too (`open '~/Private/a.txt'`): a sentence cannot
 * drop names from a path, but it need not spell out the home folder. Not for a command line a
 * person may run: a shell expands `~` only at the start of an unquoted word.
 */
export function homeText(text: string, home: string): string {
  const base = home.replace(/[\\/]+$/, '');
  if (!base) return text;
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const flags = windowsPath.test(base) ? 'gi' : 'g';
  return text.replace(
    new RegExp(
      `(?<![\\w.\\-/\\\\])${escaped}(?=[\\\\/]|$|[\\s"'\u201d\u2019),:;\\]}>]|[.!?](?:\\s|$))`,
      flags,
    ),
    '~',
  );
}
