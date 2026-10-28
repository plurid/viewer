import { z } from 'zod';
import type { SpeechProvider, SpeechProviderCheck } from '../../domain/speech/providers';
import { validSpeechEndpoint } from '../../domain/speech/providers';
import {
  ProviderResponseError,
  providerAbort,
  providerResponseJSON,
  requestProvider,
  waitForProvider,
} from '../models/provider-response';

const modelName = z.string().min(1).max(512);
const catalog = z.object({ data: z.array(z.object({ id: modelName })).max(5000) });
const deepgramCatalog = z.object({
  stt: z
    .array(
      z.object({
        name: modelName,
        canonical_name: modelName,
        uuid: modelName.optional(),
        batch: z.boolean(),
      }),
    )
    .max(5000),
});
class CheckHTTPError extends Error {
  constructor(readonly status: number) {
    super('Speech check HTTP error');
  }
}

/** Fixed GET requests only: authenticated catalogs for Meta/OpenAI-compatible APIs;
 * Deepgram authenticates the key separately because its public catalog needs no key. */
export class SpeechProviderChecks {
  constructor(private request: typeof fetch = fetch) {}
  async check(
    provider: SpeechProvider,
    secret: string,
    signal: AbortSignal,
  ): Promise<SpeechProviderCheck> {
    signal.throwIfAborted();
    if (!validSpeechEndpoint(provider.kind, provider.endpoint))
      throw new Error('The speech provider endpoint is invalid.');
    if (!secret || /[\r\n\0]/.test(secret))
      throw new Error('Save this speech provider’s API key first.');
    const result = (
      outcome: SpeechProviderCheck['outcome'],
      detail: string,
      httpStatus?: number,
    ): SpeechProviderCheck => ({
      outcome,
      detail,
      checkedAt: Date.now(),
      ...(httpStatus === undefined ? {} : { httpStatus }),
    });
    const get = async (route: string, authenticated = true) => {
      const response = await waitForProvider(
        requestProvider(this.request, provider.endpoint + '/' + route, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            ...(authenticated
              ? { Authorization: (provider.kind === 'deepgram' ? 'Token ' : 'Bearer ') + secret }
              : {}),
          },
          signal,
          redirect: 'error',
        }),
        signal,
      );
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new CheckHTTPError(response.status);
      }
      return providerResponseJSON(response, signal, 2_000_000);
    };
    try {
      if (provider.kind === 'deepgram') {
        // /models is public: a successful catalog response alone proves nothing about the key.
        const auth = await get('auth/token');
        if (!auth || typeof auth !== 'object' || Array.isArray(auth))
          return result(
            'invalid-response',
            'The key check returned an unexpected response. Check the provider endpoint.',
          );
        const models = deepgramCatalog.safeParse(await get('models', false));
        if (!models.success)
          return result(
            'invalid-response',
            'The provider returned an unexpected model catalog. Retry the check.',
          );
        const listed = models.data.stt.some(
          (model) =>
            model.batch &&
            [
              model.name,
              model.canonical_name,
              model.uuid,
              model.canonical_name.replace(/-general$/, ''),
            ].includes(provider.model),
        );
        return listed
          ? result(
              'available',
              'API key accepted; this model is listed for recorded audio. Try a short recording to check transcription.',
            )
          : result(
              'unverified',
              'API key accepted; this model is not in the public recorded-audio catalog. Check custom model access with your provider before recording.',
            );
      }
      const models = catalog.safeParse(await get('models'));
      if (!models.success)
        return result(
          'invalid-response',
          'The provider returned an unexpected model catalog. Check the API base URL.',
        );
      return models.data.data.some((model) => model.id === provider.model)
        ? result(
            'available',
            'Connection accepted; this model is listed. Try a short recording to check transcription support.',
          )
        : result(
            'model-unavailable',
            'This model is not listed for the saved key. Edit its model ID or check account access, then retry.',
          );
    } catch (error) {
      if (signal.aborted) throw providerAbort(signal);
      if (error instanceof CheckHTTPError) {
        const status = error.status;
        if (status === 401 || status === 403)
          return result(
            'auth-error',
            'The provider rejected the key or catalog access. Check the saved API key and account permissions.',
            status,
          );
        if (provider.kind === 'compatible' && (status === 404 || status === 405))
          return result(
            'unverified',
            'This endpoint does not expose a model catalog. Connection and transcription support could not be checked. Verify its model ID before trying a recording.',
            status,
          );
        return result(
          'http-error',
          status === 429
            ? 'The provider rate or account limit was reached. Wait, then retry.'
            : 'The provider could not complete the check. Verify the endpoint or retry when it is available.',
          status,
        );
      }
      // Response text and network exceptions may contain credentials; never return them.
      return result(
        error instanceof ProviderResponseError ? 'invalid-response' : 'connection-error',
        'The check could not read a model catalog. Check your connection and endpoint, then retry.',
      );
    }
  }
}
