import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { containsPath } from '../src/desktop/files/containment';
import { createArchive } from '../src/desktop/operations/archive-jobs';

interface DemoArchive {
  archive: string;
  checksum: string;
  staging: string;
  tools: string[];
  size: number;
  sha256: string;
}

async function existing(file: string) {
  try {
    return await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function outputLocation(directory: string): Promise<string> {
  try {
    return await realpath(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return path.join(await outputLocation(path.dirname(directory)), path.basename(directory));
  }
}

async function savedTools(source: string): Promise<string[]> {
  const tools: string[] = [];
  const visit = async (directory: string, included: boolean) => {
    for (const name of (await readdir(directory)).sort()) {
      const file = path.join(directory, name);
      const info = await lstat(file);
      if (info.isSymbolicLink()) throw new Error('The source must not contain symbolic links.');
      if (!info.isDirectory() && !info.isFile())
        throw new Error('The source must contain only regular files and folders.');
      const visible = included && !name.startsWith('.');
      // Hidden folders are inspected too: skipping them must not conceal a source link.
      if (info.isDirectory()) await visit(file, visible);
      else if (visible && name === 'canvas.viewer.json')
        tools.push(path.relative(source, directory) || path.basename(source));
    }
  };
  await visit(source, true);
  return tools;
}

export async function demoArchiveCommand(
  args: readonly string[],
  print: (message: string) => void = console.log,
): Promise<DemoArchive> {
  const [sourceArgument, outputArgument] = args;
  if (args.length !== 2 || !sourceArgument || !outputArgument)
    throw new Error('Give the absolute source folder and the absolute output folder.');
  if (!path.isAbsolute(sourceArgument) || !path.isAbsolute(outputArgument))
    throw new Error('The source and output paths must be absolute.');
  const sourcePath = path.resolve(sourceArgument);
  const info = await existing(sourcePath);
  if (info?.isSymbolicLink()) throw new Error('The source must not contain symbolic links.');
  if (!info?.isDirectory()) throw new Error('The source must be a folder.');
  const source = await realpath(sourcePath);
  const output = await outputLocation(path.resolve(outputArgument));
  if (containsPath(source, output))
    throw new Error('Choose an output folder outside the source folder.');
  const archive = path.join(output, 'Viewer-Demo.zip');
  const checksum = path.join(output, 'Viewer-Demo.sha256');
  for (const file of [archive, checksum]) {
    if (await existing(file))
      throw new Error(
        `The output folder already holds ${path.basename(file)}. Move it away first.`,
      );
  }
  const tools = await savedTools(source);
  if (!tools.length)
    throw new Error('The source must contain a saved tool with canvas.viewer.json.');
  await mkdir(output, { recursive: true });
  const staging = await mkdtemp(path.join(output, 'viewer-demo-stage-'));
  print(`Staging folder kept: ${staging}`);
  const staged = path.join(staging, 'Viewer Demo');
  await cp(source, staged, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: async (file) => {
      const current = await lstat(file);
      if (current.isSymbolicLink()) throw new Error('The source must not contain symbolic links.');
      return file === source || !path.basename(file).startsWith('.');
    },
  });
  // The shared ZIP writer records relative names and file bytes, never extended attributes.
  await createArchive([staged], archive, {
    signal: new AbortController().signal,
    access: async () => {},
    progress: () => {},
  });
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  const sha256 = hash.digest('hex');
  const size = (await lstat(archive)).size;
  await writeFile(checksum, `${sha256}  Viewer-Demo.zip\n`, { flag: 'wx' });
  print(`Archive: ${archive}`);
  print(`Size: ${size} bytes`);
  print(`SHA-256: ${sha256}`);
  print(`Saved tools: ${tools.join(', ')}`);
  return { archive, checksum, staging, tools, size, sha256 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await demoArchiveCommand(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'The demo archive could not be built.');
    process.exitCode = 1;
  });
