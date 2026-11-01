import { createHash } from 'node:crypto';
import { lstat, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { CanvasDocument } from '../../domain/canvases/document';
import { canvasLimits } from '../../domain/canvases/document';
import { inspectReviewedFile } from '../native/reviewed-file';
import { sourceHash } from '../canvases/sources';

export const canvasBackupAssetSchema = z
  .object({
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    data: z.string().max(Math.ceil(canvasLimits.assetBytes / 3) * 4),
  })
  .strict();
type BackupAsset = z.infer<typeof canvasBackupAssetSchema>;

function referencedAssets(documents: readonly CanvasDocument[]) {
  const assets = new Map<string, number>();
  for (const document of documents)
    for (const asset of [...document.assets, ...document.history.flatMap((item) => item.assets)]) {
      if (assets.has(asset.hash) && assets.get(asset.hash) !== asset.bytes)
        throw new Error('Canvas assets disagree about the size of the same content.');
      assets.set(asset.hash, asset.bytes);
    }
  return assets;
}

/** Validate content before importing documents that refer to it. History must remain undoable. */
export function validateCanvasBackupAssets(
  documents: readonly CanvasDocument[],
  assets: readonly BackupAsset[],
) {
  const expected = referencedAssets(documents);
  for (const document of documents)
    for (const source of [...document.sources, ...document.history.flatMap((item) => item.sources)])
      if (source.hash !== sourceHash(source.data))
        throw new Error('A canvas source snapshot changed.');
  const seen = new Set<string>();
  for (const asset of assets) {
    const bytes = Buffer.from(asset.data, 'base64');
    if (
      seen.has(asset.hash) ||
      !expected.has(asset.hash) ||
      bytes.length !== expected.get(asset.hash) ||
      bytes.toString('base64') !== asset.data ||
      createHash('sha256').update(bytes).digest('hex') !== asset.hash
    )
      throw new Error('The canvas backup contains an invalid or unexpected asset.');
    seen.add(asset.hash);
  }
  if (seen.size !== expected.size) throw new Error('The canvas backup is missing an asset.');
}

export async function readCanvasBackupAssets(
  root: string,
  documents: readonly CanvasDocument[],
  budget: number,
): Promise<BackupAsset[]> {
  const expected = referencedAssets(documents);
  if (!expected.size) return [];
  const directory = path.join(root, 'canvas-assets');
  const entry = await lstat(directory);
  if (!entry.isDirectory() || entry.isSymbolicLink())
    throw new Error('The canvas asset folder is a link or is unavailable.');
  const assets: BackupAsset[] = [];
  let size = 0;
  for (const [hash, bytes] of expected) {
    size += Math.ceil(bytes / 3) * 4;
    if (size > budget)
      throw new Error('Canvas assets exceed the 64 MiB backup limit. Export canvases separately.');
    const inspected = await inspectReviewedFile(path.join(directory, hash), bytes);
    if (inspected.bytes.length !== bytes || inspected.reviewed.sha256 !== hash)
      throw new Error('A canvas asset changed. The backup was not created.');
    assets.push({ hash, data: inspected.bytes.toString('base64') });
  }
  return assets;
}

/** Content-addressed assets may be shared with existing canvases; never replace those bytes. */
export async function restoreCanvasBackupAssets(root: string, assets: readonly BackupAsset[]) {
  if (!assets.length) return;
  const directory = path.join(root, 'canvas-assets');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const entry = await lstat(directory);
  if (!entry.isDirectory() || entry.isSymbolicLink())
    throw new Error('The canvas asset destination is a link. Existing files were preserved.');
  for (const asset of assets) {
    const file = path.join(directory, asset.hash);
    const bytes = Buffer.from(asset.data, 'base64');
    let handle;
    try {
      handle = await open(file, 'wx', 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const inspected = await inspectReviewedFile(file, bytes.length);
      if (inspected.bytes.length !== bytes.length || inspected.reviewed.sha256 !== asset.hash)
        throw new Error('An existing canvas asset is damaged. All copies were preserved.');
    } finally {
      await handle?.close();
    }
  }
}
