import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Credentials, Providers, providerBinding } from '../src/desktop/models/providers';
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
