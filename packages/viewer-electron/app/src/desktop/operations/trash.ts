import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { clipboard, dialog, shell, type BrowserWindow } from 'electron';
import type {
  TrashItem,
  TrashSnapshot,
  TrashOrigin,
  TrashRestoreResult,
  DesktopPlatform,
} from '../../domain/files/trash';
import type { Resource } from '../../domain/contracts';
import { trashName } from '../../domain/files/trash';
import { linuxMounts, trashRoots, type TrashRoot } from './trash-locations';
import { macFiles } from '../native/macos-files';
import type { FileAccess } from '../files/file-access';
import { errorMessage } from '../../domain/errors';

const run = promisify(execFile);
const limit = 4000;
type ReviewedItem = { name: string; identity: string; size: number; modified: number };
type ReviewedRoot = { path: string; identity: string; items: ReviewedItem[] };
type ReadResult = {
  snapshot: TrashSnapshot;
  roots: ReviewedRoot[];
  available: Map<string, TrashRoot>;
};
type BackingItem = {
  file: string;
  root: TrashRoot;
  rootIdentity: string;
  version: ReviewedItem;
  item: TrashItem;
  parents: BackingItem[];
};
interface TrashServices {
  origins?(): Promise<TrashOrigin[]>;
  preview?(file: string): Promise<Resource>;
  release?(id: string): void;
  changed?(source: string, destination: string): void;
}
const id = (text: string) => createHash('sha256').update(text).digest('hex');
const identity = (value: { dev: number; ino: number }) => `${value.dev}:${value.ino}`;
function moveLinux(source: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Interactive mode disables GIO's default overwrite flag. EOF on stdin
    // supplies no affirmative response if another process creates a collision.
    const child = execFile(
      '/usr/bin/gio',
      [
        'move',
        '--interactive',
        '--no-copy-fallback',
        '--no-target-directory',
        '--',
        source,
        destination,
      ],
      {
        timeout: 120000,
        env: { ...process.env, LC_ALL: 'C' },
      },
      (error) => (error ? reject(error) : resolve()),
    );
    child.stdin?.end();
  });
}

/** A dedicated Trash browser. Erasure has no bridge method and no command
 * registration. macOS owns confirmation/removal in trash-ui.h. Other platforms
 * keep removal inside the private continuation of a native confirmation.
 * No editable settings, agent approval response or caller-supplied path is used. */
export class Trash {
  #last?: ReadResult;
  #busy = false;
  #closed = false;
  #known = new Map<string, BackingItem>();
  #addedDates = new Map<string, { read: number; added?: string }>();
  constructor(
    private home: string,
    private access: FileAccess,
    private services: TrashServices = {},
  ) {}

  async list(folderID?: string): Promise<TrashSnapshot> {
    if (this.#closed) throw new Error('Trash has closed.');
    const folder = folderID ? this.#known.get(folderID) : undefined;
    if (folderID && !folder)
      throw new Error('This Trash folder is no longer available. Return to Trash.');
    const result = await this.#read();
    this.#last = result;
    if (folder) {
      const info = await this.#verify(folder, false);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error('This Trash folder changed. Return to Trash.');
      const names = (await readdir(folder.file)).sort();
      const items: TrashItem[] = [];
      for (const name of names.slice(0, limit)) {
        const file = path.join(folder.file, name);
        const current = await lstat(file);
        const item = this.#remember(
          file,
          folder.root,
          folder.rootIdentity,
          current,
          {
            name,
            originalPath: folder.item.originalPath
              ? path.join(folder.item.originalPath, name)
              : undefined,
            deleted: folder.item.deleted,
          },
          [...folder.parents, folder],
        );
        items.push(item);
      }
      await this.#verify(folder, false);
      return {
        ...result.snapshot,
        totalItems: result.snapshot.items.length,
        ancestors: [...folder.parents, folder].map((entry) => entry.item),
        items,
        truncated: names.length > limit,
        canEmpty: result.snapshot.canEmpty,
      };
    }
    return result.snapshot;
  }
  close(): void {
    this.#closed = true;
    this.#last = undefined;
    this.#known.clear();
    this.#addedDates.clear();
  }
  async preview(itemID: string): Promise<Resource> {
    const item = this.#get(itemID);
    const info = await this.#verify(item);
    if (!info.isFile() || info.isSymbolicLink() || !this.services.preview)
      throw new Error('Only regular files in Trash can be previewed.');
    const resource = await this.services.preview(item.file);
    try {
      await this.#verify(item);
      return { ...resource, entry: { ...resource.entry, name: item.item.name } };
    } catch (error) {
      this.services.release?.(resource.id);
      throw error;
    }
  }
  async copyPaths(itemIDs: string[]): Promise<void> {
    const items = itemIDs.map((itemID) => this.#get(itemID));
    for (const item of items) await this.#verify(item);
    await clipboard.writeText(items.map((item) => item.file).join('\n'));
  }
  /** "Restore to…": the folder, chosen before the move takes the file operations lock. Chosen inside
   * it, the picker held every queued file operation while it was open. */
  async chooseRestoreFolder(window: BrowserWindow): Promise<string | undefined> {
    if (this.#closed || this.#busy || window.isDestroyed())
      throw new Error('Trash is busy. Try again.');
    this.#busy = true;
    try {
      return await this.#pick(window);
    } finally {
      this.#busy = false;
    }
  }
  async #pick(window: BrowserWindow): Promise<string | undefined> {
    const picked = await dialog.showOpenDialog(window, {
      title: 'Restore to…',
      message: 'Choose a destination. Existing files will be kept.',
      properties: ['openDirectory', 'dontAddToRecent'],
      securityScopedBookmarks: this.access.scoped,
    });
    if (picked.canceled || window.isDestroyed() || this.#closed) return undefined;
    const [chosen] = picked.filePaths;
    if (picked.filePaths.length !== 1 || !chosen) throw new Error('Choose one destination folder.');
    const folder = await realpath(chosen);
    await this.access.remember(folder, true, picked.bookmarks?.[0]);
    return folder;
  }
  async restore(
    window: BrowserWindow,
    itemIDs: string[],
    destination: 'original' | 'choose' | { folder: string },
  ): Promise<TrashRestoreResult> {
    if (this.#closed || this.#busy || window.isDestroyed())
      throw new Error('Trash is busy. Try again.');
    this.#busy = true;
    let restored = 0;
    try {
      const selected = [...new Set(itemIDs)].map((itemID) => this.#get(itemID));
      if (!selected.length || selected.length > 1000)
        throw new Error('Select up to 1,000 items to restore.');
      // A selected folder carries its descendants exactly once.
      const items = selected.filter(
        (item) =>
          !selected.some(
            (parent) => item !== parent && item.file.startsWith(parent.file + path.sep),
          ),
      );
      let folder: string | undefined;
      if (destination === 'choose') {
        folder = await this.#pick(window);
        if (!folder) return { restored: 0, cancelled: true };
      } else if (destination !== 'original') folder = await realpath(destination.folder);
      const targets = new Set<string>();
      const plan: { item: BackingItem; target: string; parentIdentity: string }[] = [];
      // Preflight every destination before the first move. Never replace, merge,
      // recreate missing ancestors, or turn a failed move into copy-and-delete.
      for (const item of items) {
        await this.#verify(item);
        const target = folder ? path.join(folder, item.item.name) : item.item.originalPath;
        if (
          !target ||
          !path.isAbsolute(target) ||
          target.includes('\0') ||
          path.resolve(target) !== target
        )
          throw new Error(
            'The original location is unavailable. Use Restore to… to choose a folder.',
          );
        const parent = await realpath(path.dirname(target)).catch(() => {
          throw new Error(
            'The original folder no longer exists. Use Restore to… to choose a folder.',
          );
        });
        if (parent !== path.dirname(target))
          throw new Error(
            'The destination contains a symbolic link. Use Restore to… to choose its actual folder.',
          );
        if (
          [...(this.#last?.available.values() ?? [])].some(
            (root) => target === root.path || target.startsWith(root.path + path.sep),
          )
        )
          throw new Error('Choose a destination outside Trash.');
        if (target === item.file || parent.startsWith(item.file + path.sep))
          throw new Error('Choose a destination outside the selected folder.');
        await this.access.require([parent]);
        const parentInfo = await lstat(parent);
        if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink())
          throw new Error('The destination is no longer a folder.');
        if ((await lstat(item.file)).dev !== parentInfo.dev)
          throw new Error(
            'Restore needs a destination on the same disk. The item remains in Trash.',
          );
        const key = process.platform === 'linux' ? target : target.toLocaleLowerCase();
        if (targets.has(key))
          throw new Error(
            'Two selected items have the same destination name. Restore them separately.',
          );
        targets.add(key);
        try {
          await lstat(target);
          throw new Error(
            `“${path.basename(target)}” already exists. Use Restore to… to choose another folder.`,
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        plan.push({ item, target, parentIdentity: identity(parentInfo) });
      }
      for (const { item, target, parentIdentity } of plan) {
        if (this.#closed || window.isDestroyed()) break;
        await this.#verify(item);
        const parent = path.dirname(target);
        if ((await realpath(parent)) !== parent || identity(await lstat(parent)) !== parentIdentity)
          throw new Error('The destination changed. Remaining items were kept in Trash.');
        if (process.platform === 'darwin') {
          await macFiles().renameExclusive(item.file, target);
        } else if (process.platform === 'linux') {
          // Never replace an existing destination or copy-and-delete. Keep
          // .trashinfo metadata rather than permanently deleting it ourselves.
          await moveLinux(item.file, target);
        } else {
          // Shell owns Recycle Bin bookkeeping. A collision gets a new name,
          // never Yes-to-All, replacement flags, or a raw $Recycle.Bin deletion.
          await run(
            this.#powershell(),
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `$ErrorActionPreference='Stop'; $shell=New-Object -ComObject Shell.Application; $bin=$shell.Namespace(10); $item=@($bin.Items() | Where-Object { $_.Path -ceq $env:VIEWER_TRASH_SOURCE }); if($item.Count -ne 1){throw 'Recycle Bin item changed.'}; $target=$shell.Namespace($env:VIEWER_TRASH_DESTINATION); if($null -eq $target){throw 'Destination is unavailable.'}; $target.MoveHere($item[0],8); $deadline=[DateTime]::UtcNow.AddSeconds(90); while(Test-Path -LiteralPath $env:VIEWER_TRASH_SOURCE){if([DateTime]::UtcNow -gt $deadline){throw 'Restore was not completed. Refresh Recycle Bin.'}; Start-Sleep -Milliseconds 100}`,
            ],
            {
              timeout: 100000,
              windowsHide: true,
              env: {
                ...process.env,
                VIEWER_TRASH_SOURCE: item.file,
                VIEWER_TRASH_DESTINATION: parent,
              },
            },
          );
        }
        try {
          await lstat(item.file);
          throw new Error(
            'This item is still in Trash. The destination may already exist; nothing was overwritten.',
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        restored++;
        this.#known.delete(item.item.id);
        this.services.changed?.(item.file, target);
      }
      return { restored, cancelled: false };
    } catch (error) {
      if (restored)
        throw new Error(
          `${restored} ${restored === 1 ? 'item restored' : 'items restored'}. Remaining items were kept in Trash. ${errorMessage(error)}`,
        );
      throw error;
    } finally {
      this.#busy = false;
    }
  }
  #get(itemID: string): BackingItem {
    const item = this.#known.get(itemID);
    if (this.#closed || !item) throw new Error('This item is no longer available. Refresh Trash.');
    return item;
  }
  async #verify(item: BackingItem, strict = true) {
    if (this.#closed) throw new Error('Trash has closed.');
    await this.access.require([item.root.path, item.file]);
    const root = await lstat(item.root.path);
    if (
      !root.isDirectory() ||
      root.isSymbolicLink() ||
      identity(root) !== item.rootIdentity ||
      (await realpath(item.root.path)) !== item.root.path
    )
      throw new Error('The Trash location changed. Refresh Trash.');
    if (process.platform !== 'win32' && (root.uid !== process.getuid!() || root.mode & 0o077))
      throw new Error('The private Trash folder could not be verified.');
    for (const current of [...item.parents, item]) {
      const info = await lstat(current.file);
      if (
        identity(info) !== current.version.identity ||
        (current !== item && (!info.isDirectory() || info.isSymbolicLink())) ||
        (current === item &&
          strict &&
          (info.size !== current.version.size || info.mtimeMs !== current.version.modified))
      )
        throw new Error('This item changed. Refresh Trash before using it.');
      // Preserve a trashed symlink as an item, but never browse or preview it.
      if (!info.isSymbolicLink() && (await realpath(current.file)) !== current.file)
        throw new Error('A folder in Trash became a symbolic link. Refresh Trash.');
    }
    return lstat(item.file);
  }
  #remember(
    file: string,
    root: TrashRoot,
    rootIdentity: string,
    info: Stats,
    metadata: Pick<TrashItem, 'name' | 'originalPath' | 'deleted'>,
    parents: BackingItem[] = [],
  ): TrashItem {
    const itemID = id(JSON.stringify([file, identity(info), info.size, info.mtimeMs]));
    if (parents.length > 64) throw new Error('This folder is too deep to browse in Viewer.');
    if (this.#known.size >= 16000 && !this.#known.has(itemID))
      this.#known.delete(this.#known.keys().next().value!);
    const item: TrashItem = {
      id: itemID,
      ...metadata,
      directory: info.isDirectory(),
      previewable: info.isFile() && !info.isSymbolicLink(),
      symbolicLink: info.isSymbolicLink(),
      size: info.isDirectory() ? 0 : info.size,
      modified: info.mtimeMs,
      location: root.name,
    };
    this.#known.set(item.id, {
      file,
      root,
      rootIdentity,
      item,
      parents,
      version: {
        name: path.basename(file),
        identity: identity(info),
        size: info.size,
        modified: info.mtimeMs,
      },
    });
    return item;
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
    const [chosen] = result.filePaths;
    if (result.filePaths.length !== 1 || !chosen || path.resolve(chosen) !== root.path)
      throw new Error('Choose the Trash folder shown in the picker. No other folder was granted.');
    await this.access.remember(root.path, true, result.bookmarks?.[0]);
    await this.access.require([root.path]);
  }
  async confirmation(window: BrowserWindow, revision: string): Promise<void> {
    if (this.#closed || this.#busy || window.isDestroyed()) return;
    const displayed = this.#last;
    if (!displayed || displayed.snapshot.revision !== revision || !displayed.snapshot.canEmpty)
      throw new Error('Refresh Trash before emptying it.');
    const current = await this.#read();
    if (current.snapshot.revision !== revision || !current.snapshot.canEmpty)
      throw new Error('Trash changed. Refresh it before emptying it.');
    if (process.platform === 'darwin') {
      // This call can ONLY display a native confirmation. It accepts no
      // erase/approve flag; only NSAlert's affirmative human choice can erase.
      macFiles().trashConfirmation(
        JSON.stringify({ roots: current.roots, count: current.snapshot.items.length }),
      );
      return;
    }
    await this.#confirmNatively(window, revision);
  }
  async #confirmNatively(window: BrowserWindow, revision: string): Promise<void> {
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
          detail: errorMessage(error),
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
    const origins = new Map(
      ((await this.services.origins?.().catch(() => [])) ?? []).map((origin) => [
        origin.file,
        origin,
      ]),
    );
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
          const file = path.join(candidate.path, name);
          const receipt = origins.get(file);
          let metadata: Pick<TrashItem, 'name' | 'originalPath' | 'deleted'> = {
            name,
            ...(receipt?.identity === identity(info) ? { originalPath: receipt.originalPath } : {}),
          };
          if (metadata.originalPath) metadata.name = path.basename(metadata.originalPath);
          if (candidate.info) {
            // Missing/malformed metadata does not hide recoverable content.
            const origin = await this.#trashInfo(candidate, name).catch(() => ({}));
            metadata = { ...metadata, ...origin };
            if (metadata.originalPath) metadata.name = path.basename(metadata.originalPath);
          }
          const item = this.#remember(file, candidate, reviewed.identity, info, metadata);
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
    if (platform === 'darwin') await this.#readAddedDates(snapshot.items);
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
  async #readAddedDates(items: TrashItem[]): Promise<void> {
    const now = Date.now();
    const pending = items.filter((item) => {
      const cached = this.#addedDates.get(item.id);
      return !item.symbolicLink && (!cached || now - cached.read > 30000);
    });
    if (pending.length) {
      const paths = pending.map((item) => this.#known.get(item.id)!.file);
      // Optional, read-only metadata must not hide recoverable files when a
      // volume does not implement this key. Never substitute mtime or ctime.
      const dates = await macFiles()
        .datesAdded(paths)
        .catch(() => []);
      if (this.#closed) return;
      const byPath = new Map(dates.map((date) => [date.path, date]));
      for (const item of pending) {
        const backing = this.#known.get(item.id)!;
        const date = byPath.get(backing.file);
        const added =
          date &&
          date.identity === backing.version.identity &&
          date.size === backing.version.size &&
          Math.abs(date.modified - backing.version.modified) < 0.01 &&
          typeof date.added === 'number' &&
          Number.isFinite(date.added) &&
          Math.abs(date.added) <= 8640000000000000
            ? new Date(date.added).toISOString()
            : undefined;
        this.#addedDates.set(item.id, { read: now, added });
      }
      while (this.#addedDates.size > 16000)
        this.#addedDates.delete(this.#addedDates.keys().next().value!);
    }
    for (const item of items) item.addedToTrash = this.#addedDates.get(item.id)?.added;
  }
  async #trashInfo(
    root: TrashRoot,
    name: string,
  ): Promise<{ originalPath?: string; deleted?: string }> {
    const folder = root.info!;
    const parent = await lstat(folder);
    if (
      !parent.isDirectory() ||
      parent.isSymbolicLink() ||
      parent.uid !== process.getuid!() ||
      parent.mode & 0o077 ||
      (await realpath(folder)) !== folder
    )
      throw new Error('Trash metadata folder could not be verified.');
    const file = path.join(folder, name + '.trashinfo');
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 65536)
      throw new Error('Trash metadata could not be verified.');
    const text = await readFile(file, 'utf8');
    if (!text.startsWith('[Trash Info]')) throw new Error('Trash metadata is invalid.');
    const source = /^Path=(.*)$/m.exec(text)?.[1],
      deleted = /^DeletionDate=(.*)$/m.exec(text)?.[1];
    const decoded = source ? decodeURIComponent(source) : undefined;
    // Absolute paths are normal in the home Trash. Relative paths on a mounted
    // volume are relative to that volume, and must never contain '..'.
    const base = root.originBase;
    const originalPath =
      decoded && !decoded.includes('\0') && !decoded.split('/').includes('..')
        ? path.isAbsolute(decoded)
          ? path.normalize(decoded)
          : base
            ? path.resolve(base, decoded)
            : undefined
        : undefined;
    return {
      ...(originalPath ? { originalPath } : {}),
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
    const available = new Map<string, TrashRoot>();
    const items: TrashItem[] = [];
    for (const value of values) {
      if (
        !value ||
        typeof value !== 'object' ||
        typeof value.id !== 'string' ||
        typeof value.name !== 'string' ||
        typeof value.directory !== 'boolean' ||
        typeof value.size !== 'number'
      )
        throw new Error('Recycle Bin returned an invalid item.');
      if (
        !path.isAbsolute(value.id) ||
        value.id.includes('\0') ||
        path.basename(value.name) !== value.name
      )
        throw new Error('Recycle Bin returned an invalid path.');
      const root: TrashRoot = { path: path.dirname(value.id), name: 'Recycle Bin' };
      const rootInfo = await lstat(root.path);
      available.set(id(root.path), root);
      items.push(
        this.#remember(value.id, root, identity(rootInfo), await lstat(value.id), {
          name: value.name,
          ...(typeof value.originalPath === 'string' && path.isAbsolute(value.originalPath)
            ? { originalPath: path.join(value.originalPath, value.name) }
            : {}),
          ...(typeof value.deleted === 'string' ? { deleted: value.deleted } : {}),
        }),
      );
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
    const snapshot: TrashSnapshot = {
      revision: id(JSON.stringify(items)),
      items,
      locations: [{ id: 'windows', name: 'Recycle Bin', state: 'ready' }],
      truncated: false,
      canEmpty: items.length > 0,
    };
    return { snapshot, roots: [], available };
  }
}
