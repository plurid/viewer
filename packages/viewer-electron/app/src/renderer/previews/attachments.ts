import type { FileEntry } from '../../domain/contracts';
import type { AttachmentSave } from './contracts';
import { sourceVersion } from '../../domain/files/inspection';
import { savedAttachmentName } from '../../domain/previews/mail/attachments';
import { parentPath } from '../../domain/workspaces/planes';

/**
 * Saves attachments of the message `entry`, each as a file operation of its own, so it is named,
 * staged and undone as any other, and keeps both when its name is taken. They go beside the
 * message, or to the folder the person chooses. The message's version as read is pinned: once it
 * changes, nothing more is saved from it.
 */
export async function saveAttachments(entry: FileEntry, request: AttachmentSave): Promise<void> {
  const beside = parentPath(entry.path);
  const folder =
    request.destination === 'choose' ? await window.viewer.chooseFolder(beside) : beside;
  if (!folder) return;
  for (const { part, name } of request.attachments)
    await window.viewer.operate({
      kind: 'convert',
      sources: [entry.path],
      destination: folder,
      name: savedAttachmentName(name),
      transform: {
        kind: 'mail-attachment',
        ...(request.message === undefined ? {} : { message: request.message }),
        part,
      },
      expectedSources: [{ path: entry.path, version: sourceVersion(entry) }],
    });
}
