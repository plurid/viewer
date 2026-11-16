import { open } from 'node:fs/promises';
import os from 'node:os';
import { privateStage } from '../operations/staging';
import type { Source } from './derived';
import type { ByteSection } from '../../domain/previews/documents/postscript';

export interface PreviewCopyOptions {
  directory?: string;
  trash?(file: string): Promise<unknown>;
}

/** Private copies reuse the transfer owner's identity checks and Trash recovery. */
export async function withPreviewCopy<T>(
  source: Source,
  section: ByteSection,
  signal: AbortSignal,
  options: PreviewCopyOptions,
  read: (file: string) => Promise<T>,
): Promise<T> {
  const { offset, length } = section;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) ||
    offset < 0 || length < 1 || offset > source.info.size || length > source.info.size - offset)
    throw new Error('This preview section lies outside its source.');
  signal.throwIfAborted();
  const stage = await privateStage(options.directory ?? os.tmpdir(), 'viewer-preview-', options.trash, true);
  try {
    const output = await open(stage.file, 'wx', 0o600);
    try {
      const chunk = Buffer.alloc(Math.min(length, 1024 * 1024));
      for (let copied = 0; copied < length;) {
        signal.throwIfAborted();
        const { bytesRead } = await source.handle.read(chunk, 0, Math.min(chunk.length, length - copied), offset + copied);
        if (!bytesRead) throw new Error('The preview source changed while copying.');
        let written = 0;
        while (written < bytesRead) {
          const result = await output.write(chunk, written, bytesRead - written, copied + written);
          if (!result.bytesWritten) throw new Error('The preview copy could not be written.');
          written += result.bytesWritten;
        }
        copied += bytesRead;
      }
    } finally {
      await output.close();
    }
    signal.throwIfAborted();
    return await read(stage.file);
  } finally {
    await stage.dispose();
  }
}
