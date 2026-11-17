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
  if (/^[A-Za-z]:/.test(value)) throw new Error('Drive-letter paths are not local absolute paths.');
  if (/^[A-Za-z][A-Za-z\d+.-]*:\/\//.test(value)) throw new Error('Use a local path, not a URI.');
  if (value.includes('\\') || value.includes('\0') || value.split('/').includes('..'))
    throw new Error('Paths cannot contain parent segments, backslashes or NUL.');
  let expanded = value;
  const token = /^\{\{ROOT(?::([^{}]+))?\}\}/.exec(value);
  if (token) {
    if (value.length > token[0].length && value[token[0].length] !== '/')
      throw new Error('A root token must end at a path boundary.');
    const reference = token[1]?.trim();
    if (token[1] !== undefined && !reference)
      throw new Error('A named root reference cannot be empty.');
    if (!reference && context.resolvingRoot)
      throw new Error('{{ROOT}} cannot be used inside a definition root.');
    const key =
      reference &&
      (context.names?.get(normalizedProjectName(reference)) ??
        (reference.includes('>') ? keyFor(reference) : reference));
    const root = key ? context.roots.get(key) : context.root;
    if (!root)
      throw new Error(reference ? `Unknown definition root: ${reference}.` : 'No root is defined.');
    expanded = root.replace(/\/$/, '') + value.slice(token[0].length);
  } else if (value === '~' || value.startsWith('~/')) {
    expanded = context.home.replace(/\/$/, '') + value.slice(1);
  } else if (!value.startsWith('/')) {
    if (context.resolvingRoot || !context.root)
      throw new Error('A definition root must be absolute or use a named root or home.');
    expanded = context.root.replace(/\/$/, '') + '/' + value;
  }
  if (expanded.includes('{{') || /^[A-Za-z][A-Za-z\d+.-]*:\/\//.test(expanded))
    throw new Error('Unknown, nested or misplaced path token or URI.');
  const normalized = expanded
    .split('/')
    .filter((part) => part !== '.')
    .join('/')
    .replace(/\/{2,}/g, '/');
  return normalized.replace(/\/$/, '') || '/';
}

/** Preserve intentional spelling; otherwise choose the longest matching root before Home. */
export function tokenizePath(
  value: string,
  context: DefinitionPathContext,
  original?: string,
): string {
  const absolute = resolveDefinitionPath(value, { ...context, resolvingRoot: true });
  if (original !== undefined) {
    try {
      if (resolveDefinitionPath(original, context) === absolute) return original;
    } catch {
      // An obsolete token must not be carried into the next definition.
    }
  }
  const below = (root: string) =>
    absolute === root || absolute.startsWith(root === '/' ? '/' : root + '/');
  const matches = [...context.roots].map(([key, root]) => ({ root, token: `{{ROOT:${key}}}` }));
  if (context.root && !context.resolvingRoot)
    matches.unshift({ root: context.root, token: '{{ROOT}}' });
  const match = matches
    .filter((item) => below(item.root))
    .sort((a, b) => b.root.length - a.root.length)[0];
  if (match) {
    const relative =
      absolute === match.root
        ? ''
        : '/' + absolute.slice(match.root === '/' ? 1 : match.root.length + 1);
    return match.token + relative;
  }
  if (below(context.home))
    return (
      '~' +
      (absolute === context.home
        ? ''
        : '/' + absolute.slice(context.home === '/' ? 1 : context.home.length + 1))
    );
  return absolute;
}
