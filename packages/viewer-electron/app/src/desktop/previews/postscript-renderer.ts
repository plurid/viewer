import { itemIdentity } from '../../domain/files/item-identity';
import { stat } from '../files/stats';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { Decoder } from './derived';
import type { PostScriptStageOptions } from './postscript-stage';
import type { GhostscriptStatus } from '../../domain/previews/documents/postscript';
import {
  binaryEPS,
  epsHeader,
  inspectPostScript,
  postscriptOffset,
} from '../../domain/previews/documents/postscript';
import { errorMessage } from '../../domain/errors';
import { previewInput } from './input-copy';
import { withPostScriptStage } from './postscript-stage';
import { runProcessor } from '../transforms/process';

export const ghostscriptLocations = [
  '/opt/homebrew/bin/gs',
  '/usr/local/bin/gs',
  '/opt/local/bin/gs',
];
export const postscriptOutputLimit = 32 * 1024 * 1024;
export const postscriptTimeout = 60_000;
export const postscriptScratchLimit = 64 * 1024 * 1024;
export const postscriptMemoryKiB = 131072;
interface GhostscriptOptions extends PostScriptStageOptions {
  store(): boolean;
  timeout?: number;
  outputLimit?: number;
  scratchLimit?: number;
  resolveExecutable?(file: string): Promise<string>;
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
    for (const candidate of ghostscriptLocations) {
      const found = await this.executable(candidate).catch(() => undefined);
      if (found) return found;
    }
    return undefined;
  }

  private async executable(candidate: string): Promise<Executable | undefined> {
    const file = await (this.options.resolveExecutable ?? realpath)(candidate);
    const info = await stat(file);
    if (!info.isFile()) return undefined;
    await access(file, constants.X_OK);
    const identity = JSON.stringify([
      file,
      itemIdentity(info),
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
    const crop =
      binaryEPS(header) ||
      /EPSF-/.test(first.toString()) ||
      /^eps[fi]?$/.test(source.format ?? path.extname(source.file).slice(1));
    const prelude = postscriptOffset(first);
    section = { offset: section.offset + prelude, length: section.length - prelude };
    let version: string | undefined;
    try {
      return await withPostScriptStage(this.options, async (directory) => {
        const help = await runProcessor(executable.file, ['-h'], [], signal, {
          timeout: 3000,
          outputLimit: 64 * 1024,
          lowPriority: true,
          processGroup: true,
          cwd: directory,
          tempDirectory: directory,
          scratchLimit: this.options.scratchLimit ?? postscriptScratchLimit,
        });
        version = /\b(?:GPL |AFPL |Artifex )?Ghostscript (\d{1,3}\.\d{1,3}(?:\.\d{1,3})?)\b/.exec(
          help.toString(),
        )?.[1];
        if (!version)
          throw new Error('The selected program did not identify itself as Ghostscript.');
        if ((await this.executable(executable.file))?.identity !== executable.identity)
          throw new Error('Ghostscript changed; choose Render pages again.');
        const data = await runProcessor(
          executable.file,
          [
            '-dSAFER',
            '-dBATCH',
            '-dNOPAUSE',
            '-dNOPROMPT',
            '-dQUIET',
            '-dNumRenderingThreads=1',
            `-K${postscriptMemoryKiB}`,
            ...(crop ? ['-dEPSCrop'] : []),
            '-sDEVICE=pdfwrite',
            '-sOutputFile=%stdout',
            '-sstdout=%stderr',
            '-',
          ],
          [],
          signal,
          {
            timeout: this.options.timeout ?? postscriptTimeout,
            outputLimit: this.options.outputLimit ?? postscriptOutputLimit,
            lowPriority: true,
            processGroup: true,
            cwd: directory,
            tempDirectory: directory,
            scratchLimit: this.options.scratchLimit ?? postscriptScratchLimit,
            input: previewInput(source, section, signal),
          },
        );
        if ((await this.executable(executable.file))?.identity !== executable.identity)
          throw new Error('Ghostscript changed; choose Render pages again.');
        if (
          data.length < 16 ||
          data.subarray(0, 5).toString() !== '%PDF-' ||
          !data.subarray(-1024).includes(Buffer.from('%%EOF'))
        )
          throw new Error('Ghostscript did not produce a complete PDF.');
        return { data, extension: 'pdf', kind: 'postscript', decoder: `Ghostscript ${version}` };
      });
    } catch (error) {
      if (signal.aborted) throw new Error('PostScript rendering was cancelled.');
      const message = errorMessage(error);
      const engine = version ? `Ghostscript ${version}` : 'Ghostscript';
      if (message.includes('timed out'))
        throw new Error(`${engine} exceeded the rendering time limit.`);
      if (message.includes('output exceeded'))
        throw new Error(`${engine} exceeded the PDF output size limit.`);
      if (message.includes('scratch space'))
        throw new Error(`${engine} exceeded the scratch-space limit.`);
      if (message.includes('Media processor failed'))
        throw new Error(`${engine} could not render this document.`);
      throw error;
    }
  };
}
