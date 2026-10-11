import type { Pane, Workspace } from './contracts';

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
