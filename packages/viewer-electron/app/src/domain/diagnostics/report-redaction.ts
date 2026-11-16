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

interface RedactionSpan {
  start: number;
  end: number;
  replacement: string;
}

/** Unknown identities can occur anywhere in a failure, so that text must be withheld. */
export function redactReport(text: string, privateValues: readonly ReportPrivateValue[]): string {
  const unchecked = privateValues.filter((item) => !item.value?.trim());
  if (unchecked.length)
    return (
      '[Text omitted: ' +
      [...new Set(unchecked.map((item) => item.kind))].join(', ') +
      ' could not be checked.]'
    );

  try {
    const escape = (value: string) => value.replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&');
    const decode = (value: string) => {
      let result = value.normalize('NFC');
      for (let pass = 0; pass < 4; pass++) {
        const next = result.replace(/(?:%[\da-f]{2})+/gi, (encoded) => {
          try {
            return decodeURIComponent(encoded);
          } catch {
            return encoded;
          }
        });
        if (next === result) break;
        result = next;
      }
      return result.normalize('NFC');
    };
    const pathVariants = (value: string) => {
      const base = value
        .replace(/^\/(?:private\/)?System\/Volumes\/Data(?=\/)/i, '')
        .replace(/^\/private(?=\/)/i, '')
        .replace(/\/+$/, '');
      return ['', '/private', '/System/Volumes/Data', '/private/System/Volumes/Data'].map(
        (prefix) => prefix + base,
      );
    };
    const alternatives = (values: string[]) =>
      [...new Set(values)]
        .toSorted((a, b) => b.length - a.length)
        .map(escape)
        .join('|');
    const source = decode(text)
      .replace(/\u001b\[[\d;]*[A-Za-z]/g, '')
      .replace(/\\(?=[ '"])/g, '');
    const values = privateValues.map((item) => ({ ...item, value: decode(item.value!) }));
    const spans: RedactionSpan[] = [];
    const mask = (pattern: RegExp, replacement: string) => {
      for (const match of source.matchAll(pattern))
        spans.push({ start: match.index, end: match.index + match[0].length, replacement });
    };

    // Collect spans against the original text. A short name must not break a larger secret.
    const identities = values
      .filter((item) => !['home', 'application bundle', 'application data'].includes(item.kind))
      .flatMap((item) =>
        ['computer name', 'local host name', 'Bonjour name'].includes(item.kind)
          ? [item.value, item.value.replace(/\.local\.?$/i, '') + '.local']
          : [item.value],
      );
    if (identities.length)
      mask(
        new RegExp(
          '(?<![\\p{L}\\p{N}\\p{M}_])(?:' + alternatives(identities) + ')(?![\\p{L}\\p{N}\\p{M}_])',
          'giu',
        ),
        '<private>',
      );

    const roots = values
      .filter((item) => ['application bundle', 'application data'].includes(item.kind))
      .flatMap((item) => pathVariants(item.value));
    const protectedRoots = roots.length
      ? [
          ...source.matchAll(
            new RegExp('(?:' + alternatives(roots) + ')(?=/|$|[\\s"\'<>),:])', 'giu'),
          ),
        ]
      : [];
    const protectedPaths = protectedRoots.map((root) => ({
      start: root.index,
      end:
        root.index +
        root[0].length +
        (/^(?:\/[^\s"'<>)]*)?/.exec(source.slice(root.index + root[0].length))?.[0].length ?? 0),
    }));
    const maskOutsideApplication = (pattern: RegExp, replacement: string) => {
      for (const match of source.matchAll(pattern))
        if (!protectedPaths.some((range) => range.start <= match.index && match.index < range.end))
          spans.push({ start: match.index, end: match.index + match[0].length, replacement });
    };
    const homes = values
      .filter((item) => item.kind === 'home')
      .flatMap((item) => pathVariants(item.value));
    if (homes.length) {
      const pattern = new RegExp('(?:' + alternatives(homes) + ')(?=/|$|[\\s"\'<>),:])', 'giu');
      for (const match of source.matchAll(pattern)) {
        const start = match.index;
        const rootEnd = start + match[0].length;
        const protectedRoot = protectedRoots.some(
          (root) => root.index <= start && root.index + root[0].length >= rootEnd,
        );
        if (protectedRoot || source[rootEnd] !== '/') {
          spans.push({ start, end: rootEnd, replacement: '~' });
          continue;
        }
        // Filenames can contain spaces, quotes and punctuation, so the remaining line is private.
        let end = source.indexOf('\n', rootEnd);
        if (end < 0) end = source.length;
        const nextRoot = protectedRoots.find((root) => root.index > start && root.index < end);
        if (nextRoot) end = nextRoot.index;
        const parts = source.slice(rootEnd, end).split('/').filter(Boolean);
        const extension = [
          ...(parts.at(-1) ?? '').matchAll(/\.([a-z\d]{1,10})(?=$|[\s"'<>),:;!?])/gi),
        ].at(-1)?.[1];
        const suffix =
          extension && identities.some((value) => value.toLowerCase() === extension.toLowerCase())
            ? '<private>'
            : extension;
        const replacement =
          '~' +
          parts
            .map((_, index) => '/…' + (index === parts.length - 1 && suffix ? '.' + suffix : ''))
            .join('');
        spans.push({ start, end, replacement });
      }
    }

    mask(/^.*%[\da-f]{2}.*$/gim, '[Encoded text omitted]');
    mask(/\bviewer-license-1[.\w+/=-]*/gi, '<license>');
    mask(/\b(?:sk|pk|rk|gh[pousr]|xox[abprs])[-_][\w-]{8,}/gi, '<token>');
    mask(/\bBearer\s+[^\s"',;]+/gi, '<token>');
    mask(
      /\b(?:api[-_]?key|access[-_]?token|token|password|secret|authorization)["']?\s*[:=]\s*["']?[^\s"',;&]+/gi,
      '<token>',
    );
    mask(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu, '<email>');
    mask(/"(?:[^"\\\r\n]|\\.)+"@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu, '<email>');
    maskOutsideApplication(/\b[a-z\d_+/-]{32,}={0,2}(?![\w])/gi, '<token>');
    maskOutsideApplication(/\b(?:[\p{L}\p{N}][\p{L}\p{N}-]*\.)+[\p{L}]{2,63}\b/giu, '<host>');
    mask(/\b(?:smb|afp|nfs|cifs|ftp|sftp):\/\/[^\r\n]*/gi, '<network address>');
    mask(/\\\\[^\r\n]*/g, '<network address>');
    mask(/\/Network\/Servers\/[^\r\n]*/gi, '<network address>');
    for (const match of source.matchAll(
      /(?<!\/System)\/(?:(?:private\/)?System\/Volumes\/Data\/|private\/)?Volumes\/[^\r\n]*/gi,
    )) {
      const protectedRoot = protectedRoots.find((root) => root.index === match.index);
      const end = protectedRoot
        ? protectedRoot.index + protectedRoot[0].length
        : match.index + match[0].length;
      spans.push({ start: match.index, end, replacement: '/Volumes/<volume>' });
    }
    mask(/\b[\p{L}\p{N}][\p{L}\p{N}._-]*\.local\.?\b/giu, '<host>');
    mask(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<address>');
    for (const match of source.matchAll(
      /(?<![\w:])(?:[a-f\d]{0,4}:){2,}[a-f\d:.]*(?:%[\w.-]+)?(?![\w:])/gi,
    )) {
      try {
        new URL('http://[' + match[0].replace(/%.*/, '') + ']');
        spans.push({
          start: match.index,
          end: match.index + match[0].length,
          replacement: '<address>',
        });
      } catch {
        // Clock times and stack coordinates are not IP addresses.
      }
    }
    mask(/\bfile:\/\/(?:localhost)?(?=\/)/gi, '');
    for (const match of source.matchAll(/\b[a-z][a-z\d+.-]*:\/\/[^\r\n]*/gi)) {
      const authority = /^[a-z][a-z\d+.-]*:\/\/([^\s/<>"']*)/i.exec(match[0])?.[1];
      if (authority) {
        const start = match.index + match[0].indexOf('://') + 3;
        spans.push({ start, end: start + authority.length, replacement: '<host>' });
      }
      const query = match[0].search(/[?#]/);
      if (query >= 0)
        spans.push({
          start: match.index + query,
          end: match.index + match[0].length,
          replacement: '',
        });
    }

    const ordered = spans.toSorted((a, b) => a.start - b.start || b.end - a.end);
    const merged: RedactionSpan[] = [];
    for (const span of ordered) {
      const previous = merged.at(-1);
      if (previous && span.start < previous.end) previous.end = Math.max(previous.end, span.end);
      else merged.push({ ...span });
    }
    let result = '';
    let offset = 0;
    for (const span of merged) {
      result += source.slice(offset, span.start) + span.replacement;
      offset = span.end;
    }
    return result + source.slice(offset);
  } catch {
    return '[Text omitted: privacy checks could not be completed.]';
  }
}
