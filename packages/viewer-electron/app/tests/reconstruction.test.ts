import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Canvases } from '../src/desktop/canvases/service';
import { Reconstructions, reconstructionAssetURL } from '../src/desktop/canvases/reconstruction';
import { validateReconstructedGLB } from '../src/desktop/canvases/glb';
import { reconstructionMask } from '../src/desktop/canvases/reconstruction-mask';
import type { ReconstructionJob } from '../src/domain/canvases/reconstruction';
import { temporaryRoot } from '../tools/temporary';
import { jpeg, samReply } from './fabrication-fixtures';

function mesh(metadata: Record<string, unknown> = {}) {
  const source = JSON.stringify({
    asset: { version: '2.0' },
    buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, type: 'VEC3', count: 3 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    ...metadata,
  });
  const json = Buffer.from(source.padEnd(Math.ceil(source.length / 4) * 4));
  const bytes = Buffer.alloc(28 + json.length + 36);
  bytes.writeUInt32LE(0x46546c67);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(json.length, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  json.copy(bytes, 20);
  bytes.writeUInt32LE(36, 20 + json.length);
  bytes.writeUInt32LE(0x004e4942, 24 + json.length);
  return bytes;
}
let root: string;
let canvases: Canvases;
let service: Reconstructions;
let ports: ConstructorParameters<typeof Reconstructions>[1];
let prepared: ReconstructionJob;
const request = vi.fn<typeof fetch>();
const confirm = vi.fn(async () => true);
beforeEach(async () => {
  request.mockReset();
  confirm.mockReset();
  confirm.mockResolvedValue(true);
  root = await temporaryRoot('viewer-reconstruction-');
  canvases = new Canvases(root, { changed: () => {} });
  const canvas = await canvases.create(1, randomUUID(), root);
  const asset = await canvases.attach(1, canvas.id, 'photo.jpg', jpeg(64, 64));
  ports = {
    canvases,
    configured: async () => true,
    secret: async () => 'fixture-only-key',
    confirm,
    request,
    prepare: async () => ({
      image: { type: 'image/jpeg', data: jpeg(64, 64) },
      width: 64,
      height: 64,
    }),
    segment: async () => samReply,
  };
  service = new Reconstructions(root, ports);
  const result = await service.handle(1, {
    kind: 'prepare',
    canvasID: canvas.id,
    assetID: asset.id,
    providerID: 'fixture-sam',
    prompt: 'square',
  });
  prepared = result.job!;
});
afterEach(async () => {
  await service.close();
  await canvases.flush();
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

describe('durable paid reconstruction requests', () => {
  it('requires confirmation and submits the reviewed mask exactly once', async () => {
    expect(request).not.toHaveBeenCalled();
    confirm.mockResolvedValueOnce(false);
    expect((await service.handle(1, { kind: 'start', id: prepared.id })).job?.state).toBe(
      'prepared',
    );
    expect(request).not.toHaveBeenCalled();
    request.mockResolvedValueOnce(json({ request_id: 'request_1' }));
    expect((await service.handle(1, { kind: 'start', id: prepared.id })).job?.remoteID).toBe(
      'request_1',
    );
    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe('https://queue.fal.run/fal-ai/sam-3/3d-objects');
    expect(init?.redirect).toBe('error');
    expect(JSON.parse(init!.body as string)).toEqual({
      image_url: prepared.image,
      mask_urls: [prepared.mask],
      seed: prepared.seed,
      export_textured_glb: true,
    });
    await expect(service.handle(1, { kind: 'start', id: prepared.id })).rejects.toThrow('already');
    expect(request).toHaveBeenCalledOnce();
    expect(
      JSON.stringify(await service.handle(1, { kind: 'list', canvasID: prepared.canvasID })),
    ).not.toContain('base64');
  });

  it('keeps a lost acknowledgement indeterminate through restart without resubmitting', async () => {
    request.mockRejectedValueOnce(new Error('Connection closed after upload'));
    expect((await service.handle(1, { kind: 'start', id: prepared.id })).job?.state).toBe(
      'submission-unknown',
    );
    await service.close();
    service = new Reconstructions(root, ports);
    expect((await service.handle(1, { kind: 'get', id: prepared.id })).job?.state).toBe(
      'submission-unknown',
    );
    await expect(service.handle(1, { kind: 'start', id: prepared.id })).rejects.toThrow('already');
    expect(request).toHaveBeenCalledOnce();
  });

  it('recognizes an interrupted submission when reopening its saved job', async () => {
    const file = path.join(root, 'reconstruction-jobs', prepared.id + '.json');
    await writeFile(file, JSON.stringify({ ...prepared, state: 'submitting' }));
    expect((await service.handle(1, { kind: 'get', id: prepared.id })).job?.state).toBe(
      'submission-unknown',
    );
    expect(request).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(file, 'utf8')).state).toBe('submission-unknown');
  });

  it('resumes a queued request, saves a validated mesh, and never sends the key to the asset host', async () => {
    request.mockResolvedValueOnce(json({ request_id: 'request_1' }));
    await service.handle(1, { kind: 'start', id: prepared.id });
    await service.close();
    service = new Reconstructions(root, ports);
    request.mockResolvedValueOnce(json({ status: 'IN_PROGRESS' }));
    expect((await service.handle(1, { kind: 'get', id: prepared.id })).job?.state).toBe('running');
    request
      .mockResolvedValueOnce(json({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(json({ model_glb: { url: 'https://fal.media/files/model.glb' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array(mesh())));
    const result = (await service.handle(1, { kind: 'get', id: prepared.id })).job!;
    expect(result.state).toBe('succeeded');
    const canvas = await canvases.read(1, prepared.canvasID);
    const asset = canvas.assets.find((item) => item.id === result.assetID)!;
    expect(asset.provenance).toContain('request_1');
    expect(await canvases.assetBytes(asset)).toEqual(mesh());
    expect(request.mock.calls.at(-1)![1]?.headers).toBeUndefined();
    expect(request.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    await service.handle(1, { kind: 'get', id: prepared.id });
    expect(request).toHaveBeenCalledTimes(5);
  });

  it('does not report a point cloud or invalid GLB as a generated mesh', async () => {
    request.mockResolvedValueOnce(json({ request_id: 'request_1' }));
    await service.handle(1, { kind: 'start', id: prepared.id });
    request
      .mockResolvedValueOnce(json({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(json({ model_glb: null }));
    expect((await service.handle(1, { kind: 'get', id: prepared.id })).job?.state).toBe('failed');
    expect((await canvases.read(1, prepared.canvasID)).assets).toHaveLength(1);
  });

  it('distinguishes a cancellation request from cancellation confirmed by fal', async () => {
    request.mockResolvedValueOnce(json({ request_id: 'request_1' }));
    await service.handle(1, { kind: 'start', id: prepared.id });
    request.mockResolvedValueOnce(json({ status: 'CANCELLATION_REQUESTED' }, 202));
    expect((await service.handle(1, { kind: 'cancel', id: prepared.id })).job?.state).toBe(
      'cancel-requested',
    );
    request.mockResolvedValueOnce(json({ status: 'OK' }));
    expect((await service.handle(1, { kind: 'cancel', id: prepared.id })).job?.state).toBe(
      'cancelled',
    );
  });
});

describe('reconstruction assets', () => {
  it('expands the saved SAM mask onto the exact source pixel grid', () => {
    const png = reconstructionMask(samReply, 64, 64);
    expect(png.readUInt32BE(16)).toBe(64);
    expect(png.readUInt32BE(20)).toBe(64);
    const compressedSize = png.readUInt32BE(33);
    const pixels = inflateSync(png.subarray(41, 41 + compressedSize));
    expect([...pixels].filter((value) => value === 255)).toHaveLength(32 * 32);
    expect(pixels[16 * 65 + 17]).toBe(255);
    expect(pixels[15 * 65 + 17]).toBe(0);
    expect(() => reconstructionMask(samReply, 63, 64)).toThrow('aligned');
    expect(() => reconstructionMask('No objects found.', 64, 64)).toThrow('aligned');
  });

  it('rejects external model assets, oversized allocations, malformed meshes, and other hosts', () => {
    expect(() => validateReconstructedGLB(mesh())).not.toThrow();
    expect(() => validateReconstructedGLB(Buffer.from('not a model'))).toThrow();
    expect(() =>
      validateReconstructedGLB(mesh({ buffers: [{ uri: 'file:///private.txt', byteLength: 36 }] })),
    ).toThrow();
    expect(() =>
      validateReconstructedGLB(
        mesh({ accessors: [{ count: 100_000_000, componentType: 5126, type: 'VEC3' }] }),
      ),
    ).toThrow('geometry');
    for (const url of [
      'https://fal.media.evil.invalid/a',
      'http://fal.media/a',
      'https://127.0.0.1/a',
      'https://key@fal.media/a',
    ])
      expect(() => reconstructionAssetURL(url)).toThrow();
  });
});
