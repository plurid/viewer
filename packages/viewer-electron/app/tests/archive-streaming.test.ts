import { beforeEach, afterEach, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';
import { Archives } from '../src/desktop/previews/archives';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string;
beforeEach(async () => {
  root = await temporaryRoot('viewer-archive-streaming-');
});
afterEach(async () => {
  await trashTemporary(root);
});

it('streams stored and deflated ZIP entries in bounded chunks without extracting files', async () => {
  const content = Buffer.from('Measurements Știință 📏\n'.repeat(20000));
  for (const level of [0, 6] as const) {
    const file = path.join(root, `Archive-${level}.xlsx`);
    await writeFile(file, zipSync({ 'sheet.xml': content }, { level }));
    const reader = new Archives(),
      chunks: Buffer[] = [];
    await reader.readZIPChunks(file, 'sheet.xml', (chunk) => {
      chunks.push(chunk);
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(Math.max(...chunks.map((chunk) => chunk.length))).toBeLessThanOrEqual(65536);
    expect(Buffer.concat(chunks)).toEqual(content);
    reader.release(file);
  }
});

it('checks the full CRC and expanded length even after a consumer ignores retained content', async () => {
  const content = Buffer.from('whole data\n'.repeat(30000));
  const file = path.join(root, 'Corrupt.xlsx');
  const bytes = Buffer.from(zipSync({ 'sheet.xml': content }, { level: 0 }));
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bytes.writeUInt32LE((bytes.readUInt32LE(central + 16) ^ 1) >>> 0, central + 16);
  await writeFile(file, bytes);
  const reader = new Archives();
  let consumed = 0;
  await expect(
    reader.readZIPChunks(file, 'sheet.xml', (chunk) => {
      consumed += chunk.length;
    }),
  ).rejects.toThrow('checksum');
  expect(consumed).toBe(content.length);
  reader.release(file);
  const wrongSize = Buffer.from(zipSync({ 'sheet.xml': content }));
  const position = wrongSize.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  wrongSize.writeUInt32LE(content.length - 1, position + 24);
  await writeFile(file, wrongSize);
  await expect(reader.readZIPChunks(file, 'sheet.xml', () => {})).rejects.toThrow('size');
  reader.release(file);
});

it('cancels an active stream and releases its reader before another read', async () => {
  const file = path.join(root, 'Cancel.xlsx'),
    content = Buffer.alloc(2_000_000, 65);
  await writeFile(file, zipSync({ 'sheet.xml': content }));
  const reader = new Archives(),
    controller = new AbortController();
  let chunks = 0;
  await expect(
    reader.readZIPChunks(
      file,
      'sheet.xml',
      () => {
        chunks++;
        controller.abort();
      },
      controller.signal,
    ),
  ).rejects.toThrow();
  expect(chunks).toBe(1);
  let bytes = 0;
  await reader.readZIPChunks(file, 'sheet.xml', (chunk) => {
    bytes += chunk.length;
  });
  expect(bytes).toBe(content.length);
  await expect(
    reader.readZIPChunks(file, 'sheet.xml', () => {
      throw new Error('Consumer stopped');
    }),
  ).rejects.toThrow('Consumer stopped');
  await reader.readZIPChunks(file, 'sheet.xml', () => {});
  reader.release(file);
});

it('refuses a source changed during streaming even when the indexed entry CRC still matches', async () => {
  const file = path.join(root, 'Changed.xlsx');
  await writeFile(file, zipSync({ 'sheet.xml': Buffer.alloc(200000, 65) }));
  const reader = new Archives();
  let changed = false;
  await expect(
    reader.readZIPChunks(file, 'sheet.xml', () => {
      if (!changed) {
        changed = true;
        appendFileSync(file, 'changed');
      }
    }),
  ).rejects.toThrow('changed while reading');
  reader.release(file);
});
