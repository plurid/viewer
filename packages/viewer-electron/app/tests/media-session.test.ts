import { expect, it, vi } from 'vitest';
import type { ViewerAPI } from '../src/domain/contracts';
import type { MediaDraft } from '../src/domain/media/documents';
import { mediaDraftSchema } from '../src/domain/media/documents';
import { mediaSession } from '../src/renderer/media/drafts';

function fixture() {
  let saved = mediaDraftSchema.parse({
    version: 1,
    id: crypto.randomUUID(),
    revision: 1,
    sources: [
      {
        path: '/fixture/movie.mp4',
        version: { identity: 'fixture:1', modified: 1, size: 1 },
        info: {
          duration: 10,
          extension: 'mp4',
          width: 640,
          height: 360,
          fps: 30,
          video: true,
          audio: true,
        },
      },
    ],
    plan: { kind: 'media', format: 'mp4', segments: [{ source: 0, start: 0, end: 10 }] },
  });
  const media = vi.fn<ViewerAPI['media']>(async (request) => {
    if (request.kind === 'get') return structuredClone(saved);
    if (request.kind === 'update') {
      expect(request.revision).toBe(saved.revision);
      saved = mediaDraftSchema.parse({
        ...saved,
        revision: saved.revision + 1,
        plan: request.plan,
      });
      return structuredClone(saved);
    }
    throw new Error('Unexpected request');
  });
  const api = { media, onEvent: () => () => {} } as unknown as ViewerAPI;
  const session = mediaSession(saved.id, api);
  return { session, media, saved: () => saved };
}

it('keeps unsaved editing decisions when retrying a draft that cannot yet save', async () => {
  const f = fixture();
  try {
    await vi.waitFor(() => expect(f.session.snapshot().loading).toBe(false));
    f.session.plan((plan) => ({ ...plan, segments: [{ source: 0, start: 1.5, end: 10 }] }));
    f.media.mockRejectedValueOnce(new Error('File access unavailable'));
    await f.session.reload();
    expect(f.session.snapshot()).toMatchObject({
      dirty: true,
      unavailable: true,
      draft: { plan: { segments: [{ start: 1.5 }] } },
    });
    expect(f.saved().plan.segments[0]!.start).toBe(0);
    expect(f.media.mock.calls.filter(([request]) => request.kind === 'get')).toHaveLength(1);
    await f.session.reload();
    expect(f.session.snapshot()).toMatchObject({
      dirty: false,
      unavailable: false,
      draft: { plan: { segments: [{ start: 1.5 }] } },
    });
    expect(f.saved().plan.segments[0]!.start).toBe(1.5);
  } finally {
    f.session.dispose();
  }
});

it('does not overwrite an edit made while a reload read is in flight', async () => {
  const f = fixture();
  try {
    await vi.waitFor(() => expect(f.session.snapshot().loading).toBe(false));
    let finish!: (draft: MediaDraft) => void;
    f.media.mockImplementationOnce(
      () =>
        new Promise<MediaDraft>((resolve) => {
          finish = resolve;
        }),
    );
    const reloading = f.session.reload();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    f.session.plan((plan) => ({ ...plan, segments: [{ source: 0, start: 2, end: 10 }] }));
    finish(structuredClone(f.saved()));
    await reloading;
    expect(f.session.snapshot()).toMatchObject({
      dirty: true,
      draft: { plan: { segments: [{ start: 2 }] } },
    });
    await f.session.flush();
    expect(f.saved().plan.segments[0]!.start).toBe(2);
  } finally {
    f.session.dispose();
  }
});
