import { createRequire } from 'node:module';
import path from 'node:path';
import type { ImageTransform } from '../../domain/operations/transforms';

interface Metadata {
  width?: number;
  height?: number;
  format?: string;
  exif?: Buffer;
  xmp?: Buffer;
  orientation?: number;
  hasAlpha?: boolean;
  pages?: number;
}
export interface ImageInspection {
  width: number;
  height: number;
  alpha: boolean;
  preview: Uint8Array;
}
interface Pipeline {
  metadata(): Promise<Metadata>;
  autoOrient(): Pipeline;
  rotate(degrees: number): Pipeline;
  extract(region: { left: number; top: number; width: number; height: number }): Pipeline;
  resize(
    width: number | undefined,
    height: number | undefined,
    options: { fit: string; withoutEnlargement: boolean },
  ): Pipeline;
  flatten(options: { background: string }): Pipeline;
  keepMetadata(): Pipeline;
  keepIccProfile(): Pipeline;
  withExif(value: Record<string, Record<string, string>>): Pipeline;
  withXmp(value: string): Pipeline;
  jpeg(options: { quality: number; progressive?: boolean; optimiseCoding?: boolean }): Pipeline;
  png(options?: {
    compressionLevel: number;
    adaptiveFiltering: boolean;
    palette?: boolean;
    quality?: number;
    effort?: number;
  }): Pipeline;
  webp(options: { quality: number; lossless: boolean }): Pipeline;
  avif(options: { quality: number; effort: number; lossless: boolean }): Pipeline;
  toBuffer(): Promise<Buffer>;
}
type Sharp = (
  input: Buffer,
  options: { limitInputPixels: number; sequentialRead: boolean; failOn: string },
) => Pipeline;

/** Buffer input deliberately has no base URI: librsvg cannot resolve filesystem
 * or network companions. Raster export remains a separate, raster-only route. */
export async function previewSvg(root: string, input: Buffer, size: number): Promise<Buffer> {
  if (!input.length || input.length > 8_000_000)
    throw new Error('SVG preview input must fit within 8 MB.');
  if (!Number.isInteger(size) || size < 1 || size > 4096)
    throw new Error('Choose an SVG preview size between 1 and 4096 pixels.');
  const sharp = createRequire(path.join(root, 'image-loader.cjs'))(
    path.join(root, 'node_modules/sharp'),
  ) as Sharp;
  const image = sharp(input, {
    limitInputPixels: 100_000_000,
    sequentialRead: true,
    failOn: 'warning',
  });
  const metadata = await image.metadata();
  if (metadata.format !== 'svg' || !metadata.width || !metadata.height)
    throw new Error('Choose a valid SVG image.');
  const output = await image
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  if (output.length > 32_000_000) throw new Error('SVG preview exceeds the 32 MB output limit.');
  return output;
}
/** The descriptive ASCII tags the default policy keeps: who made the picture and what it shows. */
const creditTags: Readonly<Record<number, string>> = {
  270: 'ImageDescription',
  315: 'Artist',
  33432: 'Copyright',
};
/** When the picture was taken, kept with it too: the date photos sort by. */
const captureTags: Readonly<Record<number, string>> = {
  36867: 'DateTimeOriginal',
  36881: 'OffsetTimeOriginal',
  37521: 'SubSecTimeOriginal',
};
/** The EXIF sub-IFD's pointer in IFD0. */
const exifPointer = 34665;
/**
 * A deliberately small EXIF reader: only the named ASCII tags of IFD0, and of the EXIF sub-IFD
 * when `nested` names some, survive the default policy. GPS, device serials and opaque nested
 * metadata do not.
 */
function exifText(
  exif: Buffer | undefined,
  names: Readonly<Record<number, string>>,
  nested = false,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!exif || exif.length > 1_000_000) return result;
  try {
    const start = exif.toString('ascii', 0, 6) === 'Exif\0\0' ? 6 : 0;
    const little = exif.toString('ascii', start, start + 2) === 'II';
    const u16 = (offset: number) =>
      little ? exif.readUInt16LE(start + offset) : exif.readUInt16BE(start + offset);
    const u32 = (offset: number) =>
      little ? exif.readUInt32LE(start + offset) : exif.readUInt32BE(start + offset);
    if (u16(2) !== 42) return result;
    const directory = (offset: number, visit: (tag: number, item: number) => void) => {
      const count = Math.min(256, u16(offset));
      for (let index = 0; index < count; index++) {
        const item = offset + 2 + index * 12;
        visit(u16(item), item);
      }
    };
    const read = (tag: number, item: number) => {
      const name = names[tag],
        type = u16(item + 2),
        length = u32(item + 4);
      if (!name || type !== 2 || length > 4096 || !length) return;
      const value = length <= 4 ? item + 8 : u32(item + 8);
      if (start + value + length > exif.length) return;
      result[name] = exif
        .toString('utf8', start + value, start + value + length)
        .replace(/\0.*$/s, '');
    };
    let sub: number | undefined;
    directory(u32(4), (tag, item) => {
      if (tag === exifPointer) sub = u32(item + 8);
      else if (!nested) read(tag, item);
    });
    if (nested && sub !== undefined) directory(sub, read);
  } catch {
    /* malformed optional metadata is omitted */
  }
  return result;
}
export const imageCredits = (exif?: Buffer) => exifText(exif, creditTags);
/** When a photo was taken, as its EXIF says: kept by the default policy with the credits. */
export const imageCaptureTime = (exif?: Buffer) => exifText(exif, captureTags, true);
export function safeImageXmp(bytes?: Buffer): string | undefined {
  if (!bytes || bytes.length > 1_000_000) return;
  const text = bytes.toString('utf8');
  const fields = ['creator', 'rights', 'description', 'title'].flatMap((name) => {
    const value = new RegExp(`<dc:${name}\\b[^>]*>([\\s\\S]*?)<\\/dc:${name}>`, 'i').exec(
      text,
    )?.[1];
    if (!value) return [];
    // Retain content only; untrusted XML tags/attributes and external entities do not survive.
    const plain = value
      .replace(/<[^>]*>/g, ' ')
      .replace(
        /&(?:amp|lt|gt|quot|apos);/g,
        (entity) =>
          ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[entity]!,
      )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4096);
    return [
      `<dc:${name}>${plain.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</dc:${name}>`,
    ];
  });
  return fields.length
    ? `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/">${fields.join('')}</rdf:Description></rdf:RDF></x:xmpmeta>`
    : undefined;
}
export async function transformImage(
  root: string,
  input: Buffer,
  plan: ImageTransform,
): Promise<Buffer> {
  if (input.length > 256_000_000) throw new Error('Image input is larger than 256 MB.');
  const raster = input.subarray(0, 4).toString('hex');
  if (!(
    raster.startsWith('ffd8') ||
    raster === '89504e47' ||
    raster === '47494638' ||
    raster === '49492a00' ||
    raster === '4d4d002a' ||
    input.toString('ascii', 8, 12) === 'WEBP' ||
    input.toString('ascii', 4, 8) === 'ftyp'
  ))
    throw new Error('Choose a supported raster image.');
  // Production workers are CommonJS. Resolve from the explicit processor root,
  // rather than import.meta.url, which does not exist in that bundle format.
  const sharp = createRequire(path.join(root, 'image-loader.cjs'))(
    path.join(root, 'node_modules/sharp'),
  ) as Sharp;
  let image = sharp(input, {
    limitInputPixels: 100_000_000,
    sequentialRead: true,
    failOn: 'warning',
  });
  const metadata = await image.metadata();
  if ((metadata.pages || 1) > 1)
    throw new Error(
      'Animated or multipage images require an animation-aware export. The source was kept.',
    );
  if (!['jpeg', 'png', 'gif', 'webp', 'tiff', 'heif', 'avif'].includes(metadata.format || ''))
    throw new Error('This raster format is not supported by the image processor.');
  image = image.autoOrient();
  if (plan.rotate) image = image.rotate(plan.rotate);
  if (plan.crop)
    image = image.extract({
      left: plan.crop.x,
      top: plan.crop.y,
      width: plan.crop.width,
      height: plan.crop.height,
    });
  if (plan.width || plan.height)
    image = image.resize(plan.width, plan.height, { fit: plan.fit, withoutEnlargement: true });
  if (plan.format === 'jpeg') image = image.flatten({ background: plan.background });
  if (plan.metadata === 'all') image = image.keepMetadata();
  else if (plan.metadata === 'safe') {
    image = image.keepIccProfile();
    const credits = imageCredits(metadata.exif);
    const taken = imageCaptureTime(metadata.exif);
    if (Object.keys(credits).length || Object.keys(taken).length)
      image = image.withExif({
        ...(Object.keys(credits).length ? { IFD0: credits } : {}),
        ...(Object.keys(taken).length ? { IFD2: taken } : {}),
      });
    const xmp = safeImageXmp(metadata.xmp);
    if (xmp) image = image.withXmp(xmp);
  }
  if (plan.format === 'jpeg')
    image = image.jpeg({ quality: plan.quality, progressive: plan.optimize, optimiseCoding: true });
  if (plan.format === 'png')
    image = image.png(
      plan.optimize
        ? {
            compressionLevel: 9,
            adaptiveFiltering: true,
            palette: !plan.lossless,
            quality: plan.quality,
            effort: 10,
          }
        : undefined,
    );
  if (plan.format === 'webp')
    image = image.webp({ quality: plan.quality, lossless: plan.lossless });
  if (plan.format === 'avif')
    image = image.avif({ quality: plan.quality, effort: 4, lossless: plan.lossless });
  return image.toBuffer();
}
export async function inspectImage(root: string, input: Buffer): Promise<ImageInspection> {
  if (input.length > 256_000_000) throw new Error('Image input is larger than 256 MB.');
  const signature = input.subarray(0, 4).toString('hex');
  if (!(
    signature.startsWith('ffd8') ||
    ['89504e47', '47494638', '49492a00', '4d4d002a'].includes(signature) ||
    input.toString('ascii', 8, 12) === 'WEBP' ||
    input.toString('ascii', 4, 8) === 'ftyp'
  ))
    throw new Error('Choose a supported raster image.');
  const sharp = createRequire(path.join(root, 'image-loader.cjs'))(
    path.join(root, 'node_modules/sharp'),
  ) as Sharp;
  const image = sharp(input, {
    limitInputPixels: 100_000_000,
    sequentialRead: true,
    failOn: 'warning',
  });
  const metadata = await image.metadata();
  const swapped = [5, 6, 7, 8].includes(metadata.orientation || 0);
  const width = (swapped ? metadata.height : metadata.width) || 0,
    height = (swapped ? metadata.width : metadata.height) || 0;
  if (!width || !height) throw new Error('Viewer couldn’t read this image’s size.');
  return {
    width,
    height,
    alpha: metadata.hasAlpha || false,
    preview: await image
      .autoOrient()
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer(),
  };
}
