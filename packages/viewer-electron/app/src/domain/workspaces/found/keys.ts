import { slug, stubName } from '../definitions/keys';
import { insideRoot } from './roots';

export function foundPathHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++)
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function foundKey(
  root: string,
  home: string,
  taken: ReadonlySet<string> = new Set(),
): string {
  const relative = insideRoot(home, root) ? root.slice(home.length) : root;
  const segments = relative.split('/').filter(Boolean);
  const parts = segments
    .slice(-8)
    .map((segment) => {
      const part = slug(segment);
      return part !== segment || part === '.' || part === '..'
        ? `${part === '.' || part === '..' ? 'x' : part}-${foundPathHash(segment)}`
        : part;
    });
  let key = parts.join('/') || 'x';
  const shortened = key.length > 190 || segments.length > 8 || !insideRoot(home, root);
  while (key.length > 190 && parts.length > 1) {
    parts.shift();
    key = parts.join('/');
  }
  key = key.slice(-190);
  if (shortened) key = key.slice(0, 181) + '-' + foundPathHash(relative);
  if (!taken.has(key)) return key;
  // A collision carries path evidence, so visit ranking never assigns numbered keys.
  for (let salt = 0; ; salt++) {
    const candidate = key.slice(0, 181) + '-' + foundPathHash(relative + ':' + salt);
    if (!taken.has(candidate)) return candidate;
  }
}
export function foundName(root: string): string {
  return stubName(root.split('/').filter(Boolean).slice(-2).join(' > ')).slice(0, 100);
}
export function foundAliases(names: readonly string[]): string[] {
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))]
    .slice(0, 3)
    .map((name) => name.slice(0, 60));
}
