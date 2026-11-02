import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { startSupplier } from '../tools/mounting/supplier';
import { partDXF } from '../src/domain/layout/nesting/dxf-writer';
import { temporaryRoot } from '../tools/temporary';

const content = partDXF({
  units: 4,
  layers: ['CUT'],
  primitives: [
    {
      kind: 'polyline',
      layer: 'CUT',
      closed: true,
      vertices: [
        [0, 0],
        [120, 0],
        [120, 80],
        [0, 80],
      ].map(([x, y]) => ({ x: x!, y: y!, bulge: 0 })),
    },
  ],
});

it('quotes the exact attachment, persists the reply and blocks changed files and cross-origin requests', async () => {
  const root = await temporaryRoot('viewer-supplier-check-');
  const drawing = path.join(root, 'plate.dxf');
  const output = path.join(root, 'supplier-reply.json');
  await writeFile(drawing, content, { flag: 'wx' });
  const supplier = await startSupplier({
    drawing,
    output,
    material: 'Aluminium',
    thicknessMm: 6,
    quantity: 1,
  });
  try {
    const page = await fetch(supplier.url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Local simulation');
    await expect(readFile(output)).rejects.toThrow();
    expect(
      (
        await fetch(supplier.url + '/quote', {
          method: 'POST',
          headers: { Origin: 'https://example.com' },
        })
      ).status,
    ).toBe(403);
    await expect(readFile(output)).rejects.toThrow();
    const request = () =>
      fetch(supplier.url + '/quote', {
        method: 'POST',
        headers: { Origin: new URL(supplier.url).origin },
        body: '{}',
      });
    const reply = await (await request()).json();
    const saved = JSON.parse(await readFile(output, 'utf8'));
    expect(saved).toEqual(reply.quote);
    expect(saved.attachment).toMatchObject({
      name: 'plate.dxf',
      widthMm: 120,
      heightMm: 80,
      sha256: createHash('sha256').update(content).digest('hex'),
    });
    expect(saved.options).toEqual([
      { id: 'economy', label: 'Economy', total: 40, deliveryDays: 7 },
      { id: 'express', label: 'Express', total: 65, deliveryDays: 2 },
    ]);
    expect((await request()).status).toBe(200);
    await writeFile(drawing, content.replace('120', '140'));
    expect((await request()).status).toBe(409);
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(saved);
  } finally {
    await supplier.close();
  }
});
