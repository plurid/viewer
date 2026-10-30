/** `.ts` and `.mts` name TypeScript and also MPEG transport streams, which cameras and recorders
 * write. A stream repeats the sync byte every 188 bytes, or every 192 in the M2TS form that adds a
 * timestamp before each packet. */
export const transportStreamExtensions = ['ts', 'mts'];
/** The extension a recording is read as, whichever of the two names it has. */
export const recordingFormat = 'm2ts';
/** How many packets in a row must carry the sync byte. */
const packets = 8;
/** Enough of a file's head for that many of the longer packets, from any start. */
export const transportStreamProbe = packets * 192;

/** What a `.ts` or `.mts` file's first bytes hold. */
export type TransportStreamContent = 'video' | 'text';

const synced = (bytes: Uint8Array, size: number) => {
  // a recording cut mid-packet starts its first whole packet further in
  for (let start = 0; start < size; start++) {
    let count = 0;
    while (count < packets && bytes[start + count * size] === 0x47) count++;
    if (count === packets) return true;
  }
  return false;
};
export const isTransportStream = (bytes: Uint8Array) => synced(bytes, 188) || synced(bytes, 192);

/** UTF-8 without NULs; a character the head cuts in two still reads as text. */
function isText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true });
    return true;
  } catch {
    return false;
  }
}

/** Video only when the packets repeat; text, as code, when the head is text, short or unclear. */
export function transportStreamContent(head: Uint8Array): TransportStreamContent {
  return !isText(head) && isTransportStream(head) ? 'video' : 'text';
}
