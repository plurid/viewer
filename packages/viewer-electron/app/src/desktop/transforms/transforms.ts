import { constants } from 'node:fs';
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { validateTransform, type TransformPlan } from '../../domain/operations/transforms';
import type { MediaInfo } from '../../domain/media/documents';
import { fileCoordination } from '../files/file-coordination';
import { PreviewWork, type PreviewScope } from '../previews/preview-work';
import { runProcessor } from './process';
import { compileMedia, mediaDemuxer, mediaInfo } from './media';
import type { ImageInspection } from './image';
import { renderLayout } from './layout';
import { writeNesting } from './nesting';
import { writeCorrection } from './correction';
import { writeHandoff } from '../fabrication/handoff';
import type { LayoutTools } from './layout';
import { inspectPDF, pdfProcessor, transformPDF } from './pdf';
import { jpegMetadata } from './jpeg-metadata';
import { optimizerDirectory } from './processor-paths';
import { encodeToTarget } from './target-size';
import { saveAttachment } from './mail-attachment';
import { optimizationAttemptLimit } from '../../domain/operations/optimization-target';
import type {
  OptimizationOutcome,
  OptimizationStatistics,
} from '../../domain/operations/optimization-target';
import type { CorrectionReport, DXFCorrection } from '../../domain/fabrication/plan';
import type { HandoffChecks } from '../fabrication/handoff';

interface Source {
  file: string;
  handle: FileHandle;
  identity: string;
  modified: number;
  size: number;
}
/** Each member names the other's fields as absent, so either can be read from the union. */
type Without<T> = { [K in keyof T]?: never };
/** What a transform reports beside its output: an optimization's sizes, or what a corrected
 * drawing measures. */
export type TransformOutcome =
  | void
  | (OptimizationStatistics & Without<{ correction: CorrectionReport }>)
  | ({ correction: CorrectionReport } & Without<OptimizationStatistics>);
export interface TransformExecutor {
  execute(
    plan: TransformPlan,
    sources: readonly string[],
    output: string,
    signal: AbortSignal,
    progress: (fraction: number, detail: string) => void,
    preparedID?: string,
  ): Promise<TransformOutcome>;
}
export class Transforms implements TransformExecutor {
  private work = new PreviewWork();
  private running = 0;
  private waiting: { priority: number; enter(): void }[] = [];
  constructor(
    readonly root: string,
    private access: (paths: readonly string[]) => Promise<void>,
    private image: (
      bytes: Buffer,
      plan: Extract<TransformPlan, { kind: 'image' }>,
      signal: AbortSignal,
    ) => Promise<Buffer>,
    private inspect?: (bytes: Buffer, signal: AbortSignal) => Promise<ImageInspection>,
    private layout: Omit<LayoutTools, 'qpdf'> = {},
    /** The open fabrication checks a handoff saves the tour and record of. */
    private checks?: HandoffChecks,
  ) {}
  /** What `renderLayout` needs from this service's processors. */
  layoutTools(): LayoutTools {
    return { qpdf: pdfProcessor(this.root), ...this.layout };
  }
  private slot(signal: AbortSignal, priority: number): Promise<() => void> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      let entered = false;
      const cancel = () => {
        this.waiting = this.waiting.filter((value) => value !== item);
        reject(signal.reason ?? new Error('Media inspection cancelled.'));
      };
      const item = {
        priority,
        enter: () => {
          entered = true;
          signal.removeEventListener('abort', cancel);
          this.running++;
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            this.running--;
            this.waiting
              .sort((a, b) => a.priority - b.priority)
              .shift()
              ?.enter();
          });
        },
      };
      if (this.running < 2) item.enter();
      else if (this.waiting.length >= 32)
        reject(new Error('Wait for a media task to finish before opening another.'));
      else {
        this.waiting.push(item);
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted && !entered) cancel();
      }
    });
  }
  private async sources<T>(
    files: readonly string[],
    scope: PreviewScope,
    work: (sources: Source[]) => Promise<T>,
    priority = 1,
  ): Promise<T> {
    const release = await this.slot(scope.signal, priority);
    const claims: Awaited<ReturnType<typeof fileCoordination.acquire>>[] = [],
      sources: Source[] = [];
    try {
      for (const file of files) {
        scope.check();
        await this.access([file]);
        const actual = await realpath(file);
        scope.add(actual);
        await this.access([actual]);
        const claim = await fileCoordination.acquire(
          [{ path: actual, mode: 'read', transform: true }],
          scope.signal,
        );
        claims.push(claim);
        const handle = await open(
          claim.path(actual),
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        const info = await handle.stat();
        sources.push({
          file: actual,
          handle,
          identity: `${info.dev}:${info.ino}`,
          modified: info.mtimeMs,
          size: info.size,
        });
        if (!info.isFile()) throw new Error('Choose a regular file to transform.');
      }
      const result = await work(sources);
      scope.check();
      await this.access(files);
      for (const source of sources)
        for (const info of [await source.handle.stat(), await lstat(source.file)]) {
          if (
            `${info.dev}:${info.ino}` !== source.identity ||
            info.mtimeMs !== source.modified ||
            info.size !== source.size
          )
            throw new Error(
              'A source changed during processing. Its partial output was kept; export again.',
            );
        }
      return result;
    } finally {
      await Promise.allSettled(sources.map((source) => source.handle.close()));
      await Promise.allSettled(claims.map((claim) => claim.release()));
      release();
    }
  }
  private async probeSource(source: Source, signal: AbortSignal): Promise<MediaInfo> {
    const extension = path.extname(source.file).slice(1).toLowerCase();
    const bytes = await runProcessor(
      path.join(this.root, 'ffprobe'),
      [
        '-v',
        'error',
        '-max_alloc',
        '268435456',
        '-protocol_whitelist',
        'fd,pipe',
        '-f',
        mediaDemuxer(extension),
        '-fd',
        '3',
        '-i',
        'fd:',
        '-show_entries',
        'format=duration:stream=codec_name,codec_type,width,height,duration,avg_frame_rate,sample_rate,channels:stream_side_data=rotation',
        '-of',
        'json',
      ],
      [source.handle.fd],
      signal,
      { timeout: 30000 },
    );
    return mediaInfo(JSON.parse(bytes.toString('utf8')) as unknown, extension);
  }
  probe(file: string, signal = new AbortController().signal): Promise<MediaInfo> {
    return this.work.track(
      [file],
      (scope) =>
        this.sources([file], scope, (sources) => this.probeSource(sources[0]!, scope.signal)),
      signal,
    );
  }
  inspectImage(file: string): Promise<ImageInspection> {
    return this.work.track([file], (scope) =>
      this.sources([file], scope, async (sources) => {
        if (!this.inspect) throw new Error('Image inspection is unavailable.');
        if (sources[0]!.size > 256_000_000) throw new Error('This image is larger than 256 MB.');
        return this.inspect(await sources[0]!.handle.readFile(), scope.signal);
      }),
    );
  }
  pdfInspect(file: string, signal = new AbortController().signal): Promise<{ pages: number }> {
    return this.work.track(
      [file],
      (scope) =>
        this.sources([file], scope, async ([source]) => {
          const value = await inspectPDF(pdfProcessor(this.root), source!, scope.signal);
          return { pages: value.pages.length };
        }),
      signal,
    );
  }
  execute(
    value: DXFCorrection,
    files: readonly string[],
    output: string,
    signal: AbortSignal,
    progress: (fraction: number, detail: string) => void,
  ): Promise<{ correction: CorrectionReport }>;
  execute(
    value: Exclude<TransformPlan, DXFCorrection>,
    files: readonly string[],
    output: string,
    signal: AbortSignal,
    progress: (fraction: number, detail: string) => void,
  ): Promise<void | OptimizationStatistics>;
  execute(
    value: TransformPlan,
    files: readonly string[],
    output: string,
    signal: AbortSignal,
    progress: (fraction: number, detail: string) => void,
  ): Promise<TransformOutcome>;
  execute(
    value: TransformPlan,
    files: readonly string[],
    output: string,
    signal: AbortSignal,
    progress: (fraction: number, detail: string) => void,
  ): Promise<TransformOutcome> {
    const plan = validateTransform(value, files.length);
    return this.work.track(
      files,
      (scope) =>
        this.sources(
          files,
          scope,
          async (sources) => {
            await this.access([output]);
            scope.check();
            if (plan.kind === 'mail-attachment')
              return saveAttachment(sources[0]!, plan, output, scope.signal, progress);
            if (plan.kind === 'pdf' || plan.kind === 'pdf-pages')
              return transformPDF(
                pdfProcessor(this.root),
                sources,
                plan,
                output,
                this.image,
                scope.signal,
                progress,
              );
            if (plan.kind === 'image') {
              if (sources.length !== 1) throw new Error('Convert one raster image per output.');
              if (sources[0]!.size > 256_000_000)
                throw new Error('This image is larger than 256 MB.');
              progress(0.1, 'Decoding image');
              const input = await sources[0]!.handle.readFile();
              let data: Buffer;
              let targetSize: OptimizationOutcome | undefined;
              if (plan.lossless && plan.format === 'jpeg') {
                jpegMetadata(input, plan.metadata);
                const optimizer = path.join(optimizerDirectory(this.root), 'jpegtran');
                const encoded = await runProcessor(
                  optimizer,
                  ['-copy', 'all', '-optimize', '-progressive', '-maxmemory', '256m'],
                  [],
                  scope.signal,
                  { input, outputLimit: 256 * 1024 * 1024, timeout: 90000 },
                );
                data = jpegMetadata(encoded, plan.metadata);
              } else if (plan.targetSize && !plan.lossless) {
                const sized = await encodeToTarget(
                  plan.targetSize,
                  plan.quality,
                  (quality, attempt, signal) => {
                    progress(
                      (attempt - 1) / optimizationAttemptLimit,
                      `Trying image quality ${quality}`,
                    );
                    return this.image(input, { ...plan, quality }, signal);
                  },
                  scope.signal,
                );
                data = sized.data;
                targetSize = sized.outcome;
              } else data = await this.image(input, plan, scope.signal);
              if (plan.targetSize && !targetSize)
                targetSize = {
                  bytes: plan.targetSize.bytes,
                  met: data.length <= plan.targetSize.bytes,
                  attempts: 1,
                };
              scope.check();
              const target = await open(output, 'wx', 0o644);
              try {
                await target.writeFile(data);
                await target.sync();
              } finally {
                await target.close();
              }
              progress(1, 'Image ready');
              return plan.optimize || plan.targetSize
                ? {
                    inputBytes: sources[0]!.size,
                    outputBytes: data.length,
                    ...(targetSize ? { targetSize } : {}),
                  }
                : undefined;
            }
            if (plan.kind === 'layout')
              return renderLayout(
                plan,
                sources,
                output,
                this.layoutTools(),
                scope.signal,
                progress,
              );
            if (plan.kind === 'nesting')
              return writeNesting(
                plan,
                sources,
                output,
                scope.signal,
                progress,
                (report, file, signal) =>
                  renderLayout(report, [], file, this.layoutTools(), signal),
              );
            if (plan.kind === 'dxf-correction')
              return writeCorrection(plan, sources[0]!, output, scope.signal, progress);
            if (plan.kind === 'fabrication-handoff')
              return writeHandoff(
                plan,
                sources,
                files,
                output,
                scope.signal,
                progress,
                this.checks,
                (report, file, signal) =>
                  renderLayout(report, [], file, this.layoutTools(), signal),
              );
            progress(0, 'Inspecting media');
            const facts: MediaInfo[] = [];
            for (const source of sources) facts.push(await this.probeSource(source, scope.signal));
            // Reopen independent file descriptions after probing (ffprobe seeks its inherited FD).
            const inputs: FileHandle[] = [];
            const count =
              plan.segments.length + (['mix', 'replace'].includes(plan.audio.mode) ? 1 : 0);
            const outputFD = 3 + count;
            const command = compileMedia(plan, facts, (index) => 3 + index, outputFD);
            const target = await open(output, 'wx+', 0o644);
            try {
              for (const index of command.sources) {
                const input = await open(
                  sources[index]!.file,
                  constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
                );
                inputs.push(input);
                const info = await input.stat(),
                  expected = sources[index]!;
                if (
                  `${info.dev}:${info.ino}` !== expected.identity ||
                  info.mtimeMs !== expected.modified ||
                  info.size !== expected.size
                )
                  throw new Error('A source changed before encoding. Export again.');
              }
              await runProcessor(
                path.join(this.root, 'ffmpeg'),
                command.args,
                [...inputs.map((input) => input.fd), target.fd],
                scope.signal,
                {
                  progress: (seconds) =>
                    progress(
                      Math.min(0.99, seconds / command.duration),
                      command.copied ? 'Copying compatible streams' : 'Encoding media',
                    ),
                },
              );
              await target.sync();
              scope.check();
              progress(1, command.copied ? 'Stream copy ready' : 'Media ready');
            } finally {
              await Promise.allSettled(inputs.map((input) => input.close()));
              await target.close();
            }
          },
          0,
        ),
      signal,
    );
  }
  frame(file: string, seconds: number, signal: AbortSignal): Promise<Buffer> {
    return this.work.track(
      [file],
      (scope) =>
        this.sources([file], scope, async (sources) => {
          const extension = path.extname(file).slice(1);
          return runProcessor(
            path.join(this.root, 'ffmpeg'),
            [
              '-nostdin',
              '-hide_banner',
              '-loglevel',
              'error',
              '-protocol_whitelist',
              'fd,pipe',
              '-ss',
              String(seconds),
              '-f',
              mediaDemuxer(extension),
              '-fd',
              '3',
              '-i',
              'fd:',
              '-map',
              '0:v:0',
              '-frames:v',
              '1',
              '-vf',
              'scale=320:-2',
              '-c:v',
              'png',
              '-threads',
              '1',
              '-f',
              'image2pipe',
              'pipe:1',
            ],
            [sources[0]!.handle.fd],
            scope.signal,
            { timeout: 20000, outputLimit: 4 * 1024 * 1024 },
          );
        }),
      signal,
    );
  }
  waveform(file: string, duration: number, signal: AbortSignal): Promise<number[]> {
    return this.work.track(
      [file],
      (scope) =>
        this.sources([file], scope, async (sources) => {
          const extension = path.extname(file).slice(1),
            samples = Math.max(1, Math.ceil((duration * 8000) / 512));
          const text = await runProcessor(
            path.join(this.root, 'ffmpeg'),
            [
              '-nostdin',
              '-hide_banner',
              '-loglevel',
              'error',
              '-protocol_whitelist',
              'fd,pipe',
              '-f',
              mediaDemuxer(extension),
              '-fd',
              '3',
              '-i',
              'fd:',
              '-vn',
              '-af',
              `aresample=8000,asetnsamples=n=${samples}:p=1,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.Peak_level:file='pipe\\:1'`,
              '-f',
              'null',
              '-',
            ],
            [sources[0]!.handle.fd],
            scope.signal,
            { timeout: 30000, outputLimit: 256000 },
          );
          return [
            ...text
              .toString('utf8')
              .matchAll(/lavfi\.astats\.Overall\.Peak_level=(-?[\d.]+|-inf)/g),
          ]
            .slice(0, 512)
            .map((match) =>
              match[1] === '-inf' ? 0 : Math.min(1, Math.pow(10, Number(match[1]) / 20)),
            );
        }),
      signal,
    );
  }
  async quiesce(root?: string) {
    const actual = await this.work.invalidate(root);
    await this.work.drain(root ? [root, actual || root] : undefined);
  }
}
