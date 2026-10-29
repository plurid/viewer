import { expect, it, vi } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { temporaryRoot } from '../tools/temporary';
import {
  imageTransformSchema,
  mediaTransformSchema,
  validateTransform,
} from '../src/domain/operations/transforms';
import { compileMedia, mediaDemuxer } from '../src/desktop/transforms/media';
import { sourceVersion } from '../src/domain/files/inspection';
import { entry } from '../src/desktop/files/filesystem';
import { Operations } from '../src/desktop/operations/operations';
import { OperationPlans } from '../src/desktop/operations/operation-plans';
import { Checkpoints } from '../src/desktop/operations/checkpoints';
import { MediaDocuments } from '../src/desktop/transforms/media-documents';
import type { Transforms } from '../src/desktop/transforms/transforms';
import type { Resources } from '../src/desktop/previews/resources';
import type { OperationPlan } from '../src/domain/operations/operation-plan';
import type { MediaDraft } from '../src/domain/media/documents';
import type { OperationRequest } from '../src/domain/contracts';

it('records size savings, skips larger candidates and cancels an in-flight export without touching its source', async () => {
  const root = await temporaryRoot('viewer-optimization-publication-'),
    source = path.join(root, 'source.png');
  await writeFile(source, 'source', { flag: 'wx' });
  let cancelMode = false,
    begin!: () => void;
  const begun = new Promise<void>((resolve) => {
    begin = resolve;
  });
  const operations = new Operations(
    async () => {
      throw new Error('No removal is authorized.');
    },
    () => {},
    undefined,
    undefined,
    undefined,
    path.join(root, 'Profile'),
    undefined,
    undefined,
    undefined,
    undefined,
    {
      execute: async (_plan, _files, output, signal) => {
        await writeFile(output, 'larger candidate', { flag: 'wx' });
        if (cancelMode) {
          begin();
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('Cancelled fixture')), {
              once: true,
            });
            if (signal.aborted) reject(new Error('Cancelled fixture'));
          });
        }
        return { inputBytes: 6, outputBytes: 16 };
      },
    },
  );
  try {
    const request = {
      kind: 'convert' as const,
      sources: [source],
      destination: root,
      transform: imageTransformSchema.parse({ kind: 'image', format: 'png', optimize: true }),
      expectedSources: [{ path: source, version: sourceVersion(await entry(source)) }],
    };
    const id = operations.start(request);
    await vi.waitFor(
      () => expect(operations.all().find((job) => job.id === id)?.status).toBe('completed'),
      { timeout: 10000 },
    );
    expect(operations.all().find((job) => job.id === id)!.completed[0]).toMatchObject({
      source,
      inputBytes: 6,
      outputBytes: 16,
      optimized: false,
    });
    await expect(readFile(path.join(root, 'source optimized.png'))).rejects.toThrow();
    cancelMode = true;
    const cancelled = operations.start(request);
    await begun;
    operations.cancel(cancelled);
    await vi.waitFor(
      () => expect(operations.all().find((job) => job.id === cancelled)?.status).toBe('cancelled'),
      { timeout: 10000 },
    );
    expect(await readFile(source, 'utf8')).toBe('source');
  } finally {
    await operations.close();
  }
  const restored = new Operations(
    async () => {
      throw new Error('No removal');
    },
    () => {},
    undefined,
    undefined,
    undefined,
    path.join(root, 'Profile'),
  );
  await restored.load();
  expect(restored.all().find((job) => job.status === 'completed')!.completed[0].optimized).toBe(
    false,
  );
  await restored.close();
});

const facts = {
  extension: 'mp4',
  duration: 10,
  video: true,
  audio: true,
  width: 640,
  height: 360,
  fps: 30,
  videoCodec: 'h264',
  audioCodec: 'aac',
};
const media = (segments = [{ source: 0, start: 0, end: 10 }]) =>
  mediaTransformSchema.parse({ kind: 'media', format: 'mp4', segments });
it('limits typed plans and refuses execution text, excessive dimensions, invalid source indices and incompatible fast cuts', () => {
  expect(() =>
    validateTransform({ ...media(), args: ['-filter_complex', 'movie=https://example.com'] }, 1),
  ).toThrow();
  expect(() =>
    validateTransform(
      {
        ...imageTransformSchema.parse({ kind: 'image', format: 'webp' }),
        width: 20000,
        height: 20000,
      },
      1,
    ),
  ).toThrow('100 megapixels');
  expect(() => validateTransform(media([{ source: 1, start: 0, end: 1 }]), 1)).toThrow('source');
  expect(() => validateTransform({ ...media(), audio: { mode: 'replace' } }, 1)).toThrow(
    'audio source',
  );
  expect(() =>
    validateTransform(
      {
        ...media([
          { source: 0, start: 0, end: 1 },
          { source: 0, start: 2, end: 3 },
        ]),
        cut: 'keyframe',
      },
      1,
    ),
  ).toThrow('Fast keyframe');
  expect(() => mediaDemuxer('m3u8')).toThrow('supported');
  // containers Chromium cannot play, read for a compatibility copy
  expect(['wmv', 'flv', '3gp', 'vob', 'mxf', 'mts', 'wma', 'ape'].map(mediaDemuxer)).toEqual([
    'asf',
    'flv',
    'mov',
    'mpeg',
    'mxf',
    'mpegts',
    'asf',
    'ape',
  ]);
});
it('copies only a compatible whole clip by default, encodes exact partial cuts and restricts all input/output protocols to held descriptors', () => {
  const full = compileMedia(media(), [facts], (index) => index + 3, 4);
  expect(full.copied).toBe(true);
  const cut = compileMedia(
    media([{ source: 0, start: 1.125, end: 2.875 }]),
    [facts],
    (index) => index + 3,
    4,
  );
  expect(cut.copied).toBe(false);
  expect(cut.duration).toBe(1.75);
  expect(cut.args).toContain('h264_videotoolbox');
  expect(cut.args).toContain('fd,pipe');
  expect(cut.args.at(-1)).toBe('fd:');
  expect(() =>
    compileMedia(
      { ...media(), cut: 'keyframe' },
      [{ ...facts, videoCodec: 'vp9' }],
      (index) => index + 3,
      4,
    ),
  ).toThrow('H.264');
  expect(() =>
    compileMedia(media([{ source: 0, start: 0, end: 11 }]), [facts], (index) => index + 3, 4),
  ).toThrow('duration');
});
it('publishes new output with keep-both collisions, retains its typed receipt and rejects a source changed during processing', async () => {
  const root = await temporaryRoot('viewer-typed-operations-'),
    file = path.join(root, 'source.png');
  await writeFile(file, 'source bytes', { flag: 'wx' });
  const name = 'source.png',
    plan = imageTransformSchema.parse({ kind: 'image', format: 'png' });
  let changeSource = false;
  const execute = vi.fn(async (_plan, _sources, output, signal, progress) => {
    signal.throwIfAborted();
    progress(0.5, 'Processing fixture');
    await writeFile(output, 'new output', { flag: 'wx' });
    if (changeSource) await writeFile(file, 'changed source');
  });
  const operations = new Operations(
    async () => {
      throw new Error('No Trash action is authorized in this test.');
    },
    () => {},
    undefined,
    undefined,
    undefined,
    path.join(root, 'Profile'),
    undefined,
    undefined,
    undefined,
    undefined,
    { execute },
  );
  try {
    const request = {
      kind: 'convert' as const,
      sources: [file],
      destination: root,
      name,
      transform: plan,
      expectedSources: [{ path: file, version: sourceVersion(await entry(file)) }],
    };
    const id = operations.start(request);
    await vi.waitFor(
      () => expect(operations.all().find((job) => job.id === id)?.status).toBe('completed'),
      { timeout: 10000 },
    );
    const job = operations.all().find((job) => job.id === id)!;
    expect(job.completed[0].destination).not.toBe(file);
    expect(await readFile(file, 'utf8')).toBe('source bytes');
    expect(await readFile(job.completed[0].destination!, 'utf8')).toBe('new output');
    changeSource = true;
    const changed = operations.start({ ...request, name: 'changed.png' });
    await vi.waitFor(
      () => expect(operations.all().find((job) => job.id === changed)?.status).toBe('failed'),
      { timeout: 10000 },
    );
    await expect(readFile(path.join(root, 'changed.png'))).rejects.toThrow();
    expect(operations.all().find((job) => job.id === changed)!.errors[0].message).toContain(
      'source changed',
    );
    const receipts = await readFile(
      path.join(root, 'Profile', 'file-operations-v1.json'),
      'utf8',
    ).catch(() => '');
    // The journal's filename is private; final reload below proves its durable plan and job.
    void receipts;
  } finally {
    await operations.close();
  }
  const restored = new Operations(
    async () => {
      throw new Error('No removal');
    },
    () => {},
    undefined,
    undefined,
    undefined,
    path.join(root, 'Profile'),
  );
  await restored.load();
  expect(restored.all().some((job) => job.status === 'completed')).toBe(true);
  await restored.close();
});
it.each(['media', 'pdf-pages'] as const)(
  'prepares a combined %s row without writing outputs and pins every source again at review',
  async (kind) => {
    const root = await temporaryRoot('viewer-transform-plan-'),
      destination = path.join(root, 'Output');
    await mkdir(destination);
    const extension = kind === 'media' ? 'mp4' : 'pdf';
    const files = [path.join(root, 'one.' + extension), path.join(root, 'two.' + extension)];
    for (const file of files) await writeFile(file, 'fixture', { flag: 'wx' });
    const operations = new Operations(
      async () => {
        throw new Error('No removal');
      },
      () => {},
    );
    const checkpoints = new Checkpoints(
      path.join(root, 'Checkpoints'),
      async () => {},
      () => 1048576,
    );
    const plans = new OperationPlans(
      path.join(root, 'Plans'),
      operations,
      checkpoints,
      async () => {},
    );
    try {
      const plan = (await plans.request({
        kind: 'prepare',
        title: 'Join',
        intents: [
          {
            kind: 'convert',
            sources: files,
            destination,
            name: 'joined.' + extension,
            transform:
              kind === 'media'
                ? media([
                    { source: 0, start: 0, end: 1 },
                    { source: 1, start: 0, end: 1 },
                  ])
                : {
                    kind: 'pdf-pages',
                    format: 'pdf',
                    pages: [
                      { source: 0, page: 1, rotate: 0 },
                      { source: 1, page: 1, rotate: 0 },
                    ],
                  },
          },
        ],
      })) as OperationPlan;
      expect(plan.rows).toHaveLength(1);
      expect(plan.rows[0].sources).toEqual(files);
      expect(plan.rows[0].expectedSources).toHaveLength(2);
      expect(operations.all()).toEqual([]);
      await writeFile(files[1], 'new content');
      await expect(
        plans.request({
          kind: 'apply',
          id: plan.id,
          revision: plan.revision,
          checkpoint: false,
          rows: [{ id: plan.rows[0].id, approved: true }],
        }),
      ).rejects.toThrow('source changed');
      expect(operations.all()).toEqual([]);
    } finally {
      await plans.close();
      await operations.close();
      await checkpoints.close();
    }
  },
);
it('restores private media drafts, serializes revisions, remaps separate exports and reuses only version-current inspection data', async () => {
  const root = await temporaryRoot('viewer-media-documents-'),
    files = [path.join(root, 'one.mp4'), path.join(root, 'two.mp4')];
  for (const file of files) await writeFile(file, 'fixture', { flag: 'wx' });
  const frame = vi.fn(async () => Buffer.from('generated frame')),
    waveform = vi.fn(async () => [0.2, 0.8]);
  const transforms = { probe: async () => facts, frame, waveform } as unknown as Transforms;
  const requests: OperationRequest[] = [];
  const operations = {
    start: (value: OperationRequest) => {
      requests.push(value);
      return crypto.randomUUID();
    },
  } as unknown as Operations;
  const resources = {
    grantBytes: async (_source: string, _name: string, bytes: Buffer) => ({
      id: crypto.randomUUID(),
      url: 'fixture:' + bytes.length,
      entry: await entry(files[0]),
    }),
  } as unknown as Resources;
  const documents = () =>
    new MediaDocuments(
      root,
      transforms,
      operations,
      resources,
      async () => {},
      async () => [],
    );
  const service = documents(),
    draft = (await service.request({ kind: 'create', paths: files }, 1)) as MediaDraft;
  const audioDraft = (await service.request(
    { kind: 'create', paths: files, preset: 'extract-audio' },
    1,
  )) as MediaDraft;
  expect(audioDraft.plan.format).toBe('m4a');
  expect(audioDraft.plan.segments).toEqual(
    files.map((_file, source) => ({ source, start: 0, end: facts.duration })),
  );
  expect(draft.plan.format).toBe('mp4');
  const updated = (await service.request(
    {
      kind: 'update',
      id: draft.id,
      revision: 1,
      plan: media([
        { source: 1, start: 0.1, end: 1 },
        { source: 0, start: 2, end: 3 },
      ]),
    },
    1,
  )) as MediaDraft;
  await expect(
    service.request({ kind: 'update', id: draft.id, revision: 1, plan: media() }, 1),
  ).rejects.toThrow('another plane');
  expect(
    ((await documents().request({ kind: 'get', id: draft.id }, 1)) as MediaDraft).plan,
  ).toEqual(updated.plan);
  await service.request(
    {
      kind: 'export',
      id: draft.id,
      revision: 2,
      destination: root,
      name: 'pieces.mp4',
      separate: true,
    },
    1,
  );
  expect(requests.map((request) => request.sources)).toEqual([[files[1]], [files[0]]]);
  expect(
    requests.every(
      (request) =>
        request.transform?.kind === 'media' && request.transform.segments[0].source === 0,
    ),
  ).toBe(true);
  for (let index = 0; index < 2; index++)
    await service.request(
      { kind: 'frame', id: draft.id, source: 0, seconds: 0.5, requestID: crypto.randomUUID() },
      1,
    );
  expect(frame).toHaveBeenCalledTimes(1);
  service.invalidate();
  await service.request(
    { kind: 'frame', id: draft.id, source: 0, seconds: 0.5, requestID: crypto.randomUUID() },
    1,
  );
  expect(frame).toHaveBeenCalledTimes(2);
  await writeFile(files[0], 'source changed');
  await expect(
    service.request(
      { kind: 'frame', id: draft.id, source: 0, seconds: 0.5, requestID: crypto.randomUUID() },
      1,
    ),
  ).rejects.toThrow('source changed');
});
