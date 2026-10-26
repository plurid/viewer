/** The largest file a thumbnail is made from, on both sides of the bridge: the renderer allowed
 * 64 MiB and the desktop 64,000,000 bytes, so files between were asked for and refused. */
export const thumbnailByteLimit = 64_000_000;
