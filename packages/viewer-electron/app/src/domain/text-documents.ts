import { z } from 'zod';

/**
 * A text file's version as it was read: its item, date and size, and the hash of its bytes, all
 * taken from one open handle. A save is checked against it, so nothing that changed is overwritten.
 */
export const textVersionSchema = z
  .object({
    identity: z.string().max(300),
    modified: z.number().finite(),
    size: z.number().finite().min(0),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type TextVersion = z.infer<typeof textVersionSchema>;

export const sameTextVersion = (a: TextVersion, b: TextVersion) =>
  a.identity === b.identity &&
  a.modified === b.modified &&
  a.size === b.size &&
  a.sha256 === b.sha256;

/** A text file open for editing. `text` leaves out a byte-order mark, which `bom` keeps for saving. */
export interface TextDocument {
  file: string;
  text: string;
  bom: boolean;
  version: TextVersion;
}

/** Whether a previewed file can be edited where it is, and why not. */
export type TextOpening =
  | { editable: true; document: TextDocument }
  | {
      editable: false;
      reason: string;
      /** A folder whose access, once allowed, makes the file editable (the App Store build). */
      folder?: string;
    };

/** A save refused because the file changed since it was read; its error carries this code. */
export const textChangedCode = 'TEXT_CHANGED_ON_DISK';

/** The most text Viewer edits or saves, as a preview reads at most. */
export const MAX_TEXT_BYTES = 4 * 1024 * 1024;

/** Unsaved text Viewer keeps in its profile: a scratch plane's, or a file's unsaved edits. */
export interface TextBuffer {
  id: string;
  kind: 'scratch' | 'file';
  /** A file's unsaved edits: the file, and the version they were made over. */
  file?: string;
  base?: TextVersion;
  bom?: boolean;
  language?: string;
  title?: string;
  text: string;
  /** Rises with each write, so an older write arriving late is ignored. */
  revision: number;
  updated: number;
}
/** A kept buffer, without its text. */
export type TextBufferSummary = Omit<TextBuffer, 'text' | 'base' | 'bom' | 'revision'> & {
  bytes: number;
};

/** Without spaces and tabs at line ends, its line breaks kept (`\r\n` too): VS Code's trimming. */
export const trimTrailingWhitespace = (text: string) => text.replace(/[ \t]+(?=\r?\n|$)/g, '');
