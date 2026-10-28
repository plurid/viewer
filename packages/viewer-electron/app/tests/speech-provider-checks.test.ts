import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { newSpeechProvider, type SpeechProviderKind } from '../src/domain/speech/providers';
import { SpeechProviderChecks } from '../src/desktop/speech/provider-check';

const secret = 'GENERATED_CHECK_SECRET';
const signal = () => new AbortController().signal;
const provider = (kind: SpeechProviderKind) => ({
  ...newSpeechProvider(kind, randomUUID()),
  ...(kind === 'compatible'
    ? { endpoint: 'http://127.0.0.1:8142/v1', model: 'speech-fixture' }
    : {}),
});
describe('speech catalog checks', () => {
  it.each<SpeechProviderKind>(['openai', 'meta', 'compatible'])(
    'checks %s with a fixed authenticated GET and no audio',
    async (kind) => {
      const p = provider(kind),
        request = vi.fn<typeof fetch>(async () => Response.json({ data: [{ id: p.model }] }));
      expect(await new SpeechProviderChecks(request).check(p, secret, signal())).toMatchObject({
        outcome: 'available',
      });
      expect(request).toHaveBeenCalledExactlyOnceWith(
        p.endpoint + '/models',
        expect.objectContaining({
          method: 'GET',
          redirect: 'error',
          headers: { Accept: 'application/json', Authorization: 'Bearer ' + secret },
        }),
      );
      expect(request.mock.calls[0]![1]?.body).toBeUndefined();
    },
  );
  it('authenticates Deepgram independently from its public recorded-audio catalog', async () => {
    const p = provider('deepgram'),
      request = vi.fn<typeof fetch>(async (url) =>
        String(url).endsWith('/auth/token')
          ? Response.json({ project_id: randomUUID(), key_id: randomUUID() })
          : Response.json({
              stt: [{ name: 'general', canonical_name: 'nova-3-general', batch: true }],
            }),
      );
    expect(await new SpeechProviderChecks(request).check(p, secret, signal())).toMatchObject({
      outcome: 'available',
    });
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      p.endpoint + '/auth/token',
      p.endpoint + '/models',
    ]);
    expect(request.mock.calls[0]![1]?.headers).toMatchObject({ Authorization: 'Token ' + secret });
    expect(request.mock.calls[1]![1]?.headers).not.toHaveProperty('Authorization');
  });
  it('does not certify a Deepgram streaming-only or unlisted custom model', async () => {
    const request = vi.fn<typeof fetch>(async (url) =>
      Response.json(
        String(url).endsWith('/auth/token')
          ? {}
          : { stt: [{ name: 'nova-3', canonical_name: 'nova-3', batch: false }] },
      ),
    );
    expect(
      (await new SpeechProviderChecks(request).check(provider('deepgram'), secret, signal()))
        .outcome,
    ).toBe('unverified');
  });
  it('does not confuse a catalog success with an available chosen model', async () => {
    const request = vi.fn<typeof fetch>(async () =>
      Response.json({ data: [{ id: 'some-other-model' }] }),
    );
    expect(
      (await new SpeechProviderChecks(request).check(provider('meta'), secret, signal())).outcome,
    ).toBe('model-unavailable');
  });
  it.each([401, 403, 429, 500])(
    'reports HTTP %s without exposing provider bodies or credentials',
    async (status) => {
      const request = vi.fn<typeof fetch>(
        async () => new Response(secret + ' echoed HTML', { status }),
      );
      const result = await new SpeechProviderChecks(request).check(
        provider('openai'),
        secret,
        signal(),
      );
      expect(result.httpStatus).toBe(status);
      expect(result.outcome).toBe(status === 401 || status === 403 ? 'auth-error' : 'http-error');
      expect(JSON.stringify(result)).not.toContain(secret);
    },
  );
  it('reports missing compatible discovery as unverified without claiming authentication', async () => {
    const result = await new SpeechProviderChecks(
      async () => new Response('', { status: 404 }),
    ).check(provider('compatible'), secret, signal());
    expect(result).toMatchObject({ outcome: 'unverified', httpStatus: 404 });
    expect(result.detail).toContain('could not be checked');
  });
  it.each([
    () => new Response('not-json ' + secret),
    () => Response.json({ data: 'unexpected' }),
    () => new Response('x'.repeat(2_000_001)),
  ])('bounds and sanitizes malformed catalogs', async (response) => {
    const result = await new SpeechProviderChecks(async () => response()).check(
      provider('meta'),
      secret,
      signal(),
    );
    expect(result.outcome).toBe('invalid-response');
    expect(result.detail).not.toContain(secret);
  });
  it('bounds stalled responses and honours cancellation', async () => {
    const controller = new AbortController();
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response(
          new ReadableStream({
            start(stream) {
              stream.enqueue(new TextEncoder().encode('{'));
            },
          }),
        ),
    );
    const work = new SpeechProviderChecks(request).check(
      provider('openai'),
      secret,
      controller.signal,
    );
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    controller.abort();
    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
  });
});
