import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ArchiveEntry, ArchiveListing } from '../../domain/contracts';
import {
  embeddedFactLimit,
  embeddedFormats,
  embeddedMember,
  embeddedPictureLimits,
  embeddedPictureNames,
} from '../../domain/previews/documents/embedded';
import type { EmbeddedFormat, EmbeddedMember } from '../../domain/previews/documents/embedded';
import { fileCoordination } from '../files/file-coordination';
import type { Archives } from './archives';
import { imageDimensions } from './image-dimensions';

const PNG_SIGNATURE = '89504e470d0a1a0a';
const limit = (member: EmbeddedMember) =>
  member === 'picture' ? embeddedPictureLimits.bytes : embeddedFactLimit;

/** The picture is the PNG or JPEG its name says, within the pixel limit. */
function checkPicture(name: string, data: Buffer): void {
  const png = data.subarray(0, 8).toString('hex') === PNG_SIGNATURE;
  const jpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const dimensions = imageDimensions(data);
  if (
    !(/\.png$/i.test(name) ? png : jpeg) ||
    !dimensions ||
    dimensions.width * dimensions.height > embeddedPictureLimits.pixels
  )
    throw new Error(
      'This picture is not the PNG or JPEG it is named, or exceeds its preview limit.',
    );
}

/**
 * A member of a document package, without following a link: each folder on the way is a folder,
 * the file is a regular one opened without following its name, the one checked, and its real path
 * is the one asked for. `bundle` is the package's own real path.
 */
async function packaged(bundle: string, name: string) {
  const root = fileCoordination.path(bundle);
  const file = path.join(root, ...name.split('/'));
  for (let folder = path.dirname(file); folder !== root; folder = path.dirname(folder)) {
    const info = await lstat(folder);
    if (!info.isDirectory()) throw new Error('This package member is not in a folder.');
  }
  const info = await lstat(file);
  if (!info.isFile()) throw new Error('This package member is not a regular file.');
  return { file, info, root };
}
async function readPackaged(bundle: string, name: string, bytes: number): Promise<Buffer> {
  const { file, info: checked, root } = await packaged(bundle, name);
  const handle = await open(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0),
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.dev !== checked.dev || info.ino !== checked.ino)
      throw new Error('This package member changed while it was read.');
    if (info.size > bytes) throw new Error('This picture is missing or exceeds its preview limit.');
    if ((await realpath(file)) !== path.join(await realpath(root), ...name.split('/')))
      throw new Error('This package member is not where its name says.');
    const data = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < data.length) {
      const read = await handle.read(data, offset, data.length - offset, offset);
      if (!read.bytesRead) throw new Error('The file changed or is truncated.');
      offset += read.bytesRead;
    }
    return data;
  } finally {
    await handle.close();
  }
}

/**
 * The members a format reads that its container holds: from a ZIP's index, or the pictures a
 * document package holds. The caller holds a read claim for the file.
 */
export async function embeddedListing(
  archives: Archives,
  file: string,
  format: EmbeddedFormat,
  bundle: boolean,
): Promise<ArchiveListing> {
  if (!bundle) {
    const listing = await archives.list(file);
    return {
      entries: listing.entries.filter((entry) => embeddedMember(format, entry.name)),
      truncated: listing.truncated,
    };
  }
  const entries: ArchiveEntry[] = [];
  for (const name of embeddedPictureNames(format)) {
    const found = await packaged(file, name).catch(() => undefined);
    if (found)
      entries.push({
        name,
        size: found.info.size,
        directory: false,
        previewable: found.info.size <= embeddedPictureLimits.bytes,
      });
  }
  return { entries, truncated: false };
}

/** One member a format reads, within its limit; a picture is checked to be the image it claims. */
export async function readEmbedded(
  archives: Archives,
  file: string,
  format: EmbeddedFormat,
  name: string,
  bundle: boolean,
): Promise<Buffer> {
  const member = embeddedMember(format, name);
  if (!member || (bundle && member !== 'picture'))
    throw new Error(
      `${embeddedFormats[format].kind}: Viewer reads only its saved picture and a few details.`,
    );
  let data: Buffer;
  if (bundle) data = await readPackaged(file, name, limit(member));
  else {
    const listed = (await archives.list(file)).entries.find((entry) => entry.name === name);
    if (!listed?.previewable || listed.size > limit(member))
      throw new Error('This member is missing or exceeds its preview limit.');
    data = await archives.read(file, name);
  }
  if (member === 'picture') checkPicture(name, data);
  return data;
}
