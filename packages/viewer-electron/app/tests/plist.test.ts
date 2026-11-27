/**
 * A property list shows as a tree in either form. The binary bytes below are what plutil writes for
 * the XML document, so the decoder is checked against Apple's own encoder.
 */
import { expect, it } from 'vitest';
import { decodeBinaryPlist, isBinaryPlist, xmlPlistValue } from '../src/domain/previews/data/plist';
import { inspectStructured } from '../src/domain/previews/data/structured';

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Field notes</string>
  <key>Version</key><integer>42</integer>
  <key>Ratio</key><real>1.5</real>
  <key>Enabled</key><true/>
  <key>Off</key><false/>
  <key>Created</key><date>2026-10-29T10:00:00Z</date>
  <key>Icon</key><data>AAECAwQ=</data>
  <key>Tags</key><array><string>walk</string><string>café ☕</string></array>
  <key>Large</key><integer>5000000000</integer>
</dict>
</plist>`;
const binary = Buffer.from(
  '62706c6973743030d90102030405060708090a0b0c0d0e0f10111457437265617465645756657273696f6e55526174696f5c434642756e646c654e616d65554c6172676557456e61626c65645449636f6e5454616773534f66663341c849a850000000102a233ff80000000000005b4669656c64206e6f74657313000000012a05f20009450001020304a212135477616c6b6600630061006600e90020261508081b232b313e444c51565a63656e7a83848a8d929f00000000000001010000000000000015000000000000000000000000000000a0',
  'hex',
);
const values = {
  CFBundleName: 'Field notes',
  Version: 42,
  Ratio: 1.5,
  Enabled: true,
  Off: false,
  Created: '2026-10-29T10:00:00.000Z',
  Icon: '<data, 5 bytes>',
  Tags: ['walk', 'café ☕'],
  Large: 5_000_000_000,
};

it('reads the binary form plutil writes', () => {
  expect(isBinaryPlist(binary)).toBe(true);
  expect(decodeBinaryPlist(binary)).toEqual(values);
});

it('reads the XML form as the same values, and shows it as a tree', () => {
  expect(xmlPlistValue(xml)).toEqual({ ...values, Created: '2026-10-29T10:00:00Z' });
  const tree = inspectStructured(xml, 'plist');
  expect(tree.error).toBeUndefined();
  expect(tree.nodes.map((node) => node.name)).toContain('CFBundleName');
});

it('refuses malformed binary lists instead of reading out of range', () => {
  const broken = Buffer.from(binary);
  // point the offset table past the end
  broken.writeBigUInt64BE(BigInt(broken.length), broken.length - 8);
  expect(() => decodeBinaryPlist(broken)).toThrow('invalid trailer');
  const cut = Buffer.concat([binary.subarray(0, 20), binary.subarray(binary.length - 32)]);
  expect(() => decodeBinaryPlist(cut)).toThrow();
  expect(() =>
    decodeBinaryPlist(Buffer.from('not a plist at all, just text....................')),
  ).toThrow('not a binary property list');
});

it('refuses a list that contains itself', () => {
  // one array object whose only element is itself
  const objects = Buffer.from([0xa1, 0x00]);
  const offsets = Buffer.from([8]);
  const trailer = Buffer.alloc(32);
  trailer.writeUInt8(1, 6);
  trailer.writeUInt8(1, 7);
  trailer.writeBigUInt64BE(1n, 8);
  trailer.writeBigUInt64BE(0n, 16);
  trailer.writeBigUInt64BE(10n, 24);
  const list = Buffer.concat([Buffer.from('bplist00'), objects, offsets, trailer]);
  expect(() => decodeBinaryPlist(list)).toThrow('refers to itself');
});

it('keeps refusing a declaration that defines entities', () => {
  const entities = xml.replace(
    '<!DOCTYPE plist PUBLIC',
    '<!DOCTYPE plist [<!ENTITY a "aaaa">]><!DOCTYPE x PUBLIC',
  );
  expect(() => xmlPlistValue(entities)).toThrow('not supported');
});

it('refuses binary plist DAGs that expand exponentially and rejects out-of-range offsets or integer widths', () => {
  const buildDag = (depth: number) => {
    const count = depth + 1;
    const body: number[] = [];
    const offsets: number[] = [];
    let cursor = 8;
    for (let k = 0; k < depth; k++) {
      offsets.push(cursor);
      body.push(0xa2, k + 1, k + 1);
      cursor += 3;
    }
    offsets.push(cursor);
    body.push(0x51, 0x78);
    const tableOffset = 8 + body.length;
    const total = tableOffset + offsets.length + 32;
    const bytes = new Uint8Array(total);
    bytes.set(new TextEncoder().encode('bplist00'), 0);
    bytes.set(body, 8);
    bytes.set(offsets, tableOffset);
    const view = new DataView(bytes.buffer);
    const trailer = total - 32;
    view.setUint8(trailer + 6, 1);
    view.setUint8(trailer + 7, 1);
    view.setBigUint64(trailer + 8, BigInt(count));
    view.setBigUint64(trailer + 16, 0n);
    view.setBigUint64(trailer + 24, BigInt(tableOffset));
    return bytes;
  };
  for (const depth of [18, 35]) {
    const dag = buildDag(depth);
    const slice = dag.subarray.bind(dag);
    let reads = 0;
    dag.subarray = (start, end) => {
      // One header and at most 100,000 string leaves in the 200,000 visited objects.
      if (++reads > 100_001) throw new Error('Exceeded the leaf read budget.');
      return slice(start, end);
    };
    expect(() => decodeBinaryPlist(dag)).toThrow('too large');
  }

  // Offset pointing past the offset table into the trailer
  const badOffset = Buffer.alloc(8 + 2 + 1 + 32);
  badOffset.write('bplist00', 0);
  badOffset[8] = 0x10;
  badOffset[9] = 0x01;
  badOffset[10] = 40; // out of range (>= tableOffset 10)
  badOffset.writeUInt8(1, 11 + 6);
  badOffset.writeUInt8(1, 11 + 7);
  badOffset.writeBigUInt64BE(1n, 11 + 8);
  badOffset.writeBigUInt64BE(0n, 11 + 16);
  badOffset.writeBigUInt64BE(10n, 11 + 24);
  expect(() => decodeBinaryPlist(badOffset)).toThrow('out of range');

  // Integer with info = 4 (16-byte integer) must throw a clean error, not RangeError
  const wideInt = Buffer.alloc(8 + 2 + 1 + 32);
  wideInt.write('bplist00', 0);
  wideInt[8] = 0x14;
  wideInt[9] = 0x00;
  wideInt[10] = 8;
  wideInt.writeUInt8(1, 11 + 6);
  wideInt.writeUInt8(1, 11 + 7);
  wideInt.writeBigUInt64BE(1n, 11 + 8);
  wideInt.writeBigUInt64BE(0n, 11 + 16);
  wideInt.writeBigUInt64BE(10n, 11 + 24);
  expect(() => decodeBinaryPlist(wideInt)).toThrow('out of range');
});
