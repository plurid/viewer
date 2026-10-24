import { lstat, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const homeFolders = [
  'Applications',
  'Desktop',
  'Documents',
  'Downloads',
  'Library',
  'Movies',
  'Music',
  'Pictures',
  'Public',
];
const systemFolders = [
  '/Applications',
  '/Library',
  '/System',
  '/Users',
  '/Volumes',
  '/bin',
  '/etc',
  '/opt',
  '/private',
  '/private/etc',
  '/private/tmp',
  '/private/var',
  '/sbin',
  '/tmp',
  '/usr',
  '/var',
];

/**
 * Folders that no person, recipe, agent or watch rule may move to the Trash, move,
 * rename or replace: the disk root, Home, the standard Home folders macOS itself
 * refuses to remove, and system locations. Matching is by device and inode, so a
 * case variant, symbolic link or firmlink spelling is protected too.
 */
export class ProtectedPaths {
  private identities?: Promise<Map<string, string>>;
  constructor(private home = os.homedir()) {}
  private load(): Promise<Map<string, string>> {
    return (this.identities ??= (async () => {
      const candidates =
        process.platform === 'win32'
          ? [path.parse(this.home).root, this.home]
          : ['/', this.home, ...homeFolders.map((name) => path.join(this.home, name))].concat(
              process.platform === 'darwin' || process.platform === 'linux' ? systemFolders : [],
            );
      const identities = new Map<string, string>();
      for (const file of candidates)
        for (const info of await Promise.all([
          lstat(file).catch(() => null),
          stat(file).catch(() => null),
        ]))
          if (info && !identities.has(`${info.dev}:${info.ino}`))
            identities.set(`${info.dev}:${info.ino}`, file);
      return identities;
    })());
  }
  /** Throws when `file` itself is protected; items inside protected folders are not. */
  async check(file: string, action: string): Promise<void> {
    const info = await lstat(file).catch(() => null);
    if (!info?.isDirectory() && !info?.isSymbolicLink()) return;
    const protectedPath = (await this.load()).get(`${info.dev}:${info.ino}`);
    if (protectedPath)
      throw new Error(`${protectedPath} is a protected folder, so it cannot be ${action}.`);
    // A mounted volume's root: its device is not its parent's. Only /Volumes itself was protected,
    // so a disk or a network share could be moved whole (2026-10-20).
    const parent = path.dirname(file);
    if (info.isDirectory() && parent !== file) {
      const outer = await lstat(parent).catch(() => null);
      if (outer && outer.dev !== info.dev)
        throw new Error(`${file} is the root of a mounted volume, so it cannot be ${action}.`);
    }
  }
}
