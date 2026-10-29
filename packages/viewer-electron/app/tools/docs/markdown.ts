import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import path from 'node:path';

interface MarkdownNode {
  type: string;
  value?: string;
  lang?: string | null;
  url?: string;
  alt?: string | null;
  identifier?: string;
  children?: MarkdownNode[];
}
export interface DocumentLink {
  url: string;
  image: boolean;
  alt?: string;
}
export interface MarkdownFacts {
  links: DocumentLink[];
  anchors: Set<string>;
  commands: string[];
}
export interface DocumentationProblem {
  file: string;
  message: string;
}
export const documentationSections = [
  'guides',
  'reference',
  'development',
  'adr',
  'research',
  'release',
  'media',
] as const;
const sections = new Set<string>(documentationSections);
const privatePath =
  /\/(?:Users|home)\/[^\s/<>]+|\/(?:private\/)?var\/folders\/|\/private\/tmp\/viewer-/;
/** Pages people read to use Viewer, as opposed to decisions, research and development notes. */
const readerPage =
  /^(?:README\.md|PRODUCT\.md|docs\/README\.md|docs\/(?:guides|reference|release)\/|packages\/[^/]+\/README\.md)/;
/** Words that pad a sentence without telling the reader anything. */
const filler =
  /\b(?:simply|useful|familiar|rather than|seamless(?:ly)?|effortless(?:ly)?|leverage|delve|unlock|empower|worth noting|in order to|feel free)\b/i;
/** The prose of a page: fenced code and inline code quote output, so they are left out. */
const proseLines = (text: string) =>
  text
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, (block) => block.replace(/[^\n]/g, ''))
    .replace(/`[^`\n]*`/g, '')
    .split('\n');
const textOf = (node: MarkdownNode): string =>
  node.value ?? node.children?.map(textOf).join('') ?? '';

export function markdownFacts(text: string): MarkdownFacts {
  const facts: MarkdownFacts = { links: [], anchors: new Set(), commands: [] };
  const references = new Map<string, string>();
  const unresolved: { identifier: string; image: boolean; alt?: string }[] = [];
  const slugs = new Map<string, number>();
  const inspect = () => (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (node.type === 'definition' && node.identifier && node.url)
        references.set(node.identifier.toLowerCase(), node.url);
      if (node.type === 'heading') {
        const slug = textOf(node)
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '')
          .replace(/\s/g, '-');
        const count = slugs.get(slug) ?? 0;
        slugs.set(slug, count + 1);
        facts.anchors.add(slug + (count ? '-' + count : ''));
      }
      if ((node.type === 'link' || node.type === 'image') && node.url)
        facts.links.push({ url: node.url, image: node.type === 'image', alt: node.alt ?? '' });
      if (node.type === 'linkReference' || node.type === 'imageReference')
        unresolved.push({
          identifier: node.identifier ?? '',
          image: node.type === 'imageReference',
          alt: node.alt ?? '',
        });
      if (node.type === 'html') {
        for (const match of (node.value ?? '').matchAll(/<(a|img|source)\b[^>]*>/gi)) {
          const tag = match[0];
          const attribute = (name: string) =>
            new RegExp('\\b' + name + '=["\']([^"\']*)["\']', 'i').exec(tag)?.[1];
          const anchor = attribute('id') || attribute('name');
          if (anchor) facts.anchors.add(anchor);
          const url = attribute('href') || attribute('src') || attribute('srcset');
          if (url)
            facts.links.push({
              url,
              image: match[1]?.toLowerCase() !== 'a',
              alt: attribute('alt'),
            });
        }
      }
      if (node.type === 'code' && /^(sh|bash|shell|console)?$/.test(node.lang ?? '')) {
        for (const match of (node.value ?? '').matchAll(/(?:^|\n)\s*(?:\$\s*)?pnpm\s+([\w:-]+)/g))
          facts.commands.push(match[1]!);
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
  renderToStaticMarkup(
    createElement(Markdown, { children: text, remarkPlugins: [remarkGfm, inspect] }),
  );
  for (const reference of unresolved)
    facts.links.push({
      ...reference,
      url: references.get(reference.identifier.toLowerCase()) ?? '',
    });
  return facts;
}

export function checkDocuments(
  documents: ReadonlyMap<string, string>,
  files: ReadonlySet<string>,
  scripts: ReadonlySet<string>,
): DocumentationProblem[] {
  const facts = new Map([...documents].map(([file, text]) => [file, markdownFacts(text)]));
  const problems: DocumentationProblem[] = [];
  const report = (file: string, message: string) => problems.push({ file, message });
  for (const [file, text] of documents) {
    if (file.startsWith('docs/') && file !== 'docs/README.md') {
      const [, section, page] = file.split('/');
      if (!page || !sections.has(section!))
        report(file, 'Put this page in a documented section; docs/ contains only its README.');
    }
    if (privatePath.test(text)) report(file, 'Contains a private machine path.');
    for (const [index, line] of proseLines(text).entries()) {
      if (line.includes('\u2014'))
        report(file, `Line ${index + 1}: use a full stop, comma or colon instead of an em dash.`);
      const padding = readerPage.test(file) ? filler.exec(line) : null;
      if (padding) report(file, `Line ${index + 1}: cut “${padding[0]}”; say what it means.`);
    }
    const parsed = facts.get(file)!;
    for (const link of parsed.links) {
      if (link.image && link.alt === '') report(file, 'An image needs useful alt text.');
      if (!link.url) {
        report(file, 'An unresolved reference link has no target.');
        continue;
      }
      if (/^(?:https?:|mailto:)/i.test(link.url)) continue;
      if (privatePath.test(link.url)) continue;
      if (/^[a-z][\w+.-]*:/i.test(link.url) || link.url.startsWith('/')) {
        report(file, 'Local links must be relative to the document.');
        continue;
      }
      let destination: string, anchor: string;
      try {
        const [url, fragment = ''] = link.url.split('#');
        destination = url
          ? path.posix.normalize(
              path.posix.join(path.posix.dirname(file), decodeURIComponent(url.split('?')[0]!)),
            )
          : file;
        anchor = decodeURIComponent(fragment);
      } catch {
        report(file, 'A link contains invalid URL escaping.');
        continue;
      }
      if (destination.startsWith('../')) {
        report(file, 'A link escapes the repository.');
        continue;
      }
      if (/(^|\/)(?:out|node_modules|\.impeccable)(\/|$)/.test(destination)) {
        report(file, 'A link points to private or generated artifacts: ' + destination);
        continue;
      }
      const directory = [...files].some((entry) =>
        entry.startsWith(destination.replace(/\/$/, '') + '/'),
      );
      if (!files.has(destination) && !directory)
        report(file, 'Missing link or media target: ' + destination);
      else if (anchor && facts.has(destination) && !facts.get(destination)!.anchors.has(anchor))
        report(file, 'Missing heading: ' + destination + '#' + anchor);
    }
    for (const command of parsed.commands)
      if (
        !scripts.has(command) &&
        !['install', 'exec', 'add', 'dlx', 'run', 'list', 'why'].includes(command)
      )
        report(file, 'Unknown documented package command: pnpm ' + command);
  }
  return problems;
}
