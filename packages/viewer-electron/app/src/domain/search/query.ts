import type { FileEntry } from '../contracts';
import { searchPattern, type SearchPattern } from './pattern';
import { errorMessage } from '../errors';
import { officeFormats } from '../previews/documents/layout';

/**
 * The file query language: one parser for the folder filter, the search through
 * subfolders, the index and saved searches. Words are in the name; `"a phrase"` too; and terms say
 * more, as GitHub's and Gmail's search boxes do:
 *
 *   ext:md,txt   kind:folder|file|link|image|video|audio|text|document|archive|app
 *   name:draft   path:Projects   size>10mb   size<=1kb   modified<7d   created>=2026-01-01
 *   modified:today   tag:red   tag:"Project X"   is:hidden   ~^IMG_\d+   -ext:tmp   a OR b   (a b)
 *
 * Terms side by side must all match; OR between them, either; `-` turns one down; parentheses
 * group. `size:>10mb` and `modified:>2025-01-01`, as the index read them before, still work. A
 * quote left open runs to the end, so a filter typed letter by letter never stops on one.
 */
export type QueryNode =
  | { kind: 'and' | 'or'; nodes: QueryNode[] }
  | { kind: 'not'; node: QueryNode }
  /** In the name, folded: case and accents aside. */
  | { kind: 'text'; text: string }
  | { kind: 'regex'; regex: SearchPattern; source: string }
  | { kind: 'ext'; extensions: string[] }
  | { kind: 'type'; type: QueryType }
  | { kind: 'path'; text: string }
  | { kind: 'size'; op: Comparison; bytes: number }
  /** A time between `from` (inclusive) and `to` (exclusive), epoch milliseconds. */
  | { kind: 'date'; field: 'modified' | 'created'; from?: number; to?: number }
  | { kind: 'tag'; tag: string }
  | { kind: 'is'; what: 'hidden' | 'link' | 'file' | 'folder' };
export type Comparison = '<' | '<=' | '>' | '>=' | '=';
export const queryTypes = [
  'file',
  'folder',
  'link',
  'app',
  'image',
  'video',
  'audio',
  'text',
  'document',
  'archive',
] as const;
export type QueryType = (typeof queryTypes)[number];
export interface FileQuery {
  /** Null matches everything: an empty query. */
  root: QueryNode | null;
  /** The bare words and phrases, for ranking names and an index's text search. */
  words: string[];
  /** Finder tags it asks about, to look up before matching. */
  tags: string[];
  /** Whether it needs more than a folder's read gives: sizes, dates, kinds by content, links. */
  needsStat: boolean;
}
/** A query that does not parse: what, and the column where. */
export class QueryError extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message);
    this.name = 'QueryError';
  }
}
/** Text as names are compared: case and accents set aside, as the index folds them. */
export const foldText = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase();

type Token =
  | { kind: 'open' | 'close' | 'or' | 'not'; at: number }
  | { kind: 'word'; text: string; quoted: boolean; at: number }
  | { kind: 'regex'; text: string; at: number }
  | { kind: 'term'; key: string; op: string; value: string; at: number };
const keys: Readonly<Record<string, string>> = {
  ext: 'ext',
  extension: 'ext',
  kind: 'kind',
  type: 'kind',
  name: 'name',
  path: 'path',
  in: 'path',
  size: 'size',
  modified: 'modified',
  mod: 'modified',
  date: 'modified',
  created: 'created',
  tag: 'tag',
  tags: 'tag',
  is: 'is',
};
/** A quoted or bare value from `at`: a quote left open runs to the end. */
function readValue(text: string, at: number): { value: string; quoted: boolean; end: number } {
  if (text[at] === '"') {
    const close = text.indexOf('"', at + 1);
    return close < 0
      ? { value: text.slice(at + 1), quoted: true, end: text.length }
      : { value: text.slice(at + 1, close), quoted: true, end: close + 1 };
  }
  let end = at;
  while (end < text.length && !/[\s)]/.test(text[end]!)) end++;
  return { value: text.slice(at, end), quoted: false, end };
}
function tokens(text: string): Token[] {
  const list: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index]!;
    if (/\s/.test(character)) {
      index++;
      continue;
    }
    const at = index;
    if (character === '(' || character === ')') {
      list.push({ kind: character === '(' ? 'open' : 'close', at });
      index++;
      continue;
    }
    if (character === '-' && index + 1 < text.length && !/\s/.test(text[index + 1]!)) {
      list.push({ kind: 'not', at });
      index++;
      continue;
    }
    if (character === '~') {
      const { value, end } = readValue(text, index + 1);
      list.push({ kind: 'regex', text: value, at });
      index = end;
      continue;
    }
    const term = /^([A-Za-z]+)(>=|<=|:|>|<|=)/.exec(text.slice(index));
    if (term && keys[term[1]!.toLowerCase()]) {
      const { value, end } = readValue(text, index + term[0].length);
      list.push({ kind: 'term', key: keys[term[1]!.toLowerCase()]!, op: term[2]!, value, at });
      index = end;
      continue;
    }
    const { value, quoted, end } = readValue(text, index);
    if (!quoted && value === 'OR') list.push({ kind: 'or', at });
    else list.push({ kind: 'word', text: value, quoted, at });
    index = end;
  }
  return list;
}

const units: Readonly<Record<string, number>> = {
  '': 1,
  b: 1,
  k: 1024,
  kb: 1024,
  m: 1024 ** 2,
  mb: 1024 ** 2,
  g: 1024 ** 3,
  gb: 1024 ** 3,
  t: 1024 ** 4,
  tb: 1024 ** 4,
};
const durations: Readonly<Record<string, number>> = {
  h: 3600_000,
  d: 86_400_000,
  w: 7 * 86_400_000,
  mo: 30 * 86_400_000,
  y: 365 * 86_400_000,
};
/** `op` from `size:>10mb` as well as `size>10mb`: the value may carry it. */
function comparison(op: string, value: string): { op: Comparison; value: string } {
  if (op === ':') {
    const inner = /^(>=|<=|>|<|=)/.exec(value)?.[1];
    return inner
      ? { op: inner as Comparison, value: value.slice(inner.length) }
      : { op: '=', value };
  }
  return { op: op as Comparison, value };
}
/** A day, a month or a year in local time, from a date written `2026-01-31`, `2026-01`, `2026`. */
function period(value: string, now: number): { start: number; end: number } | undefined {
  const day = (offset: number) => {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + offset);
    const start = date.getTime();
    date.setDate(date.getDate() + 1);
    return { start, end: date.getTime() };
  };
  if (value === 'today') return day(0);
  if (value === 'yesterday') return day(-1);
  const match = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(value);
  if (!match) return undefined;
  const [year, month, date] = [Number(match[1]), Number(match[2] ?? 1) - 1, Number(match[3] ?? 1)];
  const start = new Date(year, month, date);
  if (start.getMonth() !== month || start.getDate() !== date) return undefined;
  const end = new Date(start);
  if (match[3]) end.setDate(end.getDate() + 1);
  else if (match[2]) end.setMonth(end.getMonth() + 1);
  else end.setFullYear(end.getFullYear() + 1);
  return { start: start.getTime(), end: end.getTime() };
}
function term(token: Extract<Token, { kind: 'term' }>, now: number): QueryNode {
  const { key, at } = token;
  const value = token.value.trim();
  switch (key) {
    case 'ext': {
      const extensions = value
        .toLowerCase()
        .split(',')
        .map((item) => item.trim().replace(/^\./, ''))
        .filter(Boolean);
      if (!extensions.length) throw new QueryError('ext: names extensions: ext:md,txt.', at);
      return { kind: 'ext', extensions };
    }
    case 'kind': {
      const named = value
        .toLowerCase()
        .replace(/(ies)$/, 'y')
        .replace(/s$/, '');
      const type =
        (
          {
            directory: 'folder',
            dir: 'folder',
            symlink: 'link',
            application: 'app',
            photo: 'image',
            movie: 'video',
            music: 'audio',
            doc: 'document',
          } as Record<string, QueryType | undefined>
        )[named] ?? (queryTypes as readonly string[]).find((item) => item === named);
      if (!type)
        throw new QueryError(
          `Use kind:file or kind:folder, or ${queryTypes.slice(2).join(', ')}.`,
          at,
        );
      return { kind: 'type', type: type as QueryType };
    }
    case 'name':
      return { kind: 'text', text: foldText(value) };
    case 'path':
      return { kind: 'path', text: value };
    case 'tag':
      if (!value) throw new QueryError('tag: names a Finder tag: tag:red.', at);
      return { kind: 'tag', tag: value };
    case 'is': {
      const what = value.toLowerCase();
      if (!['hidden', 'link', 'file', 'folder'].includes(what))
        throw new QueryError('Use is:hidden, is:link, is:file or is:folder.', at);
      return { kind: 'is', what: what as 'hidden' };
    }
    case 'size': {
      const { op, value: amount } = comparison(token.op, value);
      const match = /^(\d+(?:\.\d+)?)\s*([kmgt]?b?)$/i.exec(amount);
      if (!match || !(match[2]!.toLowerCase() in units))
        throw new QueryError('Sizes read size>10mb, size<1kb, size=0.', at);
      return {
        kind: 'size',
        op,
        bytes: Number(match[1]) * units[match[2]!.toLowerCase()]!,
      };
    }
    default: {
      const field = key as 'modified' | 'created';
      const { op, value: when } = comparison(token.op, value.toLowerCase());
      const duration = /^(\d+(?:\.\d+)?)(h|d|w|mo|y)$/.exec(when);
      if (duration) {
        // how long ago: < is newer than that, > older, = within it
        const edge = now - Number(duration[1]) * durations[duration[2]!]!;
        return op === '>' || op === '>='
          ? { kind: 'date', field, to: edge }
          : { kind: 'date', field, from: edge };
      }
      const span = period(when, now);
      if (!span)
        throw new QueryError(
          `Dates read ${field}<7d, ${field}>2026-01-01, ${field}:today; durations h, d, w, mo, y.`,
          at,
        );
      return op === '<'
        ? { kind: 'date', field, to: span.start }
        : op === '<='
          ? { kind: 'date', field, to: span.end }
          : op === '>'
            ? { kind: 'date', field, from: span.end }
            : op === '>='
              ? { kind: 'date', field, from: span.start }
              : { kind: 'date', field, from: span.start, to: span.end };
    }
  }
}
/**
 * A query read: `now` places relative dates (`modified<7d`). An empty one matches everything.
 */
export function parseFileQuery(text: string, now = Date.now()): FileQuery {
  if (text.length > 1000) throw new QueryError('A query is at most 1000 characters.', 1000);
  const list = tokens(text);
  let position = 0;
  const words: string[] = [];
  const tags: string[] = [];
  let needsStat = false;
  const either = (): QueryNode => {
    const nodes = [all()];
    while (list[position]?.kind === 'or') {
      position++;
      if (!list[position] || list[position]!.kind === 'close')
        throw new QueryError('OR needs a term after it.', list[position - 1]!.at);
      nodes.push(all());
    }
    return nodes.length === 1 ? nodes[0]! : { kind: 'or', nodes };
  };
  const all = (): QueryNode => {
    const nodes: QueryNode[] = [];
    while (position < list.length && !['or', 'close'].includes(list[position]!.kind))
      nodes.push(one(false));
    if (!nodes.length) {
      const next = list[position];
      throw new QueryError(
        next?.kind === 'or'
          ? 'OR needs a term before it.'
          : next?.kind === 'close'
            ? 'A ) closes nothing.'
            : 'A term is expected here.',
        next?.at ?? 0,
      );
    }
    return nodes.length === 1 ? nodes[0]! : { kind: 'and', nodes };
  };
  const one = (negated: boolean): QueryNode => {
    const token = list[position++]!;
    if (token.kind === 'not') {
      if (!list[position]) throw new QueryError('- needs a term after it.', token.at);
      return { kind: 'not', node: one(true) };
    }
    if (token.kind === 'open') {
      const node = either();
      if (list[position]?.kind !== 'close') throw new QueryError('A ( is not closed.', token.at);
      position++;
      return node;
    }
    if (token.kind === 'close') throw new QueryError('A ) closes nothing.', token.at);
    if (token.kind === 'or') throw new QueryError('OR needs a term before it.', token.at);
    if (token.kind === 'regex') {
      try {
        return { kind: 'regex', regex: searchPattern(token.text), source: token.text };
      } catch (error) {
        throw new QueryError(`~${token.text} is not a pattern. ${errorMessage(error)}`, token.at);
      }
    }
    if (token.kind === 'word') {
      if (!negated && token.text) words.push(token.text);
      return { kind: 'text', text: foldText(token.text) };
    }
    const node = term(token as Extract<Token, { kind: 'term' }>, now);
    if (node.kind === 'tag') tags.push(node.tag);
    if (
      node.kind === 'size' ||
      node.kind === 'date' ||
      (node.kind === 'is' && node.what === 'link') ||
      (node.kind === 'type' &&
        !['file', 'folder', 'app', 'document', 'archive'].includes(node.type))
    )
      needsStat = true;
    return node;
  };
  const root = list.length ? either() : null;
  if (position < list.length) throw new QueryError('A ) closes nothing.', list[position]!.at);
  return { root, words, tags: [...new Set(tags)], needsStat };
}

/** What a query looks at in an entry; a folder's read without a stat gives the first six. */
export type QueryEntry = Pick<
  FileEntry,
  'name' | 'path' | 'extension' | 'directory' | 'hidden' | 'kind'
> &
  Partial<Pick<FileEntry, 'size' | 'modified' | 'created' | 'mime' | 'linkTarget'>>;
export interface QueryFacts {
  /** The paths carrying a Finder tag, looked up for the query's tags. */
  tagged?(tag: string): ReadonlySet<string> | undefined;
  /** Words matched elsewhere (an index's document text): not checked against names here. */
  skipWords?: boolean;
}
const documents = new Set<string>([
  ...officeFormats,
  'pdf',
  'doc',
  'docx',
  'pages',
  'rtf',
  'odt',
  'txt',
  'md',
  'epub',
  'xls',
  'xlsx',
  'numbers',
  'key',
  'ppt',
  'pptx',
  'csv',
]);
const archives = new Set(['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'dmg', 'zst']);
function ofType(entry: QueryEntry, type: QueryType): boolean {
  const extension = entry.extension.toLowerCase().replace(/^\./, '');
  switch (type) {
    case 'file':
      return !entry.directory;
    case 'folder':
      return entry.directory && extension !== 'app';
    case 'link':
      return entry.kind === 'symlink' || !!entry.linkTarget;
    case 'app':
      return extension === 'app';
    case 'document':
      return !entry.directory && documents.has(extension);
    case 'archive':
      return !entry.directory && archives.has(extension);
    default:
      return !entry.directory && !!entry.mime?.startsWith(type + '/');
  }
}
const compare = (value: number, op: Comparison, against: number) =>
  op === '<'
    ? value < against
    : op === '<='
      ? value <= against
      : op === '>'
        ? value > against
        : op === '>='
          ? value >= against
          : value === against;
/** Whether an entry answers a query; tags come from `facts`, looked up before. */
export function matchesQuery(query: FileQuery, entry: QueryEntry, facts: QueryFacts = {}): boolean {
  if (!query.root) return true;
  const name = foldText(entry.name);
  const test = (node: QueryNode): boolean => {
    switch (node.kind) {
      case 'and':
        return node.nodes.every(test);
      case 'or':
        return node.nodes.some(test);
      case 'not':
        return !test(node.node);
      case 'text':
        return facts.skipWords || name.includes(node.text);
      case 'regex':
        return node.regex.test(entry.name);
      case 'ext':
        return node.extensions.includes(entry.extension.toLowerCase().replace(/^\./, ''));
      case 'type':
        return ofType(entry, node.type);
      case 'path':
        return foldText(entry.path).includes(foldText(node.text));
      case 'size':
        return (
          !entry.directory && entry.size !== undefined && compare(entry.size, node.op, node.bytes)
        );
      case 'date': {
        const time = entry[node.field];
        return (
          time !== undefined &&
          (node.from === undefined || time >= node.from) &&
          (node.to === undefined || time < node.to)
        );
      }
      case 'tag':
        return !!facts.tagged?.(node.tag)?.has(entry.path);
      case 'is':
        return node.what === 'hidden'
          ? entry.hidden
          : node.what === 'link'
            ? ofType(entry, 'link')
            : node.what === 'folder'
              ? entry.directory
              : !entry.directory;
    }
  };
  return test(query.root);
}
/** The words every match has in its name: those side by side at the top, for ranking names. */
export function topWords(query: FileQuery): string[] {
  const top = !query.root ? [] : query.root.kind === 'and' ? query.root.nodes : [query.root];
  return top.flatMap((node) => (node.kind === 'text' && node.text ? [node.text] : []));
}
/** The query without its words at the top: an index matched those in documents' text. */
export function withoutTopWords(query: FileQuery): FileQuery {
  const root = query.root;
  if (!root) return query;
  if (root.kind === 'text') return { ...query, root: null };
  if (root.kind !== 'and') return query;
  const nodes = root.nodes.filter((node) => node.kind !== 'text');
  return {
    ...query,
    root: !nodes.length ? null : nodes.length === 1 ? nodes[0]! : { kind: 'and', nodes },
  };
}
/**
 * A pattern, as a commander selects by one: globs, each word one and any matching
 * (`*.md *.txt`, `IMG_????.jpg`), or else a query (`ext:md modified<7d`).
 */
export function parsePattern(text: string, now = Date.now()): FileQuery {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const glob =
    words.length > 0 && words.every((word) => /[*?]/.test(word) && !/^[-~(]|[:<>="]/.test(word));
  if (!glob) return parseFileQuery(text, now);
  const nodes: QueryNode[] = words.map((word) => ({
    kind: 'regex',
    regex: new RegExp(
      '^' +
        word
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.') +
        '$',
      'iu',
    ),
    source: word,
  }));
  return {
    root: nodes.length === 1 ? nodes[0]! : { kind: 'or', nodes },
    words: [],
    tags: [],
    needsStat: false,
  };
}
