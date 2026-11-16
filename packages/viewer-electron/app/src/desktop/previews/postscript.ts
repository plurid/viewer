import type { Source } from './derived';
import type { EPSHeader, PostScriptInspection } from '../../domain/previews/documents/postscript';
import {
  decodeEPSI,
  epsHeader,
  epsiBMP,
  inspectPostScript,
  EPSIPreviewLimitError,
} from '../../domain/previews/documents/postscript';
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
  const document = { ...inspectPostScript(bytes, extension), wmf: !!header?.wmf };
  if (header && document.pdf)
    throw new Error('This EPS PostScript section is malformed; its bytes are shown below.');
  if (header && document.kind !== 'Illustrator') document.kind = 'Encapsulated PostScript';
  const truncated = section.length > length;
  document.source.truncated = truncated;
  document.limited = truncated;
  let bitmap: Buffer | undefined;
  try {
    const epsi = document.pdf ? undefined : decodeEPSI(bytes, truncated);
    if (epsi) bitmap = Buffer.from(epsiBMP(epsi));
  } catch (error) {
    if (!(error instanceof EPSIPreviewLimitError)) throw error;
    document.previewMessage = error.message;
  }
  signal.throwIfAborted();
  return { document, header, bitmap };
}
