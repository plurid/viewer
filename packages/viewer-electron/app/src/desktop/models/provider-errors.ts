import type { ProviderKind } from '../../domain/models/providers';
import { providerPresets } from '../../domain/models/providers';
import { ProviderResponseError, providerAbort, providerResponseJSON } from './provider-response';

const knownCodes = new Set([
  'INVALID_ARGUMENT',
  'FAILED_PRECONDITION',
  'PERMISSION_DENIED',
  'UNAUTHENTICATED',
  'NOT_FOUND',
  'RESOURCE_EXHAUSTED',
  'UNAVAILABLE',
  'INTERNAL',
  'DEADLINE_EXCEEDED',
  'CANCELLED',
  'API_KEY_INVALID',
  'API_KEY_EXPIRED',
  'API_KEY_SERVICE_BLOCKED',
  'API_KEY_HTTP_REFERRER_BLOCKED',
  'API_KEY_IP_ADDRESS_BLOCKED',
  'invalid_api_key',
  'authentication_error',
  'invalid_request_error',
  'invalid_json_schema',
  'unsupported_parameter',
  'model_not_found',
  'not_found_error',
  'permission_error',
  'context_length_exceeded',
  'rate_limit_exceeded',
  'rate_limit_error',
  'insufficient_quota',
  'billing_hard_limit_reached',
  'overloaded_error',
]);

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function schemaGuidance(message: string): string {
  if (/too many states|too much branching|schema.{0,80}too complex/i.test(message))
    return 'The provider rejected the structured-output schema as too complex. Its array limits or union branches may need simplification.';
  const fields = [
    '$schema',
    '$ref',
    'additionalProperties',
    'anyOf',
    'oneOf',
    'allOf',
    'minItems',
    'maxItems',
    'minLength',
    'maxLength',
    'strict',
  ].filter((field) => message.includes(field));
  const detail = fields.length ? ` Reported schema fields: ${fields.slice(0, 3).join(', ')}.` : '';
  return (
    'The provider rejected the structured-output schema. Check its supported schema constraints.' +
    detail
  );
}

function diagnosis(data: unknown, status: number): { codes: string[]; detail: string } {
  // The compatibility endpoint also returns an array of RPC error envelopes.
  // Inspect only these documented fields; never recursively search response data.
  const envelopes = Array.isArray(data) ? data.slice(0, 4) : [data];
  const errors = envelopes.map((item) => object(object(item).error));
  const details = errors.flatMap((error) =>
    Array.isArray(error.details) ? error.details.slice(0, 8).map(object) : [],
  );
  const reasons = details.map((item) => item.reason);
  const codes = [
    ...new Set([...errors.flatMap((error) => [error.status, error.code, error.type]), ...reasons]),
  ].filter((value): value is string => typeof value === 'string' && knownCodes.has(value));
  const has = (...values: string[]) => values.some((value) => codes.includes(value));
  // Provider text is used only to choose fixed guidance. Never return it, even
  // after redaction: errors can quote arbitrary prompts, filenames or secrets.
  const message = [
    ...errors.map((error) => error.message),
    ...details.flatMap((detail) =>
      Array.isArray(detail.fieldViolations)
        ? detail.fieldViolations.slice(0, 8).map((item) => object(item).description)
        : [],
    ),
  ]
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
    .slice(0, 8192);
  if (
    status === 401 ||
    has(
      'API_KEY_INVALID',
      'API_KEY_EXPIRED',
      'invalid_api_key',
      'UNAUTHENTICATED',
      'authentication_error',
    ) ||
    /api[ _-]?key.{0,60}(?:not valid|invalid|expired|revoked|leaked)/i.test(message)
  )
    return { codes, detail: 'The provider rejected this API key. Review it in Settings → Models.' };
  if (
    status === 402 ||
    has('insufficient_quota', 'billing_hard_limit_reached') ||
    /billing|free tier.{0,80}(?:not available|country|region)/i.test(message)
  )
    return {
      codes,
      detail: 'Check the provider project’s billing, credits and regional availability.',
    };
  if (
    /schema|response[_ -]?format|too many states|too much branching/i.test(message) ||
    has('invalid_json_schema')
  )
    return { codes, detail: schemaGuidance(message) };
  if (
    has('model_not_found') ||
    errors.some((error) => error.param === 'model') ||
    /model.{0,120}(?:not found|not supported|unsupported|not available|does not exist)|unsupported.{0,40}model/i.test(
      message,
    )
  )
    return {
      codes,
      detail:
        'The selected model is unavailable or unsupported by this API. Load models in Settings → Models.',
    };
  if (has('context_length_exceeded') || /context.{0,40}(?:length|limit|too long)/i.test(message))
    return {
      codes,
      detail: 'The request exceeded the model’s context limit. Start a smaller conversation.',
    };
  if (
    status === 403 ||
    has(
      'PERMISSION_DENIED',
      'permission_error',
      'API_KEY_SERVICE_BLOCKED',
      'API_KEY_HTTP_REFERRER_BLOCKED',
      'API_KEY_IP_ADDRESS_BLOCKED',
    )
  )
    return {
      codes,
      detail:
        'The provider denied access. Check the key’s project, API restrictions and model permissions.',
    };
  if (status === 429 || has('RESOURCE_EXHAUSTED', 'rate_limit_error', 'rate_limit_exceeded'))
    return {
      codes,
      detail: 'The provider’s quota or rate limit was reached. Check usage before retrying.',
    };
  if (status >= 500)
    return { codes, detail: 'The provider is temporarily unavailable. Retry later.' };
  return {
    codes,
    detail:
      status === 400
        ? 'The provider rejected the request parameters. Check the model and structured-output support.'
        : 'Check the provider configuration and account access in Settings → Models.',
  };
}

/** Only public allowlisted codes and fixed guidance cross the desktop boundary. */
export async function providerHTTPError(
  response: Response,
  kind: ProviderKind,
  signal: AbortSignal,
  purpose: 'model' | 'connection',
): Promise<Error> {
  const detailsSignal = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
  let result: { codes: string[]; detail: string };
  try {
    result = diagnosis(
      await providerResponseJSON(response, detailsSignal, 32_768),
      response.status,
    );
  } catch (error) {
    if (signal.aborted) throw providerAbort(signal);
    result = {
      codes: [],
      detail: detailsSignal.aborted
        ? 'The provider’s error details timed out.'
        : error instanceof ProviderResponseError && error.problem === 'size'
          ? 'The provider’s error response exceeded its size limit.'
          : 'The provider returned no readable JSON error details.',
    };
  }
  const heading = purpose === 'model' ? 'Model request failed' : 'Provider connection failed';
  const code = result.codes.length ? '; ' + result.codes.slice(0, 2).join('; ') : '';
  const unchanged = purpose === 'model' ? ' No file changes were applied.' : '';
  return new Error(
    `${heading} (${response.status}${code}). ${providerPresets[kind].name}: ${result.detail}${unchanged}`,
  );
}
