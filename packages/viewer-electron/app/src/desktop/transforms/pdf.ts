import { open, type FileHandle } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  imageTransformSchema,
  type ImageTransform,
  type TransformPlan,
} from '../../domain/operations/transforms';
import { jpegMetadata } from './jpeg-metadata';
import { runProcessor as nativeProcessor } from './process';

const runProcessor: typeof nativeProcessor = (...args) =>
  nativeProcessor(...args).catch((error: Error) => {
    throw new Error(error.message.replace(/\bMedia\b/g, 'PDF'));
  });

interface PDFSource {
  file: string;
  handle: FileHandle;
  size: number;
}
const dictionary = z.record(z.string(), z.unknown());
const pdfJSON = z.object({
  pages: z
    .array(z.object({ object: z.string() }))
    .min(1)
    .max(10000),
  encrypt: z.object({ encrypted: z.boolean() }),
  qpdf: z.tuple([
    dictionary,
    z.record(
      z.string(),
      z.object({
        value: z.unknown().optional(),
        stream: z.object({ dict: dictionary }).optional(),
      }),
    ),
  ]),
});
type PDFJSON = z.infer<typeof pdfJSON>;
const limits = [
  '--global',
  '--max-stream-filters=8',
  '--parser-max-nesting=128',
  '--',
  '--suppress-recovery',
];
const compression = [
  '--compress-streams=y',
  '--decode-level=generalized',
  '--recompress-flate',
  '--compression-level=9',
  '--object-streams=generate',
  '--remove-unreferenced-resources=yes',
];
export const pdfProcessor = (root: string) =>
  path.join(root.replace('viewer-processors-', 'viewer-optimizers-'), 'qpdf');

/** Inspect the held source, including compressed signature dictionaries. No passwords,
 * file paths from PDF objects, scripts or arbitrary processor arguments are followed. */
export async function inspectPDF(
  executable: string,
  source: PDFSource,
  signal: AbortSignal,
): Promise<PDFJSON> {
  if (path.extname(source.file).toLowerCase() !== '.pdf' || source.size > 256 * 1024 * 1024)
    throw new Error('Choose a PDF no larger than 256 MB.');
  const header = Buffer.alloc(1024);
  await source.handle.read(header, 0, header.length, 0);
  if (!header.toString('latin1').includes('%PDF-')) throw new Error('The source is not a PDF.');
  const bytes = await runProcessor(
    executable,
    [
      ...limits,
      '--json=2',
      '--json-key=pages',
      '--json-key=encrypt',
      '--json-key=qpdf',
      '--decode-level=none',
      '/dev/fd/3',
    ],
    [source.handle.fd],
    signal,
    { timeout: 30000, outputLimit: 16 * 1024 * 1024 },
  );
  const value = pdfJSON.parse(JSON.parse(bytes.toString('utf8')));
  if (value.encrypt.encrypted)
    throw new Error('Encrypted PDFs stay unchanged. Use an unlocked copy.');
  if (bytes.includes(Buffer.from('"/ByteRange"')) || bytes.includes(Buffer.from('"/Sig"')))
    throw new Error('Signed PDFs are kept unchanged. Use an unsigned copy instead.');
  // Retain the conservative raw check for malformed or unreferenced signature content.
  const chunk = Buffer.alloc(65536);
  let tail = '';
  for (let position = 0; position < source.size; position += chunk.length) {
    signal.throwIfAborted();
    const { bytesRead } = await source.handle.read(chunk, 0, chunk.length, position);
    const text = tail + chunk.toString('latin1', 0, bytesRead);
    if (
      text
        .replace(/#([\da-f]{2})/gi, (_all, hex: string) => String.fromCharCode(parseInt(hex, 16)))
        .includes('/ByteRange')
    )
      throw new Error('Signed PDFs are kept unchanged. Use an unsigned copy instead.');
    tail = text.slice(-64);
  }
  return value;
}

/** JPEG dimensions are read from its frame header, never guessed from a PDF dictionary. */
export function jpegFrame(
  bytes: Buffer,
): { width: number; height: number; components: number } | undefined {
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8) return;
  for (let offset = 2; offset + 4 < bytes.length;) {
    if (bytes[offset++] !== 0xff) return;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++]!;
    if (marker === 0xda || marker === 0xd9) return;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return;
    if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8 && bytes[offset + 2] === 8)
      return {
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
        components: bytes[offset + 7]!,
      };
    offset += length;
  }
}

async function scanUpdates(
  executable: string,
  source: PDFSource,
  document: PDFJSON,
  plan: Extract<TransformPlan, { kind: 'pdf' }>,
  image: (bytes: Buffer, plan: ImageTransform, signal: AbortSignal) => Promise<Buffer>,
  signal: AbortSignal,
  progress: (fraction: number, detail: string) => void,
): Promise<Buffer | undefined> {
  const updates: Record<string, unknown> = {};
  const candidates = Object.entries(document.qpdf[1]).filter(([, value]) => {
    const dict = value.stream?.dict;
    return (
      dict?.['/Subtype'] === '/Image' &&
      dict['/Filter'] === '/DCTDecode' &&
      ['/DeviceRGB', '/DeviceGray'].includes(String(dict['/ColorSpace'])) &&
      dict['/BitsPerComponent'] === 8 &&
      ![
        '/Decode',
        '/DecodeParms',
        '/Mask',
        '/SMask',
        '/ImageMask',
        '/Alternates',
        '/SMaskInData',
      ].some((key) => key in dict)
    );
  });
  if (candidates.length > 500)
    throw new Error('Scan recompression supports up to 500 compatible JPEG images per PDF.');
  let cost = 0;
  for (const [index, [key, object]] of candidates.entries()) {
    signal.throwIfAborted();
    const match = /^obj:(\d+) (\d+) R$/.exec(key);
    if (!match) continue;
    progress(
      0.1 + (0.7 * index) / candidates.length,
      `Recompressing scan ${index + 1} of ${candidates.length}`,
    );
    const bytes = await runProcessor(
      executable,
      [...limits, `--show-object=${match[1]},${match[2]}`, '--raw-stream-data', '/dev/fd/3'],
      [source.handle.fd],
      signal,
      { timeout: 30000, outputLimit: 32 * 1024 * 1024 },
    );
    const frame = bytes.length > 10 ? jpegFrame(bytes) : undefined;
    const dict = object.stream!.dict;
    if (
      !frame ||
      ![1, 3].includes(frame.components) ||
      frame.width !== dict['/Width'] ||
      frame.height !== dict['/Height']
    )
      continue;
    const encoded = await image(
      jpegMetadata(bytes, 'strip'),
      imageTransformSchema.parse({
        kind: 'image',
        format: 'jpeg',
        quality: plan.preset === 'small' ? 65 : 85,
        width: plan.maxImageEdge,
        height: plan.maxImageEdge,
        metadata: 'strip',
        optimize: true,
      }),
      signal,
    );
    const next = encoded.length > 10 ? jpegFrame(encoded) : undefined;
    if (!next || ![1, 3].includes(next.components) || encoded.length >= bytes.length) continue;
    cost += encoded.length;
    if (cost > 48 * 1024 * 1024)
      throw new Error(
        'The PDF image update exceeds its 48 MB working limit. Try structural optimization instead.',
      );
    updates[key] = {
      stream: {
        dict: {
          ...dict,
          '/Width': next.width,
          '/Height': next.height,
          '/ColorSpace': next.components === 1 ? '/DeviceGray' : '/DeviceRGB',
        },
        data: encoded.toString('base64'),
      },
    };
  }
  return Object.keys(updates).length
    ? Buffer.from(JSON.stringify({ qpdf: [document.qpdf[0], updates] }))
    : undefined;
}

export async function transformPDF(
  executable: string,
  sources: PDFSource[],
  plan: Extract<TransformPlan, { kind: 'pdf' | 'pdf-pages' }>,
  output: string,
  image: (bytes: Buffer, plan: ImageTransform, signal: AbortSignal) => Promise<Buffer>,
  signal: AbortSignal,
  progress: (fraction: number, detail: string) => void,
): Promise<void | { inputBytes: number; outputBytes: number }> {
  signal = AbortSignal.any([signal, AbortSignal.timeout(180000)]);
  if (sources.reduce((sum, source) => sum + source.size, 0) > 512 * 1024 * 1024)
    throw new Error('PDF sources may total at most 512 MB.');
  if (plan.kind === 'pdf' && sources.length !== 1) throw new Error('Optimize one PDF per output.');
  progress(0, 'Inspecting PDF sources');
  const documents: PDFJSON[] = [];
  for (const source of sources) documents.push(await inspectPDF(executable, source, signal));
  const target = await open(output, 'wx+', 0o644);
  try {
    if (plan.kind === 'pdf-pages') {
      if (plan.pages.some((page) => page.page > documents[page.source]!.pages.length))
        throw new Error('A selected page is outside its source PDF. Inspect the source again.');
      const args = [...limits, ...compression, '--empty', '--pages'];
      for (const page of plan.pages)
        args.push(`--file=/dev/fd/${3 + page.source}`, `--range=${page.page}`);
      args.push('--');
      for (const angle of [90, 180, 270]) {
        const pages = plan.pages.flatMap((page, index) =>
          page.rotate === angle ? [index + 1] : [],
        );
        if (pages.length) args.push(`--rotate=+${angle}:${pages.join(',')}`);
      }
      args.push(`/dev/fd/${3 + sources.length}`);
      progress(0.4, 'Assembling PDF pages');
      await runProcessor(
        executable,
        args,
        [...sources.map((source) => source.handle.fd), target.fd],
        signal,
        { timeout: 120000 },
      );
    } else {
      const patch = plan.recompressImages
        ? await scanUpdates(executable, sources[0]!, documents[0]!, plan, image, signal, progress)
        : undefined;
      const args = [
        ...limits,
        ...compression,
        ...(plan.preset === 'lossless' || patch
          ? []
          : ['--optimize-images', `--jpeg-quality=${plan.preset === 'small' ? 65 : 85}`]),
        '/dev/fd/3',
      ];
      progress(0.85, 'Writing compact PDF');
      if (patch) {
        // Reuse the private operation staging file for the seekable JSON update. qpdf
        // needs seeks, so a pipe is insufficient. No extra scratch file or removal.
        await target.writeFile(patch);
        const reader = await open(
          output,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        let bytes: Buffer;
        try {
          const [written, read] = await Promise.all([target.stat(), reader.stat()]);
          if (
            !read.isFile() ||
            written.dev !== read.dev ||
            written.ino !== read.ino ||
            written.size !== read.size
          )
            throw new Error('The private PDF staging file changed. Export again.');
          bytes = await runProcessor(
            executable,
            [...args, '--update-from-json=/dev/fd/4', '-'],
            [sources[0]!.handle.fd, reader.fd],
            signal,
            { timeout: 120000, outputLimit: 256 * 1024 * 1024 },
          );
        } finally {
          await reader.close();
        }
        signal.throwIfAborted();
        await target.truncate(0);
        for (let offset = 0; offset < bytes.length;) {
          const { bytesWritten } = await target.write(bytes, offset, bytes.length - offset, offset);
          if (!bytesWritten)
            throw new Error('The compact PDF could not be written. Try another destination.');
          offset += bytesWritten;
        }
      } else
        await runProcessor(
          executable,
          [...args, '/dev/fd/4'],
          [sources[0]!.handle.fd, target.fd],
          signal,
          { timeout: 120000 },
        );
    }
    await target.sync();
    progress(1, 'PDF ready');
    if (plan.kind === 'pdf')
      return { inputBytes: sources[0]!.size, outputBytes: (await target.stat()).size };
  } finally {
    await target.close();
  }
}
