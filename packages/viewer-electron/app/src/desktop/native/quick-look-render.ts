import { gunzipSync } from 'node:zlib';
import { runProcessor } from '../transforms/process';
import { imageDimensions } from '../previews/image-dimensions';
import type { Decoder } from '../previews/derived';
import { binaryEPS, epsHeader } from '../../domain/previews/documents/postscript';
import { previewBytes } from '../previews/input-copy';

/** The longest edge of a rendered preview. */
const renditionSize = 4096;
/** This module formerly invoked Quick Look. Its replacement receives only an
 * already-open source descriptor and terminates the owned helper on cancellation. */
export function imageDecoder(
  helper: string,
  ffmpeg?: string,
  svg?: (bytes: Buffer, size: number, signal: AbortSignal) => Promise<Buffer>,
): Decoder {
  return async (source, mode, signal, size = renditionSize, variant) => {
    if (mode !== 'image') throw new Error('Use the camera or video decoder for this preview.');
    if (!Number.isInteger(size) || size < 1 || size > renditionSize)
      throw new Error('Choose an image preview size between 1 and 4096 pixels.');
    const signature = Buffer.alloc(30);
    await source.handle.read(signature, 0, signature.length, 0);
    const eps = binaryEPS(signature);
    const embedded =
      variant === 'eps-tiff' ? epsHeader(signature, source.info.size)?.tiff : undefined;
    if ((eps || signature.subarray(0, 4).toString() === '%!PS') && !embedded)
      throw new Error('Only an embedded TIFF picture can be decoded from PostScript.');
    if (variant === 'eps-tiff' && (!embedded || embedded.length > 32 * 1024 * 1024))
      throw new Error('The embedded TIFF exceeds its preview limit.');
    const exr = signature.subarray(0, 4).toString('hex') === '762f3101';
    const compressed = source.file.toLowerCase().endsWith('.svgz');
    const vector = compressed || source.file.toLowerCase().endsWith('.svg');
    if (vector && !svg) throw new Error('The private SVG decoder is unavailable.');
    if (exr && !ffmpeg) throw new Error('The private OpenEXR decoder is unavailable.');
    const args = exr
      ? [
          '-nostdin',
          '-hide_banner',
          '-loglevel',
          'error',
          '-xerror',
          '-max_alloc',
          '268435456',
          '-threads',
          '1',
          '-filter_threads',
          '1',
          '-protocol_whitelist',
          'fd,pipe',
          '-max_pixels',
          '100000000',
          '-f',
          'exr_pipe',
          '-fd',
          '3',
          '-i',
          'fd:',
          '-frames:v',
          '1',
          '-vf',
          `scale=w='min(iw,${size})':h='min(ih,${size})':force_original_aspect_ratio=decrease`,
          '-c:v',
          'png',
          '-f',
          'image2pipe',
          'pipe:1',
        ]
      : ['image', String(size)];
    const render = async () => {
      if (embedded) {
        if (!ffmpeg) throw new Error('The private TIFF decoder is unavailable.');
        const bytes = await previewBytes(source, embedded, signal);
        if (!['49492a00', '4d4d002a'].includes(bytes.subarray(0, 4).toString('hex')))
          throw new Error('The embedded TIFF header is malformed.');
        return runProcessor(
          ffmpeg,
          [
            '-nostdin',
            '-hide_banner',
            '-loglevel',
            'error',
            '-xerror',
            '-max_alloc',
            '268435456',
            '-threads',
            '1',
            '-filter_threads',
            '1',
            '-protocol_whitelist',
            'pipe',
            '-max_pixels',
            '100000000',
            '-f',
            'image2pipe',
            '-frame_size',
            String(bytes.length),
            '-c:v',
            'tiff',
            '-i',
            'pipe:0',
            '-map',
            '0:v:0',
            '-frames:v',
            '1',
            '-vf',
            `scale=w='min(iw,${size})':h='min(ih,${size})':force_original_aspect_ratio=decrease`,
            '-c:v',
            'png',
            '-f',
            'image2pipe',
            'pipe:1',
          ],
          [],
          signal,
          {
            input: bytes,
            timeout: 10000,
            outputLimit: 32 * 1024 * 1024,
          },
        );
      }
      if (!vector)
        return runProcessor(exr ? ffmpeg! : helper, args, [source.handle.fd], signal, {
          timeout: 10000,
          outputLimit: 32 * 1024 * 1024,
        });
      const limit = 8_000_000;
      if (!source.info.size || source.info.size > limit)
        throw new Error('SVG preview input must fit within 8 MB.');
      const input = Buffer.alloc(source.info.size + 1);
      let length = 0;
      while (length < input.length) {
        signal.throwIfAborted();
        const { bytesRead } = await source.handle.read(
          input,
          length,
          input.length - length,
          length,
        );
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length !== source.info.size) throw new Error('The SVG changed while opening.');
      // a compressed SVG is gzip around the same XML, held to the same limit once expanded
      const xml = compressed
        ? gunzipSync(input.subarray(0, length), { maxOutputLength: limit })
        : input.subarray(0, length);
      return svg!(xml, size, signal);
    };
    const data = await render().catch((error: Error) => {
      if (signal.aborted) throw signal.reason ?? new Error('Image preview cancelled.');
      throw new Error(
        error.message.includes('timed out')
          ? 'Image decoding exceeded 10 seconds. Retry or open the file in its original app.'
          : 'This image could not be decoded within the local preview limits. Open it in its original app.',
      );
    });
    signal.throwIfAborted();
    const dimensions = imageDimensions(data);
    if (
      data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      data.length > 32 * 1024 * 1024 ||
      !dimensions ||
      !dimensions.width ||
      !dimensions.height ||
      Math.max(dimensions.width, dimensions.height) > size
    )
      throw new Error('The image decoder returned an invalid preview.');
    return {
      data,
      extension: 'png',
      kind: 'image',
      decoder: vector
        ? 'librsvg isolated v1'
        : exr
          ? 'FFmpeg OpenEXR isolated v1'
          : embedded
            ? 'FFmpeg TIFF isolated v1'
            : 'ImageIO isolated v1',
    };
  };
}
