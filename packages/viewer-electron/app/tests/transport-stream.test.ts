import { expect, it } from 'vitest';
import { isTransportStream } from '../src/domain/media/transport-stream';

it('tells a recorded transport stream from TypeScript sharing its extension', () => {
  const packets = (size: number, offset: number) => {
    const bytes = new Uint8Array(size * 3);
    for (let index = 0; index < 3; index++) bytes[offset + index * size] = 0x47;
    return bytes;
  };
  expect(isTransportStream(packets(188, 0))).toBe(true);
  // M2TS, as AVCHD cameras write it, puts a timestamp before each packet
  expect(isTransportStream(packets(192, 4))).toBe(true);
  expect(isTransportStream(new TextEncoder().encode('Gexport const a = 1;\n'.repeat(40)))).toBe(
    false,
  );
});
