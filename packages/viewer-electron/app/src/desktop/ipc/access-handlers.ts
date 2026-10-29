import { shell, type BrowserWindow } from 'electron';
import type { DesktopEvent } from '../../domain/contracts';
import { serverAddress } from '../../domain/files/volumes';
import type { ApiHandlers } from './schemas';
import type { FileAccess } from '../files/file-access';
import type { FileServices } from '../files/file-services';
import type { NativeSelections } from '../native/native-selections';
import type { Resources } from '../previews/resources';
import type { Operations } from '../operations/operations';
import type { Trash } from '../operations/trash';
import { macFiles } from '../native/macos-files';

type AccessHandlers = Pick<
  ApiHandlers,
  | 'fileAccessList'
  | 'fileAccessRevoke'
  | 'volumesList'
  | 'volumeEject'
  | 'connectServer'
  | 'trashList'
  | 'trashConfirmation'
  | 'trashPreview'
  | 'trashCopyPaths'
  | 'trashRestore'
  | 'trashAccess'
>;
interface AccessPorts {
  fileAccess: Pick<FileAccess, 'scoped' | 'list' | 'revoke' | 'withBlocked'>;
  selections: Pick<NativeSelections, 'revoke'>;
  resources: Pick<Resources, 'affected'>;
  files: Pick<FileServices, 'reset'>;
  operations: Pick<Operations, 'exclusive'>;
  trash: Pick<
    Trash,
    | 'list'
    | 'confirmation'
    | 'preview'
    | 'copyPaths'
    | 'chooseRestoreFolder'
    | 'restore'
    | 'requestAccess'
  >;
  requireWindow(owner: number): BrowserWindow;
  quiesceRoot(root: string): Promise<void>;
  refreshIndex(): Promise<void>;
  emit(event: DesktopEvent): void;
}

/** Revoking a folder and ejecting its volume stop its services through one list, `quiesceRoot`. */
export function createAccessHandlers(ports: AccessPorts): AccessHandlers {
  return {
    fileAccessList: () => ports.fileAccess.list(),
    fileAccessRevoke: async ([root]) => {
      if (process.platform === 'darwin') macFiles().dismissFilePanels();
      if (ports.fileAccess.scoped) ports.selections.revoke(root);
      let resources: string[] = [];
      ports.emit({ type: 'file-access', path: root });
      await ports.fileAccess.revoke(root, async () => {
        resources = await ports.resources.affected(root);
        ports.emit({ type: 'file-access', path: root, resources });
        await ports.quiesceRoot(root);
        await ports.files.reset();
        await ports.refreshIndex();
      });
      ports.emit({ type: 'file-access', path: root, resources });
    },
    volumesList: () => (process.platform === 'darwin' ? macFiles().volumes() : []),
    volumeEject: async ([root]) => {
      const volume = (await macFiles().volumes()).find((volume) => volume.path === root);
      if (!volume?.ejectable || root === '/') throw new Error('Choose an ejectable volume.');
      let resources: string[] = [];
      try {
        await ports.fileAccess.withBlocked(root, async () => {
          ports.emit({ type: 'file-access', path: root });
          resources = await ports.resources.affected(root);
          ports.emit({ type: 'file-access', path: root, resources });
          await ports.quiesceRoot(root);
          await ports.files.reset();
          await macFiles().eject(root);
        });
      } finally {
        await ports.refreshIndex();
        ports.emit({ type: 'file-access', path: root, resources });
      }
    },
    connectServer: async ([address]) => {
      // Only file-sharing addresses: the system mounts them and asks for credentials.
      await shell.openExternal(serverAddress(address));
    },
    trashList: ([folderID]) => ports.trash.list(folderID),
    trashConfirmation: ([revision], owner) =>
      ports.trash.confirmation(ports.requireWindow(owner), revision),
    trashPreview: ([itemID]) => ports.trash.preview(itemID),
    trashCopyPaths: ([itemIDs]) => ports.trash.copyPaths(itemIDs),
    trashRestore: async ([itemIDs, destination], owner) => {
      // the folder is chosen before the operations queue is held: a panel left open blocked it
      const folder =
        destination === 'choose'
          ? await ports.trash.chooseRestoreFolder(ports.requireWindow(owner))
          : undefined;
      if (destination === 'choose' && !folder) return { restored: 0, cancelled: true };
      return ports.operations.exclusive(() =>
        ports.trash.restore(ports.requireWindow(owner), itemIDs, folder ? { folder } : 'original'),
      );
    },
    trashAccess: ([locationID], owner) =>
      ports.trash.requestAccess(ports.requireWindow(owner), locationID),
  };
}
