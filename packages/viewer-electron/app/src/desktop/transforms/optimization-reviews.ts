import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { FileEntry, OperationJob, OperationRequest } from '../../domain/contracts';
import { sameSourceVersion, sourceVersion } from '../../domain/files/inspection';
import type { SourceVersion } from '../../domain/files/inspection';
import { optimizationPlan } from '../../domain/operations/optimization';
import { errorMessage } from '../../domain/errors';
import { optimizationRequestSchema } from '../../domain/operations/optimization-review';
import type {
  OptimizationCandidate,
  OptimizationReply,
  OptimizationRequest,
} from '../../domain/operations/optimization-review';
import { transformExtension, type TransformPlan } from '../../domain/operations/transforms';
import { absolute, entry } from '../files/filesystem';
import { fileCoordination } from '../files/file-coordination';
import { privateStage } from '../operations/staging';
import type { Resources } from '../previews/resources';
import type { TransformExecutor, TransformOutcome } from './transforms';
import { optimizationFolder, optimizationSubfolder } from './optimization-folders';

type Engine = TransformExecutor & {
  pdfInspect(file: string, signal?: AbortSignal): Promise<{ pages: number }>;
};
interface Candidate {
  summary: OptimizationCandidate;
  owner: number;
  plan: TransformPlan;
  file: string;
  authority: string;
  version: SourceVersion;
  hash: string;
  stage: Awaited<ReturnType<typeof privateStage>>;
  jobs: Set<string>;
  released: boolean;
  exported: boolean;
  invalidated?: boolean;
}
const candidateBudget = 512_000_000;

/** A candidate is a window-owned capability, never a renderer-supplied staging path.
 * Export copies those measured bytes through the ordinary pinned operation journal. */
export class OptimizationReviews implements TransformExecutor {
  private candidates = new Map<string, Candidate>();
  private pending = new Map<string, { owner: number; source: string; abort: AbortController }>();
  private comparisons = new Map<number, { id: string; resources: string[] }>();
  private reviews = new Map<number, AbortController>();
  private jobs = new Map<string, string[]>();
  private exporting = new Set<number>();
  private bytes = 0;
  constructor(
    private directory: string,
    private engine: Engine,
    private resources: Pick<Resources, 'grant' | 'release'>,
    private access: (files: readonly string[]) => Promise<void>,
    private enqueue: (request: OperationRequest) => string,
    private trash: (file: string) => Promise<unknown>,
    private diagnose: (message: string) => void = () => {},
  ) {}

  private async current(source: FileEntry): Promise<void> {
    await this.access([source.path]);
    if (!sameSourceVersion(sourceVersion(source), sourceVersion(await entry(source.path))))
      throw new Error(
        'The source changed. Retry this file to prepare and review the current version.',
      );
  }
  private owned(id: string, owner: number): Candidate {
    const candidate = this.candidates.get(id);
    if (!candidate || candidate.owner !== owner || candidate.released)
      throw new Error('This candidate is no longer available. Prepare this file again.');
    return candidate;
  }
  private clearComparison(owner: number): void {
    this.reviews.get(owner)?.abort();
    this.reviews.delete(owner);
    for (const id of this.comparisons.get(owner)?.resources ?? []) this.resources.release(id);
    this.comparisons.delete(owner);
  }
  private async discard(candidate: Candidate): Promise<void> {
    if (!candidate.released || candidate.jobs.size) return;
    if (this.candidates.get(candidate.summary.id) !== candidate) return;
    this.candidates.delete(candidate.summary.id);
    this.bytes -= candidate.summary.outputBytes;
    const kept = await candidate.stage.dispose();
    if (
      kept &&
      process.env.VIEWER_TEST_PRESERVE !== '1' &&
      process.env.VIEWER_TEST_NO_REMOVAL !== '1'
    )
      this.diagnose(
        'A private optimization candidate could not be moved to Trash and was retained.',
      );
  }
  async request(raw: OptimizationRequest, owner: number): Promise<OptimizationReply> {
    const request = optimizationRequestSchema.parse(raw);
    if (request.kind === 'prepare') return this.prepare(request, owner);
    if (request.kind === 'review') return this.review(request.id, owner);
    if (request.kind === 'export') {
      if (this.exporting.has(owner))
        throw new Error('An export is already starting in this window.');
      this.exporting.add(owner);
      try {
        return await this.exportCandidates(request, owner);
      } finally {
        this.exporting.delete(owner);
      }
    }
    if (request.kind === 'cancel') {
      const pending = this.pending.get(request.requestID);
      if (pending?.owner === owner) pending.abort.abort(new Error('Optimization cancelled.'));
      return;
    }
    for (const id of request.ids) {
      const candidate = this.candidates.get(id);
      if (candidate?.owner !== owner) continue;
      candidate.released = true;
      if (this.comparisons.get(owner)?.id === id) this.clearComparison(owner);
      await this.discard(candidate);
    }
  }
  private async prepare(
    request: Extract<OptimizationRequest, { kind: 'prepare' }>,
    owner: number,
  ): Promise<OptimizationCandidate> {
    if (
      this.pending.size >= 2 ||
      this.pending.has(request.requestID) ||
      this.candidates.size >= 1000
    )
      throw new Error(
        'Wait for the current preparation to finish, or close an optimization batch.',
      );
    const source = absolute(request.source);
    const abort = new AbortController();
    this.pending.set(request.requestID, { owner, source, abort });
    let stage: Awaited<ReturnType<typeof privateStage>> | undefined;
    try {
      await this.access([source]);
      const info = await entry(source);
      const authority = await realpath(source);
      this.pending.get(request.requestID)!.source = authority;
      if (!sameSourceVersion(request.version, sourceVersion(info)))
        throw new Error('The source changed. Retry this file to use its current version.');
      const plan = optimizationPlan(info, request.options);
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      stage = await privateStage(this.directory, 'Candidate-', this.trash);
      const file = stage.file + '.' + transformExtension(plan.format);
      const statistics = await this.engine.execute(plan, [source], file, abort.signal, () => {});
      abort.signal.throwIfAborted();
      await this.current(info);
      if (!statistics || statistics.correction)
        throw new Error('The processor did not report an optimization result.');
      if (this.bytes + statistics.outputBytes > candidateBudget)
        throw new Error('The prepared batch exceeds 512 MB. Export it or prepare fewer files.');
      const version = sourceVersion(await entry(file));
      if (version.size !== statistics.outputBytes)
        throw new Error('The candidate size changed. Retry this file.');
      const hash = await this.copyOrHash(file, abort.signal);
      abort.signal.throwIfAborted();
      await this.current(info);
      const summary: OptimizationCandidate = {
        kind: 'prepared',
        id: randomUUID(),
        source: info,
        format: plan.kind === 'pdf' ? 'pdf' : 'image',
        ...statistics,
      };
      this.candidates.set(summary.id, {
        summary,
        owner,
        plan,
        file,
        authority,
        version,
        hash,
        stage,
        jobs: new Set(),
        released: false,
        exported: false,
      });
      this.bytes += statistics.outputBytes;
      stage = undefined;
      return summary;
    } finally {
      this.pending.delete(request.requestID);
      if (stage) await stage.dispose();
    }
  }
  private async review(id: string, owner: number): Promise<OptimizationReply> {
    const candidate = this.owned(id, owner);
    await this.current(candidate.summary.source);
    if (!sameSourceVersion(candidate.version, sourceVersion(await entry(candidate.file))))
      throw new Error('The candidate changed. Prepare and review this file again.');
    this.clearComparison(owner);
    const abort = new AbortController();
    this.reviews.set(owner, abort);
    const original = await this.resources.grant(candidate.summary.source.path);
    let optimized: Awaited<ReturnType<Resources['grant']>> | undefined;
    try {
      optimized = await this.resources.grant(candidate.file);
      const pages =
        candidate.summary.format === 'pdf'
          ? (await this.engine.pdfInspect(candidate.file, abort.signal)).pages
          : undefined;
      abort.signal.throwIfAborted();
      this.owned(id, owner);
      await this.current(candidate.summary.source);
      this.comparisons.set(owner, { id, resources: [original.id, optimized.id] });
      return { kind: 'review', id, original, candidate: optimized, ...(pages ? { pages } : {}) };
    } catch (error) {
      this.resources.release(original.id);
      if (optimized) this.resources.release(optimized.id);
      throw error;
    }
  }
  private async exportCandidates(
    request: Extract<OptimizationRequest, { kind: 'export' }>,
    owner: number,
  ): Promise<OptimizationReply> {
    const candidates = [...new Set(request.ids)].map((id) => this.owned(id, owner));
    const destination = absolute(request.destination);
    await this.access([destination]);
    const relative = new Map<string, string>();
    for (const candidate of candidates) {
      if (candidate.exported)
        throw new Error('This candidate was already exported. Retry to prepare a new copy.');
      if (candidate.summary.outputBytes >= candidate.summary.inputBytes)
        throw new Error('This file is already compact. Its original is kept.');
      await this.current(candidate.summary.source);
      relative.set(
        candidate.summary.id,
        request.sourceRoot
          ? optimizationSubfolder(request.sourceRoot, candidate.summary.source.path)
          : '',
      );
    }
    const groups = new Map<
      string,
      { plan: TransformPlan; destination: string; identity: string; candidates: Candidate[] }
    >();
    for (const candidate of candidates) {
      this.owned(candidate.summary.id, owner);
      const folder = await optimizationFolder(
        destination,
        relative.get(candidate.summary.id)!,
        this.access,
      );
      const key = JSON.stringify([folder, candidate.plan]);
      const group = groups.get(key) ?? {
        plan: candidate.plan,
        destination: folder,
        identity: (await entry(folder)).identity,
        candidates: [],
      };
      group.candidates.push(candidate);
      groups.set(key, group);
    }
    const jobs: string[] = [];
    const failures: { path: string; message: string }[] = [];
    for (const group of groups.values()) {
      try {
        for (const candidate of group.candidates) this.owned(candidate.summary.id, owner);
        const id = this.enqueue({
          kind: 'convert',
          destination: group.destination,
          reviewedDestination: { path: group.destination, identity: group.identity },
          transform: group.plan,
          sources: group.candidates.map((item) => item.summary.source.path),
          expectedSources: group.candidates.map((item) => ({
            path: item.summary.source.path,
            version: sourceVersion(item.summary.source),
          })),
          preparedTransforms: group.candidates.map((item) => ({
            path: item.summary.source.path,
            id: item.summary.id,
          })),
        });
        this.jobs.set(
          id,
          group.candidates.map((item) => item.summary.id),
        );
        for (const candidate of group.candidates) {
          candidate.jobs.add(id);
          candidate.exported = true;
        }
        jobs.push(id);
      } catch (reason) {
        for (const candidate of group.candidates)
          failures.push({
            path: candidate.summary.source.path,
            message: errorMessage(reason),
          });
      }
    }
    return { kind: 'exported', jobs, failures };
  }
  jobChanged(job: OperationJob): void {
    if (!['completed', 'failed', 'cancelled'].includes(job.status)) return;
    for (const id of this.jobs.get(job.id) ?? []) {
      const candidate = this.candidates.get(id);
      if (!candidate) continue;
      candidate.jobs.delete(job.id);
      void this.discard(candidate).catch((error) => this.diagnose(String(error)));
    }
    this.jobs.delete(job.id);
  }
  async stopOwner(owner: number): Promise<void> {
    for (const pending of this.pending.values()) if (pending.owner === owner) pending.abort.abort();
    this.clearComparison(owner);
    for (const candidate of this.candidates.values())
      if (candidate.owner === owner) {
        candidate.released = true;
        await this.discard(candidate);
      }
  }
  async invalidate(root?: string): Promise<void> {
    const includes = (file: string) =>
      !root || file === root || file.startsWith(root.replace(/\/$/, '') + path.sep);
    for (const pending of this.pending.values())
      if (includes(pending.source)) pending.abort.abort();
    for (const candidate of this.candidates.values())
      if (includes(candidate.summary.source.path) || includes(candidate.authority)) {
        candidate.released = true;
        candidate.invalidated = true;
        if (this.comparisons.get(candidate.owner)?.id === candidate.summary.id)
          this.clearComparison(candidate.owner);
        await this.discard(candidate);
      }
  }
  async execute(
    plan: TransformPlan,
    sources: readonly string[],
    output: string,
    signal: AbortSignal,
    progress: (fraction: number, detail: string) => void,
    preparedID?: string,
  ): Promise<TransformOutcome> {
    if (!preparedID) return this.engine.execute(plan, sources, output, signal, progress);
    const candidate = this.candidates.get(preparedID);
    if (
      !candidate ||
      candidate.invalidated ||
      !candidate.jobs.size ||
      sources.length !== 1 ||
      sources[0] !== candidate.summary.source.path ||
      JSON.stringify(plan) !== JSON.stringify(candidate.plan)
    )
      throw new Error('The reviewed candidate is unavailable. Prepare it again.');
    await this.access([...sources, output]);
    return fileCoordination.run(
      [{ path: sources[0]!, mode: 'read', transform: true }],
      async () => {
        signal.throwIfAborted();
        await this.current(candidate.summary.source);
        if (!sameSourceVersion(candidate.version, sourceVersion(await entry(candidate.file))))
          throw new Error('The reviewed candidate changed. Prepare it again.');
        progress(0, 'Saving reviewed bytes');
        const hash = await this.copyOrHash(candidate.file, signal, output);
        if (candidate.invalidated)
          throw new Error('Source access changed. The candidate was not published.');
        await this.current(candidate.summary.source);
        if (
          hash !== candidate.hash ||
          !sameSourceVersion(candidate.version, sourceVersion(await entry(candidate.file)))
        )
          throw new Error('The reviewed candidate changed. Its output was not published.');
        signal.throwIfAborted();
        progress(1, 'Reviewed copy ready');
        return {
          inputBytes: candidate.summary.inputBytes,
          outputBytes: candidate.summary.outputBytes,
          ...(candidate.summary.targetSize ? { targetSize: candidate.summary.targetSize } : {}),
        };
      },
      signal,
    );
  }
  private async copyOrHash(file: string, signal: AbortSignal, output?: string): Promise<string> {
    const input = await open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    let target: FileHandle | undefined;
    try {
      const before = await input.stat();
      if (!before.isFile() || before.size > 256_000_000)
        throw new Error('The candidate is invalid or exceeds 256 MB.');
      if (output) target = await open(output, 'wx', 0o600);
      const hash = createHash('sha256');
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let position = 0;
      while (position < before.size) {
        signal.throwIfAborted();
        const { bytesRead } = await input.read(
          buffer,
          0,
          Math.min(buffer.length, before.size - position),
          position,
        );
        if (!bytesRead) throw new Error('The candidate was truncated during export.');
        hash.update(buffer.subarray(0, bytesRead));
        if (target) {
          let offset = 0;
          while (offset < bytesRead) {
            const { bytesWritten } = await target.write(
              buffer,
              offset,
              bytesRead - offset,
              position + offset,
            );
            if (!bytesWritten) throw new Error('The output could not be written.');
            offset += bytesWritten;
          }
        }
        position += bytesRead;
      }
      for (const after of [await input.stat(), await lstat(file)])
        if (
          after.dev !== before.dev ||
          after.ino !== before.ino ||
          after.size !== before.size ||
          after.mtimeMs !== before.mtimeMs
        )
          throw new Error('The candidate changed while being read. Prepare it again.');
      await target?.sync();
      signal.throwIfAborted();
      return hash.digest('hex');
    } finally {
      await target?.close();
      await input.close();
    }
  }
}
