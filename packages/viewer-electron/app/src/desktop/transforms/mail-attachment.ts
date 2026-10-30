import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { MailAttachmentPlan } from '../../domain/previews/mail/attachments';
import { mailFormats } from '../../domain/previews/mail/formats';
import { messageAttachment } from '../../domain/previews/mail/message';
import { openedMessageBytes } from '../previews/mail';
import { macFiles } from '../native/macos-files';

/** The message file a transform opened, under its read coordination claim. */
interface OpenedMessage {
  file: string;
  handle: FileHandle;
}

/** Records a saved attachment as downloaded, as Mail does, so macOS checks it before it opens. */
function markDownloaded(file: string): void {
  if (process.platform !== 'darwin') return;
  try {
    macFiles().quarantineAttachment(file);
  } catch (error) {
    throw new Error('This attachment could not be marked as downloaded, so it was not saved.', {
      cause: error,
    });
  }
}

/**
 * Writes one attachment of a message, or of a mailbox's message, to `output`, a new file: read with
 * the parser the preview lists it with, and decoded from its transfer encoding. Nothing in it is
 * opened or run, and the file is not executable. The caller checks the message's version after.
 */
export async function saveAttachment(
  source: OpenedMessage,
  plan: MailAttachmentPlan,
  output: string,
  signal: AbortSignal,
  progress: (fraction: number, detail: string) => void,
): Promise<void> {
  const format = path.extname(source.file).slice(1).toLowerCase();
  if (!mailFormats.includes(format)) throw new Error('Choose an email message.');
  progress(0.1, 'Reading message');
  const bytes = await openedMessageBytes(source.file, source.handle, format, plan.message, signal);
  const attachment = messageAttachment(bytes, plan.part);
  if (!attachment) throw new Error('This attachment is no longer in the message.');
  signal.throwIfAborted();
  const target = await open(output, 'wx', 0o644);
  try {
    await target.writeFile(attachment.data);
    await target.sync();
  } finally {
    await target.close();
  }
  markDownloaded(output);
  progress(1, 'Attachment saved');
}
