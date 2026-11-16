import { macFiles } from '../native/macos-files';

export interface FileVisibility {
  hiddenEntries(folder: string): Promise<readonly string[]>;
  fileHidden(file: string): Promise<boolean>;
}

/** Older development helpers keep the dot rule until the owner rebuilds the native helper. */
export const fileVisibility: FileVisibility = {
  hiddenEntries: async (folder) =>
    process.platform === 'darwin' ? ((await macFiles().hiddenEntries?.(folder)) ?? []) : [],
  fileHidden: async (file) =>
    process.platform === 'darwin' ? ((await macFiles().fileHidden?.(file)) ?? false) : false,
};
