import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Parser, extract, type ReadEntry } from 'tar';

const maximumEntries = 20_000;
const maximumEntryBytes = 16 * 1024 * 1024;
const maximumExpandedBytes = 512 * 1024 * 1024;

/** Validate the complete archive before allowing its first filesystem write. */
export async function inspectHeaderArchive(archive: string): Promise<Set<string>> {
  const selected = new Set<string>();
  const names = new Set<string>();
  const files = new Set<string>();
  const parents = new Set<string>();
  let entries = 0;
  let expanded = 0;
  let root: string | undefined;
  const parser = new Parser({ strict: true, maxDecompressionRatio: 1000 });
  function inspect(entry: ReadEntry): void {
    const name = entry.path.replace(/\/$/, '');
    const parts = name.split('/');
    if (
      name.length > 1024 ||
      /[\u0000-\u001f\u007f\\:]/.test(name) ||
      path.posix.isAbsolute(name) ||
      parts.some((part) => !part || part === '.' || part === '..') ||
      (entry.type !== 'File' && entry.type !== 'Directory') ||
      !!entry.linkpath
    )
      throw new Error(`Unsafe Electron header archive entry: ${entry.path}`);
    if (root && root !== parts[0]) throw new Error('Electron headers need one archive root.');
    root ??= parts[0];
    const identity = name.normalize('NFC').toLowerCase();
    if (names.has(identity)) throw new Error(`Duplicate Electron header archive entry: ${name}`);
    const components = identity.split('/');
    for (let count = 1; count < components.length; count++) {
      const parent = components.slice(0, count).join('/');
      if (files.has(parent))
        throw new Error(`A header archive file is also a directory: ${parent}`);
      parents.add(parent);
    }
    if (entry.type === 'File') {
      if (parents.has(identity))
        throw new Error(`A header archive file is also a directory: ${name}`);
      files.add(identity);
    }
    names.add(identity);
    entries++;
    expanded += entry.size;
    if (
      entries > maximumEntries ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      entry.size > maximumEntryBytes ||
      expanded > maximumExpandedBytes
    )
      throw new Error('Electron header archive exceeds the supported extraction limits.');
    if (
      entry.type === 'File' &&
      parts[1] === 'include' &&
      parts[2] === 'node' &&
      /\.(h|gypi)$/.test(name)
    )
      selected.add(entry.path);
  }
  await new Promise<void>((resolve, reject) => {
    const input = createReadStream(archive);
    input.once('error', reject);
    parser.once('error', (error) => {
      input.destroy();
      reject(error);
    });
    parser.once('end', resolve);
    parser.on('entry', (entry: ReadEntry) => {
      try {
        inspect(entry);
      } catch (error) {
        parser.abort(error as Error);
      }
      entry.resume();
    });
    input.pipe(parser);
  });
  if (selected.size === 0) throw new Error('Electron header archive contains no native headers.');
  return selected;
}

/** The destination must have been exclusively created and must still be empty. */
export async function extractHeaderArchive(
  archive: string,
  destination: string,
  selected: ReadonlySet<string>,
): Promise<void> {
  await extract({
    file: archive,
    cwd: destination,
    strip: 1,
    strict: true,
    noMtime: true,
    preserveOwner: false,
    keep: true,
    filter: (name) => selected.has(name),
  });
}
