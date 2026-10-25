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
/** A deliberately small EXIF reader: only descriptive ASCII IFD0 tags survive
 * the default policy. GPS, device serials and opaque nested metadata do not. */
export function imageCredits(exif?: Buffer): Record<string, string> {
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
    const offset = u32(4),
      count = Math.min(256, u16(offset));
    for (let index = 0; index < count; index++) {
      const item = offset + 2 + index * 12,
        tag = u16(item),
        type = u16(item + 2),
        length = u32(item + 4);
      const name = (
        { 270: 'ImageDescription', 315: 'Artist', 33432: 'Copyright' } as Record<number, string>
      )[tag];
      if (!name || type !== 2 || length > 4096 || !length) continue;
      const value = length <= 4 ? item + 8 : u32(item + 8);
      if (start + value + length > exif.length) continue;
      result[name] = exif
        .toString('utf8', start + value, start + value + length)
        .replace(/\0.*$/s, '');
    }
  } catch {
    /* malformed optional metadata is omitted */
  }
  return result;
}
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
  if (input.length > 256 * 1024 * 1024) throw new Error('Image input is larger than 256 MB.');
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
    if (Object.keys(credits).length) image = image.withExif({ IFD0: credits });
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
  if (input.length > 256 * 1024 * 1024) throw new Error('Image input is larger than 256 MB.');
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
  if (!width || !height) throw new Error('The image dimensions are unavailable.');
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
