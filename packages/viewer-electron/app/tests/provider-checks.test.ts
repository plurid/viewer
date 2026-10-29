import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Credentials, Providers, providerBinding } from '../src/desktop/models/providers';
import { ModelPermissions } from '../src/desktop/models/model-permissions';
import {
  providerCheckBody,
  redactProviderCheckMessage,
} from '../src/desktop/models/provider-checks';
import { providerCheckKinds } from '../src/domain/models/provider-checks';
import { chatStepSchema } from '../src/domain/models/chat';
import { newModelProvider } from '../src/domain/models/providers';
import { geminiGenerationSchema } from '../src/desktop/models/provider-schema';
import { schemas, methodWindows } from '../src/desktop/ipc/schemas';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const secret = 'AIzaGENERATED_TEST_SECRET_abcdefghijklmnopqrstuvwxyz';
const marker = 'VIEWER_PROVIDER_CHECK_OK';
const provider = { ...newModelProvider('gemini', 'generated-check'), model: 'gemini-fixture' };
const chat = {
  kind: 'reply',
  text: marker,
  path: null,
  query: null,
  commandID: null,
  patches: [],
  renames: [],
  files: [],
};
const completed = (content: string) =>
  Response.json({ choices: [{ finish_reason: 'stop', message: { content } }] });
let root: string;
let credentials: Credentials;
let permissions: ModelPermissions;

beforeEach(async () => {
  root = await temporaryRoot('viewer-provider-check-');
  credentials = new Credentials(
    root,
    async (value) => Buffer.from(value),
    async (value) => value.toString(),
  );
  await credentials.set(provider.id, secret, providerBinding(provider));
  permissions = new ModelPermissions(root, () => [provider]);
  await permissions.set(provider, 'names');
});
afterEach(async () => {
  vi.restoreAllMocks();
  await permissions.close();
  await trashTemporary(root);
});

describe('fixed no-file Gemini checks', () => {
  it('varies only response_format, keeping the production budget and fixed messages identical', () => {
    const bodies = providerCheckKinds.map((kind) => providerCheckBody(provider.model, kind));
    const base = bodies.map(({ response_format: _format, ...body }) => body);
    expect(base[1]).toEqual(base[0]);
    expect(base[2]).toEqual(base[0]);
    expect(base[0]).toMatchObject({ model: provider.model, max_tokens: 12000, stream: false });
    expect(bodies[0]).not.toHaveProperty('response_format');
    expect(bodies[1]).toMatchObject({
      response_format: {
        type: 'json_schema',
        json_schema: {
          strict: true,
          schema: { properties: { ok: { type: 'boolean' } }, additionalProperties: false },
        },
      },
    });
    expect(bodies[2]).toMatchObject({
      response_format: {
        type: 'json_schema',
        json_schema: {
          strict: true,
          schema: geminiGenerationSchema(z.toJSONSchema(chatStepSchema)),
        },
      },
    });
    expect(JSON.stringify(base)).not.toContain(secret);
  });

  it.each(providerCheckKinds)(
    'runs exactly one %s check through the existing permission and credential routes',
    async (kind) => {
      const request = vi.fn<typeof fetch>(async () =>
        completed(
          kind === 'text' ? marker : JSON.stringify(kind === 'simple-schema' ? { ok: true } : chat),
        ),
      );
      const permit = vi.spyOn(permissions, 'run');
      const providers = new Providers(credentials, request, permissions);
      const result = await providers.check(provider, kind);
      expect(result).toEqual({
        providerID: provider.id,
        kind,
        outcome: 'passed',
        httpStatus: 200,
        detail: 'The provider returned the expected synthetic response.',
      });
      expect(request).toHaveBeenCalledOnce();
      const [url, options] = request.mock.calls[0]!;
      expect(url).toBe(provider.endpoint + '/chat/completions');
      expect(options).toMatchObject({
        method: 'POST',
        redirect: 'error',
        headers: { authorization: 'Bearer ' + secret },
      });
      expect(JSON.parse(String(options!.body))).toEqual(providerCheckBody(provider.model, kind));
      expect(permit.mock.calls[0]?.[1]).toBe('names');
      expect(permit.mock.calls[0]?.[4]).toBe('user');
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(JSON.stringify(result)).not.toContain(marker);
    },
  );

  it('rejects missing private permission before reading a credential or sending a request', async () => {
    await permissions.set(provider, null);
    const read = vi.spyOn(credentials, 'forProvider');
    const request = vi.fn<typeof fetch>();
    await expect(
      new Providers(credentials, request, permissions).check(provider, 'text'),
    ).rejects.toMatchObject({ code: 'MODEL_DATA_PERMISSION_REQUIRED' });
    expect(read).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects unsupported kinds and endpoints before reading a credential', async () => {
    const read = vi.spyOn(credentials, 'forProvider');
    const request = vi.fn<typeof fetch>();
    const providers = new Providers(credentials, request, permissions);
    await expect(
      providers.check({ ...provider, endpoint: 'https://unrelated.invalid' }, 'text'),
    ).rejects.toThrow('supported API endpoint');
    await expect(providers.check({ ...provider, kind: 'openai' }, 'text')).rejects.toThrow(
      'currently support Gemini',
    );
    await expect(providers.check(provider, 'arbitrary-prompt' as 'text')).rejects.toThrow(
      'Unknown provider',
    );
    expect(read).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('cannot reuse a credential bound to another provider type', async () => {
    await credentials.set(provider.id, secret, providerBinding({ ...provider, kind: 'openai' }));
    const request = vi.fn<typeof fetch>();
    await expect(
      new Providers(credentials, request, permissions).check(provider, 'text'),
    ).rejects.toThrow('changed after its API key');
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects concurrent checks for one provider and releases its slot afterwards', async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const request = vi.fn<typeof fetch>(async () => {
      await waiting;
      return completed(marker);
    });
    const providers = new Providers(credentials, request, permissions);
    const first = providers.check(provider, 'text');
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    await expect(providers.check(provider, 'text')).rejects.toThrow('already running');
    release();
    expect((await first).outcome).toBe('passed');
    expect((await providers.check(provider, 'text')).outcome).toBe('passed');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('returns the actual bounded field diagnostic with exact and encoded credentials removed', async () => {
    const encoded = [...Buffer.from(secret)]
      .map((byte) => '%' + byte.toString(16).padStart(2, '0'))
      .join('');
    const request = vi.fn<typeof fetch>(async () =>
      Response.json(
        [
          {
            error: {
              code: 400,
              status: 'INVALID_ARGUMENT',
              message: `Invalid JSON payload. Unknown name "maxItems" at response_format. ${secret}`,
              details: [
                {
                  fieldViolations: [
                    { description: `Unknown name "anyOf" at response_format. ${encoded}` },
                  ],
                },
              ],
            },
          },
        ],
        { status: 400 },
      ),
    );
    const result = await new Providers(credentials, request, permissions).check(
      provider,
      'chat-schema',
    );
    expect(result.outcome).toBe('http-error');
    expect(result.httpStatus).toBe(400);
    expect(result.detail).toContain('Unknown name "maxItems"');
    expect(result.detail).toContain('Unknown name "anyOf"');
    expect(result.detail).not.toContain(secret);
    expect(result.detail).not.toContain(encoded);
    expect(request).toHaveBeenCalledOnce();
  });

  it('bounds error reads to 32 KiB and cancels the remaining stream', async () => {
    const cancel = vi.fn();
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(32769));
            },
            cancel,
          }),
          { status: 400 },
        ),
    );
    const result = await new Providers(credentials, request, permissions).check(provider, 'text');
    expect(result).toMatchObject({ outcome: 'http-error', httpStatus: 400 });
    expect(result.detail).toContain('too large');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('honors cancellation while reading and releases the provider slot', async () => {
    const cancel = vi.fn();
    const controller = new AbortController();
    const request = vi.fn<typeof fetch>(
      async () => new Response(new ReadableStream<Uint8Array>({ cancel })),
    );
    const providers = new Providers(credentials, request, permissions);
    const check = providers.check(provider, 'text', controller.signal);
    const rejected = expect(check).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
    request.mockImplementation(async () => completed(marker));
    expect((await providers.check(provider, 'text')).outcome).toBe('passed');
  });

  it('applies the 20-second deadline to streamed response reads without retrying', async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(deadline.signal);
    const cancel = vi.fn();
    const request = vi.fn<typeof fetch>(
      async () => new Response(new ReadableStream<Uint8Array>({ cancel })),
    );
    const check = new Providers(credentials, request, permissions).check(provider, 'text');
    const failed = expect(check).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(timeout).toHaveBeenCalledWith(20000);
    deadline.abort(new DOMException('Generated deadline', 'TimeoutError'));
    await failed;
    expect(cancel).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
  });

  it('bounds stored-key access, keeps its slot occupied and never sends a late request', async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(deadline.signal);
    let release!: (value: string) => void;
    const reading = new Promise<string>((resolve) => {
      release = resolve;
    });
    const keyAccess = vi.spyOn(credentials, 'forProvider').mockReturnValueOnce(reading);
    const request = vi.fn<typeof fetch>(async () => completed(marker));
    const providers = new Providers(credentials, request, permissions);
    let failure: unknown;
    const check = providers.check(provider, 'text').catch((error: unknown) => {
      failure = error;
    });
    await vi.waitFor(() => expect(keyAccess).toHaveBeenCalledOnce());
    deadline.abort(new DOMException('Generated deadline', 'TimeoutError'));
    try {
      await vi.waitFor(() => expect(failure).toBeInstanceOf(DOMException), { timeout: 150 });
      expect(failure).toMatchObject({
        name: 'TimeoutError',
        message: expect.stringContaining('accessing the stored key'),
      });
      await expect(providers.check(provider, 'text')).rejects.toThrow('already running');
      expect(keyAccess).toHaveBeenCalledOnce();
      expect(request).not.toHaveBeenCalled();
    } finally {
      release(secret);
      await check;
    }
    expect(request).not.toHaveBeenCalled();
    await vi.waitFor(async () =>
      expect((await providers.check(provider, 'text')).outcome).toBe('passed'),
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it('handles a stored-key rejection arriving after the deadline without retrying', async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(deadline.signal);
    let rejectKey!: (error: Error) => void;
    const reading = new Promise<string>((_resolve, reject) => {
      rejectKey = reject;
    });
    const keyAccess = vi.spyOn(credentials, 'forProvider').mockReturnValueOnce(reading);
    const request = vi.fn<typeof fetch>(async () => completed(marker));
    const providers = new Providers(credentials, request, permissions);
    const check = providers.check(provider, 'text');
    const failed = expect(check).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.waitFor(() => expect(keyAccess).toHaveBeenCalledOnce());
    deadline.abort(new DOMException('Generated deadline', 'TimeoutError'));
    await failed;
    await expect(providers.check(provider, 'text')).rejects.toThrow('already running');
    rejectKey(new Error('Generated late key-access failure'));
    await vi.waitFor(async () =>
      expect((await providers.check(provider, 'text')).outcome).toBe('passed'),
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it('bounds permission lookup before accessing any stored key', async () => {
    const current = await permissions.get(provider);
    let release!: (value: typeof current) => void;
    const waiting = new Promise<typeof current>((resolve) => {
      release = resolve;
    });
    const lookup = vi.spyOn(permissions, 'get').mockReturnValueOnce(waiting);
    const keyAccess = vi.spyOn(credentials, 'forProvider');
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(deadline.signal);
    const request = vi.fn<typeof fetch>();
    const providers = new Providers(credentials, request, permissions);
    const check = providers.check(provider, 'text');
    const failed = expect(check).rejects.toMatchObject({
      name: 'TimeoutError',
      message: expect.stringContaining('checking data permission'),
    });
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledOnce());
    deadline.abort(new DOMException('Generated deadline', 'TimeoutError'));
    await failed;
    await expect(providers.check(provider, 'text')).rejects.toThrow('already running');
    release(current);
    await Promise.resolve();
    expect(keyAccess).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each(['', '<html>Generated error</html>', '{invalid', 'null'])(
    'does not expose malformed error bodies',
    async (body) => {
      const request = vi.fn<typeof fetch>(async () => new Response(body, { status: 400 }));
      const result = await new Providers(credentials, request, permissions).check(provider, 'text');
      expect(result).toMatchObject({ outcome: 'http-error', httpStatus: 400 });
      expect(result.detail).not.toContain('Generated error');
      expect(result.detail).not.toContain('<html>');
      expect(request).toHaveBeenCalledOnce();
    },
  );

  it.each([
    { kind: 'text' as const, content: 'Unexpected output ' + secret },
    { kind: 'simple-schema' as const, content: '{"ok":false}' },
    {
      kind: 'chat-schema' as const,
      content: JSON.stringify({ ...chat, kind: 'command', commandID: 'run-something' }),
    },
    { kind: 'chat-schema' as const, content: '{invalid' },
  ])(
    'rejects unexpected $kind successes without returning model text or proposals',
    async ({ kind, content }) => {
      const request = vi.fn<typeof fetch>(async () => completed(content));
      const result = await new Providers(credentials, request, permissions).check(provider, kind);
      expect(result.outcome).toBe('invalid-response');
      expect(result.detail).not.toContain(secret);
      expect(result.detail).not.toContain(content);
      expect(request).toHaveBeenCalledOnce();
    },
  );

  it('accepts only fixed synthetic requests from Viewer and Settings', () => {
    expect(methodWindows.providerCheck).toBe('both');
    expect(
      schemas.providerCheck.safeParse([{ providerID: provider.id, kind: 'text' }]).success,
    ).toBe(true);
    for (const field of ['prompt', 'schema', 'headers', 'endpoint', 'actor'])
      expect(
        schemas.providerCheck.safeParse([
          { providerID: provider.id, kind: 'text', [field]: 'injected' },
        ]).success,
      ).toBe(false);
  });
});

describe('fixed-check credential redaction', () => {
  it.each([
    secret,
    encodeURIComponent(secret),
    [...Buffer.from(secret)].map((byte) => '%' + byte.toString(16).padStart(2, '0')).join(''),
    [...secret]
      .map((letter) => '\\u' + letter.charCodeAt(0).toString(16).padStart(4, '0'))
      .join(''),
    [...secret].map((letter) => '&#' + letter.charCodeAt(0) + ';').join(''),
    Buffer.from(secret).toString('base64'),
    Buffer.from(secret).toString('base64url'),
  ])('redacts an encoded secret before any boundary truncation', (encoded) => {
    const message = redactProviderCheckMessage('x'.repeat(1980) + encoded + ' trailing', secret);
    expect(message.length).toBeLessThanOrEqual(2000);
    expect(message).not.toContain(secret.slice(0, 12));
    expect(message).not.toContain(encoded.slice(0, 16));
  });

  it('omits HTML, request echoes, URLs and authorization headers', () => {
    expect(redactProviderCheckMessage(`<html>${secret}</html>`, secret)).not.toContain('<html>');
    expect(
      redactProviderCheckMessage(
        `{"messages":["fixed prompt"],"headers":{"authorization":"Bearer ${secret}"}}`,
        secret,
      ),
    ).toContain('omitted');
    const message = redactProviderCheckMessage(
      `Unknown maxItems. https://example.invalid/?key=${secret}\nAuthorization: Bearer ${secret}`,
      secret,
    );
    expect(message).toContain('Unknown maxItems');
    expect(message).not.toContain(secret);
    expect(message).not.toContain('https://');
    expect(message).not.toContain('Authorization:');
  });
});
