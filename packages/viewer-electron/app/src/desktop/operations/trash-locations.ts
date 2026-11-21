import path from 'node:path';
import type { DesktopPlatform } from '../../domain/files/trash';
export interface TrashRoot {
  path: string;
  name: string;
  info?: string;
  shared?: string;
  originBase?: string;
  /** True on filesystems that store no POSIX permission or sticky bits (such as exFAT/FAT32). */
  ignoreOwnership?: boolean;
}
export interface TrashMount {
  path: string;
  name: string;
  ignoreOwnership?: boolean;
}
export function trashRoots(
  platform: DesktopPlatform,
  home: string,
  uid: number,
  mounts: TrashMount[],
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
          ...(volume.ignoreOwnership ? { ignoreOwnership: true } : {}),
        })),
    ];
  const folder = dataHome && path.isAbsolute(dataHome) ? dataHome : path.join(home, '.local/share');
  const roots: TrashRoot[] = [
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
        ...(mount.ignoreOwnership ? { ignoreOwnership: true } : {}),
      });
  }
  return roots;
}
export function linuxMounts(source: string): TrashMount[] {
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
  const noOwnershipTypes = new Set(['vfat', 'exfat', 'msdos']);
  const values = new Map<string, TrashMount>();
  for (const line of source.split('\n')) {
    const [left, right] = line.split(' - ');
    const filesystem = right?.split(' ')[0] ?? '';
    if (!left || !right || ignored.has(filesystem)) continue;
    const mount = left
      .split(' ')[4]
      ?.replace(/\\(040|011|012|134)/g, (_, octal: string) =>
        String.fromCharCode(parseInt(octal, 8)),
      );
    if (!mount || mount === '/' || !path.isAbsolute(mount)) continue;
    values.set(mount, {
      path: mount,
      name: path.basename(mount) || mount,
      ...(noOwnershipTypes.has(filesystem) ? { ignoreOwnership: true } : {}),
    });
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
