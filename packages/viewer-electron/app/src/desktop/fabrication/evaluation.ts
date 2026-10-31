import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import type { ParseError } from 'jsonc-parser';
import type { ModelProvider } from '../../domain/services';
import type { ModelPermissions } from '../models/model-permissions';
import { validProviderEndpoint } from '../../domain/models/providers';
import { Credentials, Providers } from '../models/providers';
import { settingsSchema } from '../preferences/settings-schema';

/** Authentication stays in the desktop process, including when the evaluator is a tool. */
export interface EvaluationProvider {
  provider: ModelProvider;
  connect(request: typeof fetch, permissions: Pick<ModelPermissions, 'run'>): Providers;
  /** A provider can echo sensitive input; keep it out of console and retained reports. */
  publicText(value: string): string;
}

export interface EvaluationProviderInfo {
  id: string;
  name: string;
  kind: 'meta';
  model: string;
  keyPresent: boolean;
}

/** Reads the configured providers without starting Settings or migrating its documents. */
export async function readEvaluationProviders(profile: string): Promise<ModelProvider[]> {
  const handle = await open(
    path.join(profile, 'config.jsonc'),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > 16_000_000)
      throw new Error('The Viewer configuration is not an ordinary configuration file.');
    const text = await handle.readFile('utf8');
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new Error('The Viewer configuration changed while reading. Try again.');
    const errors: ParseError[] = [];
    const document: unknown = parse(text, errors, { allowTrailingComma: true });
    const settings =
      !errors.length && document && typeof document === 'object' && 'settings' in document
        ? document.settings
        : undefined;
    const providers =
      settings && typeof settings === 'object' && 'providers' in settings
        ? settings.providers
        : undefined;
    const parsed = settingsSchema.shape.providers.safeParse(providers);
    if (!parsed.success)
      throw new Error('Viewer has no valid model configuration. Check Settings → Models.');
    return parsed.data;
  } finally {
    await handle.close();
  }
}

/** Metadata only. Inspecting does not decrypt a key or contact any provider. */
export async function inspectEvaluationProviders(
  providers: readonly ModelProvider[],
  credentials: Pick<Credentials, 'load' | 'ids'>,
): Promise<EvaluationProviderInfo[]> {
  await credentials.load();
  const ids = new Set(credentials.ids());
  return providers
    .filter((provider) => provider.kind === 'meta')
    .map(({ id, name, model }) => ({ id, name, kind: 'meta', model, keyPresent: ids.has(id) }));
}

/** A captured provider and its endpoint-bound key, used only by a main-process evaluation. */
export async function configuredEvaluationProvider(
  providers: readonly ModelProvider[],
  credentials: Pick<Credentials, 'forProvider'>,
  providerID?: string,
): Promise<EvaluationProvider> {
  const metas = providers.filter((provider) => provider.kind === 'meta');
  const selected = providerID ? metas.find((provider) => provider.id === providerID) : metas[0];
  if (!selected)
    throw new Error('Configure a Meta provider in Viewer Settings → Models before evaluating.');
  if (!providerID && metas.length > 1)
    throw new Error('Several Meta providers are configured. Choose one with --provider <id>.');
  const provider = Object.freeze({ ...selected });
  if (!validProviderEndpoint(provider.kind, provider.endpoint))
    throw new Error('The selected Meta provider has an unsupported endpoint. Check Settings.');
  const secret = await credentials.forProvider(provider);
  if (!secret)
    throw new Error('The selected Meta provider has no API key. Enter it in Viewer Settings.');
  return {
    provider,
    connect: (request, permissions) =>
      new Providers(new CapturedKey(secret, provider), request, permissions),
    publicText: (value) => value.split(secret).join('[redacted API key]'),
  };
}

/** No writes, rebinding or fallback: the desktop already validated the captured provider. */
class CapturedKey extends Credentials {
  constructor(
    private readonly secret: string,
    private readonly provider: ModelProvider,
  ) {
    super('', unavailable, unavailable);
  }
  override async forProvider(provider: ModelProvider): Promise<string> {
    if (
      provider.id !== this.provider.id ||
      provider.kind !== this.provider.kind ||
      provider.endpoint !== this.provider.endpoint
    )
      throw new Error('The evaluation provider changed after its key was captured.');
    return this.secret;
  }
}
const unavailable = async (): Promise<never> => {
  throw new Error('An evaluation cannot save or rebind credentials.');
};
