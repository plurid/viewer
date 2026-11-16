import { Readable } from 'node:stream';
import type { Source } from './derived';
import type { ByteSection } from '../../domain/previews/documents/postscript';

/** A held descriptor supplies only its validated section, with backpressure and no disk copy. */
export function previewInput(source: Source, section: ByteSection, signal: AbortSignal): Readable {
  const { offset, length } = section;
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 1 ||
    offset > source.info.size ||
    length > source.info.size - offset
  )
    throw new Error('This preview section lies outside its source.');
  signal.throwIfAborted();
  return Readable.from(
    (async function* () {
      for (let read = 0; read < length;) {
        signal.throwIfAborted();
        const chunk = Buffer.alloc(Math.min(1024 * 1024, length - read));
        const { bytesRead } = await source.handle.read(chunk, 0, chunk.length, offset + read);
        if (!bytesRead) throw new Error('The preview source changed while reading.');
        read += bytesRead;
        yield chunk.subarray(0, bytesRead);
      }
    })(),
  );
}

export async function previewBytes(
  source: Source,
  section: ByteSection,
  signal: AbortSignal,
): Promise<Buffer> {
  if (section.length > 32 * 1024 * 1024) throw new Error('The embedded picture exceeds 32 MiB.');
  const chunks: Buffer[] = [];
  for await (const chunk of previewInput(source, section, signal)) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks, section.length);
}
