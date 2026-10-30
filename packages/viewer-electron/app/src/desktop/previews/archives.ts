import { open, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { crc32, createInflateRaw, gunzip, inflateRaw } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import type { ArchiveEntry, ArchiveListing } from '../../domain/contracts';
import type { GzipLimits } from '../../domain/files/containers';
import { formatBytes } from '../../domain/files/entries';
import { fileCoordination } from '../files/file-coordination';
import { imageDimensions } from './image-dimensions';

const ENTRY_LIMIT = 32_000_000;
const INDEX_LIMIT = 20000;
const unzip = promisify(inflateRaw),
  ungzip = promisify(gunzip);
/** A header, empty deflate data and the trailer: the smallest gzip stream. */
const GZIP_MINIMUM = 18;
const isGzip = (bytes: Buffer) => bytes[0] === 0x1f && bytes[1] === 0x8b && bytes[2] === 8;
const PNG_SIGNATURE = '89504e470d0a1a0a';
async function readWhole(handle: Awaited<ReturnType<typeof openArchive>>, size: number) {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < bytes.length) {
    const read = await handle.read(bytes, offset, bytes.length - offset, offset);
    if (!read.bytesRead) throw new Error('The file changed or is truncated.');
    offset += read.bytesRead;
  }
  return bytes;
}
async function openArchive(file: string) {
  const handle = await open(
    fileCoordination.path(file),
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0),
  );
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Archive source must be a regular file.');
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}
interface IndexedEntry extends ArchiveEntry {
  offset: number;
  compressed: number;
  method: number;
  checksum?: number;
}
interface Index {
  entries: IndexedEntry[];
  data?: Buffer;
  file: string;
  truncated: boolean;
  unsafe: boolean;
}
interface CachedIndex {
  fingerprint: string;
  pending: Promise<Index>;
  bytes: number;
}
function safeName(name: string): boolean {
  return (
    !/^(?:[\\/]|[a-z]:)/i.test(name) && !name.split(/[\\/]/).includes('..') && !name.includes('\0')
  );
}
/** Bytes 0x80–0xFF of CP437, the encoding of a ZIP name whose UTF-8 flag is clear. */
const CP437 =
  'ÇüéâäàåçêëèïîìÄÅ' +
  'ÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
  'áíóúñÑªº¿⌐¬½¼¡«»' +
  '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧' +
  '╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩' +
  '≡±≥≤⌠⌡÷≈°∙·√ⁿ²■' +
  // 0xFF, the no-break space, spelled out: as a literal it is invisible
  String.fromCharCode(0xa0);
const strictUTF8 = new TextDecoder('utf-8', { fatal: true });
/**
 * A ZIP entry's name as its archiver wrote it: UTF-8 under the format's flag (bit 11) or in an
 * Info-ZIP Unicode Path field whose checksum matches the stored name; otherwise CP437, the format's
 * default, unless the bytes are valid UTF-8, as macOS's archiver writes them without the flag.
 * Every name was read as UTF-8, so a DOS or Windows archive listed its accented names garbled.
 */
export function zipName(raw: Buffer, flags: number, extra: Buffer): string {
  if (flags & 0x0800) return raw.toString('utf8');
  for (let at = 0; at + 4 <= extra.length;) {
    const tag = extra.readUInt16LE(at),
      size = extra.readUInt16LE(at + 2);
    if (
      tag === 0x7075 &&
      size >= 5 &&
      at + 4 + size <= extra.length &&
      extra[at + 4] === 1 &&
      extra.readUInt32LE(at + 5) === crc32(raw)
    )
      return extra.subarray(at + 9, at + 4 + size).toString('utf8');
    at += 4 + size;
  }
  try {
    return strictUTF8.decode(raw);
  } catch {
    return Array.from(raw, (byte) =>
      byte < 0x80 ? String.fromCharCode(byte) : CP437[byte - 0x80],
    ).join('');
  }
}
function pax(data: Buffer): Record<string, string> {
  const fields: Record<string, string> = Object.create(null);
  for (let cursor = 0; cursor < data.length;) {
    const space = data.indexOf(32, cursor);
    const length = Number(data.subarray(cursor, space).toString('ascii'));
    if (
      space < cursor ||
      !Number.isSafeInteger(length) ||
      length <= space - cursor + 2 ||
      cursor + length > data.length
    )
      throw new Error('Malformed TAR extended header.');
    const record = data.subarray(space + 1, cursor + length - 1).toString('utf8');
    const equals = record.indexOf('=');
    if (equals > 0) fields[record.slice(0, equals)] = record.slice(equals + 1);
    cursor += length;
  }
  return fields;
}
/** Reads archive indexes without extracting paths onto the filesystem. */
export class Archives {
  private cache = new Map<string, CachedIndex>();
  private work: Promise<unknown> = Promise.resolve();
  private background<T>(run: () => Promise<T>): Promise<T> {
    const result = this.work.catch(() => undefined).then(run);
    this.work = result;
    return result;
  }
  private async index(file: string): Promise<Index> {
    const fingerprint = await archiveFingerprint(file);
    const cached = this.cache.get(file);
    if (cached?.fingerprint === fingerprint) return cached.pending;
    const record: CachedIndex = { fingerprint, pending: this.load(file), bytes: 0 };
    this.cache.delete(file);
    this.cache.set(file, record);
    try {
      const result = await record.pending;
      record.bytes = result.data?.length || 0;
      let bytes = [...this.cache.values()].reduce((sum, item) => sum + item.bytes, 0);
      for (const [key, older] of this.cache) {
        if (this.cache.size <= 16 && bytes <= 128 * 1024 * 1024) break;
        if (older !== record) {
          this.cache.delete(key);
          bytes -= older.bytes;
        }
      }
      return result;
    } catch (error) {
      if (this.cache.get(file) === record) this.cache.delete(file);
      throw error;
    }
  }
  release(file: string): void {
    this.cache.delete(file);
  }
  private coordinated<T>(file: string, read: () => Promise<T>): Promise<T> {
    return fileCoordination.run([{ path: file, mode: 'read' }], async (signal) => {
      signal?.throwIfAborted();
      const result = await read();
      signal?.throwIfAborted();
      return result;
    });
  }
  async list(file: string): Promise<ArchiveListing> {
    return this.coordinated(file, () => this.listCoordinated(file));
  }
  private async listCoordinated(file: string): Promise<ArchiveListing> {
    const index = await this.index(file);
    return {
      entries: index.entries.map(({ name, size, directory, previewable }) => ({
        name,
        size,
        directory,
        previewable,
      })),
      truncated: index.truncated,
    };
  }
  async read(file: string, name: string): Promise<Buffer> {
    return this.coordinated(file, () => this.readCoordinated(file, name));
  }
  private async readCoordinated(file: string, name: string): Promise<Buffer> {
    const before = await archiveFingerprint(file);
    const data = await this.readIndexed(file, name);
    if ((await archiveFingerprint(file)) !== before)
      throw new Error('The archive changed while reading. Retry with the current file.');
    return data;
  }
  /** A small picture an archive carries, such as an OpenDocument thumbnail: its listed size, PNG
   * signature and dimensions are checked before Chromium decodes it. */
  async readPNG(
    file: string,
    name: string,
    limits: { bytes: number; side: number },
  ): Promise<Buffer> {
    const listed = (await this.list(file)).entries.find((entry) => entry.name === name);
    if (!listed?.previewable || listed.size > limits.bytes)
      throw new Error('This picture is missing or exceeds its preview limit.');
    const data = await this.read(file, name);
    const dimensions = imageDimensions(data);
    if (
      data.subarray(0, 8).toString('hex') !== PNG_SIGNATURE ||
      !dimensions ||
      Math.max(dimensions.width, dimensions.height) > limits.side
    )
      throw new Error('This picture is not a PNG within its preview limit.');
    return data;
  }
  /** The one file a gzip stream holds, under the caller's name, and the size its trailer records.
   * The format keeps that size modulo 4 GiB, and only for the last of several joined streams. */
  async gzip(file: string, name: string, limits: GzipLimits): Promise<ArchiveListing> {
    return this.coordinated(file, async () => {
      const handle = await openArchive(file);
      try {
        const { size } = await handle.stat();
        const header = Buffer.alloc(3);
        const trailer = Buffer.alloc(4);
        await handle.read(header, 0, header.length, 0);
        if (size < GZIP_MINIMUM || !isGzip(header))
          throw new Error('This file is not gzip-compressed.');
        await handle.read(trailer, 0, trailer.length, size - trailer.length);
        const expanded = trailer.readUInt32LE(0);
        const entry: ArchiveEntry = {
          name,
          size: expanded,
          directory: false,
          previewable: size <= limits.compressed && expanded <= limits.expanded,
        };
        return { entries: [entry], truncated: false };
      } finally {
        await handle.close();
      }
    });
  }
  /** Expands a gzip file within its limits. The output limit stops a stream that expands past it,
   * whatever its trailer records, so a small file cannot fill memory. */
  async gunzip(file: string, limits: GzipLimits): Promise<Buffer> {
    const limit = formatBytes(limits.expanded);
    return this.coordinated(file, async () => {
      const before = await archiveFingerprint(file);
      const handle = await openArchive(file);
      let compressed: Buffer;
      try {
        const { size } = await handle.stat();
        if (size > limits.compressed)
          throw new Error(`This file expands beyond the ${limit} preview limit.`);
        compressed = await readWhole(handle, size);
      } finally {
        await handle.close();
      }
      if (compressed.length < GZIP_MINIMUM || !isGzip(compressed))
        throw new Error('This file is not gzip-compressed.');
      // The trailer's size is not trusted: a truncated file ends in compressed bytes. Native zlib
      // runs in the worker pool; one decompression at a time bounds memory.
      const data = await this.background(() =>
        ungzip(compressed, { maxOutputLength: limits.expanded }),
      ).catch((error: NodeJS.ErrnoException) => {
        throw new Error(
          error.code === 'ERR_BUFFER_TOO_LARGE'
            ? `This file expands beyond the ${limit} preview limit.`
            : 'This gzip file is damaged or incomplete.',
        );
      });
      if ((await archiveFingerprint(file)) !== before)
        throw new Error('The file changed while reading. Retry with the current file.');
      return data;
    });
  }
  /** Internal bounded ZIP reader for streaming document parsers. Successful
   * completion verifies every expanded byte and the CRC, including omitted data. */
  async readZIPChunks(
    file: string,
    name: string,
    consume: (chunk: Buffer) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    return fileCoordination.run(
      [{ path: file, mode: 'read' }],
      async (active) => {
        active?.throwIfAborted();
        const before = await archiveFingerprint(file);
        const index = await this.index(file);
        const entry = index.entries.find((item) => item.name === name);
        if (!entry?.previewable || index.data || ![0, 8].includes(entry.method))
          throw new Error('This ZIP entry cannot be streamed.');
        await this.background(async () => {
          active?.throwIfAborted();
          const handle = await openArchive(file);
          try {
            const header = Buffer.alloc(30);
            const read = await handle.read(header, 0, 30, entry.offset);
            if (
              read.bytesRead !== 30 ||
              header.readUInt32LE(0) !== 0x04034b50 ||
              header.readUInt16LE(6) & 1 ||
              header.readUInt16LE(8) !== entry.method
            )
              throw new Error('Malformed or encrypted ZIP local header.');
            const offset = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
            if (offset + entry.compressed > (await handle.stat()).size)
              throw new Error('Truncated ZIP entry.');
            let length = 0,
              checksum = 0;
            const collect = async (chunks: AsyncIterable<Buffer>) => {
              for await (const chunk of chunks) {
                active?.throwIfAborted();
                length += chunk.length;
                if (length > entry.size || length > ENTRY_LIMIT)
                  throw new Error('Archive entry size exceeds its index or reader limit.');
                checksum = crc32(chunk, checksum);
                consume(chunk);
              }
            };
            if (entry.compressed) {
              const source = handle.createReadStream({
                start: offset,
                end: offset + entry.compressed - 1,
                autoClose: false,
                highWaterMark: 64 * 1024,
              });
              if (entry.method === 8)
                await pipeline(source, createInflateRaw({ chunkSize: 64 * 1024 }), collect, {
                  signal: active,
                });
              else await pipeline(source, collect, { signal: active });
            } else if (entry.method !== 0) throw new Error('Truncated ZIP compressed entry.');
            if (length !== entry.size)
              throw new Error('Archive entry size does not match its index.');
            if (checksum !== entry.checksum) throw new Error('ZIP entry checksum is invalid.');
          } finally {
            await handle.close();
          }
        });
        if ((await archiveFingerprint(file)) !== before)
          throw new Error('The archive changed while reading. Retry with the current file.');
        active?.throwIfAborted();
      },
      signal,
    );
  }
  async extractionEntries(file: string): Promise<ArchiveEntry[]> {
    return this.coordinated(file, () => this.extractionEntriesCoordinated(file));
  }
  private async extractionEntriesCoordinated(file: string): Promise<ArchiveEntry[]> {
    const index = await this.index(file);
    if (index.truncated) throw new Error('Extraction is limited to 20,000 archive entries.');
    if (index.unsafe)
      throw new Error(
        'This archive contains unsafe paths, links or special files. Nothing was extracted.',
      );
    if (index.entries.some((entry) => !entry.directory && !entry.previewable))
      throw new Error(
        'Extraction supports unencrypted ZIP and regular TAR files up to 32 MB per entry. Nothing was extracted.',
      );
    if (index.entries.reduce((bytes, entry) => bytes + entry.size, 0) > 256_000_000)
      throw new Error('Extraction is limited to 256 MB of expanded data. Nothing was extracted.');
    return index.entries;
  }
  private async readIndexed(file: string, name: string): Promise<Buffer> {
    const index = await this.index(file);
    const entry = index.entries.find((item) => item.name === name);
    if (!entry || !entry.previewable)
      throw new Error(
        'This archive entry cannot be previewed (unsupported compression, encryption, or size).',
      );
    if (index.data) return index.data.subarray(entry.offset, entry.offset + entry.size);
    const handle = await openArchive(file);
    try {
      if (entry.method === -1) {
        const data = Buffer.alloc(entry.size);
        await handle.read(data, 0, data.length, entry.offset);
        return data;
      }
      const header = Buffer.alloc(30);
      await handle.read(header, 0, 30, entry.offset);
      if (header.readUInt32LE(0) !== 0x04034b50) throw new Error('Malformed ZIP local header.');
      const offset = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
      if (offset + entry.compressed > (await handle.stat()).size)
        throw new Error('Truncated ZIP entry.');
      return await this.background(async () => {
        const compressed = Buffer.alloc(entry.compressed);
        await handle.read(compressed, 0, compressed.length, offset);
        const data =
          entry.method === 0
            ? compressed
            : await unzip(compressed, { maxOutputLength: ENTRY_LIMIT });
        if (data.length !== entry.size)
          throw new Error('Archive entry size does not match its index.');
        if (crc32(data) !== entry.checksum) throw new Error('ZIP entry checksum is invalid.');
        return data;
      });
    } finally {
      await handle.close();
    }
  }
  private async load(file: string): Promise<Index> {
    const handle = await openArchive(file);
    try {
      const info = await handle.stat();
      const signature = Buffer.alloc(4);
      await handle.read(signature, 0, 4, 0);
      if (signature.readUInt32LE(0) === 0x04034b50 || signature.readUInt32LE(0) === 0x06054b50) {
        const tailSize = Math.min(info.size, 65557);
        const tail = Buffer.alloc(tailSize);
        await handle.read(tail, 0, tailSize, info.size - tailSize);
        let end = tail.length - 22;
        while (
          end >= 0 &&
          (tail.readUInt32LE(end) !== 0x06054b50 ||
            end + 22 + tail.readUInt16LE(end + 20) !== tail.length)
        )
          end--;
        if (end < 0) throw new Error('ZIP directory was not found.');
        const count = tail.readUInt16LE(end + 10),
          length = tail.readUInt32LE(end + 12),
          offset = tail.readUInt32LE(end + 16);
        if (tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6))
          throw new Error('Multi-volume ZIP archives need a future adapter.');
        if (count === 65535 || offset === 0xffffffff)
          throw new Error('ZIP64 needs a future archive adapter.');
        if (length > 16 * 1024 * 1024 || offset + length > info.size)
          throw new Error('ZIP index exceeds the preview limit or is malformed.');
        const directory = Buffer.alloc(length);
        await handle.read(directory, 0, length, offset);
        const entries: IndexedEntry[] = [];
        let unsafe = false;
        let cursor = 0,
          scanned = 0;
        while (cursor + 46 <= directory.length && scanned < INDEX_LIMIT) {
          if (directory.readUInt32LE(cursor) !== 0x02014b50)
            throw new Error('Malformed ZIP directory.');
          const flags = directory.readUInt16LE(cursor + 8),
            method = directory.readUInt16LE(cursor + 10);
          const compressed = directory.readUInt32LE(cursor + 20),
            size = directory.readUInt32LE(cursor + 24);
          const nameLength = directory.readUInt16LE(cursor + 28),
            extra = directory.readUInt16LE(cursor + 30),
            comment = directory.readUInt16LE(cursor + 32);
          const name = zipName(
            directory.subarray(cursor + 46, cursor + 46 + nameLength),
            flags,
            directory.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extra),
          );
          const fileType = (directory.readUInt32LE(cursor + 38) >>> 16) & 0xf000;
          if (
            !safeName(name) ||
            name.includes('\\') ||
            (fileType && ![0x8000, 0x4000].includes(fileType)) ||
            directory.readUInt16LE(cursor + 34) !== 0
          )
            unsafe = true;
          if (cursor + 46 + nameLength + extra + comment > directory.length)
            throw new Error('Truncated ZIP directory.');
          if (safeName(name))
            entries.push({
              name,
              size,
              directory: name.endsWith('/'),
              compressed,
              method,
              checksum: directory.readUInt32LE(cursor + 16),
              offset: directory.readUInt32LE(cursor + 42),
              previewable:
                !name.endsWith('/') &&
                !(flags & 1) &&
                [0, 8].includes(method) &&
                size <= ENTRY_LIMIT &&
                compressed <= ENTRY_LIMIT,
            });
          cursor += 46 + nameLength + extra + comment;
          scanned++;
        }
        if (scanned < INDEX_LIMIT && (scanned !== count || cursor !== directory.length))
          throw new Error('ZIP directory count is invalid.');
        return { file, entries, unsafe, truncated: count > scanned };
      }
      let data: Buffer | undefined;
      if (signature[0] === 0x1f && signature[1] === 0x8b) {
        if (info.size > 64_000_000) throw new Error('Compressed TAR preview is limited to 64 MB.');
        // Native zlib runs in the worker pool; one decompression at a time bounds memory.
        data = await this.background(async () => {
          const compressed = Buffer.alloc(info.size);
          let offset = 0;
          while (offset < compressed.length) {
            const read = await handle.read(compressed, offset, compressed.length - offset, offset);
            if (!read.bytesRead) throw new Error('Compressed TAR changed or is truncated.');
            offset += read.bytesRead;
          }
          return ungzip(compressed, { maxOutputLength: 128 * 1024 * 1024 });
        });
      }
      const total = data?.length ?? info.size;
      const entries: IndexedEntry[] = [];
      let unsafe = false;
      let cursor = 0;
      let longName: string | undefined;
      let localFields: Record<string, string> = {},
        globalFields: Record<string, string> = {},
        scanned = 0;
      while (cursor + 512 <= total && scanned < INDEX_LIMIT) {
        const header = data ? data.subarray(cursor, cursor + 512) : Buffer.alloc(512);
        if (!data) await handle.read(header, 0, 512, cursor);
        if (header.every((byte) => byte === 0)) break;
        const field = (from: number, length: number) =>
          header
            .subarray(from, from + length)
            .toString('utf8')
            .replace(/\0.*$/s, '');
        const type = field(156, 1),
          prefix = field(345, 155);
        const extended = ['x', 'g', 'L'].includes(type);
        const fields = { ...globalFields, ...localFields };
        const size =
          !extended && fields.size !== undefined
            ? Number(fields.size)
            : parseInt(field(124, 12).trim() || '0', 8);
        if (!Number.isSafeInteger(size) || size < 0 || cursor + 512 + size > total)
          throw new Error('Malformed TAR entry size.');
        let checksum = 0;
        for (let index = 0; index < 512; index++)
          checksum += index >= 148 && index < 156 ? 32 : (header[index] ?? 0);
        if (parseInt(field(148, 8).trim(), 8) !== checksum)
          throw new Error('TAR header checksum is invalid.');
        const name =
          fields.path || longName || (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
        if (extended) {
          if (size > 65536) throw new Error('TAR file name exceeds the preview limit.');
          const text = data ? data.subarray(cursor + 512, cursor + 512 + size) : Buffer.alloc(size);
          if (!data) await handle.read(text, 0, size, cursor + 512);
          if (type === 'L') longName = text.toString('utf8').replace(/\0.*$/s, '');
          else if (type === 'g') globalFields = { ...globalFields, ...pax(text) };
          else localFields = pax(text);
        } else {
          longName = undefined;
          localFields = {};
          if (!safeName(name) || name.includes('\\') || !['0', '', '5'].includes(type))
            unsafe = true;
          if (safeName(name))
            entries.push({
              name,
              size,
              directory: type === '5' || name.endsWith('/'),
              offset: cursor + 512,
              compressed: size,
              method: -1,
              previewable: ['0', ''].includes(type) && size <= ENTRY_LIMIT,
            });
        }
        cursor += 512 + Math.ceil(size / 512) * 512;
        scanned++;
      }
      if (!entries.length && total && !data && !file.toLowerCase().endsWith('.tar'))
        throw new Error('This is not a supported ZIP or TAR archive.');
      return {
        file,
        entries,
        data,
        unsafe,
        truncated: scanned >= INDEX_LIMIT && cursor + 512 < total,
      };
    } finally {
      await handle.close();
    }
  }
}

export async function archiveFingerprint(file: string): Promise<string> {
  const info = await stat(file);
  return `${file}:${info.dev}:${info.ino}:${info.ctimeMs}:${info.mtimeMs}:${info.size}`;
}
