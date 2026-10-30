import type { SavedPage, SavedPagePart } from '../saved-page';
import { decodeBinaryPlist, isBinaryPlist, xmlPlistValue } from '../data/plist';
import { decodeText } from '../mail/mime';
import {
  escapeHtml,
  pageBase,
  partExtension,
  rewritePage,
  rewriteStyle,
  savedPageLimits,
} from '../saved-page';

export const webArchiveLimits = {
  bytes: 64 * 1024 * 1024,
  /** Subresources read from the archive. */
  resources: 5000,
} as const;

/** What a web archive's preview names beside the page. */
export interface WebArchiveSummary {
  /** The address the page was saved from. */
  url: string;
  title: string;
  /** Subresources the archive holds. */
  resources: number;
  /** Frames saved with the page, which are not shown. */
  frames: number;
}

interface WebResource {
  url: string;
  type: string;
  encoding?: string;
  data: Uint8Array;
}
interface WebArchive {
  main: WebResource;
  resources: WebResource[];
  frames: number;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array)
    ? (value as Record<string, unknown>)
    : undefined;
function resource(value: unknown): WebResource | undefined {
  const item = record(value);
  const data = item?.WebResourceData;
  if (!item || !(data instanceof Uint8Array)) return undefined;
  return {
    url: typeof item.WebResourceURL === 'string' ? item.WebResourceURL : '',
    type:
      typeof item.WebResourceMIMEType === 'string' ? item.WebResourceMIMEType.toLowerCase() : '',
    encoding:
      typeof item.WebResourceTextEncodingName === 'string'
        ? item.WebResourceTextEncodingName
        : undefined,
    data,
  };
}
/** Safari's archive, a binary or XML property list: the main resource, its subresources and the
 * archives of its frames. */
function readArchive(bytes: Uint8Array): WebArchive {
  if (bytes.length > webArchiveLimits.bytes) throw new Error('This web archive exceeds 64 MB.');
  const value = isBinaryPlist(bytes)
    ? decodeBinaryPlist(bytes, { data: 'bytes' })
    : xmlPlistValue(decodeText(bytes, 'utf-8'), { data: 'bytes' });
  const archive = record(value);
  const main = resource(archive?.WebMainResource);
  if (!archive || !main) throw new Error('This property list holds no saved web page.');
  const resources = Array.isArray(archive.WebSubresources) ? archive.WebSubresources : [];
  const frames = Array.isArray(archive.WebSubframeArchives) ? archive.WebSubframeArchives : [];
  return {
    main,
    resources: resources
      .slice(0, webArchiveLimits.resources)
      .map(resource)
      .filter((item): item is WebResource => !!item),
    frames: frames.length,
  };
}

const html = (item: WebResource) => /^(?:text\/html|application\/xhtml\+xml)$/.test(item.type);
const withoutFragment = (url: string) => url.split('#')[0]!;
const absolute = (reference: string, base: string) => {
  try {
    return withoutFragment(new URL(reference, base || undefined).href);
  } catch {
    return undefined;
  }
};

export function webArchiveSummary(bytes: Uint8Array): WebArchiveSummary & { text: string } {
  const archive = readArchive(bytes);
  const page = html(archive.main) ? decodeText(archive.main.data, archive.main.encoding) : '';
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(page)?.[1] ?? '';
  return {
    url: archive.main.url,
    title: title.replace(/\s+/g, ' ').trim().slice(0, 500),
    resources: archive.resources.length,
    frames: archive.frames,
    text: page
      .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .slice(0, 150_000),
  };
}

/**
 * The saved page with its subresources served from the archive: each reference that resolves,
 * against the page's address and base, to a resource the archive holds is rewritten to it, a
 * stylesheet's own references too. Anything else is removed; nothing loads from the network.
 */
export function webArchivePage(bytes: Uint8Array): SavedPage {
  const archive = readArchive(bytes);
  const { main } = archive;
  const byURL = new Map<string, WebResource>();
  for (const item of archive.resources) {
    const url = absolute(item.url, '');
    if (url && !byURL.has(url)) byURL.set(url, item);
  }
  const parts: SavedPagePart[] = [];
  const served = new Map<WebResource, string | null>();
  let total = 0;
  const count = { blocked: 0 };
  const serve = (item: WebResource | undefined): string | undefined => {
    if (!item) return undefined;
    if (served.has(item)) return served.get(item) ?? undefined;
    served.set(item, null);
    const extension = partExtension(item.type);
    if (!extension || parts.length >= savedPageLimits.parts) return undefined;
    let data = item.data;
    if (extension === 'css') {
      // a stylesheet's references resolve against its own address
      const css = rewriteStyle(
        decodeText(data, item.encoding),
        (reference) => serve(byURL.get(absolute(reference, item.url) ?? '')),
        count,
      );
      data = new TextEncoder().encode(css);
    }
    if (data.length > savedPageLimits.partBytes || total + data.length > savedPageLimits.pageBytes)
      return undefined;
    total += data.length;
    const path = `/parts/${parts.length + 1}.${extension}`;
    parts.push({ path: path.slice(1), type: item.type, data });
    served.set(item, path);
    return path;
  };
  if (!html(main)) {
    const path = serve(main);
    const body = path
      ? `<img src="${path}" alt="">`
      : main.type.startsWith('text/')
        ? `<pre style="white-space:pre-wrap">${escapeHtml(decodeText(main.data, main.encoding))}</pre>`
        : '<p>This archive saved a file Viewer does not show.</p>';
    return { html: `<!doctype html><meta charset="utf-8">${body}`, parts, blocked: 0 };
  }
  const source = decodeText(main.data, main.encoding);
  if (source.length > savedPageLimits.htmlBytes)
    throw new Error('The saved page exceeds 4 MB of HTML.');
  const declared = pageBase(source);
  const base = (declared && absolute(declared, main.url)) || main.url;
  const page = rewritePage(source, (reference, kind) =>
    kind === 'navigation' ? undefined : serve(byURL.get(absolute(reference, base) ?? '')),
  );
  return {
    html: page.html,
    parts,
    blocked: page.blocked + count.blocked + archive.frames,
  };
}
