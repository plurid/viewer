import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  newSpeechProvider,
  speechProviderSchema,
  validSpeechEndpoint,
  type SpeechProviderKind,
} from '../src/domain/speech/providers';
import { HostedTranscription, speechWAV } from '../src/desktop/speech/transcription';
import { SpeechProviders } from '../src/desktop/speech/providers';
import { SpeechProviderChecks } from '../src/desktop/speech/provider-check';
import { Credentials } from '../src/desktop/models/providers';
import { temporaryRoot } from '../tools/temporary';
import { Speech } from '../src/desktop/speech/service';

const pcm = new Uint8Array(32000),
  secret = 'GENERATED_PRIVATE_TEST_KEY';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const managers: SpeechProviders[] = [];
it('requires audio consent before microphone authority and transcribes without a local engine', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ text: 'Editable hosted words' }));
  const f = await fixture(fetcher);
  const models = {
    status: vi.fn(async () => ({
      models: [],
      records: [],
      runtime: {
        name: 'whisper.cpp' as const,
        recognitionAvailable: false,
        reason: 'Not installed',
      },
    })),
    selectedFile: vi.fn(async () => {
      throw new Error('No local weights');
    }),
    describe: vi.fn(async () => ''),
    request: vi.fn(),
    cancel: vi.fn(),
    validateSelection: vi.fn(),
  };
  const runtime = {
    status: vi.fn(async () => ({
      name: 'whisper.cpp' as const,
      recognitionAvailable: false,
      reason: 'Not installed',
    })),
    transcribe: vi.fn(),
  };
  const microphone = vi.fn(async () => true);
  const speech = new Speech(
    f.root,
    models,
    runtime,
    {
      human: (owner) => owner > 0,
      settings: (owner) => owner === 2,
      foreground: () => true,
      microphone: () => 'not-determined',
      requestMicrophone: microphone,
      chooseModel: async () => undefined,
      changed: () => {},
      event: () => {},
    },
    f.manager,
  );
  f.ports.invalidated.mockImplementation((id: string) => speech.invalidateProvider(id));
  try {
    await speech.request(
      {
        kind: 'preferences',
        preferences: {
          backend: 'hosted',
          providerID: f.provider.id,
          language: 'en',
          microphone: '',
        },
      },
      2,
    );
    await f.key();
    await expect(speech.request({ kind: 'begin', id: randomUUID() }, 1)).rejects.toThrow(
      'Allow this',
    );
    expect(microphone).not.toHaveBeenCalled();
    await f.allow();
    const id = randomUUID();
    expect(await speech.request({ kind: 'begin', id }, 1)).toMatchObject({
      processing: { kind: 'hosted', providerID: f.provider.id },
    });
    expect(speech.allowsMicrophone(1)).toBe(true);
    expect(await speech.request({ kind: 'transcribe', id, pcm }, 1)).toMatchObject({
      text: 'Editable hosted words',
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(models.selectedFile).not.toHaveBeenCalled();
    expect(runtime.transcribe).not.toHaveBeenCalled();
    const next = randomUUID();
    await speech.request({ kind: 'begin', id: next }, 1);
    await f.manager.request({ kind: 'provider-consent', id: f.provider.id, allow: false });
    expect(speech.allowsMicrophone(1)).toBe(false);
    await expect(speech.request({ kind: 'transcribe', id: next, pcm }, 1)).rejects.toThrow('ended');
    expect(fetcher).toHaveBeenCalledOnce();
    await expect(
      speech.request({ kind: 'provider-key', id: f.provider.id, key: 'NO' }, 1),
    ).rejects.toThrow('Settings');
  } finally {
    await speech.close();
  }
});
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.close()));
});
async function fixture(
  fetcher: typeof fetch = async () => Response.json({ text: 'Generated transcript' }),
) {
  const root = await temporaryRoot('viewer-speech-hosted-');
  // Test encryption isolates credential lifecycle; production supplies Electron safeStorage.
  const encrypt = vi.fn(async (value: string) => Buffer.from('test:' + value));
  const credentials = new Credentials(path.join(root, 'private'), encrypt, async (value) =>
    value.toString().slice(5),
  );
  const ports = {
    confirm: vi.fn(async () => true),
    changed: vi.fn(),
    invalidated: vi.fn<(id: string) => void>(),
  };
  const manager = new SpeechProviders(
    root,
    credentials,
    ports,
    new HostedTranscription(fetcher),
    new SpeechProviderChecks(fetcher),
  );
  managers.push(manager);
  const provider = newSpeechProvider('openai', randomUUID());
  await manager.request({ kind: 'provider-save', provider });
  const key = () => manager.request({ kind: 'provider-key', id: provider.id, key: secret });
  const allow = () => manager.request({ kind: 'provider-consent', id: provider.id, allow: true });
  return { root, credentials, encrypt, ports, manager, provider, key, allow };
}
it('checks without audio consent, keeps permission independent and forgets checks on credential edits or restart', async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ data: [{ id: f.provider.model }] }),
  );
  const f = await fixture(fetcher);
  await f.key();
  await f.manager.check(f.provider.id);
  expect((await f.manager.status()).providers[0]).toMatchObject({
    allowed: false,
    check: { outcome: 'available' },
  });
  expect(f.ports.confirm).not.toHaveBeenCalled();
  await f.allow();
  expect((await f.manager.status()).providers[0]).toMatchObject({
    allowed: true,
    check: { outcome: 'available' },
  });
  const restarted = new SpeechProviders(f.root, f.credentials, f.ports);
  managers.push(restarted);
  expect((await restarted.status()).providers[0]?.check).toBeUndefined();
  await f.manager.request({ kind: 'provider-key', id: f.provider.id, key: 'replacement' });
  expect((await f.manager.status()).providers[0]).toMatchObject({
    allowed: false,
    check: undefined,
  });
});
it('cannot send a late check after key revocation while credentials are pending', async () => {
  const fetcher = vi.fn<typeof fetch>(),
    f = await fixture(fetcher);
  await f.key();
  const key = deferred<string>(),
    get = vi.spyOn(f.credentials, 'get').mockImplementationOnce(() => key.promise);
  const check = f.manager.check(f.provider.id).catch((error: Error) => error);
  await vi.waitFor(() => expect(get).toHaveBeenCalledOnce());
  await f.manager.request({ kind: 'provider-key', id: f.provider.id, key: '' });
  expect(await check).toMatchObject({ name: 'AbortError' });
  key.resolve(secret);
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(fetcher).not.toHaveBeenCalled();
  expect((await f.manager.status()).providers[0]?.check).toBeUndefined();
});
describe('hosted speech wire protocols', () => {
  it('persists consent revocation before a failed credential change, including after restart', async () => {
    const f = await fixture();
    await f.key();
    await f.allow();
    vi.spyOn(f.credentials, 'set').mockRejectedValueOnce(
      new Error('Generated credential write failure'),
    );
    await expect(
      f.manager.request({ kind: 'provider-key', id: f.provider.id, key: 'replacement' }),
    ).rejects.toThrow('credential write');
    const stored = JSON.parse(
      await readFile(path.join(f.root, 'speech-providers-v1.json'), 'utf8'),
    );
    expect(stored.consents[f.provider.id]).toBeUndefined();
    const restarted = new SpeechProviders(f.root, f.credentials, f.ports);
    managers.push(restarted);
    expect((await restarted.status()).providers[0]?.allowed).toBe(false);
    await expect(restarted.prepare(f.provider.id, 'en')).rejects.toThrow('Allow this');
  });
  it('encodes bounded WAV with explicit mono PCM metadata', () => {
    const wav = speechWAV(pcm),
      view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(32000);
    expect(() => speechWAV(new Uint8Array(1920002))).toThrow('60 seconds');
  });
  it.each<SpeechProviderKind>(['meta', 'openai', 'deepgram', 'compatible'])(
    'uses the documented %s request and normalizes editable text',
    async (kind) => {
      const provider = {
        ...newSpeechProvider(kind, randomUUID()),
        ...(kind === 'compatible'
          ? { endpoint: 'https://speech.example.test/v1', model: 'fixture-model' }
          : {}),
      };
      const fetcher = vi.fn<typeof fetch>(async (url, init) => {
        const headers = new Headers(init?.headers);
        expect(headers.get('Authorization')).toBe(
          (kind === 'deepgram' ? 'Token ' : 'Bearer ') + secret,
        );
        expect(init?.redirect).toBe('error');
        expect(init?.method).toBe('POST');
        if (kind === 'meta') {
          expect(String(url)).toBe('https://api.meta.ai/v1/asr/transcribe');
          const body = new TextDecoder().decode(init?.body as Uint8Array);
          expect(body).toContain('name="request"\r\nContent-Type: application/json');
          expect(body).not.toContain('name="request"; filename=');
          expect(body).toContain('"audioEncoding":"WAV"');
          expect(body).toContain('"languageBias":["English"]');
          expect(body).toContain('name="audio"; filename="recording.wav"');
          return Response.json({
            transcript: '  Meta words  ',
            turns: [],
            audioDurationMs: 1000,
            sessionId: 'generated',
          });
        }
        if (kind === 'deepgram') {
          const requestURL = new URL(String(url));
          expect(requestURL.pathname).toBe('/v1/listen');
          expect(requestURL.searchParams.get('language')).toBe('en');
          expect(requestURL.searchParams.get('model')).toBe('nova-3');
          expect(headers.get('Content-Type')).toBe('audio/wav');
          expect((init?.body as Uint8Array).length).toBe(32044);
          return Response.json({
            results: {
              channels: [
                { detected_language: 'en', alternatives: [{ transcript: '  Deepgram words  ' }] },
              ],
            },
          });
        }
        const form = init?.body as FormData;
        expect(form.get('model')).toBe(provider.model);
        expect(form.get('language')).toBe('en');
        expect(form.get('response_format')).toBe('json');
        expect((form.get('file') as File).name).toBe('recording.wav');
        return Response.json({ text: '  Compatible words  ' });
      });
      const result = await new HostedTranscription(fetcher).transcribe(
        provider,
        secret,
        pcm,
        'en',
        new AbortController().signal,
      );
      expect(result.text).toBe(
        kind === 'meta'
          ? 'Meta words'
          : kind === 'deepgram'
            ? 'Deepgram words'
            : 'Compatible words',
      );
      expect(result.seconds).toBe(1);
      expect(result.model).toBe(provider.model);
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );
  it('does not send unsupported Meta language hints or accept redirected named endpoints', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      new HostedTranscription(fetcher).transcribe(
        newSpeechProvider('meta', randomUUID()),
        secret,
        pcm,
        'ro',
        new AbortController().signal,
      ),
    ).rejects.toThrow('does not list');
    expect(fetcher).not.toHaveBeenCalled();
    expect(validSpeechEndpoint('meta', 'https://another.example/v1')).toBe(false);
    expect(validSpeechEndpoint('compatible', 'http://another.example/v1')).toBe(false);
    expect(validSpeechEndpoint('compatible', 'http://127.0.0.1:1234/v1')).toBe(true);
    expect(
      speechProviderSchema.safeParse({
        ...newSpeechProvider('openai', randomUUID()),
        model: 'bad\nmodel',
      }).success,
    ).toBe(false);
  });
  it.each([401, 403, 429, 500, 302])(
    'reports HTTP %i without leaking provider error bodies or retrying',
    async (status) => {
      const fetcher = vi.fn<typeof fetch>(async () =>
        Response.json({ error: { message: secret } }, { status }),
      );
      const error = await new HostedTranscription(fetcher)
        .transcribe(
          newSpeechProvider('openai', randomUUID()),
          secret,
          pcm,
          'auto',
          new AbortController().signal,
        )
        .catch((error: Error) => error);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain(String(status));
      expect(String(error)).not.toContain(secret);
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );
  it('rejects oversized and malformed responses and cancels a stalled response body', async () => {
    const provider = newSpeechProvider('openai', randomUUID());
    await expect(
      new HostedTranscription(async () => new Response('x'.repeat(262145))).transcribe(
        provider,
        secret,
        pcm,
        'auto',
        new AbortController().signal,
      ),
    ).rejects.toThrow('size limit');
    const malformed = await new HostedTranscription(async () =>
      Response.json({ unexpected: secret }),
    )
      .transcribe(provider, secret, pcm, 'auto', new AbortController().signal)
      .catch((error: Error) => error);
    expect(String(malformed)).not.toContain(secret);
    expect(String(malformed)).toContain('incompatible');
    const cancel = vi.fn(),
      started = deferred<void>();
    const transport = new HostedTranscription(async () => {
      started.resolve();
      return new Response(new ReadableStream({ cancel }));
    });
    const controller = new AbortController(),
      work = transport
        .transcribe(provider, secret, pcm, 'auto', controller.signal)
        .catch((error: Error) => error);
    await started.promise;
    controller.abort();
    expect(await work).toBeInstanceOf(Error);
    expect(cancel).toHaveBeenCalled();
  });
});
describe('private audio consent and credentials', () => {
  it('never exposes stored keys in snapshots or config and requires a separate audio approval', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ text: 'Draft' })),
      f = await fixture(fetcher);
    await f.key();
    expect(f.encrypt).toHaveBeenCalledWith(secret);
    expect(JSON.stringify(await f.manager.status())).not.toContain(secret);
    expect(await readFile(path.join(f.root, 'speech-providers-v1.json'), 'utf8')).not.toContain(
      secret,
    );
    await expect(f.manager.prepare(f.provider.id, 'en')).rejects.toThrow('Allow this endpoint');
    expect(fetcher).not.toHaveBeenCalled();
    f.ports.confirm.mockResolvedValueOnce(false);
    await f.allow();
    await expect(f.manager.prepare(f.provider.id, 'en')).rejects.toThrow('Allow this endpoint');
    await f.allow();
    const lease = await f.manager.prepare(f.provider.id, 'en');
    expect((await f.manager.transcribe(lease, pcm, 'en', new AbortController().signal)).text).toBe(
      'Draft',
    );
  });
  it('keeps a key for model changes but revokes audio consent; endpoint changes clear its key', async () => {
    const f = await fixture();
    await f.key();
    await f.allow();
    const old = await f.manager.prepare(f.provider.id, 'en');
    const changed = { ...f.provider, model: 'another-transcription-model' };
    await f.manager.request({ kind: 'provider-save', provider: changed });
    expect((await f.manager.status()).providers[0]).toMatchObject({ allowed: false, hasKey: true });
    await expect(
      f.manager.transcribe(old, pcm, 'en', new AbortController().signal),
    ).rejects.toThrow('Allow this endpoint');
    await f.manager.request({
      kind: 'provider-save',
      provider: { ...changed, kind: 'compatible', endpoint: 'https://different.example/v1' },
    });
    expect((await f.manager.status()).providers[0]).toMatchObject({
      allowed: false,
      hasKey: false,
    });
    expect(f.credentials.ids()).toEqual([]);
  });
  it('cannot revive an approval after revocation while the native confirmation was pending', async () => {
    const f = await fixture(),
      gate = deferred<boolean>();
    await f.key();
    f.ports.confirm.mockImplementation(() => gate.promise);
    const work = f.allow().catch((error: Error) => error);
    await vi.waitFor(() => expect(f.ports.confirm).toHaveBeenCalledOnce());
    await f.manager.request({ kind: 'provider-consent', id: f.provider.id, allow: false });
    gate.resolve(true);
    expect(await work).toBeInstanceOf(Error);
    expect((await f.manager.status()).providers[0]!.allowed).toBe(false);
  });
  it('revocation aborts in-flight upload and rejects late results', async () => {
    const gate = deferred<Response>(),
      started = deferred<AbortSignal>();
    const f = await fixture(async (_url, init) => {
      started.resolve(init!.signal!);
      return gate.promise;
    });
    await f.key();
    await f.allow();
    const lease = await f.manager.prepare(f.provider.id, 'en'),
      work = f.manager
        .transcribe(lease, pcm, 'en', new AbortController().signal)
        .catch((error: Error) => error);
    const signal = await started.promise;
    await f.manager.request({ kind: 'provider-consent', id: f.provider.id, allow: false });
    expect(signal.aborted).toBe(true);
    gate.resolve(Response.json({ text: 'Must not reach a draft' }));
    expect(await work).toBeInstanceOf(Error);
  });
  it('restores endpoint-bound consent and encrypted key metadata without opening a microphone or contacting a provider', async () => {
    const f = await fixture();
    await f.key();
    await f.allow();
    await f.manager.close();
    const fetcher = vi.fn<typeof fetch>(),
      restored = new SpeechProviders(
        f.root,
        f.credentials,
        f.ports,
        new HostedTranscription(fetcher),
      );
    managers.push(restored);
    expect((await restored.status()).providers[0]).toMatchObject({ hasKey: true, allowed: true });
    await restored.prepare(f.provider.id, 'en');
    expect(fetcher).not.toHaveBeenCalled();
    await restored.request({ kind: 'provider-key', id: f.provider.id, key: '' });
    expect((await restored.status()).providers[0]).toMatchObject({ hasKey: false, allowed: false });
  });
});
