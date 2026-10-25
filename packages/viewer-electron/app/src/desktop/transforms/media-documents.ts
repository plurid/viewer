import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DocumentStore } from '../persistence/document-store';
import { absolute, entry, validName } from '../files/filesystem';
import { sameSourceVersion, sourceVersion } from '../../domain/files/inspection';
import {
  mediaDraftSchema,
  mediaRequestSchema,
  type MediaDraft,
  type MediaReply,
  type MediaRequest,
} from '../../domain/media/documents';
import {
  mediaTransformSchema,
  transformExtension,
  validateTransform,
} from '../../domain/operations/transforms';
import type { Transforms } from './transforms';
import type { Operations } from '../operations/operations';
import type { Resources } from '../previews/resources';

/** Private drafts contain decisions and source versions, never copied media bytes.
 * Export submits ordinary guarded operations; closing an editor keeps its draft. */
export class MediaDocuments {
  private queue: Promise<unknown> = Promise.resolve();
  private previews = new Map<string, { owner: number; abort: AbortController }>();
  private cache = new Map<string, { path: string; value: Buffer | number[]; cost: number }>();
  private cacheBytes = 0;
  constructor(
    private directory: string,
    private transforms: Transforms,
    private operations: Operations,
    private resources: Resources,
    private access: (files: readonly string[]) => Promise<void>,
    private choose: (owner: number, media: 'audio' | 'video') => Promise<string[]>,
  ) {}
  private store(id: string) {
    return new DocumentStore(path.join(this.directory, 'media-drafts', `${id}.json`), (value) =>
      mediaDraftSchema.parse(value),
    );
  }
  private async source(file: string): Promise<MediaDraft['sources'][number]> {
    absolute(file);
    await this.access([file]);
    const info = await entry(file);
    if (info.kind !== 'file') throw new Error('Choose a regular media file.');
    const version = sourceVersion(info),
      media = await this.transforms.probe(file);
    if (!sameSourceVersion(version, sourceVersion(await entry(file))))
      throw new Error('The media changed while being opened. Try again.');
    return { path: file, version, info: media };
  }
  private async current(draft: MediaDraft) {
    for (const source of draft.sources) {
      await this.access([source.path]);
      if (!sameSourceVersion(source.version, sourceVersion(await entry(source.path))))
        throw new Error(
          'A source changed after this draft was opened. Open a new media draft to use the latest file.',
        );
    }
  }
  private async read(id: string) {
    const draft = await this.store(id).load();
    if (!draft) throw new Error('This media draft is unavailable.');
    await this.current(draft);
    return draft;
  }
  async request(raw: MediaRequest, owner: number): Promise<MediaReply> {
    const request = mediaRequestSchema.parse(raw);
    if (request.kind === 'cancel-preview') {
      const work = this.previews.get(request.requestID);
      if (work?.owner === owner) work.abort.abort();
      return;
    }
    if (request.kind === 'frame' || request.kind === 'waveform') {
      if (this.previews.size >= 32 || this.previews.has(request.requestID))
        throw new Error('Wait for the current media inspection to finish.');
      const abort = new AbortController();
      this.previews.set(request.requestID, { owner, abort });
      try {
        const draft = await this.read(request.id),
          source = draft.sources[request.source];
        abort.signal.throwIfAborted();
        if (!source) throw new Error('This media source is no longer available.');
        if (request.kind === 'frame' && request.seconds >= source.info.duration)
          throw new Error('Choose a frame before the end of this source.');
        const key = JSON.stringify([
          source.path,
          source.version,
          request.kind,
          request.kind === 'frame' ? request.seconds : null,
        ]);
        const hit = this.cache.get(key);
        if (hit) {
          this.cache.delete(key);
          this.cache.set(key, hit);
        }
        const value =
          hit?.value ??
          (request.kind === 'waveform'
            ? await this.transforms.waveform(source.path, source.info.duration, abort.signal)
            : await this.transforms.frame(source.path, request.seconds, abort.signal));
        await this.current(draft);
        abort.signal.throwIfAborted();
        if (!hit) {
          const cost = value.length * (Buffer.isBuffer(value) ? 1 : 8);
          if (cost <= 4 * 1024 * 1024) {
            this.cache.set(key, { path: source.path, value, cost });
            this.cacheBytes += cost;
          }
          while (this.cache.size > 128 || this.cacheBytes > 16 * 1024 * 1024) {
            const [first, item] = this.cache.entries().next().value!;
            this.cache.delete(first);
            this.cacheBytes -= item.cost;
          }
        }
        return request.kind === 'waveform'
          ? { peaks: value as number[], duration: source.info.duration }
          : this.resources.grantBytes(source.path, 'frame.png', value as Buffer);
      } finally {
        this.previews.delete(request.requestID);
      }
    }
    const run = this.queue
      .catch(() => {})
      .then(async (): Promise<MediaReply> => {
        if (request.kind === 'create') {
          const sources: MediaDraft['sources'] = [];
          for (const file of [...new Set(request.paths)]) sources.push(await this.source(file));
          const video = sources.every((source) => source.info.video);
          if (request.preset === 'extract-audio' && sources.some((source) => !source.info.audio))
            throw new Error('A selected source has no audio track. Choose sources with audio.');
          const draft: MediaDraft = {
            version: 1,
            id: randomUUID(),
            revision: 1,
            sources,
            plan: mediaTransformSchema.parse({
              kind: 'media',
              format: request.preset === 'extract-audio' ? 'm4a' : video ? 'mp4' : 'm4a',
              segments: sources.map((source, index) => ({
                source: index,
                start: 0,
                end: source.info.duration,
              })),
            }),
          };
          await this.store(draft.id).save(draft);
          return draft;
        }
        const draft = await this.read(request.id);
        if (request.kind === 'get') return draft;
        if (draft.revision !== request.revision)
          throw new Error('This draft changed in another plane. Reload it before editing.');
        if (request.kind === 'choose') {
          const files = await this.choose(owner, request.media);
          for (const file of files)
            if (!draft.sources.some((source) => source.path === file)) {
              if (draft.sources.length >= 16)
                throw new Error('A media draft supports 16 source files.');
              draft.sources.push(await this.source(file));
            }
          if (request.media === 'audio' && files[0]) {
            const source = draft.sources.findIndex((source) => source.path === files[0]);
            if (!draft.sources[source]?.info.audio)
              throw new Error('The selected source has no audio.');
            draft.plan.audio = { ...draft.plan.audio, mode: 'replace', source };
          }
          draft.revision++;
          await this.store(draft.id).save(draft);
          return draft;
        }
        if (request.kind === 'update') {
          draft.plan = validateTransform(request.plan, draft.sources.length) as MediaDraft['plan'];
          draft.revision++;
          await this.store(draft.id).save(draft);
          return draft;
        }
        validName(request.name);
        absolute(request.destination);
        await this.access([request.destination]);
        let exportPlan = draft.plan;
        if (request.frame) {
          const source = draft.sources[request.frame.source];
          if (!source?.info.video || request.frame.seconds >= source.info.duration)
            throw new Error('Choose a frame within a video source.');
          exportPlan = mediaTransformSchema.parse({
            kind: 'media',
            format: request.frame.format,
            segments: [
              {
                source: request.frame.source,
                start: request.frame.seconds,
                end: Math.min(source.info.duration, request.frame.seconds + 0.001),
              },
            ],
          });
        }
        const extension = transformExtension(exportPlan.format);
        if (!request.name.toLowerCase().endsWith('.' + extension))
          throw new Error(`Choose a .${extension} output name.`);
        const plans =
          request.separate && !request.frame
            ? exportPlan.segments.map((segment) => ({ ...exportPlan, segments: [segment] }))
            : [exportPlan];
        const jobs: string[] = [];
        for (const [index, plan] of plans.entries()) {
          const used = [
            ...new Set([
              ...plan.segments.map((segment) => segment.source),
              ...(['mix', 'replace'].includes(plan.audio.mode) && plan.audio.source !== undefined
                ? [plan.audio.source]
                : []),
            ]),
          ];
          const sources = used.map((index) => draft.sources[index]!);
          const remapped = {
            ...plan,
            segments: plan.segments.map((segment) => ({
              ...segment,
              source: used.indexOf(segment.source),
            })),
            audio: {
              ...plan.audio,
              ...(plan.audio.source !== undefined && used.includes(plan.audio.source)
                ? { source: used.indexOf(plan.audio.source) }
                : { source: undefined }),
            },
          };
          const name = request.separate
            ? `${path.basename(request.name, path.extname(request.name))} ${index + 1}.${extension}`
            : request.name;
          jobs.push(
            await this.operations.start({
              kind: 'convert',
              sources: sources.map((source) => source.path),
              destination: request.destination,
              name,
              transform: remapped,
              expectedSources: sources.map((source) => ({
                path: source.path,
                version: source.version,
              })),
            }),
          );
        }
        return { jobs };
      });
    this.queue = run;
    return run;
  }
  stopOwner(owner: number) {
    for (const value of this.previews.values()) if (value.owner === owner) value.abort.abort();
  }
  invalidate(root?: string) {
    for (const value of this.previews.values()) value.abort.abort();
    for (const [key, value] of this.cache)
      if (!root || value.path === root || value.path.startsWith(root.replace(/\/$/, '') + '/')) {
        this.cache.delete(key);
        this.cacheBytes -= value.cost;
      }
  }
}
