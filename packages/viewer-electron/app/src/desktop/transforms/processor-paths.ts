import path from 'node:path';

/** Optimizers are siblings of the media processors. Only the bundle directory
 * name changes; an installation path can contain the same text in its parents. */
export function optimizerDirectory(processorDirectory: string): string {
  return path.join(
    path.dirname(processorDirectory),
    path.basename(processorDirectory).replace(/^viewer-processors-/, 'viewer-optimizers-'),
  );
}
