import path from 'node:path';
import type { ImageConversion } from '../../domain/contracts';

/** Writes a new file at `output` from image `sources`; sources are only read. */
export interface ImageConverter {
  convert(
    conversion: ImageConversion,
    sources: readonly string[],
    output: string,
    signal: AbortSignal,
  ): Promise<void>;
}
export const unavailableConverter: ImageConverter = {
  convert: () => Promise.reject(new Error('Image quick actions are unavailable here.')),
};
export { convertibleExtensions } from '../../domain/operations/image-conversions';
/** The file a per-image conversion creates next to its source. Collisions are resolved
 * like any other new file: the person keeps both, skips or replaces. */
export function conversionOutput(source: string, conversion: ImageConversion): string {
  const extension = path.extname(source);
  const stem = path.basename(source, extension);
  const name =
    conversion === 'rotate-left' || conversion === 'rotate-right'
      ? `${stem} rotated${['.png', '.jpg', '.jpeg'].includes(extension.toLowerCase()) ? extension : '.png'}`
      : conversion === 'jpeg'
        ? `${stem}.jpg`
        : conversion === 'office-pdf'
          ? `${stem}.pdf`
          : `${stem}.png`;
  return path.join(path.dirname(source), name);
}
/** Rotates a 32-bit bitmap a quarter turn. */
export function rotateBitmap(
  pixels: Uint8Array,
  width: number,
  height: number,
  clockwise: boolean,
): Uint8Array {
  if (pixels.length !== width * height * 4) throw new Error('The image bitmap is incomplete.');
  const rotated = new Uint8Array(pixels.length);
  const view = new Uint32Array(pixels.buffer, pixels.byteOffset, width * height);
  const out = new Uint32Array(rotated.buffer);
  // The rotated image is `height` wide and `width` tall.
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const target = clockwise ? x * height + (height - 1 - y) : (width - 1 - x) * height + y;
      out[target] = view[y * width + x] ?? 0;
    }
  return rotated;
}
/** A PDF with one page per JPEG image, each page the image's size at 72 dpi. */
export function imagesToPDF(pages: readonly { jpeg: Uint8Array; width: number; height: number }[]) {
  if (!pages.length) throw new Error('Choose at least one image.');
  const chunks: Buffer[] = [];
  const offsets: number[] = [];
  let length = 0;
  const write = (value: string | Uint8Array) => {
    const chunk = typeof value === 'string' ? Buffer.from(value, 'latin1') : Buffer.from(value);
    chunks.push(chunk);
    length += chunk.length;
  };
  const object = (id: number, body: string | (() => void)) => {
    offsets[id] = length;
    write(`${id} 0 obj\n`);
    if (typeof body === 'string') write(body);
    else body();
    write('\nendobj\n');
  };
  write('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  const kids = pages.map((_, index) => `${3 + index * 3} 0 R`).join(' ');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  pages.forEach((page, index) => {
    const id = 3 + index * 3;
    const { width, height } = page;
    object(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
        `/Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`,
    );
    object(id + 1, () => {
      write(
        `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
      );
      write(page.jpeg);
      write('\nendstream');
    });
    const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;
    object(id + 2, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  const count = 3 + pages.length * 3;
  const xref = length;
  write(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) write(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  write(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(chunks);
}
