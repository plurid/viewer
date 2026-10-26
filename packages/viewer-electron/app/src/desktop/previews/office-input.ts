import type { Source } from './derived';
import { officeInputLimit } from './office-runtime-manifest';

/** Read only the captured size, even if another application grows the file.
 * DerivedPreviews rechecks its exact source version before publishing output. */
export async function officeInput(source: Source, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  if (!source.info.isFile() || source.info.size > officeInputLimit)
    throw new Error('Office layout previews support regular files up to 64 MB.');
  const data = Buffer.alloc(source.info.size);
  let offset = 0;
  while (offset < data.length) {
    signal.throwIfAborted();
    const { bytesRead } = await source.handle.read(
      data,
      offset,
      Math.min(1024 * 1024, data.length - offset),
      offset,
    );
    if (!bytesRead) throw new Error('The source changed while opening its Office layout.');
    offset += bytesRead;
  }
  signal.throwIfAborted();
  return data;
}
