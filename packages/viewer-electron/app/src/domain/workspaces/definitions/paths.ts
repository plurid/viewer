import { keyFor, projectNameParts } from './keys';

export interface DefinitionPathContext {
  home: string;
  root?: string;
  roots: ReadonlyMap<string, string>;
  names?: ReadonlyMap<string, string>;
  resolvingRoot?: boolean;
}

export const normalizedProjectName = (name: string): string => projectNameParts(name).join(' > ');

/** Paths are expanded without shell evaluation and never escape through parent segments. */
export function resolveDefinitionPath(value: string, context: DefinitionPathContext): string {
  if (value.includes('\\') || value.includes('\0') || value.split('/').includes('..'))
    throw new Error('Paths cannot contain parent segments, backslashes or NUL.');
  let expanded = value;
  const token = /^\{\{ROOT(?::([^{}]+))?\}\}/.exec(value);
  if (token) {
    if (value.length > token[0].length && value[token[0].length] !== '/')
      throw new Error('A root token must end at a path boundary.');
    const reference = token[1]?.trim();
    if (!reference && context.resolvingRoot)
      throw new Error('{{ROOT}} cannot be used inside a definition root.');
    const key = reference && (context.names?.get(normalizedProjectName(reference)) ??
      (reference.includes('>') ? keyFor(reference) : reference));
    const root = key ? context.roots.get(key) : context.root;
    if (!root) throw new Error(reference ? `Unknown definition root: ${reference}.` : 'No root is defined.');
    expanded = root.replace(/\/$/, '') + value.slice(token[0].length);
  } else if (value === '~' || value.startsWith('~/')) {
    expanded = context.home.replace(/\/$/, '') + value.slice(1);
  } else if (!value.startsWith('/') && !/^[A-Za-z]:\//.test(value)) {
    if (context.resolvingRoot || !context.root) throw new Error('A definition root must be absolute or use a named root or home.');
    expanded = context.root.replace(/\/$/, '') + '/' + value;
  }
  if (expanded.includes('{{') || /^[A-Za-z][A-Za-z\d+.-]*:\/\//.test(expanded))
    throw new Error('Unknown, nested or misplaced path token or URI.');
  const normalized = expanded.split('/').filter((part) => part !== '.').join('/').replace(/\/{2,}/g, '/');
  return normalized.replace(/\/$/, '') || '/';
}
