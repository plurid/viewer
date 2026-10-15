import path from 'node:path';
import type { DesktopPlatform } from '../domain/trash';
export interface TrashRoot {
  path: string;
  name: string;
  info?: string;
  shared?: string;
  originBase?: string;
}
export function trashRoots(
  platform: DesktopPlatform,
  home: string,
  uid: number,
  mounts: { path: string; name: string }[],
  dataHome?: string,
): TrashRoot[] {
  if (platform === 'win32') return [];
  if (platform === 'darwin')
    return [
      { path: path.join(home, '.Trash'), name: 'Home' },
      ...mounts
        .filter((volume) => volume.path !== '/')
        .map((volume) => ({
          path: path.join(volume.path, '.Trashes', String(uid)),
          name: volume.name,
          shared: path.join(volume.path, '.Trashes'),
        })),
    ];
  const folder = dataHome && path.isAbsolute(dataHome) ? dataHome : path.join(home, '.local/share');
  const roots = [
    {
      path: path.join(folder, 'Trash/files'),
      info: path.join(folder, 'Trash/info'),
      name: 'Home',
      originBase: folder,
    },
  ];
  for (const mount of mounts) {
    for (const base of [
      path.join(mount.path, '.Trash', String(uid)),
      path.join(mount.path, '.Trash-' + uid),
    ])
      roots.push({
        path: path.join(base, 'files'),
        info: path.join(base, 'info'),
        name: mount.name,
        originBase: mount.path,
        ...(base.includes('/.Trash/') ? { shared: path.join(mount.path, '.Trash') } : {}),
      });
  }
  return roots;
}
export function linuxMounts(source: string): { path: string; name: string }[] {
  const ignored = new Set([
    'proc',
    'sysfs',
    'devtmpfs',
    'tmpfs',
    'cgroup',
    'cgroup2',
    'overlay',
    'squashfs',
  ]);
  const values = new Map<string, { path: string; name: string }>();
  for (const line of source.split('\n')) {
    const [left, right] = line.split(' - ');
    if (!left || !right || ignored.has(right.split(' ')[0] ?? '')) continue;
    const mount = left
      .split(' ')[4]
      ?.replace(/\\(040|011|012|134)/g, (_, octal: string) =>
        String.fromCharCode(parseInt(octal, 8)),
      );
    if (!mount || mount === '/' || !path.isAbsolute(mount)) continue;
    values.set(mount, { path: mount, name: path.basename(mount) || mount });
  }
  return [...values.values()];
}
export function applicationsPath(
  platform: DesktopPlatform,
  home: string,
  programFiles?: string,
): string {
  if (platform === 'darwin') return '/Applications';
  if (platform === 'win32')
    return programFiles && path.win32.isAbsolute(programFiles)
      ? programFiles
      : path.win32.join(path.win32.parse(home).root, 'Program Files');
  return '/usr/share/applications';
}
