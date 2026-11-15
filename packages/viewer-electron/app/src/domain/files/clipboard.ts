export interface ClipboardFiles {
  paths: string[];
  cut: boolean;
  image?: false;
}
export type ClipboardContent = ClipboardFiles | { paths: []; cut: false; image: true };
export interface ClipboardPaste {
  id: string;
  image: boolean;
}

/**
 * A full-screen capture of a large display is tens of megabytes as PNG, so the 4 MiB bound on text
 * saves would refuse the case pasting exists for. 64 MiB is the bound other large items share.
 */
export const MAX_CLIPBOARD_IMAGE_BYTES = 64 * 1024 * 1024;

export function checkClipboardImageSize(bytes: number): void {
  if (bytes > MAX_CLIPBOARD_IMAGE_BYTES)
    throw new Error('Pasted pictures must be 64 MiB or smaller as PNG.');
}
