import { macFiles } from '../native/macos-files';
import type { MacFiles } from '../native/macos-files';

export interface FileVisibility {
  hiddenEntries(folder: string): Promise<readonly string[]>;
  fileHidden(file: string): Promise<boolean>;
}

/** Older development helpers keep the dot rule until the owner rebuilds the native helper. */
export function createFileVisibility(
  binding: () => Pick<MacFiles, 'hiddenEntries' | 'fileHidden'>,
): FileVisibility {
  return {
    hiddenEntries: async (folder) => {
      try {
        return process.platform === 'darwin'
          ? ((await binding().hiddenEntries?.(folder)) ?? [])
          : [];
      } catch {
        return [];
      }
    },
    fileHidden: async (file) => {
      try { return process.platform === 'darwin' ? ((await binding().fileHidden?.(file)) ?? false) : false; }
      catch { return false; }
    },
  };
}
export const fileVisibility = createFileVisibility(macFiles);
