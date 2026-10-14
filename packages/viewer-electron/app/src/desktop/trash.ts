import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { Menu, dialog, shell, type BrowserWindow } from 'electron';
import type { TrashItem, TrashSnapshot, DesktopPlatform } from '../domain/trash';
import { trashName } from '../domain/trash';
import { linuxMounts, trashRoots, type TrashRoot } from './trash-locations';
import { macFiles } from './macos-files';
import type { FileAccess } from './file-access';

const run = promisify(execFile);
const limit = 4000;
type ReviewedItem = { name: string; identity: string; size: number; modified: number };
type ReviewedRoot = { path: string; identity: string; items: ReviewedItem[] };
type ReadResult = {
  snapshot: TrashSnapshot;
  roots: ReviewedRoot[];
  available: Map<string, TrashRoot>;
};
const id = (text: string) => createHash('sha256').update(text).digest('hex');
const identity = (value: { dev: number; ino: number }) => `${value.dev}:${value.ino}`;

/** A dedicated read-only Trash inventory. Erasure has no bridge method and no
 * command registration. macOS owns the entire native menu/confirmation/removal
 * flow in trash-ui.h. Other platforms own it in a private native-menu callback.
 * No editable settings, agent approval response or caller-supplied path is used. */
export class Trash {
  #last?: ReadResult;
  #busy = false;
  #closed = false;
  constructor(
    private home: string,
    private access: FileAccess,
  ) {}

  async list(): Promise<TrashSnapshot> {
    if (this.#closed) throw new Error('Trash has closed.');
    const result = await this.#read();
    this.#last = result;
    return result.snapshot;
  }
  close(): void {
    this.#closed = true;
    this.#last = undefined;
  }
  async requestAccess(window: BrowserWindow, locationID: string): Promise<void> {
    const root = this.#last?.available.get(locationID);
    const location = this.#last?.snapshot.locations.find((value) => value.id === locationID);
    if (this.#closed || window.isDestroyed()) return;
    if (!root || process.platform !== 'darwin' || !location?.canRequestAccess)
      throw new Error('This Trash location is unavailable. Refresh Trash.');
    if (location.access === 'privacy') {
      // A folder picker cannot grant macOS Full Disk Access. This fixed link
      // opens settings only; it neither grants access nor changes agent scopes.
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
      );
      return;
    }
    const result = await dialog.showOpenDialog(window, {
      title: `Allow access to ${root.name} Trash`,
      message: `Select ${root.path}. The folder is hidden; use Command-Shift-G to enter this exact path.`,
      defaultPath: root.path,
      properties: ['openDirectory', 'showHiddenFiles', 'dontAddToRecent'],
      securityScopedBookmarks: this.access.scoped,
    });
    if (result.canceled) return;
    if (result.filePaths.length !== 1 || path.resolve(result.filePaths[0]) !== root.path)
      throw new Error('Choose the Trash folder shown in the picker. No other folder was granted.');
    await this.access.remember(root.path, true, result.bookmarks?.[0]);
    await this.access.require([root.path]);
  }
  async menu(window: BrowserWindow, revision: string): Promise<void> {
    if (this.#closed || this.#busy || window.isDestroyed()) return;
    const displayed = this.#last;
    if (!displayed || displayed.snapshot.revision !== revision || !displayed.snapshot.canEmpty)
      throw new Error('Refresh Trash before opening its actions.');
    const current = await this.#read();
    if (current.snapshot.revision !== revision || !current.snapshot.canEmpty)
      throw new Error('Trash changed. Refresh it before opening its actions.');
    if (process.platform === 'darwin') {
      // This call can ONLY display a native menu. It accepts no erase/approve flag.
      macFiles().trashMenu(
        JSON.stringify({ roots: current.roots, count: current.snapshot.items.length }),
      );
      return;
    }
    const title = trashName(process.platform as DesktopPlatform);
    Menu.buildFromTemplate([
      {
        label: `Empty ${title}…`,
        // The sole route to erasure. It is never returned, registered or published.
        click: () => {
          void this.#emptyFromNativeClick(window, revision);
        },
      },
    ]).popup({ window });
  }
  async #emptyFromNativeClick(window: BrowserWindow, revision: string): Promise<void> {
    if (this.#closed || this.#busy || window.isDestroyed()) return;
    this.#busy = true;
    const title = trashName(process.platform as DesktopPlatform);
    try {
      const before = await this.#read();
      if (!before.snapshot.canEmpty || before.snapshot.revision !== revision)
        throw new Error('Trash changed. Refresh it before emptying.');
      const confirmation = await dialog.showMessageBox(window, {
        type: 'warning',
        title: `Empty ${title}?`,
        message: `Empty ${title}?`,
        detail: `Permanently erase ${before.snapshot.items.length} items, including the contents of trashed folders? This cannot be undone.`,
        buttons: ['Cancel', `Empty ${title}`],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (confirmation.response !== 1 || this.#closed || window.isDestroyed()) return;
      const checked = await this.#read();
      if (!checked.snapshot.canEmpty || checked.snapshot.revision !== revision)
        throw new Error('Trash changed after confirmation. Nothing was erased.');
      if (process.platform === 'win32') {
        // Keep Windows' own confirmation. Never pass NOCONFIRMATION, -Force,
        // filesystem paths or arbitrary script text supplied by a renderer.
        await run(
          this.#powershell(),
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class ViewerRecycleBin { [DllImport("shell32.dll", CharSet=CharSet.Unicode)] public static extern int SHEmptyRecycleBin(IntPtr hwnd, string root, uint flags); }'; $result=[ViewerRecycleBin]::SHEmptyRecycleBin([IntPtr]::Zero,$null,0); if($result -ne 0){throw "Windows did not empty the Recycle Bin ($result)."}`,
          ],
          { timeout: 120000, windowsHide: true },
        );
      } else {
        // GIO owns freedesktop Trash semantics, including mounted volumes and
        // trashinfo metadata. No rm/rmdir or path-based fallback exists.
        await run('/usr/bin/gio', ['trash', '--empty'], {
          timeout: 120000,
          env: { ...process.env, LC_ALL: 'C' },
        });
      }
    } catch (error) {
      if (!window.isDestroyed() && !this.#closed)
        await dialog.showMessageBox(window, {
          type: 'error',
          message: `${title} could not be emptied`,
          detail: error instanceof Error ? error.message : String(error),
          buttons: ['OK'],
        });
    } finally {
      this.#busy = false;
    }
  }
  #powershell(): string {
    const system = process.env.SystemRoot;
    if (!system || !path.win32.isAbsolute(system))
      throw new Error('Windows system tools are unavailable.');
    return path.win32.join(system, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  }
  async #read(): Promise<ReadResult> {
    if (process.platform === 'win32') return this.#readWindows();
    const platform = process.platform as DesktopPlatform;
    const mounts =
      platform === 'darwin'
        ? await macFiles().volumes()
        : linuxMounts(await readFile('/proc/self/mountinfo', 'utf8'));
    const candidates = trashRoots(
      platform,
      this.home,
      process.getuid!(),
      mounts,
      process.env.XDG_DATA_HOME,
    );
    const snapshot: TrashSnapshot = {
      revision: '',
      items: [],
      locations: [],
      truncated: false,
      canEmpty: false,
    };
    const roots: ReviewedRoot[] = [],
      available = new Map<string, TrashRoot>();
    for (const candidate of candidates) {
      const locationID = id(candidate.path);
      available.set(locationID, candidate);
      try {
        // Do not follow either the private root or its shared parent. No roots
        // are manufactured and no permission is conferred by a JSONC setting.
        if (candidate.shared) {
          const parent = await lstat(candidate.shared);
          if (!parent.isDirectory() || parent.isSymbolicLink() || !(parent.mode & 0o1000))
            throw new Error('The shared Trash folder could not be verified.');
        }
        const root = await lstat(candidate.path);
        await this.access.require([candidate.path]);
        if (
          !root.isDirectory() ||
          root.isSymbolicLink() ||
          root.uid !== process.getuid!() ||
          root.mode & 0o077 ||
          (await realpath(candidate.path)) !== candidate.path
        )
          throw new Error('The private Trash folder could not be verified.');
        const reviewed: ReviewedRoot = {
          path: candidate.path,
          identity: identity(root),
          items: [],
        };
        const names = (await readdir(candidate.path))
          .filter((name) => platform !== 'darwin' || name !== '.DS_Store')
          .sort();
        for (const name of names) {
          if (snapshot.items.length >= limit) {
            snapshot.truncated = true;
            break;
          }
          const info = await lstat(path.join(candidate.path, name));
          reviewed.items.push({
            name,
            identity: identity(info),
            size: info.size,
            modified: info.mtimeMs,
          });
          const item: TrashItem = {
            id: id(candidate.path + '/' + name + ':' + identity(info)),
            name,
            directory: info.isDirectory(),
            size: info.isDirectory() ? 0 : info.size,
            location: candidate.name,
          };
          if (candidate.info) {
            const metadata = await this.#trashInfo(candidate.info, name);
            Object.assign(item, metadata);
          }
          snapshot.items.push(item);
        }
        if (identity(await lstat(candidate.path)) !== reviewed.identity)
          throw new Error('The Trash folder changed during reading.');
        roots.push(reviewed);
        snapshot.locations.push({ id: locationID, name: candidate.name, state: 'ready' });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        // A missing grant can mask a nonexistent volume Trash in a sandbox.
        // Report the location; never assume its contents are empty.
        const code = (error as NodeJS.ErrnoException).code;
        const privacy = platform === 'darwin' && (code === 'EPERM' || code === 'EACCES');
        const folderAccess = platform === 'darwin' && code === 'FILE_ACCESS_REQUIRED';
        snapshot.locations.push({
          id: locationID,
          name: candidate.name,
          state: 'unavailable',
          message: privacy
            ? 'macOS requires Full Disk Access for Viewer to read Trash. Enable Viewer in System Settings → Privacy & Security → Full Disk Access, then quit and reopen Viewer.'
            : error instanceof Error
              ? error.message
              : String(error),
          canRequestAccess: privacy || folderAccess,
          ...(privacy ? { access: 'privacy' } : folderAccess ? { access: 'folder' } : {}),
        });
      }
    }
    snapshot.items.sort((a, b) => a.name.localeCompare(b.name));
    snapshot.canEmpty =
      snapshot.items.length > 0 &&
      !snapshot.truncated &&
      snapshot.locations.every((location) => location.state === 'ready');
    snapshot.revision = id(
      JSON.stringify([roots, snapshot.items, snapshot.locations, snapshot.truncated]),
    );
    return { snapshot, roots, available };
  }
  async #trashInfo(
    folder: string,
    name: string,
  ): Promise<{ originalPath?: string; deleted?: string }> {
    const file = path.join(folder, name + '.trashinfo');
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 65536)
      throw new Error('Trash metadata could not be verified.');
    const text = await readFile(file, 'utf8');
    if (!text.startsWith('[Trash Info]')) throw new Error('Trash metadata is invalid.');
    const source = /^Path=(.*)$/m.exec(text)?.[1],
      deleted = /^DeletionDate=(.*)$/m.exec(text)?.[1];
    return {
      ...(source ? { originalPath: decodeURIComponent(source) } : {}),
      ...(deleted ? { deleted } : {}),
    };
  }
  async #readWindows(): Promise<ReadResult> {
    const { stdout } = await run(
      this.#powershell(),
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $bin=(New-Object -ComObject Shell.Application).Namespace(10); if($null -eq $bin){throw 'Recycle Bin is unavailable.'}; $items=@($bin.Items()); if($items.Count -gt ${limit}){throw 'Recycle Bin is too large to review safely in Viewer.'}; $output=@($items | ForEach-Object { $bytes=$_.ExtendedProperty('System.Size'); @{ id=$_.Path; name=$_.Name; directory=[bool]$_.IsFolder; size=$(if($null -eq $bytes){0}else{[long]$bytes}); originalPath=$_.ExtendedProperty('System.Recycle.DeletedFrom'); deleted=$_.ExtendedProperty('System.Recycle.DateDeleted') } }); ConvertTo-Json -InputObject $output -Depth 3 -Compress`,
      ],
      { maxBuffer: 8 * 1024 * 1024, timeout: 15000, windowsHide: true },
    );
    const values: unknown = JSON.parse(stdout || '[]');
    if (!Array.isArray(values) || values.length > limit)
      throw new Error('Recycle Bin returned an invalid inventory.');
    const items: TrashItem[] = values
      .map((value) => {
        if (
          !value ||
          typeof value !== 'object' ||
          typeof value.id !== 'string' ||
          typeof value.name !== 'string' ||
          typeof value.directory !== 'boolean' ||
          typeof value.size !== 'number'
        )
          throw new Error('Recycle Bin returned an invalid item.');
        return {
          id: id(value.id),
          name: value.name,
          directory: value.directory,
          size: value.size,
          location: 'Recycle Bin',
          ...(typeof value.originalPath === 'string' ? { originalPath: value.originalPath } : {}),
          ...(typeof value.deleted === 'string' ? { deleted: value.deleted } : {}),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    const snapshot: TrashSnapshot = {
      revision: id(JSON.stringify(items)),
      items,
      locations: [{ id: 'windows', name: 'Recycle Bin', state: 'ready' }],
      truncated: false,
      canEmpty: items.length > 0,
    };
    return { snapshot, roots: [], available: new Map() };
  }
}
