import path from 'node:path';
import { createRequire } from 'node:module';
import type { ReviewedFileExpectation } from './reviewed-file';
import { guardNativeTestRemovals } from './test-removal-policy';
import type { FullscreenPhase } from '../windows/fullscreen-transition';
import { assetPath } from './assets';
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
  /** Long-lived streaming access uses its own bounded native queue. */
  stream?: boolean;
  /** Long media transformations must not occupy foreground or playback slots. */
  transform?: boolean;
  path: string;
  mode: 'read' | 'metadata' | 'write' | 'move' | 'delete';
}
export interface NativeAddedDate {
  path: string;
  identity: string;
  size: number;
  modified: number;
  added?: number;
}
export interface MacFiles {
  /** Public AppKit transition notifications, read only for a live owned NSView handle. */
  windowFullscreenPhase(handle: Buffer): FullscreenPhase;
  /** Displays native confirmation only. No callable erasure/approval endpoint. */
  trashConfirmation(review: string): void;
  datesAdded(files: string[]): Promise<NativeAddedDate[]>;
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
  trash(file: string, purpose?: string, expected?: ReviewedFileExpectation): Promise<TrashReceipt>;
  volumes(): Promise<NativeVolume[]>;
  eject(file: string): Promise<void>;
  /** PDFKit's print sheet; refuses locked documents without their password. */
  printPDF(file: string, password?: string): void;
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
  const assets = assetPath();
  // The production main bundle is CommonJS, where import.meta.url is absent.
  // The addon path is absolute; resolution needs only a stable absolute base.
  const require = createRequire(path.join(assets, 'viewer-native.cjs'));
  const file = path.join(assets, 'viewer-macos-files.node');
  return (binding ??= guardNativeTestRemovals(require(file) as MacFiles));
}
