import type { Digest } from '../digest';

/**
 * A BitTorrent metainfo file, read for inspection: its name, files, trackers and info-hash. The
 * bencode reader bounds the input, its nesting and its count of values, and keeps byte strings as
 * views of the input.
 */
export const torrentLimits = {
  bytes: 16 * 1024 * 1024,
  depth: 32,
  values: 1_000_000,
  files: 100_000,
  trackers: 1000,
} as const;

export type Bencode = number | Uint8Array | Bencode[] | Map<string, Bencode>;

/** v1 lists files and hashes pieces with SHA-1; v2 holds a file tree hashed with SHA-256. */
export type TorrentVersion = 'v1' | 'v2' | 'hybrid';

export interface TorrentFile {
  path: string;
  size: number;
}

export interface TorrentFacts {
  kind: 'torrent';
  name: string;
  version: TorrentVersion;
  /** Bytes of every file, without padding files. */
  size: number;
  pieceSize?: number;
  pieces?: number;
  files: TorrentFile[];
  /** Files in the torrent, more than `files` holds when it was cut at `torrentLimits.files`. */
  fileCount: number;
  trackers: string[];
  /** Web seeds, from `url-list`. */
  seeds: string[];
  created?: string;
  createdBy?: string;
  comment?: string;
  private: boolean;
  /** SHA-1 of the info dictionary, for v1 and hybrid torrents. */
  infoHash?: string;
  /** SHA-256 of the info dictionary, for v2 and hybrid torrents. */
  infoHashV2?: string;
}

/** The bytes bencode marks values with: d, e, i, l and the colon after a string's length. */
const d = 0x64,
  e = 0x65,
  i = 0x69,
  l = 0x6c,
  colon = 0x3a;
const digit = (byte: number | undefined) => byte !== undefined && byte >= 48 && byte <= 57;
const malformed = () => new Error('The torrent file is not valid bencode.');

class Decoder {
  at = 0;
  private values = 0;
  /** Where each value of the top dictionary starts and ends: the info-hash covers one. */
  readonly spans = new Map<string, [number, number]>();
  constructor(private readonly bytes: Uint8Array) {}
  private integer(end: number): number {
    const text = new TextDecoder('latin1').decode(this.bytes.subarray(this.at, end));
    if (!/^(?:0|-?[1-9]\d*)$/.test(text)) throw malformed();
    this.at = end + 1;
    return Number(text);
  }
  value(depth: number): Bencode {
    if (++this.values > torrentLimits.values) throw new Error('The torrent holds too many values.');
    if (depth > torrentLimits.depth) throw new Error('The torrent nests too deeply.');
    const byte = this.bytes[this.at];
    if (byte === i) {
      this.at++;
      const end = this.bytes.indexOf(e, this.at);
      if (end < 0 || end - this.at > 24) throw malformed();
      return this.integer(end);
    }
    if (digit(byte)) {
      const end = this.bytes.indexOf(colon, this.at);
      if (end < 0 || end - this.at > 10) throw malformed();
      const length = this.integer(end);
      if (length < 0 || this.at + length > this.bytes.length) throw malformed();
      return this.bytes.subarray(this.at, (this.at += length));
    }
    if (byte === l) {
      this.at++;
      const list: Bencode[] = [];
      while (this.bytes[this.at] !== e) {
        if (this.at >= this.bytes.length) throw malformed();
        list.push(this.value(depth + 1));
      }
      this.at++;
      return list;
    }
    if (byte === d) {
      this.at++;
      const dictionary = new Map<string, Bencode>();
      while (this.bytes[this.at] !== e) {
        if (!digit(this.bytes[this.at])) throw malformed();
        const key = text(this.value(depth + 1) as Uint8Array);
        const start = this.at;
        dictionary.set(key, this.value(depth + 1));
        if (depth === 0) this.spans.set(key, [start, this.at]);
      }
      this.at++;
      return dictionary;
    }
    throw malformed();
  }
}

/** Bencoded bytes as values, bounded by `torrentLimits`. */
export function decodeBencode(bytes: Uint8Array): Bencode {
  if (bytes.length > torrentLimits.bytes) throw new Error('The torrent file is larger than 16 MB.');
  return new Decoder(bytes).value(0);
}

const text = (value: Bencode | undefined) =>
  value instanceof Uint8Array ? new TextDecoder().decode(value) : '';
const field = (value: Bencode | undefined, key: string) =>
  value instanceof Map ? value.get(key) : undefined;
/** A name in UTF-8 where the writer gave one beside its own encoding. */
const named = (value: Bencode | undefined, key: string) =>
  text(field(value, `${key}.utf-8`) ?? field(value, key));
const count = (value: Bencode | undefined) => (typeof value === 'number' ? value : undefined);
const list = (value: Bencode | undefined) => (Array.isArray(value) ? value : []);
/** BEP 47 marks padding files, which align the next file to a piece. */
const padding = (file: Bencode, parts: readonly string[]) =>
  text(field(file, 'attr')).includes('p') || parts[0] === '.pad';

/** The files of a v2 file tree: a file is a dictionary whose empty key holds its length. */
function treeFiles(tree: Bencode | undefined, add: (file: TorrentFile) => void) {
  const walk = (node: Bencode | undefined, path: string[], depth: number) => {
    if (!(node instanceof Map) || depth > torrentLimits.depth) return;
    for (const [name, child] of node) {
      if (name === '') {
        add({ path: path.join('/'), size: count(field(child, 'length')) ?? 0 });
        continue;
      }
      walk(child, [...path, name], depth + 1);
    }
  };
  walk(tree, [], 0);
}

/** The metainfo a torrent file holds, with its info-hash computed by `digest`. */
export function readTorrent(bytes: Uint8Array, digest: Digest): TorrentFacts {
  if (bytes.length > torrentLimits.bytes) throw new Error('The torrent file is larger than 16 MB.');
  const decoder = new Decoder(bytes);
  const root = decoder.value(0);
  const info = field(root, 'info');
  const span = decoder.spans.get('info');
  if (!(info instanceof Map) || !span) throw new Error('This file has no torrent information.');
  const v2 = field(info, 'meta version') === 2;
  const v1 = info.has('pieces');
  const name = named(info, 'name');
  const files: TorrentFile[] = [];
  let fileCount = 0;
  let size = 0;
  const add = (file: TorrentFile) => {
    fileCount++;
    size += file.size;
    if (files.length < torrentLimits.files) files.push(file);
  };
  if (info.has('files'))
    for (const file of list(info.get('files'))) {
      const parts = list(field(file, 'path.utf-8') ?? field(file, 'path')).map((part) =>
        text(part),
      );
      if (!padding(file, parts))
        add({ path: parts.join('/'), size: count(field(file, 'length')) ?? 0 });
    }
  else if (info.has('length')) add({ path: name, size: count(info.get('length')) ?? 0 });
  else if (v2) treeFiles(info.get('file tree'), add);
  const trackers = new Set<string>();
  const tracker = (value: Bencode | undefined) => {
    const address = text(value).trim();
    if (address && trackers.size < torrentLimits.trackers) trackers.add(address);
  };
  tracker(field(root, 'announce'));
  for (const tier of list(field(root, 'announce-list')))
    for (const item of list(tier)) tracker(item);
  const seeds = field(root, 'url-list');
  const created = count(field(root, 'creation date'));
  const pieces = info.get('pieces');
  const infoBytes = bytes.subarray(span[0], span[1]);
  return {
    kind: 'torrent',
    name,
    version: v1 && v2 ? 'hybrid' : v2 ? 'v2' : 'v1',
    size,
    pieceSize: count(info.get('piece length')),
    pieces: pieces instanceof Uint8Array ? Math.floor(pieces.length / 20) : undefined,
    files,
    fileCount,
    trackers: [...trackers],
    seeds: (Array.isArray(seeds) ? seeds : [seeds])
      .map((seed) => text(seed).trim())
      .filter(Boolean)
      .slice(0, torrentLimits.trackers),
    created:
      created !== undefined && created > 0 && created < 1e11
        ? new Date(created * 1000).toISOString()
        : undefined,
    createdBy: text(field(root, 'created by')) || undefined,
    comment: named(root, 'comment') || undefined,
    private: info.get('private') === 1,
    infoHash: v1 || !v2 ? digest('sha1', infoBytes) : undefined,
    infoHashV2: v2 ? digest('sha256', infoBytes) : undefined,
  };
}
