import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Credentials, Providers, providerBinding } from '../src/desktop/models/providers';
import { chatStepSchema } from '../src/domain/models/chat';
import {
  newModelProvider,
  providerKinds,
  providerPresets,
  validProviderEndpoint,
} from '../src/domain/models/providers';
import { SettingsService } from '../src/desktop/preferences/settings';
import { ModelPermissions } from '../src/desktop/models/model-permissions';
import type { ModelProvider } from '../src/domain/services';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string;
let credentials: Credentials;
beforeEach(async () => {
  root = await temporaryRoot('viewer-models-');
  credentials = new Credentials(
    root,
    async (value) => Buffer.from(value),
    async (value) => value.toString(),
  );
});
afterEach(async () => {
  await trashTemporary(root);
});

const newKinds = ['zai', 'deepseek', 'qwen', 'gemini', 'openrouter'] as const;
const schema = {
  type: 'object',
  properties: { rows: { type: 'array', items: { type: 'object' } } },
  required: ['rows'],
  additionalProperties: false,
};
async function approved(provider: ModelProvider, request: typeof fetch) {
  const permissions = new ModelPermissions(root, () => [provider]);
  await permissions.set(provider, 'full-text');
  return new Providers(credentials, request, permissions);
}
describe('model provider presets and adapters', () => {
  it('sends Gemini a smaller Chat grammar and retains the full limits in its instructions', async () => {
    const provider = { ...newModelProvider('gemini', 'fixture'), model: 'fixture-model' };
    await credentials.set('fixture', 'generated-test-key', providerBinding(provider));
    const request = vi.fn<typeof fetch>(async () =>
      Response.json({
        choices: [{ finish_reason: 'stop', message: { content: '{"rows":[]}' } }],
      }),
    );
    const original = z.toJSONSchema(chatStepSchema);
    await (
      await approved(provider, request)
    ).generate(
      provider,
      'Inspect only the given files.',
      [],
      original,
      new AbortController().signal,
    );
    const body = JSON.parse(String(request.mock.calls[0]![1]!.body));
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.properties.patches).not.toHaveProperty(
      'maxItems',
    );
    expect(body.response_format.json_schema.schema.properties.renames).not.toHaveProperty(
      'maxItems',
    );
    expect(body.messages[0].content).toContain(JSON.stringify(original));
    expect(original).toHaveProperty('properties.patches.maxItems', 20);
    expect(original).toHaveProperty('properties.renames.maxItems', 100);
  });

  it('normalizes Gemini model resource names for discovery and requests', async () => {
    const provider = {
      ...newModelProvider('gemini', 'fixture'),
      model: 'models/gemini-fixture',
    };
    await credentials.set('fixture', 'generated-test-key', providerBinding(provider));
    const bodies: Record<string, unknown>[] = [];
    const request = vi.fn<typeof fetch>(async (_url, options) => {
      if (!options?.body)
        return Response.json({
          data: [{ id: 'models/gemini-fixture' }, { id: 'gemini-fixture' }],
        });
      bodies.push(JSON.parse(String(options.body)));
      return Response.json({
        choices: [{ finish_reason: 'stop', message: { content: '{"rows":[]}' } }],
      });
    });
    const providers = await approved(provider, request);
    expect(await providers.models(provider)).toEqual(['gemini-fixture']);
    await providers.generate(provider, '', [], schema, new AbortController().signal);
    expect(bodies[0]?.model).toBe('gemini-fixture');
  });

  it('explains a Gemini schema rejection without echoing provider messages', async () => {
    const provider = { ...newModelProvider('gemini', 'fixture'), model: 'fixture-model' };
    await credentials.set('fixture', 'generated-test-key', providerBinding(provider));
    const request = vi.fn<typeof fetch>(async () =>
      Response.json(
        {
          error: {
            code: 400,
            status: 'INVALID_ARGUMENT',
            message: 'response_schema has too many states. PRIVATE_PROMPT and generated-test-key',
          },
        },
        { status: 400 },
      ),
    );
    const providers = await approved(provider, request);
    const failure = await providers
      .generate(provider, '', ['PRIVATE_PROMPT'], schema, new AbortController().signal)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('INVALID_ARGUMENT');
    expect((failure as Error).message).toContain('structured-output schema');
    expect((failure as Error).message).not.toContain('PRIVATE_PROMPT');
    expect((failure as Error).message).not.toContain('generated-test-key');
  });

  it.each([
    null,
    { choices: [{ message: null }] },
    { choices: [{ message: { content: { private: 'GENERATED_PRIVATE_RESPONSE' } } }] },
  ])('rejects malformed success envelopes without exposing their contents', async (body) => {
    const provider = { ...newModelProvider('gemini', 'fixture'), model: 'fixture-model' };
    await credentials.set('fixture', 'generated-test-key', providerBinding(provider));
    const request = vi.fn<typeof fetch>(async () => Response.json(body));
    await expect(
      (await approved(provider, request)).generate(
        provider,
        '',
        [],
        schema,
        new AbortController().signal,
      ),
    ).rejects.toThrow('The provider returned an invalid response envelope.');
  });

  it('rejects invalid generated JSON without exposing parser excerpts', async () => {
    const provider = { ...newModelProvider('gemini', 'fixture'), model: 'fixture-model' };
    await credentials.set('fixture', 'generated-test-key', providerBinding(provider));
    const request = vi.fn<typeof fetch>(async () =>
      Response.json({
        choices: [{ finish_reason: 'stop', message: { content: '{"GENERATED_PRIVATE_RESPONSE' } }],
      }),
    );
    await expect(
      (await approved(provider, request)).generate(
        provider,
        '',
        [],
        schema,
        new AbortController().signal,
      ),
    ).rejects.toThrow('The model returned invalid JSON. No changes were applied.');
  });

  it('sends a stored key only to the provider type and endpoint it was entered for', async () => {
    const provider = { ...newModelProvider('openrouter', 'fixture'), model: 'fixture-model' };
    await credentials.set('fixture', 'test-only-key', providerBinding(provider));
    expect(await credentials.forProvider(provider)).toBe('test-only-key');
    const moved = { ...provider, kind: 'local' as const, endpoint: 'https://collector.example' };
    await expect(credentials.forProvider(moved)).rejects.toThrow('changed after its API key');
  });
  it('asks once before an older key is tied to the endpoint it would be sent to (2026-10-21)', async () => {
    // A key saved before keys were tied to an endpoint was tied, silently, to whatever endpoint
    // config.jsonc named at its first use.
    const provider = { ...newModelProvider('openrouter', 'unbound'), model: 'fixture-model' };
    await credentials.set('unbound', 'older-key');
    await expect(credentials.forProvider(provider)).rejects.toThrow('saved before');
    const decrypt = vi.fn(async (value: Buffer) => value.toString());
    const confirm = vi.fn(async () => false);
    const asking = new Credentials(root, async (value) => Buffer.from(value), decrypt, confirm);
    await expect(asking.forProvider(provider)).rejects.toThrow('saved before');
    // a key not allowed is not even read
    expect(decrypt).not.toHaveBeenCalled();
    confirm.mockResolvedValue(true);
    const [first, second] = await Promise.all([
      asking.forProvider(provider),
      asking.forProvider(provider),
    ]);
    expect([first, second]).toEqual(['older-key', 'older-key']);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(await asking.forProvider(provider)).toBe('older-key');
    expect(confirm).toHaveBeenCalledTimes(2);
    await expect(
      asking.forProvider({ ...provider, endpoint: 'https://collector.example' }),
    ).rejects.toThrow('changed after its API key');
  });
  it.each(newKinds)(
    'uses the documented %s transport, output mode and stored-key authentication',
    async (kind) => {
      const provider = { ...newModelProvider(kind, 'fixture'), model: 'fixture-model' };
      await credentials.set('fixture', 'test-only-key', providerBinding(provider));
      const request = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ finish_reason: 'stop', message: { content: '{"rows":[]}' } }],
            }),
          ),
      );
      const output = await (
        await approved(provider, request as typeof fetch)
      ).generate(provider, 'Review names.', [], schema, new AbortController().signal);
      expect(output).toEqual({ rows: [] });
      const [url, options] = request.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(provider.endpoint + '/chat/completions');
      expect(options.headers).toMatchObject({ authorization: 'Bearer test-only-key' });
      expect(options.redirect).toBe('error');
      const body = JSON.parse(options.body as string);
      if (kind === 'zai' || kind === 'deepseek') {
        expect(body.response_format).toEqual({ type: 'json_object' });
        expect(body.messages[0].content).toContain(JSON.stringify(schema));
      } else
        expect(body.response_format).toMatchObject({
          type: 'json_schema',
          json_schema: { strict: true, schema },
        });
      if (kind === 'qwen') expect(body.enable_thinking).toBe(false);
      if (kind === 'openrouter') expect(body.provider.require_parameters).toBe(true);
    },
  );
  it('persists all provider identities through validated JSONC without enabling content or making network requests', async () => {
    const service = new SettingsService(
      root,
      root,
      () => false,
      () => {},
    );
    await service.load();
    const providers = providerKinds.map((kind) => newModelProvider(kind, kind));
    await service.patch(
      [{ path: 'settings.providers', value: providers }],
      service.snapshot().revision,
    );
    await service.close();
    const reopened = new SettingsService(
      root,
      root,
      () => false,
      () => {},
    );
    await reopened.load();
    expect(reopened.snapshot().settings.providers).toEqual(providers);
    expect(providers.every((provider) => !provider.allowContent)).toBe(true);
    // Meta starts with Muse Spark; every other provider waits for a model to be chosen.
    expect(
      providers.filter((provider) => provider.model).map((provider) => provider.model),
    ).toEqual(['muse-spark-1.3']);
    await reopened.close();
  });
  it('discovers remote IDs without silently dropping later models and filters unsupported OpenRouter models', async () => {
    const ids = Array.from({ length: 350 }, (_, index) => 'model-' + index);
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              ...ids.map((id) => ({ id, supported_parameters: ['structured_outputs'] })),
              { id: 'text-only', supported_parameters: ['temperature'] },
              null,
              { id: 123 },
              { id: '' },
            ],
          }),
        ),
    );
    const provider = newModelProvider('openrouter', 'fixture');
    expect(await new Providers(credentials, request as typeof fetch).models(provider)).toEqual(ids);
    expect((request.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://openrouter.ai/api/v1/models',
    );
  });
  it('offers Z.ai catalog suggestions without falsely claiming a model-list API connection', async () => {
    const request = vi.fn();
    expect(
      await new Providers(credentials, request).models(newModelProvider('zai', 'fixture')),
    ).toEqual(providerPresets.zai.suggestedModels);
    expect(request).not.toHaveBeenCalled();
  });
  it.each(newKinds)('requires a %s key before requesting a proposal', async (kind) => {
    const request = vi.fn();
    const provider = { ...newModelProvider(kind, 'missing'), model: 'fixture' };
    await expect(
      (await approved(provider, request)).generate(
        provider,
        '',
        [],
        schema,
        new AbortController().signal,
      ),
    ).rejects.toThrow('API key');
    expect(request).not.toHaveBeenCalled();
  });
  it('rejects unrelated cloud endpoints before decrypting or sending a stored credential', async () => {
    const decrypt = vi.fn();
    const sealed = new Credentials(root, async (value) => Buffer.from(value), decrypt);
    await sealed.set('fixture', 'test-only-key');
    const request = vi.fn();
    await expect(
      new Providers(sealed, request).generate(
        {
          ...newModelProvider('gemini', 'fixture'),
          endpoint: 'https://unrelated.invalid/v1',
          model: 'fixture',
        },
        '',
        [],
        schema,
        new AbortController().signal,
      ),
    ).rejects.toThrow('supported API endpoint');
    expect(request).not.toHaveBeenCalled();
    expect(decrypt).not.toHaveBeenCalled();
    expect(
      validProviderEndpoint(
        'qwen',
        'https://my-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      ),
    ).toBe(true);
    expect(
      validProviderEndpoint(
        'qwen',
        'https://dashscope-intl.aliyuncs.com.evil.invalid/compatible-mode/v1',
      ),
    ).toBe(false);
    expect(validProviderEndpoint('deepseek', 'https://api.deepseek.com/v1')).toBe(true);
    expect(
      validProviderEndpoint(
        'gemini',
        'https://generativelanguage.googleapis.com/v1beta/openai?key=secret',
      ),
    ).toBe(false);
  });
  it.each(['length', 'content_filter', 'sensitive', 'network_error'])(
    'rejects a %s response even when its partial content parses as JSON',
    async (finish_reason) => {
      const request = vi.fn(
        async () =>
          new Response(
            JSON.stringify({ choices: [{ finish_reason, message: { content: '{"rows":[]}' } }] }),
          ),
      );
      const provider = { ...newModelProvider('deepseek', 'fixture'), model: 'fixture' };
      await credentials.set('fixture', 'test-only-key', providerBinding(provider));
      await expect(
        (await approved(provider, request as typeof fetch)).generate(
          provider,
          '',
          [],
          schema,
          new AbortController().signal,
        ),
      ).rejects.toThrow('refused or incomplete');
    },
  );
});

describe('Meta and pictures', () => {
  const metaProvider = () => ({ ...newModelProvider('meta', 'meta'), model: 'muse-spark-1.3' });
  const picture = {
    type: 'image/jpeg' as const,
    data: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
  };
  const reply = (body: unknown) => vi.fn<typeof fetch>(async () => Response.json(body));
  async function keyed(provider: ModelProvider) {
    await credentials.set(provider.id, 'test-only-key', providerBinding(provider));
  }
  async function allowedAt(
    provider: ModelProvider,
    request: typeof fetch,
    level: 'full-text' | 'images',
  ) {
    const permissions = new ModelPermissions(root, () => [provider]);
    await permissions.set(provider, level);
    return new Providers(credentials, request, permissions);
  }

  it('starts on Muse Spark at Meta’s endpoint, and sends its key nowhere else', () => {
    expect(newModelProvider('meta', 'meta')).toMatchObject({
      name: 'Meta',
      endpoint: 'https://api.meta.ai/v1',
      model: 'muse-spark-1.3',
    });
    expect(providerPresets.meta).toMatchObject({ protocol: 'chat/completions', output: 'schema' });
    expect(validProviderEndpoint('meta', 'https://api.meta.ai/v1/')).toBe(true);
    for (const endpoint of [
      'https://api.meta.ai.collector.invalid/v1',
      'https://api.meta.ai/v2',
      'http://api.meta.ai/v1',
      'https://api.meta.ai/v1?key=secret',
    ])
      expect(validProviderEndpoint('meta', endpoint), endpoint).toBe(false);
  });

  it('sends the input as text, then each picture as an image part, under a strict schema', async () => {
    const provider = metaProvider();
    await keyed(provider);
    const request = reply({
      choices: [{ finish_reason: 'stop', message: { content: '{"rows":[]}' } }],
    });
    const output = await (
      await allowedAt(provider, request, 'images')
    ).generate(
      provider,
      'Check the job.',
      { job: 'Job 1042' },
      schema,
      new AbortController().signal,
      'images',
      'user',
      {
        images: [picture, { type: 'image/png', data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]) }],
      },
    );
    expect(output).toEqual({ rows: [] });
    const [url, options] = request.mock.calls[0]!;
    expect(url).toBe('https://api.meta.ai/v1/chat/completions');
    expect(options!.headers).toMatchObject({ authorization: 'Bearer test-only-key' });
    const body = JSON.parse(String(options!.body));
    expect(body.messages[1].content).toEqual([
      { type: 'text', text: '{"job":"Job 1042"}' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/2Q==' } },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw==' } },
    ]);
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'file_action', strict: true, schema },
    });
    // only the fields tools/meta-probe.ts checked Meta's API with
    expect(Object.keys(body).sort()).toEqual(['messages', 'model', 'response_format']);
  });

  it.each([
    [
      'the OpenAI envelope',
      { choices: [{ finish_reason: 'stop', message: { content: '{"rows":[]}' } }] },
    ],
    [
      'a Llama-style text part',
      {
        completion_message: { stop_reason: 'stop', content: { type: 'text', text: '{"rows":[]}' } },
      },
    ],
    ['a Llama-style string', { completion_message: { content: '{"rows":[]}' } }],
  ])('reads %s', async (_name, body) => {
    const provider = metaProvider();
    await keyed(provider);
    await expect(
      (await allowedAt(provider, reply(body), 'full-text')).generate(
        provider,
        '',
        [],
        schema,
        new AbortController().signal,
      ),
    ).resolves.toEqual({ rows: [] });
  });

  it('refuses a Llama-style reply cut off at its limit', async () => {
    const provider = metaProvider();
    await keyed(provider);
    const request = reply({
      completion_message: { stop_reason: 'length', content: { type: 'text', text: '{"rows":[]}' } },
    });
    await expect(
      (await allowedAt(provider, request, 'full-text')).generate(
        provider,
        '',
        [],
        schema,
        new AbortController().signal,
      ),
    ).rejects.toThrow('refused or incomplete');
  });

  it('refuses pictures a text approval does not cover, before anything is sent', async () => {
    const provider = metaProvider();
    await keyed(provider);
    const request = vi.fn<typeof fetch>();
    const providers = await allowedAt(provider, request, 'full-text');
    const signal = new AbortController().signal;
    await expect(
      providers.generate(provider, '', [], schema, signal, 'images', 'user', { images: [picture] }),
    ).rejects.toThrow('Allow this provider to receive the selected data');
    await expect(
      providers.generate(provider, '', [], schema, signal, 'full-text', 'user', {
        images: [picture],
      }),
    ).rejects.toThrow('Pictures are sent only at the images data level.');
    await expect(
      providers.segment(provider, { image: picture, width: 64, height: 64 }, 'hole', signal),
    ).rejects.toThrow('Allow this provider to receive the selected data');
    expect(request).not.toHaveBeenCalled();
  });

  it.each(['openai', 'anthropic'] as const)(
    'refuses pictures for %s with a clear message, before anything is sent',
    async (kind) => {
      const provider = { ...newModelProvider(kind, kind), model: 'fixture' };
      await keyed(provider);
      const request = vi.fn<typeof fetch>();
      await expect(
        (await allowedAt(provider, request, 'images')).generate(
          provider,
          '',
          [],
          schema,
          new AbortController().signal,
          'images',
          'user',
          {
            images: [picture],
          },
        ),
      ).rejects.toThrow(`Viewer does not send pictures to ${providerPresets[kind].name} yet.`);
      expect(request).not.toHaveBeenCalled();
    },
  );

  it('bounds the pictures of one request', async () => {
    const provider = metaProvider();
    await keyed(provider);
    const providers = await allowedAt(provider, vi.fn<typeof fetch>(), 'images');
    const big = { type: 'image/jpeg' as const, data: new Uint8Array(4_000_001) };
    await expect(
      providers.generate(provider, '', [], schema, new AbortController().signal, 'images', 'user', {
        images: [big],
      }),
    ).rejects.toThrow('A picture is larger than 4 MB.');
    await expect(
      providers.generate(provider, '', [], schema, new AbortController().signal, 'images', 'user', {
        images: Array.from({ length: 17 }, () => picture),
      }),
    ).rejects.toThrow('A request sends at most 16 pictures; this one has 17.');
  });

  it('asks SAM 3.1 through Meta’s Responses route with the same key and approval', async () => {
    const provider = metaProvider();
    await keyed(provider);
    const request = reply({
      output: [{ content: [{ type: 'output_text', text: '<0f>0<|box;…|>' }] }],
    });
    const text = await (
      await allowedAt(provider, request, 'images')
    ).segment(
      provider,
      { image: picture, width: 64, height: 64 },
      '<0f>0<|box;x1=16;y1=16;x2=47;y2=47;w=64;h=64|>',
      new AbortController().signal,
    );
    expect(text).toBe('<0f>0<|box;…|>');
    const [url, options] = request.mock.calls[0]!;
    expect(url).toBe('https://api.meta.ai/v1/responses');
    expect(options!.headers).toMatchObject({ authorization: 'Bearer test-only-key' });
    expect(JSON.parse(String(options!.body))).toEqual({
      model: 'sam-3.1',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: '<0f>0<|box;x1=16;y1=16;x2=47;y2=47;w=64;h=64|>' },
            { type: 'input_image', image_url: 'data:image/jpeg;base64,/9j/2Q==' },
          ],
        },
      ],
      metadata: { mask_encoding: 'one_bit', include_confidence: 'true' },
    });
    const gemini = { ...newModelProvider('gemini', 'gemini'), model: 'fixture' };
    await expect(
      new Providers(credentials, request).segment(
        gemini,
        { image: picture, width: 1, height: 1 },
        'hole',
        new AbortController().signal,
      ),
    ).rejects.toThrow('Gemini has no segmentation model.');
  });
});
