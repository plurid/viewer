import { clipboard } from 'electron';
import { macFiles } from './macos-files';
import type { FileAccess } from './file-access';
import type { NativeSelections } from './native-selections';

/** Files on the system pasteboard and in drags. On macOS, only bookmarks the native
 * pasteboard itself provides can extend Viewer's folder access. */
export class Pasteboard {
  /** The last file copy or cut from Viewer; Paste moves only when it is still current. */
  private clipboard: {
    paths: string[];
    cut: boolean;
    text: string;
    changeCount?: number;
  } | null = null;
  constructor(
    private access: FileAccess,
    private selections: NativeSelections,
  ) {}
  async write(paths: string[], cut: boolean): Promise<void> {
    await this.access.require(paths);
    const text = paths.join('\n');
    if (process.platform === 'darwin') {
      const changeCount = macFiles().clipboardWrite(paths);
      this.clipboard = { paths, cut: cut, text, changeCount };
    } else {
      await clipboard.writeText(text);
      this.clipboard = { paths, cut: cut, text };
    }
    return;
  }
  async read(): Promise<{ paths: string[]; cut: boolean } | null> {
    const value = this.clipboard;
    if (process.platform === 'darwin') {
      const native = macFiles().clipboardRead();
      const selection = this.selections.capture('clipboard', native.changeCount);
      if (!native.files.length) return null;
      // Only bookmarks obtained from the native pasteboard can confer access.
      const incoming: { path: string; directory: boolean; bookmark: string }[] = [];
      for (const file of native.files) {
        try {
          await this.access.require([file.path]);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'FILE_ACCESS_REQUIRED' || !file.bookmark)
            throw error;
          incoming.push({
            path: file.path,
            directory: file.directory,
            bookmark: file.bookmark,
          });
        }
      }
      this.selections.assertImport(
        incoming.map((file) => file.path),
        selection,
      );
      await this.access.receiveNative(incoming);
      await this.access.require(native.files.map((file) => file.path));
      return {
        paths: native.files.map((file) => file.path),
        cut: value?.changeCount === native.changeCount && !!value.cut,
      };
    }
    return value && (await clipboard.readText()) === value.text
      ? { paths: value.paths, cut: value.cut }
      : null;
  }
  /** Paths dropped onto Viewer, accepted with any access their drag carried. */
  async dropped(paths: string[]): Promise<string[]> {
    if (process.platform === 'darwin' && this.access.scoped) {
      const native = macFiles().clipboardRead(true);
      const files = native.files;
      const selection = this.selections.capture('drag', native.changeCount);
      const requested = new Set(paths);
      const incoming: { path: string; directory: boolean; bookmark: string }[] = [];
      for (const file of files)
        if (requested.has(file.path) && file.bookmark) {
          try {
            await this.access.require([file.path]);
          } catch (error) {
            if ((error as { code?: string }).code !== 'FILE_ACCESS_REQUIRED') throw error;
            incoming.push({
              path: file.path,
              directory: file.directory,
              bookmark: file.bookmark,
            });
          }
        }
      this.selections.assertImport(
        incoming.map((file) => file.path),
        selection,
      );
      await this.access.receiveNative(incoming);
    }
    await this.access.require(paths);
    return paths;
  }
  async copyText(paths: string[]): Promise<void> {
    await clipboard.writeText(paths.join('\n'));
    // Plain-text paths must not retain a previous cut/copy file operation.
    this.clipboard = null;
    return;
  }
}
