import { expect, it, vi } from 'vitest';
const thumbnail = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ nativeImage: { createThumbnailFromPath: thumbnail } }));
import { quickLookRender } from '../src/desktop/native/quick-look-render';
it('caps actual unanswered system requests and skips late bitmap encoding after cancellation', async () => {
  const replies: ((value: unknown) => void)[] = [];
  thumbnail.mockImplementation(
    () =>
      new Promise((resolve) => {
        replies.push(resolve);
      }),
  );
  const abort = new AbortController();
  const first = quickLookRender('/fixture/one.nef', undefined, abort.signal),
    second = quickLookRender('/fixture/two.dng');
  await expect(quickLookRender('/fixture/third.tiff')).rejects.toThrow('still busy');
  expect(thumbnail).toHaveBeenCalledTimes(2);
  const image = {
    isEmpty: () => false,
    toBitmap: vi.fn(() => Buffer.from([0, 0, 0, 255])),
    toJPEG: vi.fn(() => Buffer.from('jpeg')),
    toPNG: vi.fn(),
  };
  abort.abort(new Error('Preview released'));
  replies[0]!(image);
  await expect(first).rejects.toThrow('Preview released');
  expect(image.toBitmap).not.toHaveBeenCalled();
  replies[1]!(image);
  expect(await second).toEqual({ data: Buffer.from('jpeg'), extension: 'jpg' });
  thumbnail.mockImplementation(async () => image);
  await expect(quickLookRender('/fixture/later.tiff')).resolves.toMatchObject({ extension: 'jpg' });
});
