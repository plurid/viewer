import { boundedText, withoutControls } from './text';
import { bundleRelativePath, reportPath } from './report-failure';
import { redactCredentials } from './secrets';

export type ReportPrivateKind =
  | 'home'
  | 'short name'
  | 'full name'
  | 'computer name'
  | 'local host name'
  | 'Bonjour name'
  | 'volume name'
  | 'application bundle'
  | 'application data';

export interface ReportPrivateValue {
  kind: ReportPrivateKind;
  value: string | undefined;
}

const fixedDataFolders = new Set([
  'Logs',
  'window-states',
  'terminal-launches',
  'journal',
  'checkpoints',
  'optimization-candidates',
  'speech-private',
  'chat-documents',
  'text-buffers',
  'lenses',
  'notes',
  'workspaces',
]);
const extensions = new Set([
  'pdf',
  'txt',
  'md',
  'json',
  'jsonc',
  'log',
  'js',
  'cjs',
  'mjs',
  'ts',
  'tsx',
  'jsx',
  'map',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'heic',
  'tiff',
  'mp4',
  'mov',
  'm4v',
  'mp3',
  'wav',
  'flac',
  'zip',
  'tar',
  'gz',
  'csv',
  'xlsx',
  'docx',
  'pptx',
  'html',
  'xml',
]);

function decoded(value: string): string {
  let result = value
    .replace(/\\u([\da-f]{4})/gi, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\\//g, '/');
  for (let pass = 0; pass < 3; pass++) {
    const next = result.replace(/(?:%[\da-f]{2})+/gi, (part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
    if (next === result) break;
    result = next;
  }
  return withoutControls(result).normalize('NFC').replace(/[’‘]/g, "'");
}

function pathRoot(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/\/\.(?=\/)/g, '')
    .replace(/^\/(?:private\/)?System\/Volumes\/Data(?=\/)/i, '')
    .replace(/^\/private(?=\/)/i, '')
    .replace(/\/+$/, '');
}

function pathSummary(value: string, homes: readonly string[]): string {
  const normalized = pathRoot(value);
  const home = homes.find(
    (root) =>
      normalized.toLowerCase().startsWith(root.toLowerCase() + '/') ||
      normalized.toLowerCase() === root.toLowerCase(),
  );
  const base = home ? normalized.slice(home.length) : normalized.replace(/^~[^/]*/, '');
  const components = base.split('/').filter(Boolean);
  const last = components.at(-1) ?? '';
  const extension = /\.([a-z0-9]{1,10})$/i.exec(last)?.[1];
  const suffix = extension && extensions.has(extension.toLowerCase()) ? '.' + extension : '';
  const prefix =
    home || normalized.startsWith('~')
      ? '~'
      : normalized.startsWith('/Volumes/')
        ? '/Volumes/<volume>'
        : '<path>';
  return (
    prefix +
    components.map((_, index) => '/…' + (index === components.length - 1 ? suffix : '')).join('')
  );
}

function folded(value: string): string {
  return value.normalize('NFKD').toUpperCase().toLowerCase().replace(/\p{M}/gu, '');
}

function addressWord(word: string): boolean {
  const value = word.replace(/^[([{<]+|[)\]}>.,!]+$/g, '');
  const withoutZone = value.replace(/%[^\]]*/, '');
  return (
    /@|\(at\)|&#64;|[?#]/i.test(value) ||
    /^(?:[\p{L}\p{N}_-]+\.)+[\p{L}\p{N}_-]+(?::\d{1,5})?(?:\/.*)?$/u.test(value) ||
    /^(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?$/.test(value) ||
    /^[\p{L}\p{N}_-]+:\d{1,5}$/u.test(value) ||
    /^ip-\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3}$/i.test(value) ||
    /^[a-f0-9]{2}(?:[:-][a-f0-9]{2}){5}$/i.test(value) ||
    (withoutZone.length <= 128 && (withoutZone.match(/:/g)?.length ?? 0) >= 2 &&
      /^[a-f0-9:.[\]]+$/i.test(withoutZone))
  );
}

function opaqueWord(word: string): boolean {
  return /^[a-f\d]{20,}$/i.test(word) ||
    /^[A-Za-z\d+/]{12,}={1,2}$/.test(word) ||
    (word.length >= 32 && /^[A-Za-z\d_+/=.-]+$/.test(word));
}

/** Best-effort excerpts are explicitly optional. Bound input before normalization or scanning. */
export function redactReport(text: string, privateValues: readonly ReportPrivateValue[]): string {
  const unchecked = privateValues.filter((item) => !item.value?.trim());
  if (unchecked.length)
    return '[Text omitted: ' + [...new Set(unchecked.map((item) => item.kind))].join(', ') +
      ' could not be checked.]';
  if (privateValues.length > 256 || privateValues.some((item) => item.value!.length > 4096))
    return '[Text omitted: privacy checks exceeded their limits.]';
  try {
    const values = privateValues.map((item) => ({ ...item, value: decoded(item.value!) }));
    const roots = (kind: ReportPrivateKind) => values.filter((item) => item.kind === kind)
      .map((item) => pathRoot(item.value)).toSorted((a, b) => b.length - a.length);
    const homes = roots('home').flatMap((home) => [home, home.replace(/ /g, '+'), home.replace(/ /g, '-'), home.replace(/ /g, '_')])
      .toSorted((a, b) => b.length - a.length);
    const bundles = roots('application bundle');
    const dataRoots = roots('application data');
    const volumeRoots = roots('volume name').map((name) => '/Volumes/' + name);
    const knownRoots = [...bundles, ...dataRoots, ...homes, ...volumeRoots].flatMap((root) => [
      root, '/private' + root, '/System/Volumes/Data' + root, '/private/System/Volumes/Data' + root,
    ]).toSorted((a, b) => b.length - a.length);
    const aliases: string[] = [];
    const shortNames = values.filter((item) => item.kind === 'short name').map((item) => item.value);
    for (const item of values) {
      if (['home', 'application bundle', 'application data'].includes(item.kind)) continue;
      aliases.push(item.value);
      if (item.kind === 'full name') aliases.push(...item.value.split(/\s+/));
      if (['computer name', 'local host name', 'Bonjour name', 'full name'].includes(item.kind)) {
        const label = item.value.split('.')[0]!;
        for (const plain of [label, label.replace(/'/g, '')]) {
          const parts = plain.split(/[\s_-]+/);
          aliases.push(parts.join(' '), parts.join('-'), parts.join('_'), parts.join(''));
          if (item.kind !== 'full name')
            aliases.push(plain.slice(0, 15), parts.join('').slice(0, 15), parts.join('-').slice(0, 15));
        }
      }
    }
    for (const name of shortNames)
      for (const suffix of ['mac', 'macbook', 'macbookpro', 'macbookair', 'imac', 'computer', 'pc'])
        aliases.push(name + suffix, name + 's' + suffix);
    const escape = (value: string) => value.replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&');
    const names = [...new Set(aliases.map(folded).filter(Boolean))].toSorted((a, b) => b.length - a.length);
    const namePattern = names.length ? new RegExp(
      '(?<![\\p{L}\\p{M}])(?:' + names.map(escape).join('|') + ')(?![\\p{L}\\p{M}])', 'gu',
    ) : undefined;
    const redactNames = (source: string) => {
      if (!namePattern) return source;
      let view = '';
      const starts: number[] = [];
      const ends: number[] = [];
      let offset = 0;
      for (const character of source) {
        const normalized = folded(character);
        for (let index = 0; index < normalized.length; index++) {
          starts.push(offset);
          ends.push(offset + character.length);
        }
        view += normalized;
        offset += character.length;
      }
      let result = '';
      let end = 0;
      for (const match of view.matchAll(namePattern)) {
        const start = starts[match.index]!;
        result += source.slice(end, start) + '<private>';
        end = ends[match.index + match[0].length - 1]!;
      }
      return result + source.slice(end);
    };
    const mangledRoots = homes.flatMap((home) => {
      const parts = folded(home).split('/').filter(Boolean);
      return [parts.join('-'), parts.join('_')];
    });
    const mangled = (word: string) => {
      const value = folded(word).replace(/^[-_]/, '');
      return mangledRoots.some((root) => value === root || value.startsWith(root + '-') || value.startsWith(root + '_'));
    };
    const bundlePath = (relative: string) => '<Viewer>/' + relative.split('/').map((part) => {
      if (opaqueWord(part) || part.includes('[redacted]')) return '<token>';
      if (addressWord(part) && !/\.(?:asar|cjs|js|mjs|css|map|html|node|wasm|png|svg|json)$/i.test(part)) return '<address>';
      return redactNames(part);
    }).join('/');
    const summarizePath = (raw: string) => {
      const normalized = pathRoot(raw).replace(/^~[^/]*/, '~');
      const candidates = normalized.startsWith('~/') ? homes.map((home) => home + normalized.slice(1)) : [normalized];
      for (const bundle of bundles) {
        const relative = candidates.map((candidate) => bundleRelativePath(candidate, bundle)).find(Boolean);
        if (relative) return bundlePath(relative);
      }
      for (const root of dataRoots) {
        const canonical = candidates.map(reportPath).find((value) => value?.startsWith(root + '/'));
        if (!canonical) continue;
        const relative = canonical.slice(root.length + 1).split('/');
        const first = relative[0]!;
        const summary = pathSummary('/' + relative.join('/'), []);
        return '<Viewer data>/' + (relative.length > 1 && fixedDataFolders.has(first) ? first : '…') +
          (relative.length > 1 ? summary.slice('<path>'.length).split('/').slice(1).slice(1).map((part) => '/' + part).join('') : '');
      }
      if (normalized.startsWith('/Volumes/')) {
        const mounted = volumeRoots.find((root) => normalized === root || normalized.startsWith(root + '/'));
        const suffix = normalized.slice(mounted?.length ?? normalized.indexOf('/', '/Volumes/'.length));
        return '/Volumes/<volume>' + (suffix.startsWith('/') ? pathSummary(suffix, []).slice('<path>'.length) : '');
      }
      return pathSummary(normalized, homes);
    };

    return boundedText(text).split(/\n(?=[ \t]{0,16}at )/).map((part) => {
      let source = decoded(part).replace(/\\(?= )/g, '').replace(/\\/g, '/')
        .replace(/\x24(?:HOME\b|\{HOME\})/g, '~')
        .replace(/\/\.(?=\/)/g, '')
        .replace(/\bfile:\/{1,3}(?:localhost\/)?/gi, '/')
        .replace(/\/{2,}/g, '/');
      if (/:Users:/i.test(source)) return '~/<path>';
      source = redactCredentials(source);
      let result = '';
      for (let index = 0; index < source.length;) {
        const tail = source.slice(index);
        if (/^data:/i.test(tail)) {
          result += '<data>';
          break;
        }
        if (/^[A-Za-z][A-Za-z0-9+.-]{0,24}:\//.test(tail)) {
          result += '<address>';
          break;
        }
        if (tail.startsWith('<Viewer>/')) {
          const end = source.indexOf(' ', index);
          const stop = end < 0 ? source.length : end;
          result += bundlePath(source.slice(index + '<Viewer>/'.length, stop));
          index = stop;
          continue;
        }
        const character = source[index]!;
        if (/['"\x60«“‘]/.test(character) && (index === 0 || !/[\p{L}\p{N}]/u.test(source[index - 1]!))) {
          const closing = character === '«' ? '»' : character === '“' ? '”' : character === '‘' ? '’' : character;
          let end = index + 1;
          while (end < source.length) {
            if (source[end] === closing && !(/[\p{L}]/u.test(source[end - 1]!) && /[\p{L}]/u.test(source[end + 1] ?? ''))) break;
            end++;
          }
          const quoted = source.slice(index + 1, end);
          result += /[/~]/.test(quoted) ? summarizePath(quoted) : '<quoted text>';
          index = Math.min(source.length, end + 1);
          continue;
        }
        const drive = /^[A-Za-z]:\//.test(tail.slice(0, 3));
        if (character === '/' || character === '~' || drive) {
          const known = knownRoots.find((root) => tail.toLowerCase().startsWith(root.toLowerCase()) &&
            !/[\p{L}\p{M}]/u.test(tail[root.length] ?? ''));
          let end = index + (known?.length ?? 0);
          while (end < source.length && !/\s|['"\x60«»“”‘’]/.test(source[end]!)) end++;
          let raw = source.slice(index, end).replace(/:\d+(?::\d+)?\)?$/, '');
          if (drive) raw = raw.slice(2);
          result += summarizePath(raw);
          // A space may be part of an unquoted name. Its ambiguous suffix cannot be shared.
          index = end < source.length && /\s/.test(source[end]!) ? source.length : end;
          continue;
        }
        if (/\s/.test(character)) {
          result += character;
          index++;
          continue;
        }
        // Consume each whitespace-delimited word once, including its address punctuation.
        const nonspace = /^\S+/.exec(tail)![0];
        const whole = nonspace.replace(/["'»”’]+$/, '');
        if (/%[a-f\d]{2}/i.test(whole)) {
          result += '[Encoded text omitted]';
          index += nonspace.length;
          continue;
        }
        if (addressWord(whole) || opaqueWord(whole) || mangled(whole)) {
          result += addressWord(whole) ? '<address>' : '<token>';
          index += nonspace.length;
          continue;
        }
        const embedded = nonspace.search(/[/~]/);
        if (embedded > 0 && !/[\p{L}\p{N}]/u.test(nonspace[embedded - 1]!)) {
          result += nonspace.slice(0, embedded);
          index += embedded;
          continue;
        }
        if (embedded >= 0) {
          result += summarizePath(nonspace);
          index = source.length;
        } else {
          result += nonspace;
          index += nonspace.length;
        }
      }
      return redactNames(result);
    }).join('\n');
  } catch {
    return '[Text omitted: privacy checks could not be completed.]';
  }
}
