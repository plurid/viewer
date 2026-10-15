import type { Pane, Workspace } from './contracts';

/** The last path component, for display; a root or empty path is returned unchanged. */
export function baseName(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || path
  );
}
export function parentPath(path: string): string {
  const separator = path.includes('\\') ? '\\' : '/';
  const normalized = path.replace(/[\\/]$/, '');
  const end = normalized.lastIndexOf(separator);
  if (/^[A-Za-z]:[\\/]/.test(path) && end <= 2) return path.slice(0, 3);
  return end <= 0 ? separator : normalized.slice(0, end);
}

/** Compare lexical paths, without resolving links or touching the filesystem. */
export function normalizedPanePath(path: string, platform: string): string {
  const windows = platform === 'win32';
  const value = windows ? path.replace(/\\/g, '/') : path;
  const prefix = windows && value.startsWith('//') ? '//' : value.startsWith('/') ? '/' : '';
  const segments: string[] = [];
  for (const segment of value.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..' && segments.length) segments.pop();
    else segments.push(segment);
  }
  const normalized = prefix + segments.join('/');
  return windows ? normalized.toLocaleLowerCase() : normalized;
}

export function matchingPane(
  workspace: Workspace,
  path: string,
  type: Pane['type'],
  active: string,
  platform: string,
  scope: { rootID: string; owners: ReadonlyMap<string, string> },
): Pane | undefined {
  const target = normalizedPanePath(path, platform);
  const matches = workspace.panes.filter(
    (pane) =>
      scope.owners.get(pane.id) === scope.rootID &&
      pane.type === type &&
      normalizedPanePath(pane.path, platform) === target,
  );
  return matches.find((pane) => pane.id === active) ?? matches.at(-1);
}
/** Resolves a relative link in a document against the document's folder. Links with a
 * scheme, absolute and protocol-relative links, and in-page anchors stay inert. */
export function relativeLinkTarget(document: string, href?: string): string | undefined {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || /^[\\/#]/.test(href)) return;
  let relative: string;
  try {
    relative = decodeURIComponent(href.replace(/[?#].*$/, ''));
  } catch {
    return;
  }
  if (!relative || relative.includes('\0')) return;
  const windows = /^[A-Za-z]:[\\/]/.test(document);
  const separator = windows ? '\\' : '/';
  const base = parentPath(document);
  const parts = base === separator ? [''] : base.split(/[\\/]/);
  for (const part of relative.split(/[\\/]/)) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length > 1) parts.pop();
    } else parts.push(part);
  }
  return parts.length === 1 ? parts[0] + separator : parts.join(separator);
}
