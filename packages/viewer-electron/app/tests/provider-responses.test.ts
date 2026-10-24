import { getEventListeners } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerHTTPError } from '../src/desktop/models/provider-errors';
import { providerResponseJSON, requestProvider } from '../src/desktop/models/provider-response';
import { providerModelID } from '../src/domain/models/providers';

const privateText = 'GENERATED_PRIVATE_PROMPT_key=GENERATED_SECRET';
const signal = () => new AbortController().signal;
const bytes = (value: string) => new TextEncoder().encode(value);

afterEach(() => vi.restoreAllMocks());

describe('bounded provider responses', () => {
  it('reads streamed JSON without a Content-Length', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes('{"rows":'));
        controller.enqueue(bytes('[]}'));
        controller.close();
      },
    });
    expect(await providerResponseJSON(new Response(stream), signal())).toEqual({ rows: [] });
    expect(stream.locked).toBe(false);
  });

  it('rejects advertised oversize bodies without waiting for cancellation to finish', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const response = new Response(stream, { headers: { 'content-length': '1000' } });
    await expect(providerResponseJSON(response, signal(), 20)).rejects.toThrow('size limit');
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });

  it('rejects a dishonest Content-Length and cancels the remaining stream', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes(privateText));
      },
      cancel,
    });
    const response = new Response(stream, { headers: { 'content-length': '1' } });
    await expect(providerResponseJSON(response, signal(), 20)).rejects.toThrow('size limit');
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });

  it('bounds streams that emit empty chunks indefinitely', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array());
      },
      cancel,
    });
    await expect(providerResponseJSON(new Response(stream), signal())).rejects.toThrow(
      'size limit',
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels a stalled body and removes its abort listener without exposing the reason', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const reading = providerResponseJSON(new Response(stream), controller.signal);
    const failure = expect(reading).rejects.toMatchObject({
      name: 'AbortError',
      message: 'The provider request was cancelled.',
    });
    controller.abort(new Error(privateText));
    await failure;
    expect(cancel).toHaveBeenCalledOnce();
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    expect(stream.locked).toBe(false);
  });

  it('cancels an unread body when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    await expect(
      providerResponseJSON(new Response(stream), controller.signal),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(['<html>' + privateText, '{"partial":"' + privateText])(
    'never exposes parser excerpts from malformed JSON',
    async (body) => {
      await expect(providerResponseJSON(new Response(body), signal())).rejects.toThrow(
        'The provider returned invalid JSON.',
      );
    },
  );

  it('never exposes stream error text', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error(privateText));
      },
    });
    await expect(providerResponseJSON(new Response(stream), signal())).rejects.toThrow(
      'The provider response could not be read.',
    );
    expect(stream.locked).toBe(false);
  });

  it('reports empty bodies without a parser error', async () => {
    await expect(providerResponseJSON(new Response(null), signal())).rejects.toThrow(
      'empty response',
    );
    await expect(providerResponseJSON(new Response(''), signal())).rejects.toThrow(
      'empty response',
    );
  });
});

describe('private provider diagnostics', () => {
  it('unwraps Gemini’s array-wrapped RPC errors without exposing their message', async () => {
    const response = Response.json(
      [
        {
          error: {
            code: 400,
            status: 'INVALID_ARGUMENT',
            message: 'response_schema has too many states. ' + privateText,
          },
        },
      ],
      { status: 400 },
    );
    const failure = await providerHTTPError(response, 'gemini', signal(), 'model');
    expect(failure.message).toContain('400; INVALID_ARGUMENT');
    expect(failure.message).toContain('schema as too complex');
    expect(failure.message).not.toContain(privateText);
  });

  it('classifies bounded field violations when the RPC message is generic', async () => {
    const response = Response.json(
      [
        {
          error: {
            code: 400,
            status: 'INVALID_ARGUMENT',
            message: 'Request contains an invalid argument.',
            details: [
              {
                fieldViolations: [
                  { description: 'Unknown response_schema field "anyOf" ' + privateText },
                ],
              },
            ],
          },
        },
      ],
      { status: 400 },
    );
    const failure = await providerHTTPError(response, 'gemini', signal(), 'model');
    expect(failure.message).toContain('400; INVALID_ARGUMENT');
    expect(failure.message).toContain('Reported schema fields: anyOf');
    expect(failure.message).not.toContain(privateText);
  });

  it.each([
    {
      status: 400,
      error: { status: 'INVALID_ARGUMENT', message: 'response_schema has too many states' },
      expected: ['INVALID_ARGUMENT', 'schema as too complex'],
    },
    {
      status: 400,
      error: { status: 'INVALID_ARGUMENT', message: 'Unknown schema field "additionalProperties"' },
      expected: ['INVALID_ARGUMENT', 'Reported schema fields: additionalProperties'],
    },
    {
      status: 400,
      error: {
        status: 'INVALID_ARGUMENT',
        message: 'API key not valid',
        details: [{ reason: 'API_KEY_INVALID', metadata: { secret: privateText } }],
      },
      expected: ['API_KEY_INVALID', 'rejected this API key'],
    },
    {
      status: 400,
      error: {
        status: 'FAILED_PRECONDITION',
        message: 'Free tier is not available in your country',
      },
      expected: ['FAILED_PRECONDITION', 'billing, credits and regional availability'],
    },
    {
      status: 404,
      error: { code: 'model_not_found', message: 'The selected model is not found' },
      expected: ['model_not_found', 'selected model is unavailable'],
    },
    {
      status: 400,
      error: { type: 'invalid_request_error', param: 'model', message: 'Unsupported value' },
      expected: ['invalid_request_error', 'selected model is unavailable'],
    },
    {
      status: 403,
      error: { status: 'PERMISSION_DENIED', message: 'Key blocked for this API' },
      expected: ['PERMISSION_DENIED', 'provider denied access'],
    },
    {
      status: 429,
      error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' },
      expected: ['RESOURCE_EXHAUSTED', 'quota or rate limit'],
    },
    {
      status: 400,
      error: { code: 'context_length_exceeded', message: 'Context too long' },
      expected: ['context_length_exceeded', 'context limit'],
    },
  ])(
    'classifies HTTP $status without echoing diagnostic data',
    async ({ status, error, expected }) => {
      const response = Response.json(
        { error: { ...error, message: error.message + ' ' + privateText, unsafe: privateText } },
        { status, statusText: privateText, headers: { 'x-private-header': privateText } },
      );
      const failure = await providerHTTPError(response, 'gemini', signal(), 'model');
      expect(failure.message).toContain(`Model request failed (${status}`);
      for (const fragment of expected) expect(failure.message).toContain(fragment);
      expect(failure.message).not.toContain(privateText);
      expect(failure.message).toContain('No file changes were applied.');
      expect(failure.message.length).toBeLessThan(600);
      expect(failure.cause).toBeUndefined();
    },
  );

  it.each([
    '<html>' + privateText,
    '{"broken":"' + privateText,
    JSON.stringify({ error: { code: privateText, type: privateText, message: privateText } }),
    JSON.stringify({ error: privateText }),
    'null',
  ])('does not expose arbitrary error values or HTML', async (body) => {
    const failure = await providerHTTPError(
      new Response(body, { status: 400 }),
      'gemini',
      signal(),
      'model',
    );
    expect(failure.message).toContain('Model request failed (400)');
    expect(failure.message).not.toContain(privateText);
    expect(failure.message).not.toContain('<html>');
  });

  it('bounds error bodies below successful response limits', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(32_769));
      },
      cancel,
    });
    const failure = await providerHTTPError(
      new Response(stream, { status: 400 }),
      'gemini',
      signal(),
      'model',
    );
    expect(failure.message).toContain('error response exceeded its size limit');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('bounds time spent reading error details while preserving the HTTP status', async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(deadline.signal);
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }), { status: 400 });
    const reading = providerHTTPError(response, 'gemini', signal(), 'model');
    deadline.abort(new DOMException(privateText, 'TimeoutError'));
    const failure = await reading;
    expect(failure.message).toContain('Model request failed (400)');
    expect(failure.message).toContain('error details timed out');
    expect(failure.message).not.toContain(privateText);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('does not turn caller cancellation into an HTTP failure', async () => {
    const controller = new AbortController();
    const response = new Response(new ReadableStream<Uint8Array>(), { status: 400 });
    const reading = providerHTTPError(response, 'gemini', controller.signal, 'model');
    const failure = expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(new Error(privateText));
    await failure;
  });

  it('uses the same safe diagnostics for model discovery', async () => {
    const response = Response.json({ error: { code: 'invalid_api_key' } }, { status: 401 });
    const failure = await providerHTTPError(response, 'gemini', signal(), 'connection');
    expect(failure.message).toContain('Provider connection failed (401; invalid_api_key)');
    expect(failure.message).toContain('rejected this API key');
    expect(failure.message).not.toContain('file changes');
  });

  it('does not expose network exception text', async () => {
    const request = vi.fn<typeof fetch>(async () => {
      throw new Error(privateText);
    });
    await expect(
      requestProvider(request, 'https://example.invalid', { signal: signal(), redirect: 'error' }),
    ).rejects.toThrow(
      'Provider connection failed. Check your connection and endpoint in Settings.',
    );
  });

  it('preserves slash-containing identifiers for other providers', () => {
    expect(providerModelID('openrouter', 'publisher/model')).toBe('publisher/model');
    expect(providerModelID('local', 'models/project')).toBe('models/project');
    expect(providerModelID('gemini', 'models/gemini-fixture')).toBe('gemini-fixture');
  });
});
