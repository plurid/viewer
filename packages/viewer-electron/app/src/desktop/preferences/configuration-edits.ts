import {
  applyEdits,
  findNodeAtLocation,
  format,
  modify,
  parseTree,
  type FormattingOptions,
  type JSONPath,
  type Node,
} from 'jsonc-parser';

/**
 * Text edits element by element. A changed list was one edit, the whole value written
 * again, so every comment inside it went, those of unchanged items too; jsonc-parser's own removal
 * took the comments above the next item and broke a list written on one line. A list's items are
 * matched, by `id` when every item has a unique one and by value when all are plain values, and
 * only the ones that differ are removed, inserted or edited in place. An item owns the comment lines
 * directly above it and the comment on its own line, and goes with them.
 */
export type ConfigEdit =
  | { kind: 'set'; path: JSONPath; value: unknown }
  | { kind: 'insert'; path: JSONPath; value: unknown; from?: JSONPath }
  | { kind: 'remove'; path: JSONPath };

const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const primitive = (value: unknown) =>
  value === null || ['string', 'number', 'boolean'].includes(typeof value);

export interface ConfigEditOptions {
  objectValues?: boolean;
}
function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (plain(value))
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  return value;
}

/** How two lists' items are told apart: by a unique `id`, or by value for plain values. */
function itemKey(
  before: unknown[],
  after: unknown[],
  options: ConfigEditOptions,
): ((item: unknown) => string) | undefined {
  const ids = (items: unknown[]) =>
    items.map((item) => (plain(item) && typeof item.id === 'string' ? item.id : undefined));
  const unique = (keys: (string | undefined)[]) =>
    keys.every((key) => key !== undefined) && new Set(keys).size === keys.length;
  if (unique(ids(before)) && unique(ids(after)))
    return (item) => 'id:' + (item as { id: string }).id;
  if ([...before, ...after].every(primitive)) return (item) => JSON.stringify(item);
  if (
    options.objectValues &&
    [...before, ...after].every((item) => plain(item) && !Object.hasOwn(item, 'id'))
  )
    return (item) => JSON.stringify(canonicalValue(item));
  return undefined;
}

/** The longest common subsequence of two key lists, as matched index pairs in order. */
function matched(before: string[], after: string[]): [number, number][] {
  const table = Array.from({ length: before.length + 1 }, () =>
    new Array<number>(after.length + 1).fill(0),
  );
  for (let i = before.length - 1; i >= 0; i--)
    for (let j = after.length - 1; j >= 0; j--)
      table[i]![j] =
        before[i] === after[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < before.length && j < after.length;) {
    if (before[i] === after[j]) pairs.push([i++, j++]);
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

/**
 * The edits that turn `before` into `after`. Removals come first, from the last; then insertions,
 * from the first; then the matched items' own edits. The matched items keep their order, so after the
 * removals and insertions the list is in `after`'s order and every index below is valid when applied
 * one by one.
 */
export function configEdits(
  before: unknown,
  after: unknown,
  path: JSONPath = [],
  options: ConfigEditOptions = {},
): ConfigEdit[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (plain(before) && plain(after))
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(
      (key): ConfigEdit[] =>
        after[key] === undefined
          ? before[key] === undefined
            ? []
            : [{ kind: 'remove', path: [...path, key] }]
          : before[key] === undefined
            ? [{ kind: 'set', path: [...path, key], value: after[key] }]
            : configEdits(before[key], after[key], [...path, key], options),
    );
  if (!Array.isArray(before) || !Array.isArray(after)) return [{ kind: 'set', path, value: after }];
  const key = itemKey(before, after, options);
  if (!key) return [{ kind: 'set', path, value: after }];
  const pairs = matched(before.map(key), after.map(key));
  const kept = new Set(pairs.map(([index]) => index));
  const placed = new Set(pairs.map(([, index]) => index));
  const reusable = new Set(before.map((_, index) => index).filter((index) => !kept.has(index)));
  return [
    ...before
      .map((_, index) => index)
      .filter((index) => !kept.has(index))
      .reverse()
      .map((index): ConfigEdit => ({ kind: 'remove', path: [...path, index] })),
    ...after
      .map((_, index) => index)
      .filter((index) => !placed.has(index))
      .map((index): ConfigEdit => {
        const value = after[index];
        const from =
          options.objectValues && plain(value) && !Object.hasOwn(value, 'id')
            ? [...reusable].find((source) => key(before[source]) === key(value))
            : undefined;
        if (from !== undefined) reusable.delete(from);
        return {
          kind: 'insert',
          path: [...path, index],
          value,
          ...(from !== undefined ? { from: [...path, from] } : {}),
        };
      }),
    ...pairs.flatMap(([from, to]) => configEdits(before[from], after[to], [...path, to], options)),
  ];
}

/** Applies `configEdits` to JSONC text, re-reading the text for each. */
export function applyConfigEdits(
  text: string,
  edits: readonly ConfigEdit[],
  formattingOptions: FormattingOptions,
): string {
  // Read moved items before any removal changes their offsets or discards their comments.
  const originals = edits.map((edit) =>
    edit.kind === 'insert' && edit.from ? writtenItem(text, edit.from) : undefined,
  );
  for (const [index, edit] of edits.entries())
    text =
      edit.kind === 'remove'
        ? remove(text, edit.path)
        : edit.kind === 'insert'
          ? insert(text, edit.path, edit.value, formattingOptions, originals[index])
          : applyEdits(text, modify(text, edit.path, edit.value, { formattingOptions }));
  return text;
}

const lineStart = (text: string, offset: number) => text.lastIndexOf('\n', offset - 1) + 1;
/** Where the line holding `offset` ends: its `\r\n` or `\n`, or the end of the text. */
const lineEnd = (text: string, offset: number) => {
  const at = text.indexOf('\n', offset);
  if (at < 0) return text.length;
  return text[at - 1] === '\r' ? at - 1 : at;
};
/** An item on a line of its own: nothing before it there, and the next item or the closing
 * bracket on a later line. */
const ownLine = (text: string, parent: Node, index: number) => {
  const child = parent.children![index]!;
  const next = parent.children![index + 1];
  return (
    /^[\t ]*$/.test(text.slice(lineStart(text, child.offset), child.offset)) &&
    lineEnd(text, child.offset + child.length) <
      (next ? next.offset : parent.offset + parent.length - 1)
  );
};
const locate = (text: string, path: JSONPath) => {
  const parent = findNodeAtLocation(
    parseTree(text, [], { allowTrailingComma: true })!,
    path.slice(0, -1),
  );
  const last = path.at(-1);
  const index =
    typeof last === 'number'
      ? last
      : (parent?.children?.findIndex((property) => property.children?.[0]?.value === last) ?? -1);
  return { parent, index };
};

function remove(text: string, path: JSONPath): string {
  const { parent, index } = locate(text, path);
  const children = parent?.children;
  if (!parent || !children || index < 0 || index >= children.length) return text;
  if (children.length === 1)
    return text.slice(0, parent.offset + 1) + text.slice(parent.offset + parent.length - 1);
  const child = children[index]!;
  const end = child.offset + child.length;
  const previous = children[index - 1];
  const next = children[index + 1];
  if (!ownLine(text, parent, index))
    return next
      ? text.slice(0, child.offset) + text.slice(next.offset)
      : text.slice(0, previous!.offset + previous!.length) + text.slice(end);
  // whole lines: from the end of the line before (the previous item's, or the bracket's) to the
  // end of this item's line, so its comments go with it and the next item keeps its own
  const from = lineEnd(text, previous ? previous.offset + previous.length : parent.offset);
  let result = text.slice(0, from) + text.slice(lineEnd(text, end));
  const comma = (offset: number) => /^[\t ]*,/.exec(text.slice(offset, lineEnd(text, offset)));
  if (!next && previous && !comma(end)) {
    // the last item went: the comma after the one before it goes too
    const found = comma(previous.offset + previous.length);
    if (found) {
      const at = previous.offset + previous.length + found[0].length - 1;
      result = result.slice(0, at) + result.slice(at + 1);
    }
  }
  return result;
}

interface WrittenConfigItem {
  prefix: string;
  value: string;
  suffix: string;
}

function writtenItem(text: string, path: JSONPath): WrittenConfigItem | undefined {
  const { parent, index } = locate(text, path);
  const child = parent?.children?.[index];
  if (!parent || !child) return undefined;
  const end = child.offset + child.length;
  const own = ownLine(text, parent, index);
  const previous = parent.children?.[index - 1];
  const from = lineEnd(text, previous ? previous.offset + previous.length : parent.offset);
  const start = own ? text.indexOf('\n', from) + 1 : child.offset;
  return {
    prefix: text.slice(start, child.offset),
    value: text.slice(child.offset, end),
    suffix: own ? text.slice(end, lineEnd(text, end)).replace(/^([\t ]*),/, '$1') : '',
  };
}

function insert(
  text: string,
  path: JSONPath,
  value: unknown,
  formattingOptions: FormattingOptions,
  original?: WrittenConfigItem,
): string {
  const { parent, index } = locate(text, path);
  const children = parent?.children ?? [];
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const formatted = (inserted: string, offset: number, length: number) =>
    applyEdits(inserted, format(inserted, { offset, length }, formattingOptions));
  if (parent && index < children.length && ownLine(text, parent, index)) {
    // above the comment lines that belong to the item now at this index, so they stay with it
    const target = children[index]!;
    let start = lineStart(text, target.offset);
    while (start > 0) {
      const above = lineStart(text, start - 1);
      if (!/^[\t ]*\/\//.test(text.slice(above, start))) break;
      start = above;
    }
    const indent = text.slice(lineStart(text, target.offset), target.offset);
    const content = original
      ? (original.prefix || indent) + original.value + ',' + original.suffix + eol
      : indent + JSON.stringify(value) + ',' + eol;
    const inserted = text.slice(0, start) + content + text.slice(start);
    return original ? inserted : formatted(inserted, start, content.length);
  }
  const last = children.at(-1);
  if (parent && last && index === children.length && ownLine(text, parent, children.length - 1)) {
    // after the last item's line, so a comment on that line stays with it
    const end = last.offset + last.length;
    const at = lineEnd(text, end);
    const indent = text.slice(lineStart(text, last.offset), last.offset);
    const content =
      eol +
      (original
        ? (original.prefix || indent) + original.value + original.suffix
        : indent + JSON.stringify(value));
    let inserted = text.slice(0, at) + content + text.slice(at);
    let offset = at;
    if (!/^[\t ]*,/.test(text.slice(end, at))) {
      inserted = inserted.slice(0, end) + ',' + inserted.slice(end);
      offset += 1;
    }
    return original ? inserted : formatted(inserted, offset, content.length);
  }
  if (original && parent) {
    const target = children[index];
    const ending = original.suffix + (original.suffix.includes('//') ? eol : '');
    const content = original.prefix + original.value;
    if (target)
      return text.slice(0, target.offset) + content + ',' + ending + text.slice(target.offset);
    const at = parent.offset + parent.length - 1;
    if (last) {
      const end = last.offset + last.length;
      const comma = /^[\t ]*,/.test(text.slice(end, at)) ? '' : ',';
      return text.slice(0, end) + comma + text.slice(end, at) + content + ending + text.slice(at);
    }
    return text.slice(0, at) + content + ending + text.slice(at);
  }
  return applyEdits(text, modify(text, path, value, { formattingOptions, isArrayInsertion: true }));
}
