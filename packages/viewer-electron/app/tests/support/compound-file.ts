/** An entry's type in a generated compound file's directory. */
export type EntryType = 'root' | 'storage' | 'stream';
/** A directory entry; its links name other entries by their place in the directory. */
export interface DirectoryEntry {
  name: string;
  type: EntryType;
  left?: number;
  right?: number;
  child?: number;
}
const types: Record<EntryType, number> = { root: 5, storage: 1, stream: 2 };
const none = 0xffffffff;

/**
 * An OLE compound file as far as its kind goes: the 512-byte header and the first directory
 * sector, sector `directory`, with zeros between. `shift` 12 makes a version 4 file of 4096-byte
 * sectors. The streams themselves are absent: no reader of their contents takes this file.
 */
export function compoundFile(
  entries: readonly DirectoryEntry[],
  { directory = 1, shift = 9 }: { directory?: number; shift?: number } = {},
): Uint8Array<ArrayBuffer> {
  const sector = 2 ** shift;
  const at = (directory + 1) * sector;
  const bytes = new Uint8Array(at + sector);
  const view = new DataView(bytes.buffer);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  view.setUint16(0x18, 0x3e, true);
  view.setUint16(0x1a, shift === 12 ? 4 : 3, true);
  view.setUint16(0x1c, 0xfffe, true);
  view.setUint16(0x1e, shift, true);
  view.setUint16(0x20, 6, true);
  view.setUint32(0x30, directory, true);
  for (let index = 0; index < sector / 128; index++) {
    const start = at + index * 128;
    // an unused entry has no name or type, and links none
    const entry: Partial<DirectoryEntry> = entries[index] ?? {};
    const name = entry.name ?? '';
    [...name].forEach((character, offset) =>
      view.setUint16(start + offset * 2, character.charCodeAt(0), true),
    );
    view.setUint16(start + 0x40, name ? (name.length + 1) * 2 : 0, true);
    bytes[start + 0x42] = entry.type ? types[entry.type] : 0;
    view.setUint32(start + 0x44, entry.left ?? none, true);
    view.setUint32(start + 0x48, entry.right ?? none, true);
    view.setUint32(start + 0x4c, entry.child ?? none, true);
  }
  return bytes;
}

/** As Word writes a document: the root's first child lies past the first directory sector, which
 * shows WordDocument without the storage it lies in. */
export const wordDirectory: readonly DirectoryEntry[] = [
  { name: 'Root Entry', type: 'root', child: 13 },
  { name: 'Data', type: 'stream' },
  { name: 'WordDocument', type: 'stream', left: 12 },
  { name: 'ObjectPool', type: 'storage', left: 15, child: 4 },
];
/** As Excel writes a workbook: Workbook is the root's child through another storage's link. */
export const excelDirectory: readonly DirectoryEntry[] = [
  { name: 'Root Entry', type: 'root', child: 2 },
  { name: 'Workbook', type: 'stream', left: 11 },
  { name: 'MsoDataStore', type: 'storage', left: 1, right: 9, child: 3 },
  { name: 'Item', type: 'storage', right: 6, child: 4 },
];
export const powerPointDirectory: readonly DirectoryEntry[] = [
  { name: 'Root Entry', type: 'root', child: 1 },
  { name: 'PowerPoint Document', type: 'stream', left: 2, right: 3 },
  { name: '\x05SummaryInformation', type: 'stream', left: 4 },
  { name: '\x05DocumentSummaryInformation', type: 'stream' },
];
