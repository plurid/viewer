import { gzipSync } from 'node:zlib';
import { beforeEach, expect, it, vi } from 'vitest';
const processor = vi.hoisted(() => vi.fn());
vi.mock('../src/desktop/transforms/process', () => ({ runProcessor: processor }));
import { imageDecoder } from '../src/desktop/native/quick-look-render';
import type { Source } from '../src/desktop/previews/derived';

const source = {
  file: '/fixture/image.tiff',
  handle: { fd: 17, read: async () => {} },
} as unknown as Source;
function png(width = 128, height = 64) {
  const data = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(data);
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
}
beforeEach(() => processor.mockReset().mockResolvedValue(png()));

it('gives the private decoder only the open descriptor, requested size and finite budgets', async () => {
  const signal = new AbortController().signal;
  const result = await imageDecoder('/private/helper')(source, 'image', signal, 128);
  expect(result).toMatchObject({ extension: 'png', kind: 'image', data: png() });
  expect(processor).toHaveBeenCalledWith('/private/helper', ['image', '128'], [17], signal, {
    timeout: 10000,
    outputLimit: 32 * 1024 * 1024,
  });
});

it('refuses non-image modes and invalid sizes before starting a decoder', async () => {
  const decode = imageDecoder('/private/helper');
  for (const mode of ['camera', 'raw', 'video'] as const)
    await expect(decode(source, mode, new AbortController().signal)).rejects.toThrow(
      'camera or video',
    );
  for (const size of [0, -1, 1.5, Infinity, 4097])
    await expect(decode(source, 'image', new AbortController().signal, size)).rejects.toThrow(
      'size',
    );
  expect(processor).not.toHaveBeenCalled();
});

it('rejects wrong output signatures and oversized or empty pixel dimensions', async () => {
  const decode = imageDecoder('/private/helper');
  for (const data of [Buffer.from('not PNG'), png(129, 64), png(0, 64)]) {
    processor.mockResolvedValueOnce(data);
    await expect(decode(source, 'image', new AbortController().signal, 128)).rejects.toThrow(
      'invalid preview',
    );
  }
});

it('retains the cancellation reason and rejects even late valid decoder bytes', async () => {
  const abort = new AbortController();
  processor.mockImplementationOnce(async () => {
    abort.abort(new Error('Scope revoked'));
    return png();
  });
  await expect(imageDecoder('/private/helper')(source, 'image', abort.signal, 128)).rejects.toThrow(
    'Scope revoked',
  );
});

it('reports a bounded timeout and permits the next independent decode', async () => {
  const decode = imageDecoder('/private/helper');
  processor.mockRejectedValueOnce(new Error('Media processing timed out'));
  await expect(decode(source, 'image', new AbortController().signal, 128)).rejects.toThrow(
    '10 seconds',
  );
  await expect(decode(source, 'image', new AbortController().signal, 128)).resolves.toMatchObject({
    kind: 'image',
  });
});

it('routes bounded SVG bytes to the private vector worker without passing a source path', async () => {
  const bytes = Buffer.from('<svg/>');
  const vector = {
    file: '/fixture/image.SVG',
    info: { size: bytes.length },
    handle: {
      read: vi.fn(async (buffer: Buffer, offset: number, length: number, position: number) => {
        const chunk = bytes.subarray(position, position + length);
        chunk.copy(buffer, offset);
        return { bytesRead: chunk.length };
      }),
    },
  } as unknown as Source;
  const svg = vi.fn(async () => png());
  const signal = new AbortController().signal;
  const result = await imageDecoder('/helper', undefined, svg)(vector, 'image', signal, 128);
  expect(result.decoder).toBe('librsvg isolated v1');
  expect(svg).toHaveBeenCalledWith(bytes, 128, signal);
  expect(processor).not.toHaveBeenCalled();
  await expect(
    imageDecoder('/helper', undefined, svg)(
      { ...vector, info: { ...vector.info, size: 8 * 1024 * 1024 + 1 } },
      'image',
      signal,
      128,
    ),
  ).rejects.toThrow('could not be decoded');
  expect(svg).toHaveBeenCalledTimes(1);
});
it('expands a compressed SVG before the vector worker, within the same limit', async () => {
  const xml = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
  const compressed = (bytes: Buffer, name: string) =>
    ({
      file: '/fixture/' + name,
      info: { size: bytes.length },
      handle: {
        read: vi.fn(async (buffer: Buffer, offset: number, length: number, position: number) => {
          const chunk = bytes.subarray(position, position + length);
          chunk.copy(buffer, offset);
          return { bytesRead: chunk.length };
        }),
      },
    }) as unknown as Source;
  const svg = vi.fn(async () => png());
  const signal = new AbortController().signal;
  const decode = imageDecoder('/helper', undefined, svg);
  await decode(compressed(gzipSync(xml), 'drawing.svgz'), 'image', signal, 128);
  expect(svg).toHaveBeenCalledWith(xml, 128, signal);
  // a small file that expands past the limit is refused, not expanded
  const bomb = gzipSync(Buffer.alloc(9 * 1024 * 1024, 32));
  await expect(decode(compressed(bomb, 'bomb.svgz'), 'image', signal, 128)).rejects.toThrow();
  expect(svg).toHaveBeenCalledTimes(1);
});
