/** `.ts` and `.mts` name TypeScript and also MPEG transport streams, which cameras and recorders
 * write. A stream repeats the sync byte every 188 bytes, or every 192 in the M2TS form that adds a
 * timestamp before each packet. */
export const transportStreamExtensions = ['ts', 'mts'];
export const transportStreamProbe = 3 * 192;

export function isTransportStream(bytes: Uint8Array): boolean {
  const synced = (start: number, packet: number) =>
    [0, 1, 2].every((index) => bytes[start + index * packet] === 0x47);
  return synced(0, 188) || synced(4, 192);
}
