import type { AppIconSize } from './app-icons';
import { runProcessor } from '../transforms/process';
import { imageDimensions } from '../previews/image-dimensions';
import { assetPath } from './assets';

/**
 * A bundle's own NSWorkspace icon, rendered by the bounded private helper.
 * app.getFileIcon returned generic placeholders; Quick Look shares Finder's
 * thumbnail worker. Neither is the image decoder for these bundle icons.
 */
export async function nativeAppIcon(
  file: string,
  size: AppIconSize,
  signal = new AbortController().signal,
): Promise<string> {
  const pixels = size === 'large' ? 256 : 64;
  const data = await runProcessor(
    assetPath('viewer-image-preview'),
    ['icon', String(pixels)],
    [],
    signal,
    { input: Buffer.from(JSON.stringify(file)), timeout: 8000, outputLimit: 1_000_000 },
  );
  signal.throwIfAborted();
  const dimensions = imageDimensions(data);
  if (
    data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
    dimensions?.width !== pixels ||
    dimensions.height !== pixels
  )
    throw new Error('The bundle icon decoder returned an invalid image.');
  return 'data:image/png;base64,' + data.toString('base64');
}
