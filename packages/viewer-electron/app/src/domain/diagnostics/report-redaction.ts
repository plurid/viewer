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
  'Logs', 'window-states', 'terminal-launches', 'journal', 'checkpoints', 'optimization-candidates',
  'speech-private', 'chat-documents', 'text-buffers', 'lenses', 'notes', 'workspaces',
]);
const extensions = new Set([
  'pdf', 'txt', 'md', 'json', 'jsonc', 'log', 'js', 'cjs', 'mjs', 'ts', 'tsx', 'jsx', 'map',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic', 'tiff', 'mp4', 'mov', 'm4v', 'mp3',
  'wav', 'flac', 'zip', 'tar', 'gz', 'csv', 'xlsx', 'docx', 'pptx', 'html', 'xml',
]);

function decoded(value: string): string {
  let result = value.replace(/\\u([\da-f]{4})/gi, (_match, hex: string) =>
    String.fromCharCode(parseInt(hex, 16))).replace(/\\\//g, '/');
  for (let pass = 0; pass < 3; pass++) {
    const next = result.replace(/(?:%[\da-f]{2})+/gi, (part) => {
      try { return decodeURIComponent(part); } catch { return part; }
    });
    if (next === result) break;
    result = next;
  }
  return withoutControls(result).normalize('NFC').replace(/[’‘]/g, "'");
}

function pathRoot(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/\.(?=\/)/g, '')
    .replace(/^\/(?:private\/)?System\/Volumes\/Data(?=\/)/i, '')
    .replace(/^\/private(?=\/)/i, '').replace(/\/+$/, '');
}

function pathSummary(value: string, homes: readonly string[]): string {
  const normalized = pathRoot(value);
  const home = homes.find((root) => normalized.toLowerCase().startsWith(root.toLowerCase() + '/') ||
    normalized.toLowerCase() === root.toLowerCase());
  const base = home ? normalized.slice(home.length) : normalized.replace(/^~[^/]*/, '');
  const components = base.split('/').filter(Boolean);
  const last = components.at(-1) ?? '';
  const extension = /\.([a-z0-9]{1,10})$/i.exec(last)?.[1];
  const suffix = extension && extensions.has(extension.toLowerCase()) ? '.' + extension : '';
  const prefix = home || normalized.startsWith('~') ? '~' : normalized.startsWith('/Volumes/') ? '/Volumes/<volume>' : '<path>';
  return prefix + components.map((_, index) => '/…' + (index === components.length - 1 ? suffix : '')).join('');
}

function addressWord(word: string, stack: boolean): boolean {
  const trimmed = word.replace(/[.:!?]+$/, '');
  return word.includes('@') || word.includes('://') || word.includes('?') || word.includes('#') ||
    /^[a-f0-9]{2}(?::[a-f0-9]{2}){5}$/i.test(trimmed) ||
    (!stack && /^(?:[\p{L}\p{N}_-]+\.)+[\p{L}\p{N}_-]+$/u.test(trimmed)) ||
    (word.length <= 128 && word.includes('::') && /^[a-f0-9:[\].]+$/i.test(trimmed.replace(/%[^\]]*\]?$/, '')));
}

/** Best-effort excerpts are explicitly optional. Bound input before any normalization or scan. */
export function redactReport(text: string, privateValues: readonly ReportPrivateValue[]): string {
  const unchecked = privateValues.filter((item) => !item.value?.trim());
  if (unchecked.length)
    return '[Text omitted: ' + [...new Set(unchecked.map((item) => item.kind))].join(', ') + ' could not be checked.]';
  if (privateValues.length > 256 || privateValues.some((item) => item.value!.length > 4096))
    return '[Text omitted: privacy checks exceeded their limits.]';
  try {
    const values = privateValues.map((item) => ({ ...item, value: decoded(item.value!) }));
    const homes = values.filter((item) => item.kind === 'home')
      .map((item) => pathRoot(item.value)).toSorted((a, b) => b.length - a.length);
    const bundles = values.filter((item) => item.kind === 'application bundle').map((item) => pathRoot(item.value));
    const dataRoots = values.filter((item) => item.kind === 'application data').map((item) => pathRoot(item.value));
    const escape = (value: string) => value.replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&');
    const rootAliases = homes.flatMap((home) => {
      const variants = [home, '/private' + home, '/System/Volumes/Data' + home, '/private/System/Volumes/Data' + home];
      return variants.flatMap((root) => [root, root.replace(/[ +_-]/g, '-'), root.replace(/[ +_-]/g, '_'), root.replace(/ /g, '+')]);
    });
    const homePattern = rootAliases.length ? new RegExp('(?:' + rootAliases.toSorted((a, b) => b.length - a.length).map(escape).join('|') + ')(?![\\p{L}\\p{M}])', 'giu') : undefined;
    const names = values.filter((item) => !['home', 'application bundle', 'application data'].includes(item.kind))
      .flatMap((item) => {
        const aliases = [item.value];
        if (item.kind === 'full name') aliases.push(...item.value.split(/\s+/), item.value.replace(/\s+/g, ''));
        if (['computer name', 'local host name', 'Bonjour name'].includes(item.kind)) {
          const label = item.value.split('.')[0]!;
          aliases.push(label, label + '.local', label.slice(0, 15),
            label.replace(/[^A-Za-z0-9-]/g, '').slice(0, 15),
            label.replace(/[^A-Za-z0-9-]/g, '-').slice(0, 15));
        }
        return aliases.filter(Boolean);
      });
    const namePattern = names.length ? new RegExp('(?<![\\p{L}\\p{M}])(?:' +
      [...new Set(names)].toSorted((a, b) => b.length - a.length).map(escape).join('|') +
      ')(?![\\p{L}\\p{M}])', 'giu') : undefined;

    const summarizePath = (raw: string) => {
      const normalized = pathRoot(raw);
      const candidates = normalized.startsWith('~/')
        ? homes.map((home) => home + normalized.slice(1)) : [normalized];
      for (const bundle of bundles) {
        const relative = candidates.map((candidate) => bundleRelativePath(candidate, bundle)).find(Boolean);
        if (relative) return '<Viewer>/' + relative;
      }
      for (const root of dataRoots) {
        const canonical = candidates.map(reportPath).find((value) => value?.startsWith(root + '/'));
        if (!canonical?.startsWith(root + '/')) continue;
        const relative = canonical.slice(root.length + 1).split('/');
        const first = relative[0]!;
        const suffix = pathSummary('/' + relative.join('/'), []);
        const hidden = suffix.slice('<path>'.length).split('/').slice(2).join('/');
        return '<Viewer data>/' + (relative.length > 1 && fixedDataFolders.has(first) ? first : '…') +
          (relative.length > 1 ? '/' + hidden : '');
      }
      return pathSummary(normalized, homes);
    };

    const output = boundedText(text).split(/\n(?=[ \t]{0,16}at )/).map((part) => {
      // Decode each original word first: an encoded URL path containing spaces is one address.
      let joined = '';
      let pathWord = false;
      for (const character of part) {
        if (character === '\n') joined += pathWord ? '' : ' ';
        else {
          joined += character;
          if (/\s/.test(character)) pathWord = false;
          else if (character === '/' || character === '\\') pathWord = true;
        }
      }
      joined = joined.replace(/\b(?:smb|afp|nfs|cifs):\/\/[\s\S]*/gi, '<address>');
      let source = joined.replace(/[^\s"'<>]+/gu, (word) => {
        const value = decoded(word);
        if (/%[a-f0-9]{2}/i.test(value)) return '[Encoded text omitted]';
        return /\b[a-z][a-z0-9+.-]{0,24}:\/\//i.test(value) && !/^file:/i.test(value)
          ? '<address>' : value;
      });
      source = decoded(source).replace(/\\(?= )/g, '').replace(/\\/g, '/')
        .replace(/\x24(?:HOME\b|\{HOME\})/g, '~');
      const stack = /^\s*at /.test(source);
      if (/:Users:/i.test(source)) return '~/<path>';
      source = source.replace(/\/{2,}/g, '/').replace(/\/\.(?=\/)/g, '');
      source = source.replace(/\bfile:\/(?:localhost\/)?/gi, '/')
        .replace(/\b[A-Za-z]:(?=\/)/g, '');
      source = redactCredentials(source);
      source = source.replace(/[^\s"'<>]+/gu, (word) => {
        if (addressWord(word, stack)) return '<address>';
        if (!stack && !word.startsWith('/') && !word.startsWith('~') &&
          word.length >= 32 && (!word.includes('/') || /[0-9]/.test(word)) &&
          /^[A-Za-z0-9_+/=.-]+$/.test(word)) return '<token>';
        return word;
      });
      if (homePattern) source = source.replace(homePattern, '~');
      if (namePattern) source = source.replace(namePattern, '<private>');
      const knownRoots = [...bundles, ...dataRoots].map((root) => homePattern ? root.replace(homePattern, '~') : root)
        .toSorted((a, b) => b.length - a.length);
      let result = '';
      for (let index = 0; index < source.length;) {
        const character = source[index]!;
        if (character === '"' || character === "'" || character === '\x60' || character === '“') {
          const closing = character === '“' ? '”' : character;
          const end = source.indexOf(closing, index + 1);
          const stop = end < 0 ? source.length : end;
          const quoted = source.slice(index + 1, stop);
          result += /[/\\]/.test(quoted) ? summarizePath(quoted) : '<quoted text>';
          index = end < 0 ? source.length : end + 1;
          continue;
        }
        const pathStart = (character === '/' || character === '~') &&
          (index === 0 || /[\s(=:]/.test(source[index - 1]!));
        const drive = /^[A-Za-z]:\//.test(source.slice(index, index + 3));
        if (pathStart || drive) {
          const known = knownRoots.find((root) => source.slice(index, index + root.length).toLowerCase() === root.toLowerCase() &&
            ['/', '', ' '].includes(source[index + root.length] ?? ''));
          let end = index + (known?.length ?? 0);
          while (end < source.length && !/[\s"'<>),;]/.test(source[end]!)) end++;
          let raw = source.slice(index, end).replace(/:\d+(?::\d+)?$/, '');
          if (drive) raw = raw.slice(2);
          result += summarizePath(raw);
          // Unquoted names can contain spaces. Withhold the ambiguous remainder.
          if (end < source.length && source[end] === ' ') index = source.length;
          else index = end;
          continue;
        }
        if (/\s/.test(character) || /[()<>,;]/.test(character)) {
          result += character;
          index++;
          continue;
        }
        let end = index + 1;
        while (end < source.length && !/[\s"'()<>,;]/.test(source[end]!)) end++;
        const word = source.slice(index, end);
        const trimmed = word.replace(/[.:!?]+$/, '');
        const address = word.includes('@') || word.includes('://') || word.includes('?') ||
          word.includes('#') || /^[a-f0-9]{2}(?::[a-f0-9]{2}){5}$/i.test(trimmed) ||
          (!stack && /^(?:[\p{L}\p{N}_-]+\.)+[\p{L}\p{N}_-]+$/u.test(trimmed)) ||
          (word.length <= 128 && word.includes('::') && /^[a-f0-9:[\].]+$/i.test(trimmed.replace(/%[^\]]*\]?$/, '')));
        if (address) result += '<address>';
        else if (word.length >= 32 && /^[A-Za-z0-9_+/=.-]+$/.test(word)) result += '<token>';
        else result += word;
        index = end;
      }
      if (homePattern) result = result.replace(homePattern, '~');
      if (namePattern) result = result.replace(namePattern, '<private>');
      return result;
    }).join('\n');
    return output;
  } catch {
    return '[Text omitted: privacy checks could not be completed.]';
  }
}
