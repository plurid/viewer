import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Credentials, Providers } from '../src/desktop/providers';
import {
  newModelProvider,
  providerKinds,
  providerPresets,
  validProviderEndpoint,
} from '../src/domain/model-providers';
import { SettingsService } from '../src/desktop/settings';

let root: string;
let credentials: Credentials;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'viewer-models-'));
  credentials = new Credentials(
    root,
    async (value) => Buffer.from(value),
    async (value) => value.toString(),
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const newKinds = ['zai', 'deepseek', 'qwen', 'gemini', 'openrouter'] as const;
const schema = {
  type: 'object',
  properties: { rows: { type: 'array', items: { type: 'object' } } },
  required: ['rows'],
  additionalProperties: false,
};
describe('model provider presets and adapters', () => {
  it.each(newKinds)(
    'uses the documented %s transport, output mode and stored-key authentication',
    async (kind) => {
      await credentials.set('fixture', 'test-only-key');
      const provider = { ...newModelProvider(kind, 'fixture'), model: 'fixture-model' };
      const request = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ finish_reason: 'stop', message: { content: '{"rows":[]}' } }],
            }),
          ),
      );
      const output = await new Providers(credentials, request as typeof fetch).generate(
        provider,
        'Review names.',
        [],
        schema,
        new AbortController().signal,
      );
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
    expect(providers.every((provider) => !provider.allowContent && !provider.model)).toBe(true);
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
    await expect(
      new Providers(credentials, request).generate(
        { ...newModelProvider(kind, 'missing'), model: 'fixture' },
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
      await credentials.set('fixture', 'test-only-key');
      const request = vi.fn(
        async () =>
          new Response(
            JSON.stringify({ choices: [{ finish_reason, message: { content: '{"rows":[]}' } }] }),
          ),
      );
      await expect(
        new Providers(credentials, request as typeof fetch).generate(
          { ...newModelProvider('deepseek', 'fixture'), model: 'fixture' },
          '',
          [],
          schema,
          new AbortController().signal,
        ),
      ).rejects.toThrow('refused or incomplete');
    },
  );
});
