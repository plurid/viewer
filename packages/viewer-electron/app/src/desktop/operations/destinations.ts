import type { OperationRequest } from '../../domain/contracts';
import type { TransformPlan } from '../../domain/operations/transforms';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { extractedFolderName } from '../../domain/operations/extract';
import { combinedTransform, transformExtension } from '../../domain/operations/transforms';
import { validName } from '../files/filesystem';
import { sameItem } from '../files/item-identity';
import { conversionOutput } from './image-convert';

/** Whether a request makes one output from all its sources: a new folder or file, an archive, a
 * PDF of images or a combined transform. Every other request makes one output per source. */
export function singleOutput(request: OperationRequest): boolean {
  return (
    ['mkdir', 'mkfile', 'compress'].includes(request.kind) ||
    (request.kind === 'convert' &&
      (request.conversion === 'pdf' || combinedTransform(request.transform)))
  );
}

/**
 * Where an item's output goes, from the request alone; `source` is empty for a single-output
 * request. A duplicate and an alias take the first free name beside their source instead
 * (`keepBothName`, `aliasName`). An output at its own source is refused, except a conversion's,
 * which keeps both.
 */
export function outputName(request: OperationRequest, source: string): string {
  const output = namedOutput(request, source);
  if (output === source && request.kind !== 'convert')
    throw new Error('Source and destination are the same.');
  return output;
}
function namedOutput(request: OperationRequest, source: string): string {
  if (singleOutput(request)) return path.join(request.destination!, validName(request.name!));
  if (request.kind === 'convert')
    return request.transform
      ? transformedName(request, request.transform, source)
      : conversionOutput(source, request.conversion!);
  if (request.kind === 'extract')
    return path.join(request.destination!, validName(extractedFolderName(path.basename(source))));
  if (request.kind === 'rename') return path.join(path.dirname(source), validName(request.name!));
  return path.join(request.destination!, request.name ?? path.basename(source));
}
/** A transform's output, beside its source or in the folder chosen: the name chosen for a single
 * source, otherwise the source's name marked "optimized" or "converted", with the new extension. */
function transformedName(request: OperationRequest, plan: TransformPlan, source: string): string {
  const optimizing = plan.kind === 'pdf' || (plan.kind === 'image' && plan.optimize);
  const name =
    request.name && request.sources.length === 1
      ? validName(request.name)
      : path.basename(source, path.extname(source)) +
        (optimizing ? ' optimized.' : ' converted.') +
        transformExtension(plan.format);
  return path.join(request.destination || path.dirname(source), name);
}

/** Refuses an output inside what it is made from: a folder inside itself, directly or through a
 * symbolic link, or an archive inside the folders it holds. */
export async function guardDestination(
  request: OperationRequest,
  source: string,
  destination: string,
): Promise<void> {
  if (source && destination.startsWith(source + path.sep))
    throw new Error('A folder cannot be placed inside itself.');
  if (
    request.kind === 'compress' &&
    request.sources.some((file) => destination === file || destination.startsWith(file + path.sep))
  )
    throw new Error('Save the archive outside the selected folders.');
  if (!source || !(await lstat(source)).isDirectory()) return;
  // Resolve symlinks in the destination's ancestry as well.
  const realSource = await realpath(source);
  const realDestination = path.join(
    await realpath(path.dirname(destination)),
    path.basename(destination),
  );
  if (realDestination === realSource || realDestination.startsWith(realSource + path.sep))
    throw new Error('A folder cannot be placed inside itself through a symbolic link.');
}

/** Whether `destination` reaches `source` itself, as a case-only rename does on a volume that
 * ignores case. */
export async function sameItemAt(source: string, destination: string): Promise<boolean> {
  const item = await lstat(source);
  const existing = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  return !!existing && sameItem(item, existing);
}
