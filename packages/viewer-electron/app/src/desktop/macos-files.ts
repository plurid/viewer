import path from 'node:path';
import { createRequire } from 'node:module';
export interface NativeVolume {
  path: string;
  name: string;
  total: number;
  available: number;
  removable: boolean;
  ejectable: boolean;
  readOnly: boolean;
}
export interface FileAccessIntent {
  path: string;
  mode: 'read' | 'metadata' | 'write' | 'move' | 'delete';
}
export interface MacFiles {
  /** Displays native confirmation only. No callable erasure/approval endpoint. */
  trashConfirmation(review: string): void;
  information(file: string): Promise<string>;
  updateInformation(file: string, revision: string, json: string): Promise<string>;
  alias(source: string, destination: string): Promise<void>;
  filePanel(kind: string, files: string[]): void;
  dismissFilePanels(): void;
  coordinateStart(
    id: string,
    intents: FileAccessIntent[],
    purpose: string,
    nested?: boolean,
  ): Promise<string[]>;
  coordinateCancel(id: string): void;
  coordinateEnd(id: string): Promise<void>;
  coordinateSameItem(original: string, returned: string): boolean;
  clipboardVersion(drag?: boolean): number;
  clipboardRead(drag?: boolean): {
    files: { path: string; directory: boolean; bookmark?: string }[];
    changeCount: number;
  };
  clipboardWrite(paths: string[]): number;
  copyMetadata(sourceFD: number, targetFD: number): Promise<void>;
  copyLinkMetadata(source: string, target: string): Promise<void>;
  renameExclusive(source: string, target: string, purpose?: string): Promise<void>;
  trash(file: string, purpose?: string): Promise<TrashReceipt>;
  volumes(): Promise<NativeVolume[]>;
  eject(file: string): Promise<void>;
}
let binding: MacFiles | undefined;
export interface TrashReceipt {
  path: string;
  directory: boolean;
  bookmark?: string;
}
export type ReceiptAccess = <T>(receipt: TrashReceipt, work: () => Promise<T>) => Promise<T>;
export function macFiles(): MacFiles {
  if (process.platform !== 'darwin') throw new Error('This file service requires macOS.');
  const assets = process.versions.electron ? process.resourcesPath : path.resolve('assets');
  // The production main bundle is CommonJS, where import.meta.url is absent.
  // The addon path is absolute; resolution needs only a stable absolute base.
  const require = createRequire(path.join(assets, 'viewer-native.cjs'));
  const file =
    process.versions.electron && !process.defaultApp
      ? path.join(assets, 'viewer-macos-files.node')
      : path.resolve('assets/viewer-macos-files.node');
  return (binding ??= require(file) as MacFiles);
}
