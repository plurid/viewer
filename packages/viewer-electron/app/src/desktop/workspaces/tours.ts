import { constants, type Stats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  isTourFile,
  tourDefinitionSchema,
  tourHashLimit,
  tourPathSchema,
  type TourDefinition,
  type TourDocument,
  type TourLookup,
} from '../../domain/tours/tour';
import { DefinitionFiles } from '../persistence/definition-files';
import { fileCoordination } from '../files/file-coordination';
import { containsPath } from '../files/containment';
import { entry } from '../files/filesystem';

const tourComments =
  [
    '// Viewer tour, version 1: the stops Viewer shows in turn, each a file at a place in it.',
    '// Paths are relative to this file and stay inside its folder; move the folder, not the tour.',
    '// Opening this file plays it. It opens files and moves the camera; it never runs commands.',
    '// A stop whose file is gone is skipped; one whose file changed opens without its anchor.',
  ].join('\n') + '\n';

/** A new tour file's text, as a first save writes it; a handoff writes its tour this way. */
export function tourText(definition: TourDefinition): string {
  return tourComments + JSON.stringify(tourDefinitionSchema.parse(definition), null, 2) + '\n';
}

type Missing = Exclude<TourLookup['state'], 'found'>;
/** A part of a stop's path as it is on disk, or why it is not there to show. */
async function look(file: string): Promise<Stats | Missing> {
  try {
    return await lstat(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return 'missing';
    if (code === 'EACCES' || code === 'EPERM') return 'denied';
    throw error;
  }
}
const accessError = (error: unknown) =>
  (error as { code?: unknown } | null)?.code === 'FILE_ACCESS_REQUIRED';

/**
 * The SHA-256 of a regular file no larger than `tourHashLimit`, read through a handle that is the
 * file `info` names. Undefined when it is larger, or when it changed while it was read.
 */
async function sha256(file: string, info: Stats): Promise<string | undefined> {
  if (!info.isFile() || info.size > tourHashLimit) return;
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (before.ino !== info.ino || before.dev !== info.dev || before.size > tourHashLimit) return;
    const hash = createHash('sha256');
    if (before.size)
      for await (const chunk of handle.createReadStream({
        start: 0,
        end: before.size - 1,
        autoClose: false,
      }))
        hash.update(chunk as Buffer);
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) return;
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

/** `.viewer-tour.jsonc` files, through the shared definition I/O: comments kept, saves checked. */
export class Tours extends DefinitionFiles<TourDefinition> {
  constructor(
    private readonly allow: (files: readonly string[]) => Promise<void>,
    coordination: Pick<typeof fileCoordination, 'run'> = fileCoordination,
  ) {
    super(tourDefinitionSchema, 'Tour', tourComments, allow, coordination, 2 * 1024 * 1024);
  }
  override async read(file: string): Promise<TourDocument> {
    named(file);
    return super.read(file);
  }
  override async save(
    file: string,
    expected: string,
    input: TourDefinition,
  ): Promise<TourDocument> {
    named(file);
    return super.save(file, expected, input);
  }
  /**
   * A stop's file at `relative` under `root`. Its path never goes through a link, below the
   * folder or out of it (the folder itself may be reached through one, as a synced folder is), and
   * it is a file or folder. A permission error is `denied`, never `missing`. `hash` reads the
   * file's SHA-256 when it is no larger than `tourHashLimit`.
   */
  async stat(root: string, relative: string, hash = false): Promise<TourLookup> {
    tourPathSchema.parse(relative);
    const folder = path.resolve(root);
    const parts = relative.split('/');
    const file = path.join(folder, ...parts);
    try {
      await this.allow([file]);
    } catch (error) {
      if (accessError(error)) return { state: 'denied' };
      throw error;
    }
    let current = folder,
      info: Stats | Missing = 'missing';
    for (const part of parts) {
      current = path.join(current, part);
      info = await look(current);
      if (typeof info === 'string') return { state: info };
      if (info.isSymbolicLink()) return { state: 'link' };
    }
    if (typeof info === 'string' || !(info.isFile() || info.isDirectory()))
      return { state: 'missing' };
    // a folder swapped for a link while it was walked, or a mount that leads elsewhere
    const [inside, actual] = await Promise.all([realpath(folder), realpath(file)]);
    if (!containsPath(inside, actual)) return { state: 'link' };
    const found = await entry(file);
    if (found.identity !== `${info.dev}:${info.ino}`) return { state: 'missing' };
    const digest = hash ? await sha256(file, info) : undefined;
    return { state: 'found', entry: found, ...(digest ? { sha256: digest } : {}) };
  }
}
function named(file: string): void {
  if (!path.isAbsolute(file) || !isTourFile(path.basename(file)))
    throw new Error('Choose a file whose name ends in .viewer-tour.jsonc.');
}
