import type { XMLNode } from '../data/xml';
import type { EPUBChapter } from './epub';
import { XMLStream } from '../data/xml';
import { epubImageLimit } from './epub';
import { decodeBase64, decodeText } from '../mail/mime';
import { escapeHtml } from '../saved-page';

export const fictionBookLimits = {
  bytes: 32 * 1024 * 1024,
  nodes: 400_000,
  chapters: 300,
  chapterCharacters: 400_000,
  imageBytes: epubImageLimit,
  /** Every picture of one book together. */
  imagesBytes: 16 * 1024 * 1024,
} as const;

export interface FictionBookImage {
  /** The path the book's chapters name it by: `images/1.jpg`. */
  path: string;
  type: string;
  data: Uint8Array;
}
export interface FictionBook {
  /** `title`, `creator`, `language`, `date`, `publisher`, `subject` and `series`, as EPUB names them. */
  metadata: Record<string, string>;
  chapters: EPUBChapter[];
  images: FictionBookImage[];
  /** Chapters, pictures or text past the reader's limits were left out. */
  truncated: boolean;
}

/** The text of an XML file in the encoding its declaration names: FictionBook is often
 * Windows-1251. */
function xmlText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  const declaration = /^(?:﻿)?<\?xml[^>]*?encoding\s*=\s*["']([\w.:-]+)["']/.exec(
    new TextDecoder('latin1').decode(bytes.subarray(0, 256)),
  );
  return decodeText(bytes, declaration?.[1] ?? 'utf-8');
}

/** The element tree of untrusted XML. The reader takes no DTD or entity declaration and resolves
 * nothing outside the file. */
function readTree(bytes: Uint8Array): XMLNode {
  // the reader decodes UTF-8 itself; the declaration's encoding has been applied above
  const text = xmlText(bytes).replace(/^﻿/, '');
  let root: XMLNode | undefined;
  const stack: XMLNode[] = [];
  const stream = new XMLStream(
    {
      open(node) {
        if (stack.length) stack.at(-1)!.children.push(node);
        else root = node;
        stack.push(node);
      },
      close() {
        stack.pop();
      },
      text(value) {
        stack.at(-1)!.children.push(value);
      },
    },
    fictionBookLimits.nodes,
  );
  stream.write(new TextEncoder().encode(text));
  stream.end();
  if (!root) throw new Error('This file holds no FictionBook.');
  return root;
}

const local = (name: string) => name.slice(name.indexOf(':') + 1);
const elements = (node: XMLNode) =>
  node.children.filter((child): child is XMLNode => typeof child !== 'string');
const child = (node: XMLNode | undefined, name: string) =>
  node && elements(node).find((item) => local(item.name) === name);
const all = (node: XMLNode | undefined, name: string) =>
  node ? elements(node).filter((item) => local(item.name) === name) : [];
const textOf = (node: XMLNode | undefined): string =>
  node
    ? node.children
        .map((item) => (typeof item === 'string' ? item : textOf(item)))
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
/** A title's paragraphs as one line. */
const titleText = (node: XMLNode | undefined): string =>
  node ? elements(node).map(textOf).filter(Boolean).join(' ') || textOf(node) : '';
const attribute = (node: XMLNode, name: string) =>
  Object.entries(node.attributes).find(([key]) => local(key) === name)?.[1];

const signatures: readonly [
  type: string,
  extension: string,
  test: (data: Uint8Array) => boolean,
][] = [
  ['image/png', 'png', (data) => data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e],
  ['image/jpeg', 'jpg', (data) => data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff],
  ['image/gif', 'gif', (data) => data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46],
  [
    'image/webp',
    'webp',
    (data) => data[0] === 0x52 && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42,
  ],
];

function author(node: XMLNode): string {
  const name = ['first-name', 'middle-name', 'last-name']
    .map((part) => textOf(child(node, part)))
    .filter(Boolean)
    .join(' ');
  return name || textOf(child(node, 'nickname'));
}

/**
 * A FictionBook 2 book as reader chapters: a title page with the cover, title, authors and
 * annotation, then each top-level section of the main body, then its notes. Internal links keep
 * working across chapters; pictures are the book's own binaries, checked by their bytes.
 */
export function readFictionBook(bytes: Uint8Array): FictionBook {
  if (bytes.length > fictionBookLimits.bytes) throw new Error('This book exceeds 32 MB.');
  const root = readTree(bytes);
  if (local(root.name) !== 'FictionBook') throw new Error('This XML is not a FictionBook.');
  const description = child(root, 'description');
  const info = child(description, 'title-info');
  const publish = child(description, 'publish-info');
  const metadata: Record<string, string> = {};
  const set = (key: string, value: string) => {
    if (value) metadata[key] = value.slice(0, 4000);
  };
  set('title', textOf(child(info, 'book-title')));
  set('creator', all(info, 'author').map(author).filter(Boolean).join('; '));
  set('language', textOf(child(info, 'lang')));
  const date = child(info, 'date');
  set('date', (date && attribute(date, 'value')) || textOf(date) || textOf(child(publish, 'year')));
  set('publisher', textOf(child(publish, 'publisher')));
  set('subject', all(info, 'genre').map(textOf).filter(Boolean).join('; '));
  const sequence = child(info, 'sequence');
  if (sequence)
    set(
      'series',
      [attribute(sequence, 'name'), attribute(sequence, 'number')].filter(Boolean).join(' '),
    );

  let truncated = false;
  const binaries = new Map(
    all(root, 'binary').flatMap((node) => {
      const id = attribute(node, 'id');
      return id ? [[id, node] as const] : [];
    }),
  );
  const images: FictionBookImage[] = [];
  const pictures = new Map<string, string | null>();
  let pictureBytes = 0;
  /** The chapter path of a picture the book holds, decoded once. */
  const picture = (reference: string | undefined): string | undefined => {
    const id = reference?.startsWith('#') ? reference.slice(1) : undefined;
    if (!id) return undefined;
    if (pictures.has(id)) return pictures.get(id) ?? undefined;
    pictures.set(id, null);
    const node = binaries.get(id);
    if (!node) return undefined;
    const text = node.children.filter((item) => typeof item === 'string').join('');
    if ((text.length * 3) / 4 > fictionBookLimits.imageBytes + 4) {
      truncated = true;
      return undefined;
    }
    const data = decodeBase64(text);
    const signature = signatures.find(([, , test]) => test(data));
    if (!signature) return undefined;
    if (pictureBytes + data.length > fictionBookLimits.imagesBytes) {
      truncated = true;
      return undefined;
    }
    pictureBytes += data.length;
    const path = `images/${images.length + 1}.${signature[1]}`;
    images.push({ path, type: signature[0], data });
    pictures.set(id, path);
    return path;
  };

  const bodies = all(root, 'body');
  const main = bodies.find((body) => !attribute(body, 'name')) ?? bodies[0];
  /** Chapter content in order: each with the path its links resolve to. */
  const planned: { title: string; path: string; nodes: (XMLNode | string)[]; level: number }[] = [];
  const front: (XMLNode | string)[] = [];
  let chapterNumber = 0;
  for (const item of main ? elements(main) : []) {
    if (local(item.name) !== 'section') {
      // the body's own title repeats the book's, which the title page already shows
      if (local(item.name) !== 'title' || !metadata.title) front.push(item);
      continue;
    }
    chapterNumber++;
    planned.push({
      title: titleText(child(item, 'title')) || `Chapter ${chapterNumber}`,
      path: `chapter-${chapterNumber}`,
      nodes: [item],
      level: 1,
    });
  }
  bodies
    .filter((body) => body !== main)
    .forEach((body, index) =>
      planned.push({
        title:
          titleText(child(body, 'title')) ||
          (attribute(body, 'name') === 'notes' ? 'Notes' : 'Notes ' + (index + 1)),
        path: `notes-${index + 1}`,
        nodes: elements(body),
        level: 1,
      }),
    );
  if (planned.length > fictionBookLimits.chapters - 1) {
    planned.length = fictionBookLimits.chapters - 1;
    truncated = true;
  }
  const targets = new Map<string, string>();
  const collect = (node: XMLNode | string, path: string) => {
    if (typeof node === 'string') return;
    const id = attribute(node, 'id');
    if (id && !targets.has(id)) targets.set(id, path);
    for (const item of node.children) collect(item, path);
  };
  for (const chapter of planned) for (const node of chapter.nodes) collect(node, chapter.path);
  for (const node of front) collect(node, 'title');

  const render = (node: XMLNode | string, level: number): string => {
    if (typeof node === 'string') return escapeHtml(node);
    const inner = (depth = level) => node.children.map((item) => render(item, depth)).join('');
    const id = attribute(node, 'id');
    const anchor = id ? ` id="${escapeHtml(id)}"` : '';
    switch (local(node.name)) {
      case 'p':
      case 'v':
        return `<p${anchor}>${inner()}</p>`;
      case 'empty-line':
        return '<br>';
      case 'emphasis':
        return `<em>${inner()}</em>`;
      case 'strong':
        return `<strong>${inner()}</strong>`;
      case 'strikethrough':
        return `<s>${inner()}</s>`;
      case 'sub':
      case 'sup':
      case 'code':
        return `<${local(node.name)}>${inner()}</${local(node.name)}>`;
      case 'a': {
        const href = attribute(node, 'href') ?? '';
        const target = href.startsWith('#') ? targets.get(href.slice(1)) : undefined;
        const link = target ? `${target}${href}` : href;
        return `<a href="${escapeHtml(link)}"${anchor}>${inner()}</a>`;
      }
      case 'image': {
        const alt = attribute(node, 'alt') ?? attribute(node, 'title') ?? 'Book illustration';
        const path = picture(attribute(node, 'href'));
        return path
          ? `<img src="${path}" alt="${escapeHtml(alt)}"${anchor}>`
          : `<span${anchor}>${escapeHtml(alt)}</span>`;
      }
      case 'title': {
        const heading = Math.min(6, level + 1);
        const lines = elements(node)
          .map((item) => textOf(item))
          .filter(Boolean);
        return `<h${heading}${anchor}>${lines.map(escapeHtml).join('<br>') || escapeHtml(textOf(node))}</h${heading}>`;
      }
      case 'subtitle':
      case 'text-author':
        return `<p${anchor}><strong>${inner()}</strong></p>`;
      case 'epigraph':
      case 'cite':
        return `<blockquote${anchor}>${inner()}</blockquote>`;
      case 'section':
        return `<section${anchor}>${inner(level + 1)}</section>`;
      case 'poem':
      case 'stanza':
      case 'annotation':
        return `<div${anchor}>${inner()}</div>`;
      case 'table':
      case 'tr':
      case 'th':
      case 'td':
        return `<${local(node.name)}>${inner()}</${local(node.name)}>`;
      default:
        return `<span${anchor}>${inner()}</span>`;
    }
  };
  const chapter = (title: string, path: string, html: string): EPUBChapter => {
    if (html.length > fictionBookLimits.chapterCharacters) {
      truncated = true;
      html = html.slice(0, fictionBookLimits.chapterCharacters);
    }
    return { title, path, html };
  };

  const coverImage = child(child(info, 'coverpage'), 'image');
  const cover = coverImage && picture(attribute(coverImage, 'href'));
  const title = metadata.title ?? 'Untitled book';
  const titlePage = [
    cover ? `<figure><img src="${cover}" alt="Cover"></figure>` : '',
    `<h1>${escapeHtml(title)}</h1>`,
    metadata.creator ? `<p><strong>${escapeHtml(metadata.creator)}</strong></p>` : '',
    metadata.series ? `<p>${escapeHtml(metadata.series)}</p>` : '',
    ...elements(child(info, 'annotation') ?? { name: '', attributes: {}, children: [] }).map(
      (node) => render(node, 1),
    ),
    ...front.map((node) => render(node, 0)),
  ].join('');
  const chapters = [
    chapter(title, 'title', titlePage),
    ...planned.map((item) =>
      chapter(
        item.title,
        item.path,
        item.nodes.map((node) => render(node, item.level - 1)).join(''),
      ),
    ),
  ];
  return { metadata, chapters, images, truncated };
}
