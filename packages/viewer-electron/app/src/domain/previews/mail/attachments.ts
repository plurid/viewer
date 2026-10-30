import { z } from 'zod';
import { mailListLimits } from './formats';

/**
 * Saving one attachment of a message as a file of its own, through the operations service. The
 * operation's source is the message file; `message` is the message's place in a mailbox, and `part`
 * the attachment's place in the message's list of attachments.
 */
export const mailAttachmentSchema = z
  .object({
    kind: z.literal('mail-attachment'),
    message: z
      .number()
      .int()
      .min(0)
      .max(mailListLimits.messages - 1)
      .optional(),
    part: z
      .number()
      .int()
      .min(0)
      .max(mailListLimits.attachments - 1),
  })
  .strict();
export type MailAttachmentPlan = z.infer<typeof mailAttachmentSchema>;

/** A saved name's length in UTF-8 bytes. macOS allows 255, and Keep Both may add " copy 99". */
const nameBytes = 240;
/** The longest extension a shortened name keeps whole. */
const extensionCharacters = 16;
/** Device names Windows reserves, whatever their extension: a share may refuse them. */
const reservedStem = /^(?:con|prn|aux|nul|com\d|lpt\d)$/i;
/** C0 and C1 controls, and marks that reorder text so that `fdp.exe` reads as `exe.pdf`. */
const unsafeCharacters =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const encoder = new TextEncoder();

/** `name` cut, between whole characters, to `nameBytes`, keeping a short extension. */
function shortened(name: string, fallback: string): string {
  if (encoder.encode(name).length <= nameBytes) return name;
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 && name.length - dot <= extensionCharacters ? name.slice(dot) : '';
  let room = nameBytes - encoder.encode(extension).length;
  let stem = '';
  for (const { segment } of graphemes.segment(name.slice(0, name.length - extension.length))) {
    room -= encoder.encode(segment).length;
    if (room < 0) break;
    stem += segment;
  }
  return (stem.replace(/[.\s]+$/, '') || fallback) + extension;
}

/**
 * The file name an attachment is saved under. Its sender chose it, so it is made safe to keep:
 * path separators become hyphens; control characters and marks that reorder text are removed;
 * leading dots, which would hide the file, and trailing dots and spaces go; a name Windows
 * reserves gains an underscore; and a long name is shortened. A name left empty becomes
 * `fallback`. Applied twice, it changes nothing more.
 */
export function savedAttachmentName(name: string, fallback = 'Attachment'): string {
  let safe = name
    .normalize('NFC')
    .replace(unsafeCharacters, '')
    .replace(/[/\\:]/g, '-')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '');
  if (!safe) safe = fallback;
  const [stem = '', ...rest] = safe.split('.');
  if (reservedStem.test(stem)) safe = [`${stem}_`, ...rest].join('.');
  return shortened(safe, fallback);
}
