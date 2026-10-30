import type { ArchiveEntry, FileEntry } from '../../contracts';

/**
 * EMBEDDED PREVIEWS: containers that carry a picture of themselves, saved by the app that wrote
 * them. Viewer shows that picture, said to be one, with a few facts read beside it; it lays out or
 * renders nothing. One reader serves every family: each names the members it may read, and the
 * desktop reads no other.
 */

/** The apps whose documents Viewer shows by their saved picture. */
export type EmbeddedFamily = 'iwork' | 'krita' | 'openraster' | 'sketch' | 'xps';

export const embeddedFormats = {
  pages: { family: 'iwork', kind: 'Pages document' },
  numbers: { family: 'iwork', kind: 'Numbers spreadsheet' },
  key: { family: 'iwork', kind: 'Keynote presentation' },
  kra: { family: 'krita', kind: 'Krita image' },
  ora: { family: 'openraster', kind: 'OpenRaster image' },
  sketch: { family: 'sketch', kind: 'Sketch document' },
  xps: { family: 'xps', kind: 'XPS document' },
  oxps: { family: 'xps', kind: 'OpenXPS document' },
} as const satisfies Record<string, { family: EmbeddedFamily; kind: string }>;
export type EmbeddedFormat = keyof typeof embeddedFormats;
export const embeddedExtensions = Object.keys(embeddedFormats) as EmbeddedFormat[];
export function embeddedFormat(extension: string): EmbeddedFormat | undefined {
  const format = extension.toLowerCase();
  return Object.hasOwn(embeddedFormats, format) ? (format as EmbeddedFormat) : undefined;
}

/** The pictures each family may carry, by member name. */
const pictures: Record<EmbeddedFamily, readonly string[]> = {
  // iWork '13 and later keep three sizes at the root; iWork '09 kept one in QuickLook
  iwork: ['preview.jpg', 'preview-web.jpg', 'preview-micro.jpg', 'QuickLook/Thumbnail.jpg'],
  // the flattened canvas, then the small thumbnail beside it
  krita: ['mergedimage.png', 'preview.png'],
  openraster: ['mergedimage.png', 'Thumbnails/thumbnail.png'],
  sketch: ['previews/preview.png'],
  xps: ['docProps/thumbnail.jpeg', 'docProps/thumbnail.jpg', 'docProps/thumbnail.png'],
};
/** The members each family's facts are read from. */
const factMembers: Record<EmbeddedFamily, (name: string) => boolean> = {
  iwork: () => false,
  krita: (name) => name === 'maindoc.xml',
  openraster: (name) => name === 'stack.xml',
  sketch: (name) => name === 'meta.json',
  xps: (name) => /\.(?:fdseq|fdoc)$/i.test(name),
};

/** A picture is read whole; its signature and dimensions are checked before Chromium decodes it. */
export const embeddedPictureLimits = { bytes: 32_000_000, pixels: 64_000_000 } as const;
/** A member read for facts: a document's main XML or JSON. */
export const embeddedFactLimit = 1_000_000;
/** The FixedDocuments counted in one XPS sequence. */
const documentLimit = 16;

export type EmbeddedMember = 'picture' | 'facts';
/** What a format reads `name` for, or undefined for a member it never reads. */
export function embeddedMember(format: EmbeddedFormat, name: string): EmbeddedMember | undefined {
  const { family } = embeddedFormats[format];
  if (pictures[family].includes(name)) return 'picture';
  return factMembers[family](name) ? 'facts' : undefined;
}
/** The pictures a format may carry. */
export function embeddedPictureNames(format: EmbeddedFormat): readonly string[] {
  return pictures[embeddedFormats[format].family];
}
/** The pictures a container holds within the limit, the largest first: each is tried in turn, as
 * a picture can still fail its signature or pixel check. */
export function embeddedPictures(
  format: EmbeddedFormat,
  entries: readonly ArchiveEntry[],
): string[] {
  const names = embeddedPictureNames(format);
  return entries
    .filter(
      (entry) =>
        names.includes(entry.name) &&
        entry.previewable &&
        entry.size <= embeddedPictureLimits.bytes,
    )
    .sort((a, b) => b.size - a.size || names.indexOf(a.name) - names.indexOf(b.name))
    .map((entry) => entry.name);
}

/**
 * A document package Viewer shows as the document it is: an iWork folder, one item in Finder,
 * whose pictures lie inside it. Krita, Sketch and XPS files are always single files.
 */
export function embeddedPackage(entry: Pick<FileEntry, 'directory' | 'extension'>): boolean {
  const format = embeddedFormat(entry.extension);
  return entry.directory && !!format && embeddedFormats[format].family === 'iwork';
}
/** An item Quick Preview shows: a file, or a document package. */
export const previewsAsFile = (entry: Pick<FileEntry, 'directory' | 'extension'>) =>
  !entry.directory || embeddedPackage(entry);

export interface EmbeddedFacts {
  pages?: number;
  canvas?: { width: number; height: number };
}
/** A member's text, or undefined when it is missing, over its limit or not text. */
export type EmbeddedText = (name: string) => Promise<string | undefined>;

/** The attribute `name` of a start tag, as a whole number of pixels. */
function dimension(tag: string, name: string): number | undefined {
  const value = new RegExp(`\\s${name}\\s*=\\s*["'](\\d{1,7})["']`).exec(tag)?.[1];
  const pixels = value ? Number(value) : 0;
  return pixels > 0 ? pixels : undefined;
}
/** Krita's `IMAGE` element and OpenRaster's `image` hold the canvas size. A tag ends at the next
 * `<` too, so an unclosed one is not read to the end of the text from every start. */
export function canvasSize(
  xml: string,
  element: string,
  width: string,
  height: string,
): EmbeddedFacts['canvas'] {
  const tag = new RegExp(`<${element}\\b[^<>]*>`).exec(xml)?.[0];
  if (!tag) return undefined;
  const across = dimension(tag, width),
    down = dimension(tag, height);
  return across && down ? { width: across, height: down } : undefined;
}
/** Sketch's meta.json keys its pages by ID in `pagesAndArtboards`. */
export function sketchPages(json: string): number | undefined {
  try {
    const pages = (JSON.parse(json) as { pagesAndArtboards?: unknown }).pagesAndArtboards;
    return pages && typeof pages === 'object' && !Array.isArray(pages)
      ? Object.keys(pages).length
      : undefined;
  } catch {
    return undefined;
  }
}
/** The FixedDocuments an XPS sequence references, as member names: a part name from the package
 * root, or a path from the sequence's own folder. */
export function xpsDocuments(sequence: string, xml: string): string[] {
  const folder = sequence.includes('/') ? sequence.slice(0, sequence.lastIndexOf('/') + 1) : '';
  return Array.from(
    xml.matchAll(/<(?:[\w-]+:)?DocumentReference\b[^<>]*\sSource\s*=\s*["']([^"'<>]+)["']/g),
    (match) => {
      const source = match[1]!;
      let name: string;
      try {
        name = decodeURIComponent(source);
      } catch {
        name = source;
      }
      return name.startsWith('/') ? name.slice(1) : folder + name;
    },
  );
}
/** The pages a FixedDocument lists, one `PageContent` each; `PageContent.LinkTargets` is a
 * property of one, not a page. */
export function xpsPages(xml: string): number {
  return xml.match(/<(?:[\w-]+:)?PageContent(?=[\s/>])/g)?.length ?? 0;
}
async function xpsPageCount(
  names: readonly string[],
  text: EmbeddedText,
): Promise<number | undefined> {
  const sequence = names.find((name) => /\.fdseq$/i.test(name));
  const listed = sequence ? await text(sequence) : undefined;
  // without a readable sequence, every FixedDocument the package holds
  const documents =
    sequence && listed !== undefined
      ? xpsDocuments(sequence, listed)
      : names.filter((name) => /\.fdoc$/i.test(name));
  if (!documents.length || documents.length > documentLimit) return undefined;
  let pages = 0;
  for (const document of documents) {
    const xml = names.includes(document) ? await text(document) : undefined;
    if (xml === undefined) return undefined;
    pages += xpsPages(xml);
  }
  return pages;
}

/** The facts a container's members give, when they are cheap to read: a canvas size or a page
 * count. A missing or unreadable member gives none. */
export async function embeddedFacts(
  format: EmbeddedFormat,
  names: readonly string[],
  text: EmbeddedText,
): Promise<EmbeddedFacts> {
  const read = (name: string) => (names.includes(name) ? text(name) : Promise.resolve(undefined));
  const family = embeddedFormats[format].family;
  if (family === 'krita') {
    const xml = await read('maindoc.xml');
    return { canvas: xml ? canvasSize(xml, 'IMAGE', 'width', 'height') : undefined };
  }
  if (family === 'openraster') {
    const xml = await read('stack.xml');
    return { canvas: xml ? canvasSize(xml, 'image', 'w', 'h') : undefined };
  }
  if (family === 'sketch') {
    const json = await read('meta.json');
    return { pages: json ? sketchPages(json) : undefined };
  }
  if (family === 'xps') return { pages: await xpsPageCount(names, text) };
  return {};
}

/** "Krita image · 640 × 480 canvas", "XPS document · 3 pages". */
export function embeddedSummary(format: EmbeddedFormat, facts: EmbeddedFacts): string {
  const parts: string[] = [embeddedFormats[format].kind];
  if (facts.canvas) parts.push(`${facts.canvas.width} × ${facts.canvas.height} canvas`);
  if (facts.pages !== undefined) parts.push(facts.pages === 1 ? '1 page' : `${facts.pages} pages`);
  return parts.join(' · ');
}
