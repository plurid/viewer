/**
 * A torrent's metainfo is bencode, read with bounds on its size, nesting and count of values. The
 * info-hash is the hash of the info dictionary's own bytes.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decodeBencode, readTorrent, torrentLimits } from '../src/domain/previews/data/torrent';
import { bencode, sampleTorrent } from '../tools/playground/samples/inspection';

const digest = (algorithm: 'sha1' | 'sha256', bytes: Uint8Array) =>
  createHash(algorithm).update(bytes).digest('hex');
const bytes = (value: string | Buffer) =>
  new Uint8Array(typeof value === 'string' ? Buffer.from(value, 'latin1') : value);

describe('bencode', () => {
  it('reads integers, strings, lists and dictionaries', () => {
    const value = decodeBencode(bytes('d3:agei42e4:listli-1ei0ee4:name4:Ada!e'));
    expect(value).toBeInstanceOf(Map);
    const map = value as Map<string, unknown>;
    expect(map.get('age')).toBe(42);
    expect(map.get('list')).toEqual([-1, 0]);
    expect(new TextDecoder().decode(map.get('name') as Uint8Array)).toBe('Ada!');
  });

  it.each([
    ['an integer with a leading zero', 'i042e'],
    ['negative zero', 'i-0e'],
    ['a string longer than the input', '10:short'],
    ['an unterminated list', 'li1ei2e'],
    ['a dictionary key that is not a string', 'di1ei2ee'],
    ['an unknown marker', 'x'],
    ['nothing at all', ''],
  ])('refuses %s', (_case, text) => {
    expect(() => decodeBencode(bytes(text))).toThrow();
  });

  it('bounds nesting, the count of values and the input size', () => {
    const deep = 'l'.repeat(torrentLimits.depth + 2) + 'e'.repeat(torrentLimits.depth + 2);
    expect(() => decodeBencode(bytes(deep))).toThrow('nests too deeply');
    const wide = 'l' + 'i0e'.repeat(torrentLimits.values) + 'e';
    expect(() => decodeBencode(bytes(wide))).toThrow('too many values');
    expect(() => decodeBencode(new Uint8Array(torrentLimits.bytes + 1))).toThrow('16 MB');
  });
});

describe('torrent metainfo', () => {
  it('reads the playground torrent: name, size, pieces, files, trackers, date and info-hash', () => {
    const file = sampleTorrent();
    const torrent = readTorrent(bytes(file), digest);
    expect(torrent).toMatchObject({
      kind: 'torrent',
      name: 'Viewer sample',
      version: 'v1',
      pieceSize: 16384,
      fileCount: 241,
      trackers: [
        'udp://tracker.viewer.example:6969/announce',
        'https://tracker.example.org/announce',
      ],
      seeds: ['https://downloads.example.com/viewer-sample/'],
      created: '2026-01-01T00:00:00.000Z',
      createdBy: 'Viewer playground',
      private: false,
    });
    expect(torrent.files[0]).toEqual({ path: 'README.txt', size: 60 });
    expect(torrent.files[1]!.path).toBe('notes/part-001.txt');
    expect(torrent.size).toBe(torrent.files.reduce((total, item) => total + item.size, 0));
    expect(torrent.pieces).toBe(Math.ceil(torrent.size / 16384));
    // the info-hash is SHA-1 of the info dictionary as it is encoded
    const reencoded = bencode({
      files: torrent.files.map((item) => ({ length: item.size, path: item.path.split('/') })),
      name: 'Viewer sample',
      'piece length': 16384,
      pieces: (decodeBencode(bytes(file)) as Map<string, Map<string, Uint8Array>>)
        .get('info')!
        .get('pieces')!,
    });
    expect(torrent.infoHash).toBe(digest('sha1', reencoded));
  });

  it('reads a single file, a private flag, a v2 file tree and skips padding files', () => {
    const single = readTorrent(
      bytes(
        bencode({
          info: {
            length: 5,
            name: 'one.bin',
            'piece length': 16384,
            pieces: 'x'.repeat(20),
            private: 1,
          },
        }),
      ),
      digest,
    );
    expect(single).toMatchObject({
      files: [{ path: 'one.bin', size: 5 }],
      private: true,
      pieces: 1,
    });
    const v2 = readTorrent(
      bytes(
        bencode({
          info: {
            'file tree': {
              docs: { 'a.txt': { '': { length: 3 } } },
              'b.txt': { '': { length: 4 } },
            },
            'meta version': 2,
            name: 'tree',
            'piece length': 16384,
          },
        }),
      ),
      digest,
    );
    expect(v2).toMatchObject({ version: 'v2', size: 7, infoHash: undefined });
    // in the sorted order bencode keeps a dictionary's keys
    expect(v2.files).toEqual([
      { path: 'b.txt', size: 4 },
      { path: 'docs/a.txt', size: 3 },
    ]);
    expect(v2.infoHashV2).toMatch(/^[0-9a-f]{64}$/);
    const padded = readTorrent(
      bytes(
        bencode({
          info: {
            files: [
              { length: 10, path: ['a'] },
              { attr: 'p', length: 6, path: ['.pad', '6'] },
              { length: 2, path: ['b'] },
            ],
            name: 'padded',
            'piece length': 16,
            pieces: 'y'.repeat(20),
          },
        }),
      ),
      digest,
    );
    expect(padded).toMatchObject({ size: 12, fileCount: 2 });
  });

  it('keeps at most the bounded number of files, and says how many there are', () => {
    const files = Array.from({ length: torrentLimits.files + 5 }, (_, index) => ({
      length: 1,
      path: [String(index)],
    }));
    const torrent = readTorrent(
      bytes(
        bencode({ info: { files, name: 'many', 'piece length': 16384, pieces: 'z'.repeat(20) } }),
      ),
      digest,
    );
    expect(torrent.files).toHaveLength(torrentLimits.files);
    expect(torrent.fileCount).toBe(torrentLimits.files + 5);
  });

  it('refuses bencode that is not a torrent', () => {
    expect(() => readTorrent(bytes('d4:name3:abce'), digest)).toThrow('no torrent information');
    expect(() => readTorrent(bytes('li1ee'), digest)).toThrow();
  });
});
