import type { Pane, Workspace } from './contracts';

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
): Pane | undefined {
  const target = normalizedPanePath(path, platform);
  const matches = workspace.panes.filter(
    (pane) => pane.type === type && normalizedPanePath(pane.path, platform) === target,
  );
  return matches.find((pane) => pane.id === active) ?? matches.at(-1);
}
