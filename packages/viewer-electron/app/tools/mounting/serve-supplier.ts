import path from 'node:path';
import { startSupplier } from './supplier';
import { temporaryRoot } from '../temporary';

const [drawing, material, thickness, quantity = '1'] = process.argv.slice(2);
if (!drawing || !material || !thickness)
  throw new Error('Usage: serve-supplier.ts DRAWING.dxf MATERIAL THICKNESS_MM [QUANTITY]');
const root = await temporaryRoot('viewer-supplier-');
const output = path.join(root, 'supplier-reply.json');
const supplier = await startSupplier({
  drawing: path.resolve(drawing),
  output,
  material,
  thicknessMm: Number(thickness),
  quantity: Number(quantity),
});
console.log(JSON.stringify({ url: supplier.url, reply: output, simulation: true }, null, 2));
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void supplier.close();
  });
