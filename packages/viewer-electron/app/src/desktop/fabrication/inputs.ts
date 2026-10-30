/**
 * WHAT A CHECK READS: each job file only while it is the version the check listed, hashed for the
 * check record. A request is read through the mail parser, a photo re-encoded without its metadata,
 * a DXF measured by Viewer, and a drawing page rendered by the renderer is checked against its file
 * before it is sent (docs/reference/fabrication.md).
 */
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Stats } from 'node:fs';
import type { SourceVersion } from '../../domain/files/inspection';
import type { ModelImage } from '../../domain/models/images';
import type { RenderedPage } from '../../domain/fabrication/check';
import type { CheckInputRequest } from '../../domain/fabrication/prompt';
import type { ImageTransform } from '../../domain/operations/transforms';
import { checkLimits } from '../../domain/fabrication/check';
import { imageTransformSchema } from '../../domain/operations/transforms';
import { emlxMessage, readMessage } from '../../domain/previews/mail/message';
import { imageDimensions } from '../previews/image-dimensions';

type Access = (files: readonly string[]) => Promise<void>;

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const sizeText = (bytes: number) =>
  bytes >= 1_000_000 ? `${Math.round(bytes / 1_000_000)} MB` : `${Math.ceil(bytes / 1000)} kB`;
const listed = (info: Stats, version: SourceVersion) =>
  `${info.dev}:${info.ino}` === version.identity &&
  info.mtimeMs === version.modified &&
  info.size === version.size;
const changed = (file: string) =>
  new Error(`${path.basename(file)} changed since the check listed it. Check the job again.`);

/** Opens a listed file without following a link, refused when it is no longer that version. */
async function openListed(file: string, version: SourceVersion, access: Access) {
  await access([file]);
  const actual = await realpath(file);
  await access([actual]);
  const handle = await open(
    actual,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0),
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || !listed(info, version)) throw changed(file);
    return { handle, info };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

/** A listed file's bytes, up to `limit`. */
export async function readListed(
  file: string,
  version: SourceVersion,
  access: Access,
  limit: number = checkLimits.fileBytes,
): Promise<Buffer> {
  const { handle, info } = await openListed(file, version, access);
  try {
    if (info.size > limit)
      throw new Error(`${path.basename(file)} is larger than ${sizeText(limit)}.`);
    const bytes = Buffer.alloc(info.size);
    for (let offset = 0; offset < bytes.length;) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw changed(file);
      offset += bytesRead;
    }
    if (!listed(await handle.stat(), version)) throw changed(file);
    return bytes;
  } finally {
    await handle.close();
  }
}

/** A listed file's SHA-256, read in pieces: a drawing is hashed, never loaded whole. */
export async function hashListed(
  file: string,
  version: SourceVersion,
  access: Access,
  signal: AbortSignal,
): Promise<string> {
  const { handle, info } = await openListed(file, version, access);
  try {
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(1024 * 1024);
    for (let offset = 0; offset < info.size;) {
      signal.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      if (!bytesRead) throw changed(file);
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    if (!listed(await handle.stat(), version)) throw changed(file);
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

/** A request as the model reads it: a message's subject, date, plain text and attachment names,
 * read with the parser its preview uses, or a text file's text. Addresses are left out. */
export function requestInput(ref: string, name: string, bytes: Uint8Array): CheckInputRequest {
  const extension = path.extname(name).slice(1).toLowerCase();
  const bounded = (text: string) => text.slice(0, checkLimits.requestCharacters).trim();
  if (extension === 'txt')
    return { ref, text: bounded(new TextDecoder().decode(bytes)), attachments: [] };
  const message = readMessage(extension === 'emlx' ? emlxMessage(bytes) : bytes);
  return {
    ref,
    ...(message.subject ? { subject: message.subject } : {}),
    ...(message.date ? { date: message.date } : {}),
    text: bounded(message.text ?? ''),
    attachments: message.attachments.map((attachment) => attachment.name),
  };
}
/** What a request's quotes are checked against. */
export const requestText = (request: CheckInputRequest) =>
  [request.subject, request.text].filter(Boolean).join('\n');

/** A picture's type from its first bytes. */
export function pictureType(bytes: Uint8Array): ModelImage['type'] | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return 'image/png';
  return undefined;
}

/** How the image processor re-encodes a photo for a check: a JPEG, its longest side at most
 * `checkLimits.photoSide`, turned upright, with no EXIF, GPS, XMP or colour profile kept. */
export const photoPlan: ImageTransform = imageTransformSchema.parse({
  kind: 'image',
  format: 'jpeg',
  quality: 82,
  width: checkLimits.photoSide,
  height: checkLimits.photoSide,
  fit: 'inside',
  metadata: 'strip',
});

export interface PreparedPhoto {
  image: ModelImage;
  width: number;
  height: number;
}
/** Re-encodes a raster as a JPEG of at most `checkLimits.photoSide` pixels, without metadata. */
export type PhotoEncoder = (bytes: Buffer, signal: AbortSignal) => Promise<Buffer>;
/** A rendition of a photo the encoder cannot read, such as HEIC, from Viewer's image helper. */
export type PhotoRenderer = (file: string, signal: AbortSignal) => Promise<Buffer>;

/** A photo as the model sees it: re-encoded, so no location, camera or other metadata goes. */
export async function preparePhoto(
  file: string,
  bytes: Buffer,
  encode: PhotoEncoder,
  render: PhotoRenderer | undefined,
  signal: AbortSignal,
): Promise<PreparedPhoto> {
  let encoded: Buffer;
  try {
    encoded = await encode(bytes, signal);
  } catch (error) {
    signal.throwIfAborted();
    if (!render) throw error;
    encoded = await encode(await render(file, signal), signal);
  }
  const size = imageDimensions(encoded);
  if (pictureType(encoded) !== 'image/jpeg' || !size)
    throw new Error(`${path.basename(file)} could not be prepared as a picture.`);
  if (Math.max(size.width, size.height) > checkLimits.photoSide)
    throw new Error(`${path.basename(file)} was not made small enough to send.`);
  return { image: { type: 'image/jpeg', data: encoded }, ...size };
}

/** A rendered page's picture, checked: a JPEG or PNG whose size is the one the renderer gave. */
export function pagePicture(page: RenderedPage, name: string): ModelImage {
  const type = pictureType(page.image);
  const size = type && imageDimensions(Buffer.from(page.image));
  if (!type || !size)
    throw new Error(`Page ${page.page} of ${name} was not drawn as a JPEG or PNG picture.`);
  if (size.width !== page.width || size.height !== page.height)
    throw new Error(`Page ${page.page} of ${name} is not the size it was drawn at.`);
  if (Math.max(size.width, size.height) > checkLimits.pageSide)
    throw new Error(`Page ${page.page} of ${name} is larger than ${checkLimits.pageSide} px.`);
  if (page.page > page.pages)
    throw new Error(`${name} has ${page.pages} pages, not a page ${page.page}.`);
  return { type, data: page.image };
}
