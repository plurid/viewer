import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import type { OperationRequest, Resource } from '../src/domain/contracts';
import { sourceVersion } from '../src/domain/files/inspection';
import { optimizationRecipeSchema } from '../src/domain/operations/optimization';
import { entry } from '../src/desktop/files/filesystem';
import { schemas } from '../src/desktop/ipc/schemas';
import { Operations } from '../src/desktop/operations/operations';
import { OptimizationReviews } from '../src/desktop/transforms/optimization-reviews';
import {
  optimizationFolder,
  optimizationSubfolder,
} from '../src/desktop/transforms/optimization-folders';
import { temporaryRoot } from '../tools/temporary';

async function fixture() {
  const root = await temporaryRoot('viewer-optimization-review-');
  const files = path.join(root, 'Files');
  const destination = path.join(root, 'Exports');
  await Promise.all([mkdir(files), mkdir(destination)]);
  const source = path.join(files, 'Original.jpg');
  await writeFile(source, Buffer.alloc(8192, 19), { flag: 'wx' });
  const requests: OperationRequest[] = [];
  const release = vi.fn();
  const execute = vi.fn(async (_plan, _sources, output: string, signal: AbortSignal) => {
    signal.throwIfAborted();
    await writeFile(output, Buffer.alloc(4096, 37), { flag: 'wx' });
    return { inputBytes: 8192, outputBytes: 4096 };
  });
  const engine = { execute, pdfInspect: async () => ({ pages: 1 }) };
  const service = new OptimizationReviews(
    path.join(root, 'Private'),
    engine,
    {
      grant: async (file): Promise<Resource> => ({
        id: randomUUID(),
        url: 'viewer-resource://test/asset',
        entry: await entry(file),
      }),
      release,
    },
    async () => {},
    (request) => {
      requests.push(request);
      return randomUUID();
    },
    async () => {
      throw new Error('No removal is authorized.');
    },
  );
  const prepare = async () => {
    const value = await service.request(
      {
        kind: 'prepare',
        source,
        version: sourceVersion(await entry(source)),
        requestID: randomUUID(),
        options: { preset: 'balanced' },
      },
      7,
    );
    if (value?.kind !== 'prepared') throw new Error('Missing test candidate');
    return value;
  };
  return { root, files, source, destination, service, prepare, execute, requests, release };
}

it('exports the measured candidate without re-encoding, keeping it alive after its dialog closes', async () => {
  const test = await fixture();
  const candidate = await test.prepare();
  const review = await test.service.request({ kind: 'review', id: candidate.id }, 7);
  expect(review?.kind).toBe('review');
  await expect(test.service.request({ kind: 'review', id: candidate.id }, 8)).rejects.toThrow(
    'no longer available',
  );
  const exported = await test.service.request(
    { kind: 'export', ids: [candidate.id], destination: test.destination },
    7,
  );
  expect(exported?.kind).toBe('exported');
  const request = test.requests[0]!;
  expect(request.expectedSources).toEqual([
    { path: test.source, version: sourceVersion(candidate.source) },
  ]);
  expect(request.preparedTransforms).toEqual([{ path: test.source, id: candidate.id }]);
  // A public operation cannot inject a prepared capability, even if its ID is known.
  const parsed = schemas.operate.parse([request])[0];
  expect(parsed).not.toHaveProperty('preparedTransforms');
  expect(parsed).not.toHaveProperty('reviewedDestination');
  await test.service.stopOwner(7);
  expect(test.release).toHaveBeenCalledTimes(2);
  const output = path.join(test.root, 'Exact reviewed copy.jpg');
  const statistics = await test.service.execute(
    request.transform!,
    request.sources,
    output,
    new AbortController().signal,
    () => {},
    candidate.id,
  );
  expect(await readFile(output)).toEqual(Buffer.alloc(4096, 37));
  expect(statistics).toMatchObject({ inputBytes: 8192, outputBytes: 4096 });
  expect(test.execute).toHaveBeenCalledTimes(1);
  expect(await readFile(test.source)).toEqual(Buffer.alloc(8192, 19));
});

it('rejects modified sources, tampered candidates, reused exports and revoked capabilities', async () => {
  const test = await fixture();
  const candidate = await test.prepare();
  await writeFile(test.source, Buffer.alloc(8193, 20));
  await expect(
    test.service.request({ kind: 'export', ids: [candidate.id], destination: test.destination }, 7),
  ).rejects.toThrow('source changed');
  const current = await test.prepare();
  await test.service.request(
    { kind: 'export', ids: [current.id], destination: test.destination },
    7,
  );
  await expect(
    test.service.request({ kind: 'export', ids: [current.id], destination: test.destination }, 7),
  ).rejects.toThrow('already exported');
  const folders = await readdir(path.join(test.root, 'Private'));
  const encoded = folders.map((folder) => path.join(test.root, 'Private', folder, 'item.jpg'));
  for (const file of encoded) await writeFile(file, 'tampered');
  const request = test.requests[0]!;
  await expect(
    test.service.execute(
      request.transform!,
      request.sources,
      path.join(test.root, 'Rejected.jpg'),
      new AbortController().signal,
      () => {},
      current.id,
    ),
  ).rejects.toThrow('candidate changed');
  await test.service.invalidate(test.files);
  await expect(
    test.service.execute(
      request.transform!,
      request.sources,
      path.join(test.root, 'Revoked.jpg'),
      new AbortController().signal,
      () => {},
      current.id,
    ),
  ).rejects.toThrow('unavailable');
});

it('cancels preparation and preserves its partial candidate without granting a review', async () => {
  const root = await temporaryRoot('viewer-optimization-cancel-');
  const source = path.join(root, 'Source.jpg');
  await writeFile(source, Buffer.alloc(8192), { flag: 'wx' });
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const grant = vi.fn();
  const service = new OptimizationReviews(
    path.join(root, 'Private'),
    {
      execute: async (_plan, _sources, output, signal) => {
        await writeFile(output, 'retained partial candidate', { flag: 'wx' });
        started();
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        );
      },
      pdfInspect: async () => ({ pages: 1 }),
    },
    { grant, release: () => {} },
    async () => {},
    () => randomUUID(),
    async () => {
      throw new Error('No removal is authorized.');
    },
  );
  const requestID = randomUUID();
  const pending = service.request(
    {
      kind: 'prepare',
      source,
      requestID,
      version: sourceVersion(await entry(source)),
      options: { preset: 'balanced' },
    },
    7,
  );
  const rejected = expect(pending).rejects.toThrow('cancelled');
  await ready;
  await service.request({ kind: 'cancel', requestID }, 7);
  await rejected;
  expect(grant).not.toHaveBeenCalled();
  const folders = await readdir(path.join(root, 'Private'));
  expect(await readFile(path.join(root, 'Private', folders[0]!, 'item.jpg'), 'utf8')).toBe(
    'retained partial candidate',
  );
});

it('preserves only relative folders and refuses escapes and links within an export tree', async () => {
  const test = await fixture();
  const nested = path.join(test.files, 'Trip', 'Day 1');
  await mkdir(nested, { recursive: true });
  const source = path.join(nested, 'Photo.jpg');
  await writeFile(source, 'image', { flag: 'wx' });
  const relative = optimizationSubfolder(test.files, source);
  expect(relative).toBe(path.join('Trip', 'Day 1'));
  const folder = await optimizationFolder(test.destination, relative, async () => {});
  expect(folder.endsWith(path.join('Exports', 'Trip', 'Day 1'))).toBe(true);
  expect(() => optimizationSubfolder(test.files, path.join(test.root, 'outside.jpg'))).toThrow(
    'inside',
  );
  expect(() => optimizationSubfolder('/', source)).toThrow('volume root');
  await symlink(test.files, path.join(test.destination, 'Link'));
  await expect(optimizationFolder(test.destination, 'Link', async () => {})).rejects.toThrow(
    'link',
  );
  await expect(optimizationFolder(test.destination, '..', async () => {})).rejects.toThrow(
    'invalid',
  );
});

it('keeps saved recipes portable and rejects embedded locations or execution fields', () => {
  const recipe = {
    id: randomUUID(),
    name: 'Email under 2 MB',
    preserveFolders: true,
    options: {
      preset: 'balanced',
      targetSize: { bytes: 2_000_000, minimumQuality: 65 },
      pdfImages: { maximum: 1600 },
    },
  };
  expect(optimizationRecipeSchema.parse(recipe)).toMatchObject(recipe);
  expect(
    optimizationRecipeSchema.safeParse({ ...recipe, destination: '/private/location' }).success,
  ).toBe(false);
  expect(optimizationRecipeSchema.safeParse({ ...recipe, command: 'anything' }).success).toBe(
    false,
  );
});

it('rejects replacement of a reviewed output folder before a queued export starts', async () => {
  const test = await fixture();
  const candidate = await test.prepare();
  await test.service.request(
    { kind: 'export', ids: [candidate.id], destination: test.destination },
    7,
  );
  await rename(test.destination, test.destination + ' retained');
  await mkdir(test.destination);
  const operations = new Operations(
    async () => {
      throw new Error('No removal is authorized.');
    },
    () => {},
    undefined,
    undefined,
    undefined,
    path.join(test.root, 'Profile'),
    undefined,
    undefined,
    undefined,
    undefined,
    test.service,
  );
  try {
    const id = operations.start(test.requests[0]!);
    await operations.drained();
    const job = operations.all().find((job) => job.id === id)!;
    expect(job.errors[0]?.message).toContain('output folder changed');
    expect(job.completed).toEqual([]);
    expect(test.execute).toHaveBeenCalledTimes(1);
    expect(await readdir(test.destination)).toEqual([]);
  } finally {
    await operations.close();
  }
});
