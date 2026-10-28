import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SpeechModels } from '../src/desktop/speech/models';
import type { SpeechModel } from '../src/domain/speech/models';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const bytes = Buffer.from('Generated model weights — not a recognition engine.');
const model: SpeechModel = {
  id: 'fixture-model',
  name: 'Generated model',
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  url: 'https://huggingface.co/generated/fixture/resolve/pinned/model.bin',
  multilingual: true,
  license: 'MIT',
};
async function fixture(fetcher: typeof fetch = async () => new Response(bytes)) {
  const root = await temporaryRoot('viewer-speech-models-');
  const profile = path.join(root, 'Profile');
  await mkdir(profile);
  const models = new SpeechModels(profile, [model], fetcher);
  return {
    root,
    profile,
    models,
    close: async () => {
      await models.close();
      await trashTemporary(root);
    },
  };
}

describe('managed speech-model weights', () => {
  it('keeps status offline and read-only, without implying recognition is available', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const f = await fixture(fetcher);
    try {
      expect(await f.models.status()).toMatchObject({
        runtime: { recognitionAvailable: false },
        models: [{ installed: false }],
        records: [],
      });
      expect(await readdir(f.profile)).toEqual([]);
      expect(fetcher).not.toHaveBeenCalled();
      for (const kind of ['install', 'import'] as const) {
        const detail = await f.models.describe(
          kind === 'import'
            ? { kind, model: model.id, source: '/generated/model.bin' }
            : { kind, model: model.id },
        );
        expect(detail).toContain('Audio recording and speech recognition are not available.');
      }
      await expect(f.models.describe({ kind: 'use', model: model.id })).rejects.toThrow('Install');
    } finally {
      await f.close();
    }
  });

  it('verifies, explicitly selects and restores weights without redownloading', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(bytes, { headers: { 'content-length': String(bytes.length) } }),
    );
    const f = await fixture(fetcher);
    try {
      await f.models.request({ kind: 'install', model: model.id }, 'download');
      let state = await f.models.status();
      expect(state.models[0]).toMatchObject({ installed: true, selected: false });
      const choice = await f.models.describe({ kind: 'use', model: model.id });
      expect(choice).toContain('selected local model');
      expect(choice).toContain('Audio recording and speech recognition are not available.');
      expect(state.selected).toBeUndefined();
      expect(await readFile(path.join(f.profile, 'speech-models', state.records[0]!.file))).toEqual(
        bytes,
      );
      await f.models.request({ kind: 'install', model: model.id }, 'again');
      expect(fetcher).toHaveBeenCalledTimes(1);
      await f.models.request({ kind: 'use', model: model.id }, 'select');
      await f.models.close();
      const restored = new SpeechModels(f.profile, [model], fetcher);
      try {
        state = await restored.status();
        expect(state).toMatchObject({
          selected: model.id,
          models: [{ installed: true, selected: true }],
        });
        await writeFile(
          path.join(f.profile, 'speech-models', state.records[0]!.file),
          Buffer.alloc(bytes.length),
        );
        expect((await restored.status()).models[0]!.installed).toBe(false);
        await expect(restored.request({ kind: 'use', model: model.id }, 'changed')).rejects.toThrow(
          'verify',
        );
      } finally {
        await restored.close();
      }
    } finally {
      await f.close();
    }
  });

  it.each(['checksum', 'oversized', 'content-length'] as const)(
    'retains %s failures without selecting them',
    async (failure) => {
      const payload =
        failure === 'oversized' ? Buffer.alloc(bytes.length + 1) : Buffer.alloc(bytes.length);
      const f = await fixture(
        async () =>
          new Response(
            payload,
            failure === 'content-length' ? { headers: { 'content-length': '1' } } : {},
          ),
      );
      try {
        await expect(
          f.models.request({ kind: 'install', model: model.id }, 'bad'),
        ).rejects.toThrow();
        const state = await f.models.status();
        expect(state.selected).toBeUndefined();
        expect(state.records).toMatchObject([{ status: 'failed', available: false }]);
        expect(await readdir(path.join(f.profile, 'speech-models'))).toHaveLength(1);
      } finally {
        await f.close();
      }
    },
  );

  it('refuses redirects outside the catalog hosts before contacting them', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }),
    );
    const f = await fixture(fetcher);
    try {
      await expect(
        f.models.request({ kind: 'install', model: model.id }, 'redirect'),
      ).rejects.toThrow('approved HTTPS');
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect((await f.models.status()).models[0]!.installed).toBe(false);
    } finally {
      await f.close();
    }
  });

  it('cancels queued setup without fetching or creating a second model file', async () => {
    let complete!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const f = await fixture(fetcher);
    try {
      const first = f.models.request({ kind: 'install', model: model.id }, 'first');
      const queued = expect(
        f.models.request({ kind: 'install', model: model.id }, 'queued'),
      ).rejects.toThrow();
      f.models.cancel('queued');
      await expect.poll(() => fetcher.mock.calls.length).toBe(1);
      complete(new Response(bytes));
      await first;
      await queued;
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect((await f.models.status()).records).toHaveLength(1);
    } finally {
      await f.close();
    }
  });

  it('imports checksum-matched ordinary files and refuses symlink imports', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const f = await fixture(fetcher);
    try {
      const source = path.join(f.root, 'local-model.bin'),
        link = path.join(f.root, 'link.bin');
      await writeFile(source, bytes);
      await symlink(source, link);
      await expect(
        f.models.request({ kind: 'import', model: model.id, source: link }, 'link'),
      ).rejects.toThrow();
      const failed = (await f.models.status()).records[0]!;
      expect(failed.error).not.toContain(f.root);
      await f.models.request({ kind: 'import', model: model.id, source }, 'ordinary');
      expect((await f.models.status()).models[0]!.installed).toBe(true);
      expect(fetcher).not.toHaveBeenCalled();
      expect(await readFile(source)).toEqual(bytes);
    } finally {
      await f.close();
    }
  });

  it('refuses a redirected model folder and rejects work after closing', async () => {
    const f = await fixture();
    try {
      const outside = path.join(f.root, 'Unshared');
      await mkdir(outside);
      await symlink(outside, path.join(f.profile, 'speech-models'));
      await expect(
        f.models.request({ kind: 'install', model: model.id }, 'redirected-folder'),
      ).rejects.toThrow('ordinary private folder');
      expect(await readdir(outside)).toEqual([]);
      await f.models.close();
      await expect(
        f.models.request({ kind: 'install', model: model.id }, 'closed'),
      ).rejects.toThrow('closed');
    } finally {
      await f.close();
    }
  });

  it.each([
    { id: '../escaped' },
    { sha256: 'not a digest' },
    { bytes: -1 },
    { bytes: 2 ** 32 },
    { url: 'file:///private/model.bin' },
  ])('rejects invalid pinned catalog descriptors: %j', (invalid) => {
    expect(() => new SpeechModels('/unused', [{ ...model, ...invalid }])).toThrow();
  });
});
