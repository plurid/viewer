import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { FileResult } from './types';

const markerName = '.viewer-playground.json';
const marker = '{"kind":"viewer-playground","version":1}\n';
export const maximumSampleBytes = 64 * 1024 * 1024;
export const sha256 = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/** Components are checked individually: mkdir({recursive:true}) would follow links. */
async function ordinaryDirectory(directory: string): Promise<void> {
  const parent = path.dirname(directory);
  if (parent !== directory) await ordinaryDirectory(parent);
  try {
    await mkdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error(`Expected an ordinary directory: ${directory}`);
}

export async function openPlayground(directory: string): Promise<PlaygroundFiles> {
  if (!path.isAbsolute(directory)) throw new Error('Use an absolute playground directory.');
  // Resolve existing parent aliases (not a linked destination), including macOS /tmp.
  const requested = path.resolve(directory);
  let parent = path.dirname(requested);
  const suffix = [path.basename(requested)];
  while (true) {
    try {
      parent = await realpath(parent);
      break;
    } catch (error) {
      if (!missing(error)) throw error;
      suffix.unshift(path.basename(parent));
      parent = path.dirname(parent);
    }
  }
  const root = path.join(parent, ...suffix);
  let created = false;
  await ordinaryDirectory(path.dirname(root));
  try {
    await mkdir(root);
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error(`The playground destination is not an ordinary directory: ${root}`);
  const files = new PlaygroundFiles(root, `${info.dev}:${info.ino}`);
  if (created) await files.put(markerName, marker);
  const existing = await files.read(markerName);
  if (existing?.toString() !== marker)
    throw new Error(`Existing folder has no recognized playground marker; preserved: ${root}`);
  return files;
}

/** Additive writer. Existing files are inspected, never replaced or removed. */
export class PlaygroundFiles {
  constructor(
    readonly root: string,
    private readonly identity: string,
  ) {}

  private resolve(relative: string): string {
    if (
      !relative ||
      relative.includes('\\') ||
      relative.includes('\0') ||
      path.isAbsolute(relative) ||
      relative.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw new Error(`Invalid playground-relative path: ${relative}`);
    return path.join(this.root, relative);
  }

  private async checkRoot(): Promise<void> {
    const info = await lstat(this.root);
    if (!info.isDirectory() || info.isSymbolicLink() || `${info.dev}:${info.ino}` !== this.identity)
      throw new Error('The playground directory changed; preserved the replacement.');
  }

  private async parents(relative: string, create: boolean): Promise<string> {
    await this.checkRoot();
    const file = this.resolve(relative);
    let current = this.root;
    for (const component of relative.split('/').slice(0, -1)) {
      current = path.join(current, component);
      if (create) {
        try {
          await mkdir(current);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
      }
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error(`Refusing a linked or non-directory parent: ${current}`);
    }
    return file;
  }

  async read(relative: string): Promise<Buffer | undefined> {
    try {
      const file = await this.parents(relative, false);
      const handle = await open(
        file,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > maximumSampleBytes)
          throw new Error(`Expected a bounded regular sample: ${file}`);
        const bytes = Buffer.alloc(info.size + 1);
        let length = 0;
        while (length < bytes.length) {
          const result = await handle.read(bytes, length, bytes.length - length, length);
          if (result.bytesRead === 0) break;
          length += result.bytesRead;
        }
        const after = await handle.stat();
        if (length !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs)
          throw new Error(`Sample changed while it was being inspected: ${file}`);
        return bytes.subarray(0, length);
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
  }

  async inspect(relative: string, expectedSHA256: string): Promise<FileResult> {
    const existing = await this.read(relative);
    if (!existing) return { path: relative, state: 'missing', expectedSHA256 };
    const actualSHA256 = sha256(existing);
    return {
      path: relative,
      state: actualSHA256 === expectedSHA256 ? 'unchanged' : 'modified',
      expectedSHA256,
      actualSHA256,
    };
  }

  async put(relative: string, bytes: Uint8Array | string): Promise<FileResult> {
    const expectedSHA256 = sha256(bytes);
    const file = await this.parents(relative, true);
    let handle;
    try {
      handle = await open(
        file,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o644,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      return this.inspect(relative, expectedSHA256);
    }
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await this.checkRoot();
    return { path: relative, state: 'created', expectedSHA256 };
  }

  async reserveDirectory(relative: string): Promise<boolean> {
    const directory = await this.parents(relative, true);
    try {
      await mkdir(directory);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error(`Refusing a linked or non-directory scenario: ${directory}`);
      return false;
    }
  }
}

export async function assetBytes(name: string): Promise<Buffer> {
  return readFile(new URL(`./assets/${name}`, import.meta.url));
}
