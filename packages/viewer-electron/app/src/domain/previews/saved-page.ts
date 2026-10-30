/**
 * A page Viewer serves from a file's own parts, an email's HTML body or a saved web page, through
 * the private HTML protocol. The page's references are rewritten to those parts; any other
 * resource is removed, and the protocol's policy refuses what remains.
 */

export interface SavedPagePart {
  /** The path the page refers to it by, from the page's root: `parts/1.png`. */
  path: string;
  type: string;
  data: Uint8Array;
}
export interface SavedPage {
  /** UTF-8 HTML, served as `page.html`. */
  html: string;
  parts: SavedPagePart[];
  /** Resources the page names that are not in the file, so not loaded. */
  blocked: number;
}
export const savedPageLimits = {
  htmlBytes: 4_000_000,
  partBytes: 8_000_000,
  /** Every part of one page together. */
  pageBytes: 32_000_000,
  parts: 2000,
} as const;
export const savedPageName = 'page.html';
/** Formats whose page is served from the file's own parts: email, and Safari's web archive. */
export const savedPageFormats: readonly string[] = ['eml', 'emlx', 'mbox', 'webarchive'];

/** The parts a page may load, by the extension their served path takes. Scripts, frames and
 * documents are not among them. */
const partExtensions: Readonly<Record<string, string>> = {
  'text/css': 'css',
  'image/png': 'png',
  'image/apng': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'font/woff': 'woff',
  'font/woff2': 'woff2',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'application/font-woff': 'woff',
  'application/font-woff2': 'woff2',
  'application/x-font-woff': 'woff',
  'application/x-font-ttf': 'ttf',
  'application/x-font-otf': 'otf',
  'application/vnd.ms-opentype': 'otf',
};
/** The extension a part of `type` is served with, or undefined for a type a page may not load. */
export const partExtension = (type: string) =>
  partExtensions[type.split(';')[0]!.trim().toLowerCase()];

export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}
const named: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};
/** The character references an attribute value commonly holds. */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});?/gi, (entity, name: string) => {
    if (name.startsWith('#')) {
      const code =
        name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : +name.slice(1);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : entity;
    }
    return named[name.toLowerCase()] ?? entity;
  });
}

/** What a reference loads: a resource the page shows, or a page it navigates to. */
export type ReferenceKind = 'resource' | 'style' | 'navigation';
/** A reference's served path, the reference itself for one that stays (`data:`, `#top`), or
 * undefined for one the page may not load. */
export type ReferenceResolver = (reference: string, kind: ReferenceKind) => string | undefined;

/** References that load nothing from outside the page. The policy still decides which `data:`
 * types a page may use. */
const local = (reference: string) => /^(?:#|data:|about:blank$)/i.test(reference);

/** CSS with each `url()` and `@import` resolved; an unresolved one becomes empty. */
export function rewriteStyle(
  css: string,
  resolve: ReferenceResolver,
  count: { blocked: number },
): string {
  const replace = (reference: string) => {
    const value = reference.trim();
    if (!value || local(value)) return value;
    const resolved = resolve(value, 'style');
    if (resolved === undefined) count.blocked++;
    return resolved ?? '';
  };
  return css
    .replace(
      /@import\s+(?:url\(\s*)?(["'])(.*?)\1\s*\)?/gi,
      (_all, quote: string, reference: string) => `@import ${quote}${replace(reference)}${quote}`,
    )
    .replace(
      /url\(\s*(["']?)(.*?)\1\s*\)/gi,
      (_all, quote: string, reference: string) => `url(${quote}${replace(reference)}${quote})`,
    );
}

/** A `srcset` list with each candidate's URL resolved; unresolved candidates are dropped. */
function rewriteSourceSet(value: string, resolve: (reference: string) => string | undefined) {
  const candidates: string[] = [];
  for (const candidate of value.split(/,(?=\s|$)|,(?=[^\s,]*\s)/)) {
    const [reference = '', ...descriptor] = candidate.trim().split(/\s+/);
    if (!reference) continue;
    const resolved = resolve(reference);
    if (resolved) candidates.push([resolved, ...descriptor].join(' '));
  }
  return candidates.join(', ');
}

interface Attribute {
  name: string;
  /** The value as written, with its character references; undefined for a bare attribute. */
  value?: string;
  raw: string;
}
/** A start tag's name, attributes and end, read as the HTML tokenizer reads them. */
function startTag(html: string, at: number) {
  let cursor = at + 1;
  while (cursor < html.length && !/[\s/>]/.test(html[cursor]!)) cursor++;
  const written = html.slice(at + 1, cursor);
  const attributes: Attribute[] = [];
  let self = false;
  while (cursor < html.length) {
    while (cursor < html.length && /[\s/]/.test(html[cursor]!)) {
      if (html[cursor] === '/') self = true;
      cursor++;
    }
    if (html[cursor] === '>' || cursor >= html.length) break;
    self = false;
    const start = cursor;
    let end = cursor;
    while (end < html.length && (end === cursor || !/[\s/>=]/.test(html[end]!))) end++;
    const attribute = html.slice(cursor, end).toLowerCase();
    cursor = end;
    while (/\s/.test(html[cursor] ?? '')) cursor++;
    let value: string | undefined;
    if (html[cursor] === '=') {
      cursor++;
      while (/\s/.test(html[cursor] ?? '')) cursor++;
      const quote = html[cursor];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, cursor + 1);
        const stop = close < 0 ? html.length : close;
        value = html.slice(cursor + 1, stop);
        cursor = stop + 1;
      } else {
        const begin = cursor;
        while (cursor < html.length && !/[\s>]/.test(html[cursor]!)) cursor++;
        value = html.slice(begin, cursor);
      }
    }
    attributes.push({ name: attribute, value, raw: html.slice(start, cursor) });
  }
  return {
    name: written.toLowerCase(),
    written,
    attributes,
    self,
    end: Math.min(cursor + 1, html.length),
  };
}

/** Elements whose content is text, not markup, up to their end tag. */
const rawText = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'noembed', 'noframes']);
/** Elements a saved page may not keep: they run code, embed documents or set the base. */
const removed = new Set([
  'script',
  'base',
  'object',
  'embed',
  'applet',
  'portal',
  'iframe',
  'frame',
]);
/** Attributes that load a resource, by the elements that have them. */
const resourceAttributes: Readonly<Record<string, readonly string[]>> = {
  img: ['src', 'srcset', 'lowsrc'],
  source: ['src', 'srcset'],
  picture: [],
  video: ['src', 'poster'],
  audio: ['src'],
  track: ['src'],
  input: ['src'],
  image: ['href', 'xlink:href'],
  use: ['href', 'xlink:href'],
  feimage: ['href', 'xlink:href'],
};
/** A link without its address still looks like one, unless the page styles it. */
const linkStyle = '<style>:where(a[data-href]){color:LinkText;text-decoration:underline}</style>';

/**
 * HTML whose resource references are resolved through `resolve`. Scripts, frames, embedded objects,
 * `base` and refresh are removed; links and forms go nowhere, a link's address kept as its title;
 * event attributes are dropped. Comments and text pass unchanged.
 */
export function rewritePage(
  html: string,
  resolve: ReferenceResolver,
): { html: string; blocked: number } {
  const count = { blocked: 0 };
  const output: string[] = [];
  const resource = (reference: string) => {
    const value = decodeEntities(reference).trim();
    if (!value) return '';
    if (local(value)) return value;
    const resolved = resolve(value, 'resource');
    if (resolved === undefined) count.blocked++;
    return resolved;
  };
  let cursor = 0;
  while (cursor < html.length) {
    const open = html.indexOf('<', cursor);
    if (open < 0) {
      output.push(html.slice(cursor));
      break;
    }
    output.push(html.slice(cursor, open));
    if (html.startsWith('<!--', open)) {
      // as the tokenizer ends them: `<!-->` and `<!--->` are whole comments, and `--!>` ends one
      const close = /^<!---?>/.exec(html.slice(open, open + 6));
      let end = close ? open + close[0].length : html.length;
      if (!close) {
        const ending = /--!?>/g;
        ending.lastIndex = open + 4;
        const found = ending.exec(html);
        if (found) end = found.index + found[0].length;
      }
      output.push(html.slice(open, end));
      cursor = end;
      continue;
    }
    if (/^<[!?/]/.test(html.slice(open, open + 2))) {
      const close = html.indexOf('>', open);
      const end = close < 0 ? html.length : close + 1;
      output.push(html.slice(open, end));
      cursor = end;
      continue;
    }
    if (!/[a-z]/i.test(html[open + 1] ?? '')) {
      output.push('<');
      cursor = open + 1;
      continue;
    }
    const tag = startTag(html, open);
    cursor = tag.end;
    let content: string | undefined;
    if (rawText.has(tag.name) && !tag.self) {
      const close = html.slice(cursor).search(new RegExp(`</${tag.name}[\\s/>]`, 'i'));
      const stop = close < 0 ? html.length : cursor + close;
      content = html.slice(cursor, stop);
      const closeEnd = html.indexOf('>', stop);
      cursor = close < 0 ? html.length : closeEnd < 0 ? html.length : closeEnd + 1;
    }
    const attribute = (name: string) =>
      tag.attributes.find((item) => item.name === name)?.value ?? '';
    if (removed.has(tag.name)) continue;
    if (
      tag.name === 'meta' &&
      /^(?:refresh|set-cookie|content-security-policy)$/i.test(attribute('http-equiv').trim())
    )
      continue;
    if (tag.name === 'link') {
      const relation = attribute('rel').toLowerCase().split(/\s+/);
      if (!relation.includes('stylesheet') && !relation.includes('icon')) continue;
    }
    const kept: string[] = [];
    for (const item of tag.attributes) {
      const name = item.name;
      if (/^on/.test(name) || name === 'formaction' || name === 'ping') continue;
      let value = item.value;
      if (value !== undefined) {
        if (name === 'style')
          value = escapeHtml(rewriteStyle(decodeEntities(value), resolve, count));
        else if (name === 'srcset' || name === 'imagesrcset')
          value = escapeHtml(rewriteSourceSet(decodeEntities(value), resource));
        else if (
          resourceAttributes[tag.name]?.includes(name) ||
          name === 'background' ||
          (tag.name === 'link' && name === 'href')
        ) {
          const resolved = resource(value);
          if (resolved === undefined) continue;
          value = escapeHtml(resolved);
        } else if (name === 'action') continue;
        else if (name === 'href' && !/^\s*#/.test(value)) {
          const address = escapeHtml(decodeEntities(value).trim());
          kept.push(` data-href="${address}"`);
          if (!attribute('title')) kept.push(` title="${address}"`);
          continue;
        } else {
          kept.push(' ' + item.raw.trim());
          continue;
        }
        kept.push(` ${name}="${value}"`);
      } else kept.push(' ' + item.raw.trim());
    }
    output.push(`<${tag.written}${kept.join('')}${tag.self ? ' /' : ''}>`);
    if (content !== undefined) {
      output.push(tag.name === 'style' ? rewriteStyle(content, resolve, count) : content);
      output.push(`</${tag.written}>`);
    }
  }
  output.push(linkStyle);
  return { html: output.join(''), blocked: count.blocked };
}

/** The page's own declared base, for resolving its relative references. */
export function pageBase(html: string): string | undefined {
  const match = /<base\s[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(html);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value ? decodeEntities(value).trim() : undefined;
}
