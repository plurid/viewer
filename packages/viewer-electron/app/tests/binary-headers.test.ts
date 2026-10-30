/**
 * Above the hex view, a program's header says more than its kind: Mach-O CPU types and universal
 * slices, the PE machine, ELF class and machine, the WebAssembly and class file versions. The hex
 * view's Go to offset reads hexadecimal and decimal offsets.
 */
import { describe, expect, it } from 'vitest';
import { headerDetails } from '../src/domain/files/binary-headers';
import { readOffset } from '../src/domain/files/hex';
import { confirms, identifyBytes } from '../src/domain/files/signatures';
import { bencode, inspectionSamples, sampleTorrent } from '../tools/playground/samples/inspection';

const samples = inspectionSamples();
const sampleBytes = (suffix: string) =>
  new Uint8Array(Buffer.from(samples.find((sample) => sample.path.endsWith(suffix))!.bytes));
const details = (head: Uint8Array) =>
  Object.fromEntries(headerDetails(head).map((detail) => [detail.label, detail.value]));

describe('program headers', () => {
  it('names a universal binary’s slices', () => {
    const head = sampleBytes('Universal object.o').subarray(0, 4096);
    expect(identifyBytes(head)?.label).toBe('Mach-O universal binary');
    expect(details(head)).toEqual({
      Architectures: '2',
      'Slice 1': 'x86_64, 32 B at 0x1000',
      'Slice 2': 'arm64, 32 B at 0x2000',
    });
  });

  it('names a thin Mach-O file’s CPU, arm64e among them', () => {
    const header = Buffer.alloc(32);
    header.writeUInt32LE(0xfeedfacf, 0);
    header.writeUInt32LE(0x0100000c, 4);
    header.writeUInt32LE(0x80000002, 8);
    header.writeUInt32LE(2, 12);
    header.writeUInt32LE(17, 16);
    expect(details(new Uint8Array(header))).toEqual({
      Architecture: 'arm64e',
      'Load commands': '17',
    });
  });

  it('names a Java class file’s release, and the WebAssembly version', () => {
    expect(details(sampleBytes('Sample.class'))).toEqual({
      'Class file version': '65.0',
      Java: '21',
    });
    const preview = new Uint8Array(Buffer.from('cafebabeffff0045', 'hex'));
    expect(details(preview).Java).toBe('25 with preview features');
    expect(details(sampleBytes('Add.wasm'))).toEqual({ Version: '1' });
  });

  it('names a PE file’s machine, format, subsystem and .NET runtime', () => {
    const file = Buffer.alloc(512);
    file.write('MZ', 0, 'latin1');
    file.writeUInt32LE(0x80, 0x3c);
    file.write('PE\0\0', 0x80, 'latin1');
    file.writeUInt16LE(0xaa64, 0x84);
    file.writeUInt16LE(3, 0x86);
    const optional = 0x80 + 24;
    file.writeUInt16LE(0x20b, optional);
    file.writeUInt16LE(3, optional + 68);
    file.writeUInt32LE(0x2000, optional + 112 + 14 * 8);
    expect(identifyBytes(new Uint8Array(file))?.label).toBe('Windows executable');
    expect(details(new Uint8Array(file))).toEqual({
      Machine: 'ARM64',
      Format: 'PE32+ (64-bit)',
      Subsystem: 'Windows console',
      Runtime: '.NET',
      Sections: '3',
    });
  });

  it('names an ELF file’s class, byte order and machine', () => {
    const file = Buffer.alloc(64);
    file.write('\x7fELF', 0, 'latin1');
    file[4] = 2;
    file[5] = 1;
    file[7] = 3;
    file.writeUInt16LE(3, 16);
    file.writeUInt16LE(183, 18);
    expect(details(new Uint8Array(file))).toEqual({
      Class: '64-bit',
      'Byte order': 'Little-endian',
      Machine: 'AArch64',
      System: 'Linux',
    });
  });

  it('says nothing for bytes no header names', () => {
    expect(headerDetails(sampleBytes('Noise.bin').subarray(0, 4096))).toEqual([]);
    expect(identifyBytes(sampleBytes('Noise.bin').subarray(0, 4096))).toBeUndefined();
  });

  it('names a misnamed torrent, which Show as may read once its bytes confirm it', () => {
    // piece hashes in the head make it binary; a head of names alone shows as text
    const torrent = bencode({
      announce: 'udp://tracker.viewer.example:6969/announce',
      info: { length: 5, name: 'one.bin', 'piece length': 16384, pieces: Buffer.alloc(20) },
    });
    expect(identifyBytes(new Uint8Array(sampleTorrent()).subarray(0, 4096))).toBeUndefined();
    const identity = identifyBytes(new Uint8Array(torrent));
    expect(identity).toEqual({ label: 'Torrent file', extension: 'torrent' });
    expect(confirms(identity, 'torrent')).toBe(true);
    expect(identifyBytes(new Uint8Array(Buffer.from('d3:fooi1e\0\0\0', 'latin1')))).toBeUndefined();
  });
});

describe('go to offset', () => {
  it.each([
    ['0x1F0', 0x1f0],
    ['1f0h', 0x1f0],
    ['ff', 255],
    ['496', 496],
    ['4_096', 4096],
    ['0', 0],
  ])('reads %s', (input, offset) => {
    expect(readOffset(input, 1 << 20)).toEqual({ offset });
  });

  it.each([
    ['', 'Type an offset'],
    ['12z', 'is not an offset'],
    ['-4', 'is not an offset'],
    ['0x100000', 'The file ends at 000FFFFF'],
  ])('refuses %s', (input, error) => {
    const reading = readOffset(input, 1 << 20);
    expect('error' in reading && reading.error).toContain(error);
  });
});
