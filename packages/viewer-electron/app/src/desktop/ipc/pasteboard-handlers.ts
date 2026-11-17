import { app, type BrowserWindow } from 'electron';
import type { ApiHandlers } from './schemas';
import type { FileAccess } from '../files/file-access';
import type { Pasteboard } from '../native/pasteboard';
import type { Operations } from '../operations/operations';
import type { OperationRequest } from '../../domain/contracts';
import { requireAbsoluteLocalPath } from '../files/local-path';

type PasteboardHandlers = Pick<
  ApiHandlers,
  | 'clipboardWrite'
  | 'clipboardWriteText'
  | 'clipboardRead'
  | 'clipboardPaste'
  | 'fileDropPaths'
  | 'copyPaths'
  | 'fileDragStart'
>;
interface PasteboardPorts {
  pasteboard: Pick<
    Pasteboard,
    'write' | 'writeText' | 'read' | 'readForPaste' | 'dropped' | 'copyText'
  >;
  operations: Pick<Operations, 'start' | 'createImage'>;
  isAgent(owner: number): boolean;
  recorded?(request: OperationRequest, id: string): Promise<void>;
  fileAccess: Pick<FileAccess, 'require'>;
  window(owner: number): BrowserWindow | undefined;
}

/** File objects reach the clipboard or a drag only from granted folders; paths copy as text. */
export function createPasteboardHandlers(ports: PasteboardPorts): PasteboardHandlers {
  return {
    clipboardWrite: ([paths, cut]) => ports.pasteboard.write(paths, cut),
    clipboardWriteText: ([text]) => ports.pasteboard.writeText(text),
    clipboardRead: () => ports.pasteboard.read(),
    clipboardPaste: async ([destination], owner) => {
      requireAbsoluteLocalPath(destination);
      const content = await ports.pasteboard.readForPaste();
      if (!content) return null;
      // This window-wide attribution also covers the person's input while an agent awaits its reply.
      // Agent proposals already refuse Paste in agentCommandID, before renderer dispatch.
      const actor = ports.isAgent(owner) ? 'agent' : 'person';
      if ('png' in content)
        return { id: ports.operations.createImage(destination, content.png, actor), image: true };
      const request: OperationRequest = {
        kind: content.cut ? 'move' : 'copy',
        sources: content.paths,
        destination,
      };
      const id = ports.operations.start(request, actor);
      await ports.recorded?.(request, id);
      return { id, image: false };
    },
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
