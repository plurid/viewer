import { app, type BrowserWindow } from 'electron';
import type { ApiHandlers } from './schemas';
import type { FileAccess } from '../files/file-access';
import type { Pasteboard } from '../native/pasteboard';

type PasteboardHandlers = Pick<
  ApiHandlers,
  'clipboardWrite' | 'clipboardRead' | 'fileDropPaths' | 'copyPaths' | 'fileDragStart'
>;
interface PasteboardPorts {
  pasteboard: Pick<Pasteboard, 'write' | 'read' | 'dropped' | 'copyText'>;
  fileAccess: Pick<FileAccess, 'require'>;
  window(owner: number): BrowserWindow | undefined;
}

/** File objects reach the clipboard or a drag only from granted folders; paths copy as text. */
export function createPasteboardHandlers(ports: PasteboardPorts): PasteboardHandlers {
  return {
    clipboardWrite: ([paths, cut]) => ports.pasteboard.write(paths, cut),
    clipboardRead: () => ports.pasteboard.read(),
    fileDropPaths: ([paths]) => ports.pasteboard.dropped(paths),
    copyPaths: ([paths]) => ports.pasteboard.copyText(paths),
    fileDragStart: async ([paths], owner) => {
      await ports.fileAccess.require(paths);
      const window = ports.window(owner);
      if (!window || window.isDestroyed()) throw new Error('The file view has closed.');
      const [first] = paths;
      if (!first) return;
      // Native file objects carry all selected paths to Finder and other apps.
      const icon = await app.getFileIcon(first, { size: 'normal' });
      window.webContents.startDrag({ file: first, files: paths, icon });
    },
  };
}
