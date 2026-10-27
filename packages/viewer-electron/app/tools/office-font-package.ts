import { open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { officeFontConfiguration } from '../src/desktop/previews/office-font-manifest';

const metadataSchema = z
  .object({
    files: z
      .array(
        z
          .object({
            filename: z.string(),
            start: z.number().int().nonnegative(),
            end: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(10000),
    remote_package_size: z.number().int().nonnegative(),
  })
  .strict();

export interface OfficeFontAsset {
  virtualPath: string;
  bytes: number;
}

/** Append fonts and their owned fallback configuration without shifting engine
 * ranges. Reject duplicate or escaping paths, gaps and overlaps. */
export function officeFontMetadata(raw: unknown, fonts: readonly OfficeFontAsset[]): Buffer {
  const metadata = metadataSchema.parse(raw);
  const names = new Set<string>();
  let position = 0;
  for (const file of metadata.files) {
    if (
      file.start !== position ||
      file.end < file.start ||
      !file.filename.startsWith('/') ||
      file.filename.includes('\0') ||
      path.posix.normalize(file.filename) !== file.filename ||
      names.has(file.filename)
    )
      throw new Error('Invalid Office filesystem metadata.');
    names.add(file.filename);
    position = file.end;
  }
  if (position !== metadata.remote_package_size)
    throw new Error('Office filesystem size does not match its file ranges.');
  for (const font of fonts) {
    if (
      (!/^\/instdir\/share\/fonts\/truetype\/[A-Za-z0-9_-]+\.(?:ttf|ttc|otf)$/.test(
        font.virtualPath,
      ) &&
        font.virtualPath !== officeFontConfiguration.virtualPath) ||
      !Number.isSafeInteger(font.bytes) ||
      font.bytes <= 0 ||
      !Number.isSafeInteger(position + font.bytes) ||
      names.has(font.virtualPath)
    )
      throw new Error('Invalid bundled Office font.');
    metadata.files.push({
      filename: font.virtualPath,
      start: position,
      end: position + font.bytes,
    });
    names.add(font.virtualPath);
    position += font.bytes;
  }
  metadata.remote_package_size = position;
  return Buffer.from(JSON.stringify(metadata));
}

/** Stream into a new retained package; failures keep partial output for inspection. */
export async function appendOfficeData(
  destination: string,
  sources: readonly string[],
): Promise<void> {
  const target = await open(destination, 'wx');
  try {
    for (const source of sources) await target.writeFile(createReadStream(source));
  } finally {
    await target.close();
  }
}
