import { dialog, type BrowserWindow } from 'electron';
import path from 'node:path';
import type { DesktopEvent } from '../../domain/contracts';
import { errorMessage } from '../../domain/errors';
import type { ApiHandlers } from './schemas';
import type { FileAccess } from '../files/file-access';
import type { Resources } from '../previews/resources';
import type { TextFiles } from '../editing/text-files';
import type { TextBuffers } from '../editing/text-buffers';
import { askNatively } from '../native/native-confirmation';

type EditingHandlers = Pick<
  ApiHandlers,
  | 'textEdit'
  | 'textOpen'
  | 'textSave'
  | 'textSaveAs'
  | 'textEditEnd'
  | 'textPrompt'
  | 'bufferList'
  | 'bufferRead'
  | 'bufferWrite'
  | 'bufferDiscard'
>;
interface EditingPorts {
  home: string;
  resources: Resources;
  fileAccess: FileAccess;
  texts: TextFiles;
  buffers: TextBuffers;
  window(sender: number): BrowserWindow | undefined;
  emit(event: DesktopEvent): void;
}

/** All native text dialogs, grants, saves and recovery buffers share this handler group. */
export function createEditingHandlers(ports: EditingPorts): EditingHandlers {
  return {
    textEdit: (args, senderID) => {
      const command = args[0];
      ports.window(senderID)!.webContents[command]();
      return;
    },
    textOpen: async (args) => {
      let file: string;
      try {
        file = ports.resources.editableFile(args[0]);
      } catch (error) {
        return { editable: false, reason: errorMessage(error) };
      }
      return ports.texts.open(file);
    },
    textSave: (args) => ports.texts.save(args[0], args[1], args[2], args[3], args[4]),
    textSaveAs: async (args, senderID) => {
      const [text, name, session] = args;
      const window = ports.window(senderID);
      const options = {
        title: 'Save As',
        // `:w path` opens the dialog there (2026-10-23); a name alone starts on the Desktop
        defaultPath: path.isAbsolute(name)
          ? path.normalize(name)
          : path.join(ports.home, 'Desktop', path.basename(name)),
        securityScopedBookmarks: ports.fileAccess.scoped,
      };
      const { canceled, filePath, bookmark } = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options);
      if (canceled || !filePath) return null;
      await ports.fileAccess.allowOnce(filePath, bookmark);
      await ports.fileAccess.require([filePath]);
      const version = await ports.texts.saveAs(filePath, text, session);
      ports.emit({ type: 'folder-changed', path: path.dirname(filePath) });
      return { file: filePath, version };
    },
    textEditEnd: (args) => ports.texts.end(args[0]),
    textPrompt: async (args, senderID) => {
      const [kind, name] = args;
      const window = ports.window(senderID);
      if (kind === 'revert')
        return (await askNatively(window, {
          message: `Revert “${name}” to the saved version?`,
          detail: 'Your unsaved edits are discarded. The saved file is not changed.',
          buttons: ['Cancel', 'Revert'],
          defaultId: 0,
          cancelId: 0,
        })) === 1
          ? 'discard'
          : 'cancel';
      const choice = await askNatively(window, {
        message: `Save the changes to “${name}” before closing it?`,
        detail: 'If you don’t save, your changes are discarded.',
        buttons: ['Save', 'Don’t Save', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
      });
      return (['save', 'discard', 'cancel'] as const)[choice] ?? 'cancel';
    },
    bufferList: async () => ({
      buffers: await ports.buffers.list(),
      problems: ports.buffers.problems(),
    }),
    bufferRead: (args) => ports.buffers.read(args[0]),
    bufferWrite: (args) => ports.buffers.write(args[0]),
    bufferDiscard: (args) => ports.buffers.discard(args[0]),
  };
}
