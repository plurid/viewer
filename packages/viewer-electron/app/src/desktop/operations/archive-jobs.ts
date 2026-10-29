import { constants, type Stats } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { Archives, archiveFingerprint } from '../previews/archives';
import { fileCoordination } from '../files/file-coordination';

export interface ArchiveWork {
  signal: AbortSignal;
  access(files: readonly string[]): Promise<void>;
  progress(file: string, done: number, total: number): void;
}
const same = (before: Stats, after: Stats) =>
  before.dev === after.dev &&
  before.ino === after.ino &&
  before.ctimeMs === after.ctimeMs &&
  before.mtimeMs === after.mtimeMs &&
  before.size === after.size;
/** Portable names also avoid ambiguous case/Unicode collisions on macOS. */
function archiveName(name: string): string {
  if (
    !name ||
    name.includes('\0') ||
    name.includes('\\') ||
    name.startsWith('/') ||
    /^[a-z]:/i.test(name)
  )
    throw new Error('Unsafe archive path.');
  const parts = name.split('/').filter((part) => part && part !== '.');
  if (parts.some((part) => part === '..' || part.includes(':') || part.length > 255))
    throw new Error('Unsafe archive path.');
  return parts.join('/');
}
export async function createArchive(
  sources: readonly string[],
  target: string,
  work: ArchiveWork,
): Promise<void> {
  const entries: { file: string; name: string; info: Stats; children?: string[] }[] = [];
  const names = new Set<string>();
  let total = 0;
  const visit = async (file: string, name: string) => {
    work.signal.throwIfAborted();
    await work.access([file]);
    name = archiveName(name);
    const key = name.normalize('NFC').toLocaleLowerCase('en-US');
    if (!name || names.has(key))
      throw new Error('The selection has conflicting archive names. Choose files from one folder.');
    names.add(key);
    if (entries.length >= 20000) throw new Error('ZIP creation is limited to 20,000 entries.');
    const info = await lstat(file);
    if (!info.isDirectory() && !info.isFile())
      throw new Error(
        'ZIP creation supports regular files and folders. Links and special files were left untouched.',
      );
    const children = info.isDirectory() ? (await readdir(file)).sort() : undefined;
    entries.push({ file, name, info, children });
    total += info.isFile() ? info.size : 0;
    if (total > 2 * 1024 * 1024 * 1024) throw new Error('ZIP creation is limited to 2 GB.');
    for (const child of children ?? []) await visit(path.join(file, child), `${name}/${child}`);
  };
  for (const source of sources) await visit(source, path.basename(source));
  const output = await open(target, 'wx', 0o600);
  let writes = Promise.resolve(),
    done = 0;
  const zip = new Zip((error, data) => {
    writes = writes.then(async () => {
      if (error) throw error;
      work.signal.throwIfAborted();
      await output.writeFile(data);
    });
    void writes.catch(() => {});
  });
  try {
    for (const entry of entries) {
      work.signal.throwIfAborted();
      await work.access([entry.file]);
      const archiveEntry = async (signal?: AbortSignal) => {
        signal?.throwIfAborted();
        const actual = fileCoordination.path(entry.file);
        await work.access([actual]);
        if (entry.info.isFile()) {
          const hydrated = await lstat(actual);
          if (
            !hydrated.isFile() ||
            hydrated.dev !== entry.info.dev ||
            hydrated.ino !== entry.info.ino
          )
            throw new Error('A source changed while waiting for its file provider.');
          // Placeholder metadata is captured during traversal; hydrated length
          // and modification times are captured before the first content byte.
          total += hydrated.size - entry.info.size;
          if (total > 2 * 1024 * 1024 * 1024) throw new Error('ZIP creation is limited to 2 GB.');
          entry.info = hydrated;
        }
        const stream = entry.info.isDirectory()
          ? new ZipPassThrough(entry.name + '/')
          : new ZipDeflate(entry.name, { level: 1 });
        stream.os = 3;
        stream.attrs = (entry.info.mode & 0o777) << 16;
        stream.mtime = entry.info.mtime;
        zip.add(stream);
        if (entry.info.isDirectory()) stream.push(new Uint8Array(), true);
        else {
          const input = await open(
            actual,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
          );
          try {
            if (!same(entry.info, await input.stat()))
              throw new Error('A source changed before archiving.');
            const buffer = Buffer.allocUnsafe(64 * 1024);
            let offset = 0;
            while (offset < entry.info.size) {
              work.signal.throwIfAborted();
              signal?.throwIfAborted();
              const { bytesRead } = await input.read(
                buffer,
                0,
                Math.min(buffer.length, entry.info.size - offset),
                null,
              );
              if (!bytesRead) throw new Error('A source changed while archiving.');
              stream.push(buffer.subarray(0, bytesRead));
              await writes;
              offset += bytesRead;
              done += bytesRead;
              work.progress(entry.file, done, total);
            }
            stream.push(new Uint8Array(), true);
          } finally {
            await input.close();
          }
        }
        await writes;
        signal?.throwIfAborted();
      };
      if (entry.info.isDirectory()) await archiveEntry();
      else
        await fileCoordination.run([{ path: entry.file, mode: 'read' }], archiveEntry, work.signal);
    }
    for (const entry of entries) {
      if (
        !same(entry.info, await lstat(entry.file)) ||
        (entry.children &&
          JSON.stringify((await readdir(entry.file)).sort()) !== JSON.stringify(entry.children))
      )
        throw new Error(
          'A source changed while archiving. The original files were left untouched.',
        );
    }
    zip.end();
    await writes;
    await output.sync();
    await chmod(target, 0o644);
  } finally {
    zip.terminate();
    await writes.catch(() => {});
    await output.close();
  }
}
export async function extractArchive(
  source: string,
  target: string,
  work: ArchiveWork,
): Promise<void> {
  return fileCoordination.run(
    [{ path: source, mode: 'read' }],
    async (signal) => {
      signal?.throwIfAborted();
      await extractCoordinated(source, target, { ...work, signal: signal ?? work.signal });
      signal?.throwIfAborted();
    },
    work.signal,
  );
}
/** The macOS archiver's copies of resource forks: nothing a person extracts on purpose. */
const resourceForks = '__MACOSX';

/**
 * What an extraction writes, with names relative to the output folder. Most archives hold one
 * folder with everything inside, often named like the archive: its contents become the output,
 * so "Photos.zip" gives "Photos/…" and never "Photos/Photos/…".
 */
export function unwrapped<Entry extends { name: string; directory: boolean }>(
  entries: readonly Entry[],
): Entry[] {
  const kept = entries.filter(
    (entry) => entry.name !== resourceForks && !entry.name.startsWith(resourceForks + '/'),
  );
  const tops = new Set(kept.filter((entry) => entry.name).map((entry) => entry.name.split('/')[0]));
  const [single] = tops;
  if (tops.size !== 1 || !single) return kept;
  const folder = kept.every((entry) => entry.name !== single || entry.directory);
  const inside = kept.some((entry) => entry.name.startsWith(single + '/'));
  if (!folder || !inside) return kept;
  return kept
    .filter((entry) => entry.name !== single)
    .map((entry) => ({ ...entry, name: entry.name.slice(single.length + 1) }));
}
async function extractCoordinated(
  source: string,
  target: string,
  work: ArchiveWork,
): Promise<void> {
  await work.access([source]);
  const before = await archiveFingerprint(source),
    archives = new Archives();
  try {
    const entries = await archives.extractionEntries(source);
    const names = new Map<string, boolean>();
    const safe = entries.map((entry) => {
      const name = archiveName(entry.name),
        key = name.normalize('NFC').toLocaleLowerCase('en-US');
      if (!name && !entry.directory) throw new Error('Unsafe empty archive path.');
      if (name && names.has(key))
        throw new Error(
          'The archive has duplicate or conflicting file names. Nothing was extracted.',
        );
      if (name) names.set(key, entry.directory);
      return { ...entry, name, original: entry.name };
    });
    for (const entry of safe) {
      let parent = path.posix.dirname(entry.name);
      while (parent !== '.') {
        if (names.get(parent.normalize('NFC').toLocaleLowerCase('en-US')) === false)
          throw new Error('An archive file conflicts with a folder. Nothing was extracted.');
        parent = path.posix.dirname(parent);
      }
    }
    await mkdir(target, { mode: 0o700 });
    const extracted = unwrapped(safe);
    const total = extracted.reduce((sum, entry) => sum + entry.size, 0);
    let done = 0;
    for (const entry of extracted) {
      work.signal.throwIfAborted();
      await work.access([source]);
      if (!entry.name) continue;
      const file = path.join(target, entry.name);
      if (entry.directory) {
        await mkdir(file, { recursive: true, mode: 0o700 });
        continue;
      }
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const data = await archives.read(source, entry.original);
      work.signal.throwIfAborted();
      const output = await open(file, 'wx', 0o600);
      try {
        await output.writeFile(data);
        await output.sync();
      } finally {
        await output.close();
      }
      done += data.length;
      work.progress(source, done, total);
    }
    if ((await archiveFingerprint(source)) !== before)
      throw new Error('The archive changed during extraction. Retry with the current file.');
  } finally {
    archives.release(source);
  }
}
