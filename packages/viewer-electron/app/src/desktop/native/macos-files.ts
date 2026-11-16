import path from 'node:path';
import { createRequire } from 'node:module';
import type { ReviewedFileExpectation } from './reviewed-file';
import { guardNativeTestRemovals } from './test-removal-policy';
import type { FullscreenPhase } from '../windows/fullscreen-transition';
import { assetPath } from './assets';
import {
  nativeIdentityArgument,
  itemIdentity,
  identityKind,
} from '../../domain/files/item-identity';
import { sameSourceVersion, sourceVersion } from '../../domain/files/inspection';
import { lstat } from '../files/stats';
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
export interface NativeRenameReservation {
  kind: 'reservation';
  path: string;
  identity: string;
  directory: boolean;
}
export interface NativeRenameKept {
  kind: 'kept';
  path: string;
}
export interface NativeRenameRestored {
  kind: 'restored';
  path: string;
}
export type NativeRenameRecoveryEntry =
  NativeRenameReservation | NativeRenameKept | NativeRenameRestored;
export interface NativeRenameContainer {
  path: string;
  identity: string;
}
export interface NativeRenameRecovery {
  entries: NativeRenameRecoveryEntry[];
  containers: NativeRenameContainer[];
}
export interface NativeRenameFailure extends NodeJS.ErrnoException {
  renameMessage?: string;
  renameRecovery?: NativeRenameRecovery;
}
export interface MacFiles {
  /** Older helpers must never enter reservation publication with path-based cleanup. */
  readonly renameRecoveryVersion?: number;
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
  /** An APFS clone of the open file `sourceFD` at the new path `target`, made exclusively with the
   * source's attributes. Rejects with ENOTSUP or EXDEV where the volume cannot clone it. */
  clone(sourceFD: number, target: string): Promise<void>;
  copyLinkMetadata(source: string, target: string): Promise<void>;
  renameExclusive(
    source: string,
    target: string,
    purpose?: string,
    allowReservation?: boolean,
  ): Promise<void>;
  /** Rejects with ENOTSUP only for a volume without a Trash. */
  trash(file: string, purpose?: string, expected?: ReviewedFileExpectation): Promise<TrashReceipt>;
  volumes(): Promise<NativeVolume[]>;
  eject(file: string): Promise<void>;
  /** PDFKit's print sheet; refuses locked documents without their password. */
  printPDF(file: string, password?: string): void;
  /** Marks a saved email attachment as Mail does (`com.apple.quarantine`, recorded by Launch
   * Services), so Gatekeeper checks it before it first opens. Refuses anything but a regular file. */
  quarantineAttachment(file: string): void;
}
let binding: MacFiles | undefined;
export interface NativeReviewedExpectation {
  version: { identity: string; modified: number; size: number };
  sha256: string;
}
export type NativeFileBindings = Omit<MacFiles, 'trash'> & {
  trash(
    file: string,
    purpose?: string,
    expected?: NativeReviewedExpectation,
  ): Promise<TrashReceipt>;
};
export interface TrashReceipt {
  path: string;
  directory: boolean;
  bookmark?: string;
}
export type ReceiptAccess = <T>(receipt: TrashReceipt, work: () => Promise<T>) => Promise<T>;
export function adaptMacFiles(native: NativeFileBindings): MacFiles {
  const adapter = Object.create(native) as MacFiles;
  Object.defineProperty(adapter, 'trash', {
    value: async (item: string, purpose?: string, expected?: ReviewedFileExpectation) => {
      if (!expected) return native.trash(item, purpose);
      // A retained review uses temporal evidence. The native accessor must receive a fresh
      // exact identity from the same syscall as its metadata, then verify that plus the hash.
      const info = await lstat(item);
      const current = sourceVersion({
        identity: itemIdentity(info),
        kind: identityKind(info.mode),
        modified: info.mtimeMs,
        size: info.size,
        created: info.birthtimeMs,
      });
      if (!sameSourceVersion(current, expected.version))
        throw new Error('The file changed after confirmation. It was preserved.');
      return native.trash(item, purpose, {
        ...expected,
        version: { ...current, identity: nativeIdentityArgument(itemIdentity(info)) },
      });
    },
  });
  return adapter;
}
export function macFiles(): MacFiles {
  if (process.platform !== 'darwin') throw new Error('This file service requires macOS.');
  const assets = assetPath();
  // The production main bundle is CommonJS, where import.meta.url is absent.
  // The addon path is absolute; resolution needs only a stable absolute base.
  const require = createRequire(path.join(assets, 'viewer-native.cjs'));
  const file = path.join(assets, 'viewer-macos-files.node');
  if (!binding) {
    binding = adaptMacFiles(guardNativeTestRemovals(require(file) as NativeFileBindings));
  }
  return binding;
}
