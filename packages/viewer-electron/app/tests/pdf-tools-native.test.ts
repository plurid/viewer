import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { temporaryRoot } from '../tools/temporary';
import { workbenchPDF } from './pdf-fixtures';
import { validateTransform } from '../src/domain/operations/transforms';
import { Transforms } from '../src/desktop/transforms/transforms';
import { transformImage } from '../src/desktop/transforms/image';
import { runProcessor } from '../src/desktop/transforms/process';

const rootProcessors = path.resolve(
  'assets',
  `viewer-processors-${process.platform}-${process.arch}`,
);
const qpdf = path.resolve(
  'assets',
  `viewer-optimizers-${process.platform}-${process.arch}`,
  'qpdf',
);
const signal = () => new AbortController().signal;
const inspect = async (file: string) =>
  JSON.parse(
    (
      await runProcessor(
        qpdf,
        [
          '--json=2',
          '--json-key=pages',
          '--json-key=qpdf',
          '--json-stream-data=inline',
          '--decode-level=none',
          file,
        ],
        [],
        signal(),
        { outputLimit: 16 * 1024 * 1024 },
      )
    ).toString(),
  );

it('merges, extracts, reorders, rotates and splits searchable pages without changing either source', async () => {
  const root = await temporaryRoot('viewer-pdf-pages-'),
    files = [path.join(root, 'First.pdf'), path.join(root, 'Second.pdf')];
  const originals = [workbenchPDF(['Alpha', 'Beta', 'Gamma']), workbenchPDF(['Delta', 'Epsilon'])];
  for (const [index, file] of files.entries())
    await writeFile(file, originals[index]!, { flag: 'wx' });
  const transforms = new Transforms(
    rootProcessors,
    async () => {},
    (bytes, plan) => transformImage(rootProcessors, bytes, plan),
  );
  try {
    expect(await transforms.pdfInspect(files[0]!)).toEqual({ pages: 3 });
    const output = path.join(root, 'Assembly.pdf');
    await transforms.execute(
      validateTransform(
        {
          kind: 'pdf-pages',
          format: 'pdf',
          pages: [
            { source: 1, page: 2, rotate: 90 },
            { source: 0, page: 3 },
            { source: 0, page: 1, rotate: 270 },
          ],
        },
        2,
      ),
      files,
      output,
      signal(),
      () => {},
    );
    const data = await inspect(output);
    expect(data.pages).toHaveLength(3);
    const values = data.qpdf[1];
    expect(
      data.pages.map(
        (page: { object: string }) => values['obj:' + page.object].value['/Rotate'] || 0,
      ),
    ).toEqual([90, 0, 270]);
    const text = data.pages.map((page: { contents: string[] }) =>
      page.contents
        .map((ref) => Buffer.from(values['obj:' + ref].stream.data, 'base64').toString())
        .join(''),
    );
    // Stream text extraction is separately checked with qpdf generalized decoding below.
    expect(text).toHaveLength(3);
    const expanded = await runProcessor(
      qpdf,
      ['--qdf', '--object-streams=disable', '--stream-data=uncompress', output, '-'],
      [],
      signal(),
    );
    expect(expanded.toString()).toContain('(Epsilon)');
    expect(expanded.toString()).not.toContain('(Beta)');
    for (const page of [1, 2, 3])
      await transforms.execute(
        validateTransform({ kind: 'pdf-pages', format: 'pdf', pages: [{ source: 0, page }] }, 1),
        [files[0]!],
        path.join(root, `Page ${page}.pdf`),
        signal(),
        () => {},
      );
    await expect(
      transforms.execute(
        validateTransform({ kind: 'pdf-pages', format: 'pdf', pages: [{ source: 0, page: 4 }] }, 1),
        [files[0]!],
        path.join(root, 'Outside.pdf'),
        signal(),
        () => {},
      ),
    ).rejects.toThrow('outside');
    for (const [index, file] of files.entries())
      expect(await readFile(file)).toEqual(originals[index]);
  } finally {
    await transforms.quiesce();
  }
  console.warn('Retained PDF pages:', root);
});

it('recompresses an existing JPEG scan while preserving page geometry, text and vector operators', async () => {
  const sharp = createRequire(import.meta.url)(path.join(rootProcessors, 'node_modules/sharp'));
  const root = await temporaryRoot('viewer-pdf-scan-');
  const width = 2400,
    height = 3200;
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = ((i * 17) ^ (i >> 10)) & 255;
  const bytes = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 99 })
    .toBuffer();
  const original = workbenchPDF(['Searchable scan'], { bytes, width, height }),
    source = path.join(root, 'Scan.pdf'),
    output = path.join(root, 'Compact.pdf');
  await writeFile(source, original, { flag: 'wx' });
  const transforms = new Transforms(
    rootProcessors,
    async () => {},
    (bytes, plan) => transformImage(rootProcessors, bytes, plan),
  );
  try {
    // Decode through the bundled libjpeg as well as our Sharp scan rewrite. A
    // header/static-library ABI mismatch previously hid behind text-only PDFs.
    await transforms.execute(
      validateTransform({ kind: 'pdf', format: 'pdf', preset: 'balanced' }, 1),
      [source],
      path.join(root, 'Balanced.pdf'),
      signal(),
      () => {},
    );
    const result = await transforms.execute(
      validateTransform(
        { kind: 'pdf', format: 'pdf', preset: 'small', recompressImages: true, maxImageEdge: 1600 },
        1,
      ),
      [source],
      output,
      signal(),
      () => {},
    );
    expect(result!.outputBytes).toBeLessThan(original.length / 2);
    const data = await inspect(output);
    const image = Object.values(
      data.qpdf[1] as Record<string, { stream?: { dict: Record<string, unknown> } }>,
    ).find((value) => value.stream?.dict['/Subtype'] === '/Image')!;
    expect(image.stream!.dict['/Height']).toBe(1600);
    expect(image.stream!.dict['/Width']).toBe(1200);
    const expanded = await runProcessor(
      qpdf,
      ['--qdf', '--object-streams=disable', '--stream-data=uncompress', output, '-'],
      [],
      signal(),
      { outputLimit: 16 * 1024 * 1024 },
    );
    expect(expanded.toString()).toContain('(Searchable scan)');
    expect(expanded.toString()).toContain('10 10 80 40 re S');
    expect(expanded.toString()).toContain('/MediaBox [');
    expect(await readFile(source)).toEqual(original);
  } finally {
    await transforms.quiesce();
  }
  console.warn('Retained PDF scan:', root);
}, 30000);
