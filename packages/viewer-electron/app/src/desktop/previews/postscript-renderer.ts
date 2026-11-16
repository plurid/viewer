import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Decoder } from './derived';
import type { PreviewCopyOptions } from './input-copy';
import type { GhostscriptStatus } from '../../domain/previews/documents/postscript';
import {
  binaryEPS,
  epsHeader,
  inspectPostScript,
} from '../../domain/previews/documents/postscript';
import { errorMessage } from '../../domain/errors';
import { withPreviewCopy } from './input-copy';
import { runProcessor } from '../transforms/process';

const locations = ['/opt/homebrew/bin/gs', '/usr/local/bin/gs', '/opt/local/bin/gs'];
export const postscriptOutputLimit = 32 * 1024 * 1024;
export const postscriptTimeout = 60_000;
interface GhostscriptOptions extends PreviewCopyOptions {
  customPath(): string;
  store(): boolean;
  timeout?: number;
  outputLimit?: number;
}
interface Executable {
  file: string;
  identity: string;
  key: string;
}

/** Discovery never launches a program. Even its identity probe waits for Render pages. */
export class Ghostscript {
  constructor(private options: GhostscriptOptions) {}

  private async find(): Promise<Executable | undefined> {
    if (this.options.store()) return undefined;
    const custom = this.options.customPath();
    if (custom && (!path.isAbsolute(custom) || custom.includes('\0') || custom.length > 32768))
      return undefined;
    for (const candidate of custom ? [custom, ...locations] : locations) {
      const found = await this.executable(candidate).catch(() => undefined);
      if (found) return found;
    }
    return undefined;
  }

  private async executable(candidate: string): Promise<Executable | undefined> {
    const file = await realpath(candidate);
    const info = await stat(file);
    if (!info.isFile()) return undefined;
    await access(file, constants.X_OK);
    const identity = JSON.stringify([
      file,
      info.dev,
      info.ino,
      info.size,
      info.mtimeMs,
      info.ctimeMs,
    ]);
    return { file, identity, key: createHash('sha256').update(identity).digest('hex') };
  }

  async status(): Promise<GhostscriptStatus> {
    if (this.options.store()) return { kind: 'store' };
    return { kind: (await this.find()) ? 'found' : 'missing' };
  }

  async variant(): Promise<string> {
    if (this.options.store())
      throw new Error('PostScript rendering is unavailable in the Store edition.');
    const executable = await this.find();
    if (!executable) throw new Error('Pages can be rendered if Ghostscript is installed.');
    return executable.key;
  }

  readonly decode: Decoder = async (source, mode, signal, _size, variant) => {
    if (mode !== 'postscript' || this.options.store())
      throw new Error('PostScript rendering is unavailable here.');
    const executable = await this.find();
    if (!executable || executable.key !== variant)
      throw new Error('Ghostscript changed; choose Render pages again.');
    const header = Buffer.alloc(Math.min(4096, source.info.size));
    await source.handle.read(header, 0, header.length, 0);
    let section = { offset: 0, length: source.info.size };
    if (binaryEPS(header)) section = epsHeader(header, source.info.size)!.postscript;
    const first = Buffer.alloc(Math.min(256, section.length));
    await source.handle.read(first, 0, first.length, section.offset);
    if (inspectPostScript(first, source.format ?? path.extname(source.file).slice(1)).pdf)
      throw new Error('This Illustrator file already contains a PDF.');
    let version: string | undefined;
    try {
      const help = await runProcessor(executable.file, ['-h'], [], signal, {
        timeout: 3000,
        outputLimit: 64 * 1024,
        lowPriority: true,
      });
      version = /\b(?:GPL |AFPL |Artifex )?Ghostscript (\d{1,3}\.\d{1,3}(?:\.\d{1,3})?)\b/.exec(
        help.toString(),
      )?.[1];
      if (!version) throw new Error('The selected program did not identify itself as Ghostscript.');
      if ((await this.executable(executable.file))?.identity !== executable.identity)
        throw new Error('Ghostscript changed; choose Render pages again.');
      const data = await withPreviewCopy(source, section, signal, this.options, async (file) => {
        if ((await this.executable(executable.file))?.identity !== executable.identity)
          throw new Error('Ghostscript changed; choose Render pages again.');
        return runProcessor(
          executable.file,
          [
            '-dSAFER',
            '-dBATCH',
            '-dNOPAUSE',
            '-dNOPROMPT',
            '-dQUIET',
            '-dNumRenderingThreads=1',
            '-sDEVICE=pdfwrite',
            '-sOutputFile=%stdout',
            '-sstdout=%stderr',
            '--',
            file,
          ],
          [],
          signal,
          {
            timeout: this.options.timeout ?? postscriptTimeout,
            outputLimit: this.options.outputLimit ?? postscriptOutputLimit,
            lowPriority: true,
            cwd: path.dirname(file),
          },
        );
      });
      if ((await this.executable(executable.file))?.identity !== executable.identity)
        throw new Error('Ghostscript changed; choose Render pages again.');
      if (
        data.length < 16 ||
        data.subarray(0, 5).toString() !== '%PDF-' ||
        !data.subarray(-1024).includes(Buffer.from('%%EOF'))
      )
        throw new Error('Ghostscript did not produce a complete PDF.');
      return { data, extension: 'pdf', kind: 'postscript', decoder: `Ghostscript ${version}` };
    } catch (error) {
      if (signal.aborted) throw new Error('PostScript rendering was cancelled.');
      const message = errorMessage(error);
      const engine = version ? `Ghostscript ${version}` : 'Ghostscript';
      if (message.includes('timed out'))
        throw new Error(`${engine} exceeded the rendering time limit.`);
      if (message.includes('output exceeded'))
        throw new Error(`${engine} exceeded the PDF output size limit.`);
      if (message.includes('Media processor failed'))
        throw new Error(`${engine} could not render this document.`);
      throw error;
    }
  };
}
