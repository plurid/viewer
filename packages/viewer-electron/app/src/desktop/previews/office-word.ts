import path from 'node:path';
import { attribute, child, children, localName, xmlText, type XMLNode } from './office-xml';
import { partTarget, typeIs, type Relationship } from './office-package';
import type {
  OfficeContent,
  WordInline,
  WordParagraph,
  WordTable,
} from '../../domain/previews/documents/office';
type Image = Extract<WordInline, { kind: 'image' }>;
const blocked = ['del', 'moveFrom', 'instrText'];
function text(node: XMLNode): string {
  const name = localName(node);
  if ([...blocked, 'drawing', 'pict', 'object'].includes(name)) return '';
  if (name === 't') return xmlText(node);
  if (name === 'tab') return '\t';
  if (name === 'br' || name === 'cr') return '\n';
  return children(node).map(text).join('');
}
function paragraphs(node: XMLNode): XMLNode[] {
  if (['del', 'moveFrom'].includes(localName(node))) return [];
  if (localName(node) === 'p') return [node];
  return children(node).flatMap(paragraphs);
}
function descendants(node: XMLNode, name: string, limit = 257): XMLNode[] {
  const result: XMLNode[] = [],
    stack = [node];
  while (stack.length && result.length < limit) {
    const current = stack.pop()!;
    if (localName(current) === name) result.push(current);
    const nested = children(current);
    for (let index = nested.length - 1; index >= 0; index--) stack.push(nested[index]!);
  }
  return result;
}

export function wordContent(
  main: XMLNode,
  source: string,
  rels: readonly Relationship[],
  entries: ReadonlyMap<string, { size: number; directory: boolean; previewable: boolean }>,
  types: XMLNode,
): { content: OfficeContent; truncated: boolean } {
  const body = child(main, 'body');
  if (localName(main) !== 'document' || !body)
    throw new Error('This DOCX has no readable document body.');
  const blocks: (WordParagraph | WordTable)[] = [];
  let characters = 0,
    tableCells = 0,
    truncated = false,
    images = 0;
  const boundedText = (node: XMLNode) => {
    const value = text(node),
      bounded = value.slice(0, Math.max(0, 500000 - characters));
    characters += bounded.length;
    if (bounded.length < value.length) truncated = true;
    return bounded;
  };
  const image = (reference: XMLNode | undefined, container: XMLNode): Image => {
    const description = descendants(container, 'docPr', 1)[0];
    const alt = (
      (description &&
        (attribute(description, 'descr') ||
          attribute(description, 'title') ||
          attribute(description, 'name'))) ||
      'Embedded image'
    ).slice(0, 1000);
    const result: Image = { kind: 'image', alt };
    images++;
    if (images > 256) {
      truncated = true;
      return { ...result, warning: 'Image count exceeds the preview limit.' };
    }
    const id =
      reference &&
      (attribute(reference, 'embed') || attribute(reference, 'id') || attribute(reference, 'link'));
    const relation = rels.find((item) => item.id === id);
    if (!relation || !typeIs(relation.type, 'image'))
      return { ...result, warning: 'This embedded drawing is not supported.' };
    if (relation.external) return { ...result, warning: 'External images are not loaded.' };
    const part = partTarget(source, relation.target),
      item = entries.get(part);
    if (!item || item.directory || !item.previewable)
      return { ...result, warning: 'The embedded image is missing or unavailable.' };
    const override = children(types, 'Override').find(
      (node) => partTarget('', attribute(node, 'PartName') || '') === part,
    );
    const extension = path.posix.extname(part).slice(1).toLowerCase();
    const declaration =
      override ??
      children(types, 'Default').find(
        (node) => (attribute(node, 'Extension') ?? '').toLowerCase() === extension,
      );
    const mime = declaration && attribute(declaration, 'ContentType');
    if (
      !['image/png', 'image/jpeg'].includes(mime ?? '') ||
      !['png', 'jpg', 'jpeg'].includes(extension)
    )
      return { ...result, warning: 'Only embedded PNG and JPEG images are shown.' };
    if (item.size > 8 * 1024 * 1024)
      return { ...result, warning: 'The embedded image exceeds the 8 MiB preview limit.' };
    const extent = descendants(container, 'extent', 1)[0];
    const pixels = (key: string) => {
      const value = Number(extent && attribute(extent, key)) / 9525;
      return Number.isFinite(value) && value > 0 && value <= 20000 ? value : undefined;
    };
    return { ...result, part, width: pixels('cx'), height: pixels('cy') };
  };
  const inlines = (node: XMLNode, limit: number): WordInline[] => {
    let emitted = 0;
    const items: WordInline[] = [];
    const append = (value: string) => {
      const bounded = value.slice(0, Math.max(0, limit - emitted));
      emitted += bounded.length;
      if (!bounded) return;
      const previous = items.at(-1);
      if (previous?.kind === 'text') previous.text += bounded;
      else items.push({ kind: 'text', text: bounded });
    };
    const visit = (part: XMLNode) => {
      const name = localName(part);
      if (blocked.includes(name)) return;
      if (['drawing', 'pict', 'object'].includes(name)) {
        if (images >= 256) {
          truncated = true;
          if (images === 256) {
            images++;
            items.push({
              kind: 'image',
              alt: 'Additional images',
              warning: 'Image count exceeds the preview limit.',
            });
          }
          return;
        }
        const references = [...descendants(part, 'blip'), ...descendants(part, 'imagedata')];
        if (!references.length) items.push(image(undefined, part));
        else
          for (const reference of references.slice(0, 257 - images))
            items.push(image(reference, part));
      } else if (name === 'AlternateContent') {
        const choices = children(part, 'Choice'),
          selected =
            choices.find((choice) => descendants(choice, 'blip', 1).length) ||
            child(part, 'Fallback') ||
            choices[0];
        if (selected) visit(selected);
      } else if (name === 't') append(xmlText(part));
      else if (name === 'tab') append('\t');
      else if (name === 'br' || name === 'cr') append('\n');
      else for (const nested of children(part)) visit(nested);
    };
    visit(node);
    return items;
  };
  const visit = (node: XMLNode) => {
    if (blocks.length >= 2000 || characters >= 500000) {
      truncated = true;
      return;
    }
    const name = localName(node);
    if (['del', 'moveFrom'].includes(name)) return;
    if (name === 'p') {
      const value = boundedText(node),
        parts = inlines(node, value.length),
        properties = child(node, 'pPr');
      const outline = properties && child(properties, 'outlineLvl'),
        style = properties && child(properties, 'pStyle');
      const level = outline
        ? Number(attribute(outline, 'val')) + 1
        : Number(style && attribute(style, 'val')?.match(/^Heading([1-6])$/i)?.[1]);
      blocks.push({
        kind: 'paragraph',
        text: value,
        ...(level >= 1 && level <= 6 ? { heading: level } : {}),
        ...(parts.some((item) => item.kind === 'image') ? { inlines: parts } : {}),
      });
    } else if (name === 'tbl') {
      const media: NonNullable<WordTable['media']> = [],
        rows = children(node, 'tr');
      if (rows.length > 500) truncated = true;
      const parsed = rows.slice(0, 500).map((row, r) => {
        const cells = children(row, 'tc');
        if (cells.length > 100 || tableCells + cells.length > 10000) truncated = true;
        const retained = cells.slice(0, Math.min(100, Math.max(0, 10000 - tableCells)));
        tableCells += retained.length;
        return retained.map((cell, c) => {
          const nodes = paragraphs(cell),
            texts = nodes.map(boundedText),
            parts = nodes.flatMap((node, index) => [
              ...(index ? [{ kind: 'text' as const, text: '\n' }] : []),
              ...inlines(node, texts[index]!.length),
            ]);
          if (parts.some((item) => item.kind === 'image'))
            media.push({ row: r, column: c, inlines: parts });
          return texts.join('\n');
        });
      });
      blocks.push({ kind: 'table', rows: parsed, ...(media.length ? { media } : {}) });
    } else for (const nested of children(node)) visit(nested);
  };
  for (const node of children(body)) visit(node);
  return { content: { kind: 'word', blocks }, truncated };
}
