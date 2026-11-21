import { shell, type BrowserWindow } from 'electron';
import type { DesktopEvent } from '../../domain/contracts';
import type { PrivacySettingsPane } from '../../domain/files/access';
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
  | 'fileAccessPrivacySettings'
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
    | 'restoreFootprint'
    | 'restore'
    | 'requestAccess'
  >;
  requireWindow(owner: number): BrowserWindow;
  quiesceRoot(root: string): Promise<void>;
  refreshIndex(): Promise<void>;
  emit(event: DesktopEvent): void;
  isAgent?(owner: number): boolean;
  openURL?(url: string): Promise<void>;
}

/** Fixed macOS System Settings destinations for Privacy & Security folder permissions. */
export function privacySettingsURLs(
  pane: PrivacySettingsPane = 'files',
): readonly [string, string] {
  return [
    pane === 'all-files'
      ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'
      : 'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders',
    'x-apple.systempreferences:com.apple.preference.security',
  ];
}

export async function openPrivacySettings(
  pane: PrivacySettingsPane = 'files',
  open: (url: string) => Promise<void> = (url) => shell.openExternal(url),
): Promise<void> {
  const [specific, general] = privacySettingsURLs(pane);
  try {
    await open(specific);
  } catch {
    await open(general);
  }
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
    fileAccessPrivacySettings: async ([pane], owner) => {
      if (ports.isAgent?.(owner))
        throw new Error('Privacy settings are available only to the person.');
      if (process.platform !== 'darwin')
        throw new Error('Privacy settings are available only on macOS.');
      // Fixed System Settings link only; it never grants access or changes scopes.
      await openPrivacySettings(pane, ports.openURL);
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
    trashPreview: ([itemID], owner) => ports.trash.preview(itemID, owner),
    trashCopyPaths: ([itemIDs]) => ports.trash.copyPaths(itemIDs),
    trashRestore: async ([itemIDs, destination], owner) => {
      // the folder is chosen before the operations queue is held: a panel left open blocked it
      const folder =
        destination === 'choose'
          ? await ports.trash.chooseRestoreFolder(ports.requireWindow(owner))
          : undefined;
      if (destination === 'choose' && !folder) return { restored: 0, cancelled: true };
      const target = folder ? { folder } : 'original';
      return ports.operations.exclusive(
        () => ports.trash.restore(ports.requireWindow(owner), itemIDs, target),
        () => ports.trash.restoreFootprint(itemIDs, target),
      );
    },
    trashAccess: ([locationID], owner) =>
      ports.trash.requestAccess(ports.requireWindow(owner), locationID),
  };
}
