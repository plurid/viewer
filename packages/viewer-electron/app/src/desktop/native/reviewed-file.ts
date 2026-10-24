import { constants, type Stats } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { sameSourceVersion, type SourceVersion } from '../../domain/files/inspection';

/** A specific regular file reviewed before a native Trash action. */
export interface ReviewedFile {
  path: string;
  version: SourceVersion;
  sha256: string;
}

export type ReviewedFileExpectation = Pick<ReviewedFile, 'version' | 'sha256'>;

export interface InspectedFile {
  reviewed: ReviewedFile;
  bytes: Buffer;
  mode: number;
}

const stable = (before: Stats, after: Stats) =>
  before.dev === after.dev &&
  before.ino === after.ino &&
  before.size === after.size &&
  before.mode === after.mode &&
  before.mtimeMs === after.mtimeMs &&
  before.ctimeMs === after.ctimeMs;

/** Open without following the leaf, and bind bytes to both descriptor and directory entry. */
export async function inspectReviewedFile(file: string, limit: number): Promise<InspectedFile> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > limit)
      throw new Error('The reviewed path is not a bounded regular file. It was preserved.');
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error('The reviewed file changed while it was inspected.');
      offset += bytesRead;
    }
    const after = await handle.stat();
    const current = await lstat(file);
    if (!stable(before, after) || !stable(before, current))
      throw new Error('The reviewed file changed while it was inspected.');
    return {
      bytes,
      mode: before.mode,
      reviewed: {
        path: file,
        version: {
          identity: `${before.dev}:${before.ino}`,
          modified: before.mtimeMs,
          size: before.size,
        },
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    };
  } finally {
    await handle.close();
  }
}

export const sameReviewedFile = (a: ReviewedFileExpectation, b: ReviewedFileExpectation) =>
  sameSourceVersion(a.version, b.version) && a.sha256 === b.sha256;

/** Called inside the operation's native delete claim, immediately before its Trash adapter. */
export async function verifyReviewedFile(reviewed: ReviewedFile, limit = 64 * 1024 * 1024) {
  const current = await inspectReviewedFile(reviewed.path, limit);
  if (!sameReviewedFile(current.reviewed, reviewed))
    throw new Error('The file changed after confirmation. It was preserved.');
}
