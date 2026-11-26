import { boundedDiagnosticInput } from './license-key';
import { withoutControls } from './text';
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
const bundleCodeExtension =
  /\.(?:asar|cjs|js|mjs|ts|tsx|jsx|css|map|html|node|wasm|png|svg|json|jsonc)$/i;

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
  return result.normalize('NFC').replace(/[’‘]/g, "'");
}

function messageControls(value: string): string {
  // Names must be checked after normalization, while ordinary lines stay separate.
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\p{Cc}/gu, (character) => (character === '\n' ? character : ' '))
    .replace(/\p{Cf}/gu, '');
}

function internalApostrophe(value: string, index: number): boolean {
  return (
    value[index] === "'" &&
    /\p{L}$/u.test(value.slice(Math.max(0, index - 2), index)) &&
    /^\p{L}/u.test(value.slice(index + 1, index + 3))
  );
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
  if (
    /^\d{1,7}:\d{1,7}$/.test(value) ||
    /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?$/.test(value)
  )
    return false;
  const withoutZone = value.replace(/%[^\]]*/, '');
  return (
    /@|\(at\)|&#64;|[?#]/i.test(value) ||
    /^(?:[\p{L}\p{N}_-]+\.)+[\p{L}\p{N}_-]+(?::\d{1,5})?(?:\/.*)?$/u.test(value) ||
    /^(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?$/.test(value) ||
    /^[\p{L}\p{N}_-]+:\d{1,5}$/u.test(value) ||
    /^ip-\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3}$/i.test(value) ||
    /^[a-f0-9]{2}(?:[:-][a-f0-9]{2}){5}$/i.test(value) ||
    (withoutZone.length <= 128 &&
      (withoutZone.match(/:/g)?.length ?? 0) >= 2 &&
      /^[a-f0-9:.[\]]+$/i.test(withoutZone))
  );
}

function opaqueWord(word: string): boolean {
  return (
    /^[a-f\d]{20,}$/i.test(word) ||
    /^[A-Za-z\d+/]{12,}={1,2}$/.test(word) ||
    (word.length >= 32 && /^[A-Za-z\d_+/=.-]+$/.test(word))
  );
}

/** Best-effort excerpts are explicitly optional. Bound input before normalization or scanning. */
export function redactReport(text: string, privateValues: readonly ReportPrivateValue[]): string {
  const unchecked = privateValues.filter((item) => !item.value?.trim());
  if (unchecked.length)
    return (
      '[Text omitted: ' +
      [...new Set(unchecked.map((item) => item.kind))].join(', ') +
      ' could not be checked.]'
    );
  if (privateValues.length > 256 || privateValues.some((item) => item.value!.length > 4096))
    return '[Text omitted: privacy checks exceeded their limits.]';
  try {
    const values = privateValues.map((item) => ({
      ...item,
      value: withoutControls(decoded(item.value!)),
    }));
    const roots = (kind: ReportPrivateKind) =>
      values
        .filter((item) => item.kind === kind)
        .map((item) => pathRoot(item.value))
        .toSorted((a, b) => b.length - a.length);
    const homes = roots('home')
      .flatMap((home) => [
        home,
        home.replace(/ /g, '+'),
        home.replace(/ /g, '-'),
        home.replace(/ /g, '_'),
      ])
      .toSorted((a, b) => b.length - a.length);
    const bundles = roots('application bundle');
    const dataRoots = roots('application data');
    const volumeRoots = roots('volume name').map((name) => '/Volumes/' + name);
    const knownRoots = [...bundles, ...dataRoots, ...homes, ...volumeRoots]
      .flatMap((root) => [
        root,
        '/private' + root,
        '/System/Volumes/Data' + root,
        '/private/System/Volumes/Data' + root,
      ])
      .toSorted((a, b) => b.length - a.length);
    const aliases: string[] = [];
    const shortNames = values
      .filter((item) => item.kind === 'short name')
      .map((item) => item.value);
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
            aliases.push(
              plain.slice(0, 15),
              parts.join('').slice(0, 15),
              parts.join('-').slice(0, 15),
            );
        }
      }
    }
    for (const name of shortNames)
      for (const suffix of ['mac', 'macbook', 'macbookpro', 'macbookair', 'imac', 'computer', 'pc'])
        aliases.push(name + suffix, name + 's' + suffix);
    const escape = (value: string) => value.replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&');
    const names = [...new Set(aliases.map(folded).filter(Boolean))].toSorted(
      (a, b) => b.length - a.length,
    );
    // Separators inserted inside a known spelling must not expose it after normalization.
    const namePattern = names.length
      ? new RegExp(
          '(?<![\\p{L}\\p{M}])(?:' +
            names
              .map((name) =>
                name
                  .split(/ +/)
                  .map((part) => [...part].map(escape).join(' *'))
                  .join(' +'),
              )
              .join('|') +
            ')(?![\\p{L}\\p{M}])',
          'gu',
        )
      : undefined;
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
      return mangledRoots.some(
        (root) => value === root || value.startsWith(root + '-') || value.startsWith(root + '_'),
      );
    };
    const bundlePath = (relative: string) =>
      '<Viewer>/' +
      relative
        .split('/')
        .map((part) => {
          if (opaqueWord(part) || part.includes('[redacted]')) return '<token>';
          if (addressWord(part) && !bundleCodeExtension.test(part)) return '<address>';
          return redactNames(part);
        })
        .join('/');
    const summarizePath = (raw: string, complete = false) => {
      const normalized = pathRoot(raw).replace(/^~[^/]*/, '~');
      const candidates = normalized.startsWith('~/')
        ? homes.map((home) => home + normalized.slice(1))
        : [normalized];
      if (complete) {
        for (const bundle of bundles) {
          const relative = candidates
            .map((candidate) => bundleRelativePath(candidate, bundle))
            .find(Boolean);
          if (relative && !/\s/.test(relative) && bundleCodeExtension.test(relative))
            return bundlePath(relative);
        }
      }
      for (const root of dataRoots) {
        const canonical = candidates.map(reportPath).find((value) => value?.startsWith(root + '/'));
        if (!canonical) continue;
        const relative = canonical.slice(root.length + 1).split('/');
        const first = relative[0]!;
        const summary = pathSummary('/' + relative.join('/'), []);
        return (
          '<Viewer data>/' +
          (relative.length > 1 && fixedDataFolders.has(first) ? first : '…') +
          (relative.length > 1
            ? summary
                .slice('<path>'.length)
                .split('/')
                .slice(1)
                .slice(1)
                .map((part) => '/' + part)
                .join('')
            : '')
        );
      }
      if (
        homes.some(
          (home) =>
            normalized.toLowerCase() === home.toLowerCase() ||
            normalized.toLowerCase().startsWith(home.toLowerCase() + '/'),
        )
      )
        return pathSummary(normalized, homes);
      if (normalized.startsWith('/Volumes/')) {
        const mounted = volumeRoots.find(
          (root) => normalized === root || normalized.startsWith(root + '/'),
        );
        const suffix = normalized.slice(
          mounted?.length ?? normalized.indexOf('/', '/Volumes/'.length),
        );
        return (
          '/Volumes/<volume>' +
          (suffix.startsWith('/') ? pathSummary(suffix, []).slice('<path>'.length) : '')
        );
      }
      return pathSummary(normalized, homes);
    };

    let source = messageControls(redactCredentials(decoded(boundedDiagnosticInput(text))))
      .replace(/\\(?= )/g, '')
      .replace(/\\/g, '/')
      .replace(/\x24(?:HOME\b|\{HOME\})/g, '~')
      .replace(/\/\.(?=\/)/g, '')
      .replace(/\bfile:\/{1,3}(?:localhost\/)?/gi, '/')
      .replace(/\/{2,}/g, '/');
    if (/:Users:/i.test(source)) return '~/<path>';
    source = source.replace(
      /\b((?:getaddrinfo[ \t]{1,16})?(?:ENOTFOUND|EAI_AGAIN))[ \t]{1,16}[^/\s~]+(?=\s|$)/g,
      '$1 <address>',
    );
    let result = '';
    // Before a relative path, spaces can belong to its first folder. Keep only a
    // recognized operation prefix when we cannot tell where that folder started.
    const operationPrefix =
      /^(?:(?:ENOENT|EACCES|EPERM): )?(?:open|stat|lstat|read|write|rename|unlink) /i.exec(
        source,
      )?.[0] ?? '';
    for (let index = 0; index < source.length;) {
      const tail = source.slice(index);
      if (/^data:/i.test(tail)) {
        result = operationPrefix + '<data>';
        break;
      }
      const drive = /^[A-Za-z]:\//.test(tail);
      if (!drive && /^[A-Za-z][A-Za-z0-9+.-]{0,24}:\//.test(tail)) {
        result = operationPrefix + '<address>';
        break;
      }
      if (tail.startsWith('<Viewer>/')) {
        result = operationPrefix + '<path>';
        break;
      }
      const character = source[index]!;
      if (
        /['"\x60«“‘]/.test(character) &&
        (index === 0 || !/[\p{L}\p{N}]/u.test(source[index - 1]!))
      ) {
        const closing =
          character === '«' ? '»' : character === '“' ? '”' : character === '‘' ? '’' : character;
        let end = index + 1;
        while (end < source.length) {
          if (source[end] === closing && !internalApostrophe(source, end)) break;
          end++;
        }
        if (/[/~]/.test(source.slice(index + 1))) {
          // Quotes and line breaks can be literal filename characters. Even a suffix that
          // looks like a stack frame can be part of the same path.
          const remainder = source.slice(index + 1).trimEnd();
          const raw = remainder.endsWith(closing) ? remainder.slice(0, -1) : remainder;
          result = operationPrefix + summarizePath(raw, end === source.length - 1);
          break;
        }
        result = operationPrefix + '<quoted text>';
        break;
      }
      if (character === '/' || character === '~' || drive) {
        const known = knownRoots.find(
          (root) =>
            tail.toLowerCase().startsWith(root.toLowerCase()) &&
            !/[\p{L}\p{M}]/u.test(tail[root.length] ?? ''),
        );
        let end = index + (known?.length ?? 0);
        while (end < source.length && !/\s/.test(source[end]!)) end++;
        const raw = source.slice(drive ? index + 2 : index, end);
        result =
          operationPrefix +
          summarizePath(raw, index === operationPrefix.length && end === source.length);
        // A space may be part of an unquoted name. Its ambiguous suffix cannot be shared.
        break;
      }
      // A newline and a frame-shaped suffix can both belong to one relative filename.
      if (character === '\n' && /^\n[ \t]*at[ \t]+/.test(tail)) {
        result = operationPrefix + pathSummary(tail, []);
        break;
      }
      if (/\s/.test(character)) {
        result += character;
        index++;
        continue;
      }
      // Consume each whitespace-delimited word once, including its address punctuation.
      const nonspace = /^\S+/.exec(tail)![0];
      const whole = nonspace.replace(/["'»”’]+$/, '');
      const embedded = nonspace.search(/[/~]/);
      const openingQuote = nonspace.search(/(?<=[^\p{L}\p{N}])['"\x60«“‘]/u);
      if (openingQuote > 0 && (embedded < 0 || openingQuote < embedded)) {
        // An assignment or call can introduce a quoted basename inside a word.
        index += openingQuote;
        continue;
      }
      if (embedded >= 0) result = operationPrefix;
      if (/%[a-f\d]{2}/i.test(whole)) {
        result += '[Encoded text omitted]';
        if (embedded >= 0) break;
        index += nonspace.length;
        continue;
      }
      const address = addressWord(whole);
      if (address || opaqueWord(whole) || mangled(whole)) {
        result += address ? '<address>' : '<token>';
        if (embedded >= 0) break;
        index += nonspace.length;
        continue;
      }
      if (embedded >= 0) {
        result += summarizePath(nonspace);
        break;
      }
      result += nonspace;
      index += nonspace.length;
    }
    return redactNames(result);
  } catch {
    return '[Text omitted: privacy checks could not be completed.]';
  }
}
