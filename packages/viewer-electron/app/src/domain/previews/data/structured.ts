import JSON5 from 'json5';
import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser';
import { parseAllDocuments } from 'yaml';

export const structuredFormats = ['json', 'jsonc', 'json5', 'yaml', 'yml'] as const;
export const isStructured = (extension: string) =>
  (structuredFormats as readonly string[]).includes(extension);
export interface DataNode {
  path: string;
  parent?: string;
  name: string;
  depth: number;
  kind: 'object' | 'array' | 'value' | 'reference';
  summary: string;
  value: unknown;
  children: string[];
}
export interface StructuredData {
  nodes: DataNode[];
  roots: string[];
  error?: string;
  limited: boolean;
}
const pointer = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
const scalar = (value: unknown) =>
  typeof value === 'string' ? JSON.stringify(value) : String(value);

/** Parse a bounded inspection tree; source text is retained separately, never rewritten.
 * YAML uses its core schema, string keys and a bounded alias expansion budget. */
export function inspectStructured(
  text: string,
  extension: string,
  maximum = 50_000,
): StructuredData {
  const result: StructuredData = { nodes: [], roots: [], limited: false };
  try {
    if (text.length > 1_000_000)
      throw new Error('Tree inspection is limited to 1 MB. Use Source to read this file.');
    let values: unknown[];
    if (extension === 'yaml' || extension === 'yml') {
      const documents = parseAllDocuments(text, {
        stringKeys: true,
        customTags: [],
        logLevel: 'error',
      });
      if (documents.length > 100)
        throw new Error('Tree inspection is limited to 100 YAML documents.');
      values = documents.map((document) => {
        if (document.errors[0]) throw document.errors[0];
        return document.toJS({ maxAliasCount: 100 });
      });
    } else if (extension === 'json5') values = [JSON5.parse(text) as unknown];
    else if (extension === 'jsonc') {
      const errors: ParseError[] = [];
      const value: unknown = parse(text, errors, { allowTrailingComma: true });
      if (errors[0]) {
        const before = text.slice(0, errors[0].offset).split('\n');
        throw new Error(
          `${printParseErrorCode(errors[0].error)} at line ${before.length}, column ${before.at(-1)!.length + 1}`,
        );
      }
      values = [value];
    } else values = [JSON.parse(text) as unknown];
    const seen = new WeakMap<object, string>();
    const pending = values
      .map((value, index) => ({
        value,
        path: values.length === 1 ? '' : '/' + index,
        name: values.length === 1 ? 'root' : `Document ${index + 1}`,
        depth: 0,
        parent: undefined as string | undefined,
      }))
      .reverse();
    while (pending.length && result.nodes.length < maximum) {
      const item = pending.pop()!;
      const object = item.value !== null && typeof item.value === 'object';
      const previous = object ? seen.get(item.value as object) : undefined;
      const node: DataNode = {
        ...item,
        kind:
          previous !== undefined
            ? 'reference'
            : object
              ? Array.isArray(item.value)
                ? 'array'
                : 'object'
              : 'value',
        children: [],
        summary: '',
      };
      if (item.parent === undefined) result.roots.push(item.path);
      if (previous !== undefined) node.summary = `↪ ${previous || '/'}`;
      else if (object) {
        seen.set(item.value as object, item.path);
        const entries = Object.entries(item.value as Record<string, unknown>);
        node.summary = `${entries.length} ${Array.isArray(item.value) ? 'items' : 'keys'}`;
        if (item.depth >= 64) {
          node.summary += ' · depth limit';
          result.limited = true;
        } else {
          const bounded = entries.slice(
            0,
            Math.max(0, maximum - result.nodes.length - pending.length - 1),
          );
          if (bounded.length < entries.length) result.limited = true;
          for (let index = bounded.length - 1; index >= 0; index--) {
            const [name, value] = bounded[index]!;
            const path = item.path + '/' + pointer(name);
            pending.push({ value, path, parent: item.path, name, depth: item.depth + 1 });
          }
          node.children = bounded.map(([key]) => item.path + '/' + pointer(key));
        }
      } else node.summary = scalar(item.value).slice(0, 500);
      result.nodes.push(node);
    }
    if (pending.length) result.limited = true;
  } catch (error) {
    result.error = String((error as Error).message || error);
  }
  return result;
}

export interface TreeExpansion {
  all: boolean;
  open: string[];
  closed: string[];
}
export function visibleDataRows(
  data: StructuredData,
  expansion: TreeExpansion,
  search = '',
): DataNode[] {
  const term = search.trim().toLocaleLowerCase();
  const included = new Set<string>();
  const byPath = new Map(data.nodes.map((node) => [node.path, node]));
  if (term)
    for (const node of data.nodes)
      if ((node.name + ' ' + node.summary + ' ' + node.path).toLocaleLowerCase().includes(term)) {
        let ancestor: DataNode | undefined = node;
        while (ancestor && !included.has(ancestor.path)) {
          included.add(ancestor.path);
          ancestor = ancestor.parent === undefined ? undefined : byPath.get(ancestor.parent);
        }
      }
  const rows: DataNode[] = [];
  const open = new Set(expansion.open),
    closed = new Set(expansion.closed);
  const reachable = new Set(data.roots);
  for (const node of data.nodes) {
    if (term ? !included.has(node.path) : !reachable.has(node.path)) continue;
    rows.push(node);
    if (term || (expansion.all ? !closed.has(node.path) : open.has(node.path)))
      for (const child of node.children) reachable.add(child);
  }
  return rows;
}

export function copyDataValue(value: unknown): string {
  if (typeof value === 'string') return value;
  const seen = new WeakSet<object>();
  let count = 0;
  return (
    JSON.stringify(
      value,
      (_key, value: unknown) => {
        if (++count > 50_000)
          throw new Error('This value is too large to copy. Copy it from Source instead.');
        if (value && typeof value === 'object') {
          if (seen.has(value)) return '[Reference]';
          seen.add(value);
        }
        return typeof value === 'bigint' ? value.toString() : value;
      },
      2,
    ) ?? String(value)
  );
}
