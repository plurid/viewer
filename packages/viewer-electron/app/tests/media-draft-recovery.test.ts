import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { MediaDocuments } from '../src/desktop/transforms/media-documents';
import type { Transforms } from '../src/desktop/transforms/transforms';
import { mediaDraftSchema } from '../src/domain/media/documents';
import { temporaryRoot } from '../tools/temporary';

it('reapplies saved editing decisions to current authorized media in a new draft', async () => {
  const root = await temporaryRoot('viewer-media-draft-recovery-');
  await mkdir(path.join(root, 'media-drafts'));
  const file = path.join(root, 'Movie.mp4');
  await writeFile(file, 'Generated source inspected through a fake probe', { flag: 'wx' });
  const info = {
    duration: 5,
    extension: 'mp4',
    width: 640,
    height: 360,
    fps: 30,
    video: true,
    audio: true,
  };
  const original = mediaDraftSchema.parse({
    version: 1,
    id: randomUUID(),
    revision: 2,
    sources: [
      { path: file, version: { identity: 'another-computer', modified: 1, size: 1 }, info },
    ],
    plan: { kind: 'media', format: 'mp4', segments: [{ source: 0, start: 1, end: 4 }] },
  });
  const stored = path.join(root, 'media-drafts', original.id + '.json');
  await writeFile(stored, JSON.stringify(original), { flag: 'wx' });
  const bytes = await readFile(stored);
  const access = vi.fn(async () => {}),
    probe = vi.fn(async () => info);
  const service = new MediaDocuments(
    root,
    { probe } as unknown as Transforms,
    {} as never,
    {} as never,
    access,
    async () => [],
  );
  await expect(service.request({ kind: 'get', id: original.id }, 1)).rejects.toThrow(
    'source changed',
  );
  const recovered = mediaDraftSchema.parse(
    await service.request({ kind: 'recover', id: original.id }, 1),
  );
  expect(recovered.id).not.toBe(original.id);
  expect(recovered.plan).toEqual(original.plan);
  expect(recovered.sources[0]!.version.identity).not.toBe('another-computer');
  expect(access).toHaveBeenCalledWith([file]);
  expect(await readFile(stored)).toEqual(bytes);
  probe.mockResolvedValueOnce({ ...info, duration: 2 });
  await expect(service.request({ kind: 'recover', id: original.id }, 1)).rejects.toThrow(
    'shorter than a saved edit',
  );
  access.mockRejectedValueOnce(new Error('File access revoked'));
  await expect(service.request({ kind: 'recover', id: original.id }, 1)).rejects.toThrow('revoked');
  expect(await readFile(stored)).toEqual(bytes);
});
