import { shell } from 'electron';
import type { ApiHandlers } from './schemas';
import type { FileAccess } from '../files/file-access';
import type { FileServices } from '../files/file-services';
import type { FileInformationService } from '../files/file-information';
import type { Watchers } from '../files/watchers';
import { entry, list } from '../files/filesystem';
import { macFiles } from '../native/macos-files';

type FileHandlers = Pick<
  ApiHandlers,
  | 'list'
  | 'stat'
  | 'inspect'
  | 'fileInformation'
  | 'fileInformationUpdate'
  | 'reveal'
  | 'openExternal'
  | 'nativeFilePanel'
  | 'folderSizeStart'
  | 'folderSizeGet'
  | 'folderSizeCancel'
  | 'watch'
  | 'unwatch'
>;
interface FilePorts {
  fileAccess: Pick<FileAccess, 'require'>;
  files: Pick<FileServices, 'inspect' | 'sizeStart' | 'sizeGet' | 'sizeCancel'>;
  information: Pick<FileInformationService, 'get' | 'update'>;
  watchers: Pick<Watchers, 'add' | 'remove'>;
}

/** Every path a window names is checked against the granted folders before it is used. */
export function createFileHandlers(ports: FilePorts): FileHandlers {
  return {
    list: async ([folder]) => {
      await ports.fileAccess.require([folder]);
      return list(folder);
    },
    stat: async ([file]) => {
      await ports.fileAccess.require([file]);
      return entry(file);
    },
    inspect: ([file, content, ocr]) => ports.files.inspect(file, content, ocr),
    fileInformation: ([file]) => ports.information.get(file),
    fileInformationUpdate: ([file, revision, patch]) =>
      ports.information.update(file, revision, patch),
    reveal: async ([file]) => {
      await ports.fileAccess.require([file]);
      shell.showItemInFolder(file);
    },
    openExternal: async ([file]) => {
      await ports.fileAccess.require([file]);
      const error = await shell.openPath(file);
      if (error) throw new Error(error);
    },
    nativeFilePanel: async ([kind, files]) => {
      await ports.fileAccess.require(files);
      macFiles().filePanel(kind, files);
    },
    folderSizeStart: ([paths]) => ports.files.sizeStart(paths),
    folderSizeGet: ([id]) => ports.files.sizeGet(id),
    folderSizeCancel: ([id]) => ports.files.sizeCancel(id),
    watch: async ([folder, subscriber]) => {
      await ports.fileAccess.require([folder]);
      await ports.watchers.add(folder, subscriber);
      // access revoked while the watch attached: detach it again
      try {
        await ports.fileAccess.require([folder]);
      } catch (error) {
        await ports.watchers.remove(subscriber);
        throw error;
      }
    },
    unwatch: ([subscriber]) => ports.watchers.remove(subscriber),
  };
}
