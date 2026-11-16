import type { Source } from './derived';
import type { EPSHeader, PostScriptInspection } from '../../domain/previews/documents/postscript';
import { epsHeader, epsiBMP, postscriptContent } from '../../domain/previews/documents/postscript';
import { previewTextLimit } from '../../domain/files/read-limits';

export interface InspectedPostScript {
  document: PostScriptInspection;
  header?: EPSHeader;
  bitmap?: Buffer;
}

export async function readPostScript(
  source: Source,
  extension: string,
  signal: AbortSignal,
): Promise<InspectedPostScript> {
  signal.throwIfAborted();
  const prefix = Buffer.alloc(Math.min(30, source.info.size));
  await source.handle.read(prefix, 0, prefix.length, 0);
  const header = epsHeader(prefix, source.info.size);
  const section = header?.postscript ?? { offset: 0, length: source.info.size };
  const length = Math.min(section.length, previewTextLimit);
  const bytes = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    signal.throwIfAborted();
    const { bytesRead } = await source.handle.read(
      bytes,
      read,
      length - read,
      section.offset + read,
    );
    if (!bytesRead) throw new Error('This PostScript file changed while opening.');
    read += bytesRead;
  }
  const truncated = section.length > length;
  const content = postscriptContent(bytes, extension, truncated, !!header);
  const document = { ...content.document, wmf: !!header?.wmf };
  if (header && document.pdf)
    throw new Error('This EPS PostScript section is malformed; its bytes are shown below.');
  if (header && document.kind !== 'Illustrator') document.kind = 'Encapsulated PostScript';
  const bitmap = content.bitmap ? Buffer.from(epsiBMP(content.bitmap)) : undefined;
  signal.throwIfAborted();
  return { document, header, bitmap };
}
