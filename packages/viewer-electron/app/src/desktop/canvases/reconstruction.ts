import { randomInt, randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type {
  ReconstructionJob,
  ReconstructionRequest,
  ReconstructionReply,
  ReconstructionSummary,
} from '../../domain/canvases/reconstruction';
import { reconstructionJobSchema, reconstructionModel } from '../../domain/canvases/reconstruction';
import type { SegmentationPicture } from '../../domain/models/segmentation';
import { errorMessage } from '../../domain/errors';
import { DocumentStore } from '../persistence/document-store';
import type { Canvases } from './service';
import { reconstructionMask } from './reconstruction-mask';
import { validateReconstructedGLB } from './glb';
import { providerResponseJSON, requestProvider } from '../models/provider-response';

const apiRoot = 'https://queue.fal.run/fal-ai/sam-3';
const requestID = z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/);
const pending = new Set<ReconstructionJob['state']>(['queued', 'running', 'cancel-requested']);
interface ReconstructionPorts {
  canvases: Canvases;
  configured(): Promise<boolean>;
  secret(): Promise<string>;
  prepare(bytes: Buffer, signal: AbortSignal): Promise<SegmentationPicture>;
  segment(
    providerID: string,
    picture: SegmentationPicture,
    prompt: string,
    signal: AbortSignal,
  ): Promise<string>;
  confirm(owner: number, job: ReconstructionJob): Promise<boolean>;
  request?: typeof fetch;
}

export function reconstructionAssetURL(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !(url.hostname === 'fal.media' || url.hostname.endsWith('.fal.media'))
  )
    throw new Error('The reconstruction returned an unsupported asset address.');
  return url.href;
}
async function boundedBytes(response: Response, limit: number): Promise<Buffer> {
  if (!response.ok || !response.body)
    throw new Error('The generated model download failed. Refresh to retry the saved result.');
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body.cancel();
    throw new Error('The generated model exceeds 32 MiB.');
  }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit || parts.length >= 16384) {
        await reader.cancel();
        throw new Error('The generated model exceeds its download limit.');
      }
      parts.push(value);
    }
    return Buffer.concat(parts, length);
  } finally {
    reader.releaseLock();
  }
}

/** A paid submission is attempted once. A lost acknowledgement is never silently resubmitted. */
export class Reconstructions {
  private stores = new Map<string, DocumentStore<ReconstructionJob>>();
  private queues = new Map<string, Promise<unknown>>();
  private abort = new AbortController();
  private request: typeof fetch;
  constructor(
    private root: string,
    private ports: ReconstructionPorts,
  ) {
    this.request = ports.request ?? fetch;
  }
  private store(id: string) {
    z.uuid().parse(id);
    let store = this.stores.get(id);
    if (!store) {
      store = new DocumentStore(
        path.join(this.root, 'reconstruction-jobs', id + '.json'),
        (value) => reconstructionJobSchema.parse(value),
      );
      this.stores.set(id, store);
    }
    return store;
  }
  private serial<T>(id: string, work: () => Promise<T>): Promise<T> {
    const result = (this.queues.get(id) ?? Promise.resolve()).catch(() => {}).then(work);
    this.queues.set(id, result);
    return result;
  }
  private async save(job: ReconstructionJob): Promise<ReconstructionJob> {
    const next = reconstructionJobSchema.parse({ ...job, updated: Date.now() });
    await this.store(job.id).save(next);
    return next;
  }
  private async load(owner: number, id: string): Promise<ReconstructionJob> {
    let job = await this.store(id).load();
    if (!job) throw new Error('This reconstruction is unavailable.');
    await this.ports.canvases.read(owner, job.canvasID);
    if (job.state === 'submitting')
      job = await this.save({
        ...job,
        state: 'submission-unknown',
        error:
          'Viewer closed before the submission was acknowledged. Check your fal history before starting another reconstruction.',
      });
    return job;
  }
  private async api(
    suffix: string,
    method: string,
    body?: unknown,
  ): Promise<{ status: number; value: unknown }> {
    const secret = await this.ports.secret();
    if (!secret) throw new Error('Add a fal key in Settings → Models → 3D reconstruction.');
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(60000)]);
    const response = await requestProvider(this.request, apiRoot + suffix, {
      method,
      redirect: 'error',
      signal,
      headers: { authorization: 'Key ' + secret, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok && !(method === 'PUT' && response.status === 400)) {
      await response.body?.cancel();
      throw new Error(
        `fal returned HTTP ${response.status}. No new request was submitted automatically.`,
      );
    }
    return { status: response.status, value: await providerResponseJSON(response, signal) };
  }
  async handle(owner: number, request: ReconstructionRequest): Promise<ReconstructionReply> {
    const configured = await this.ports.configured();
    if (request.kind === 'status') return { configured };
    if (request.kind === 'prepare')
      return this.serial('prepare:' + request.canvasID, async () => {
        const document = await this.ports.canvases.read(owner, request.canvasID);
        const asset = document.assets.find((item) => item.id === request.assetID);
        if (!asset || !asset.mime.startsWith('image/'))
          throw new Error('Choose a photo attached to this canvas.');
        const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(120000)]);
        const picture = await this.ports.prepare(
          await this.ports.canvases.assetBytes(asset),
          signal,
        );
        const text = await this.ports.segment(request.providerID, picture, request.prompt, signal);
        const mask = reconstructionMask(text, picture.width, picture.height);
        const job = await this.save({
          version: 1,
          id: randomUUID(),
          canvasID: document.id,
          sourceAssetID: asset.id,
          sourceHash: asset.hash,
          providerID: request.providerID,
          model: reconstructionModel,
          prompt: request.prompt,
          state: 'prepared',
          image: `data:${picture.image.type};base64,${Buffer.from(picture.image.data).toString('base64')}`,
          mask: 'data:image/png;base64,' + mask.toString('base64'),
          width: picture.width,
          height: picture.height,
          created: Date.now(),
          updated: Date.now(),
          seed: randomInt(0, 2147483647),
        });
        return { configured, job };
      });
    if (request.kind === 'list') {
      await this.ports.canvases.read(owner, request.canvasID);
      const names = await readdir(path.join(this.root, 'reconstruction-jobs')).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return [];
          throw error;
        },
      );
      const jobs: ReconstructionSummary[] = [];
      for (const name of names
        .filter((name) => name.endsWith('.json') && z.uuid().safeParse(name.slice(0, -5)).success)
        .slice(0, 1000)) {
        const job = await this.store(name.slice(0, -5)).load();
        if (job?.canvasID === request.canvasID)
          jobs.push({ id: job.id, prompt: job.prompt, state: job.state, created: job.created });
      }
      return { configured, jobs: jobs.toSorted((a, b) => b.created - a.created).slice(0, 20) };
    }
    return this.serial(request.id, async () => {
      let job = await this.load(owner, request.id);
      if (request.kind === 'start') {
        if (job.state !== 'prepared')
          throw new Error('This reconstruction has already been submitted or needs review.');
        if (!configured) throw new Error('Add a fal key in Settings → Models → 3D reconstruction.');
        if (!(await this.ports.confirm(owner, job))) return { configured, job };
        job = await this.save({ ...job, state: 'submitting' });
        try {
          const { value } = await this.api('/3d-objects', 'POST', {
            image_url: job.image,
            mask_urls: [job.mask],
            seed: job.seed,
            export_textured_glb: true,
          });
          const result = z.object({ request_id: requestID }).parse(value);
          job = await this.save({
            ...job,
            remoteID: result.request_id,
            state: 'queued',
            error: undefined,
          });
        } catch {
          job = await this.save({
            ...job,
            state: 'submission-unknown',
            error:
              'fal did not acknowledge the submission. It may have started. Check your fal history before creating another request.',
          });
        }
      } else if (request.kind === 'cancel' && pending.has(job.state) && job.remoteID) {
        const { status, value } = await this.api('/requests/' + job.remoteID + '/cancel', 'PUT');
        const result = z.object({ status: z.string() }).parse(value);
        job = await this.save({
          ...job,
          state: status === 200 && result.status === 'OK' ? 'cancelled' : 'cancel-requested',
          error: undefined,
        });
      } else if (request.kind === 'get' && pending.has(job.state) && job.remoteID) {
        try {
          job = await this.poll(owner, job);
        } catch (error) {
          job = await this.save({ ...job, error: errorMessage(error).slice(0, 2000) });
        }
      }
      return { configured, job };
    });
  }
  private async poll(owner: number, job: ReconstructionJob): Promise<ReconstructionJob> {
    const base = '/requests/' + requestID.parse(job.remoteID);
    const { value } = await this.api(base + '/status', 'GET');
    const status = z
      .object({
        status: z.enum(['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED']),
        error: z.unknown().optional(),
      })
      .parse(value);
    if (status.status !== 'COMPLETED')
      return this.save({
        ...job,
        state:
          job.state === 'cancel-requested'
            ? job.state
            : status.status === 'IN_QUEUE'
              ? 'queued'
              : 'running',
        error: undefined,
      });
    if (status.error)
      return this.save({
        ...job,
        state: 'failed',
        error: 'fal reported that the reconstruction failed. No retry was submitted.',
      });
    const result = await this.api(base, 'GET');
    const output = z
      .object({ model_glb: z.object({ url: z.string().url() }).nullish() })
      .parse(result.value);
    if (!output.model_glb)
      return this.save({
        ...job,
        state: 'failed',
        error: 'The result has no GLB mesh. A point cloud does not count as a generated mesh.',
      });
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(60000)]);
    const response = await requestProvider(
      this.request,
      reconstructionAssetURL(output.model_glb.url),
      { signal, redirect: 'error' },
    );
    const bytes = await boundedBytes(response, 32 * 1024 * 1024);
    try {
      validateReconstructedGLB(bytes);
    } catch {
      return this.save({
        ...job,
        state: 'failed',
        error:
          'The returned GLB is invalid, uses external assets, or exceeds supported geometry or texture limits.',
      });
    }
    const asset = await this.ports.canvases.attach(
      owner,
      job.canvasID,
      'Reconstructed object.glb',
      bytes,
      undefined,
      `Meta SAM 3D Objects · hosted by fal · request ${job.remoteID} · seed ${job.seed} · inferred geometry`,
    );
    return this.save({ ...job, state: 'succeeded', assetID: asset.id, error: undefined });
  }
  async close(): Promise<void> {
    this.abort.abort();
    await Promise.allSettled(this.queues.values());
    await Promise.all([...this.stores.values()].map((store) => store.flush()));
  }
}
