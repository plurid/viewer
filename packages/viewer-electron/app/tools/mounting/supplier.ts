import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { prepareCanvasDrawing } from '../../src/domain/canvases/drawing';
import { supplierPage } from './supplier-page';

export interface SupplierRequest {
  drawing: string;
  output: string;
  material: string;
  thicknessMm: number;
  quantity: number;
}

async function readDrawing(file: string) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > 1_000_000)
      throw new Error('Choose a DXF file within 1 MB.');
    const bytes = Buffer.alloc(before.size + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const after = await handle.stat();
    if (bytesRead !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs)
      throw new Error('The drawing changed while being read. Start a new quote.');
    const content = bytes.subarray(0, bytesRead);
    return {
      content: content.toString('utf8'),
      sha256: createHash('sha256').update(content).digest('hex'),
      bytes: bytesRead,
    };
  } finally {
    await handle.close();
  }
}

/** Local rehearsal supplier. It has no workshop credentials, ordering route or external requests. */
export async function startSupplier(request: SupplierRequest) {
  const material = request.material.trim();
  if (
    !material ||
    material.length > 80 ||
    /[\x00-\x1f]/.test(material) ||
    !Number.isFinite(request.thicknessMm) ||
    request.thicknessMm <= 0 ||
    request.thicknessMm > 100 ||
    !Number.isSafeInteger(request.quantity) ||
    request.quantity < 1 ||
    request.quantity > 1000
  )
    throw new Error(
      'Specify a material, thickness from 0 to 100 mm, and quantity from 1 to 1,000.',
    );
  const source = await readDrawing(request.drawing);
  const { measurement, drawing } = prepareCanvasDrawing(source.content);
  const attachment = {
    name: path.basename(request.drawing),
    sha256: source.sha256,
    bytes: source.bytes,
    widthMm: measurement.width,
    heightMm: measurement.height,
    holes: measurement.holes.length,
  };
  const stock = { material, thicknessMm: request.thicknessMm, quantity: request.quantity };
  const quote = {
    version: 1,
    simulation: true,
    supplier: 'Demo cutting service',
    attachment,
    stock,
    currency: 'EUR',
    totalsInclude: ['cutting', 'delivery', 'tax'],
    options: [
      { id: 'economy', label: 'Economy', total: 40, deliveryDays: 7 },
      { id: 'express', label: 'Express', total: 65, deliveryDays: 2 },
    ],
  };
  const route = '/' + randomUUID();
  let url = '';
  let saved: Promise<void> | undefined;
  const html = supplierPage({ attachment, stock, drawing });
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    const reply = (status: number, data: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    };
    if (req.headers.host !== new URL(url).host)
      return reply(403, { error: 'Use the local demo URL.' });
    if (req.method === 'GET' && req.url === route) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (req.method !== 'POST' || req.url !== route + '/quote')
      return reply(404, { error: 'Not found.' });
    if (req.headers.origin !== new URL(url).origin)
      return reply(403, { error: 'Request a quote from the demo page.' });
    let length = 0;
    try {
      for await (const chunk of req) {
        length += Buffer.byteLength(chunk);
        if (length > 1024) return reply(413, { error: 'The request is too large.' });
      }
      const current = await readDrawing(request.drawing);
      if (current.sha256 !== attachment.sha256)
        return reply(409, {
          error: 'The drawing changed. Start a new quote for the revised file.',
        });
      saved ??= writeFile(request.output, JSON.stringify(quote, null, 2) + '\n', {
        flag: 'wx',
        mode: 0o600,
      });
      await saved;
      reply(200, { quote, file: path.basename(request.output) });
    } catch {
      reply(409, {
        error: 'The quote could not be saved. Check the drawing and choose a new output file.',
      });
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.maxConnections = 8;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The local supplier did not start.');
  url = `http://127.0.0.1:${address.port}${route}`;
  return {
    url,
    attachment,
    quote,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
