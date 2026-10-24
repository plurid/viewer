import { z } from 'zod';
import { chatStepSchema } from '../../domain/models/chat';
import type { ProviderCheckKind, ProviderCheckResult } from '../../domain/models/provider-checks';
import { providerAbort, providerResponseJSON, requestProvider } from './provider-response';
import { geminiGenerationSchema } from './provider-schema';

export type ProviderCheckPhase =
  'checking data permission' | 'accessing the stored key' | 'waiting for the provider response';

/** Bound even OS-backed awaits that cannot themselves be interrupted. */
export function waitForProviderCheck<T>(
  work: Promise<T>,
  signal: AbortSignal,
  phase: () => ProviderCheckPhase,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const clean = () => signal.removeEventListener('abort', cancel);
    const cancel = () => {
      clean();
      const timeout =
        signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError';
      const current = phase();
      const detail =
        current === 'accessing the stored key'
          ? ' Stored-key access may still be waiting for a system prompt. This check will not send a late request.'
          : '';
      reject(
        new DOMException(
          timeout
            ? `The compatibility check timed out while ${current}.${detail}`
            : 'The compatibility check was cancelled.',
          timeout ? 'TimeoutError' : 'AbortError',
        ),
      );
    };
    signal.addEventListener('abort', cancel, { once: true });
    // Both handlers stay attached after an early abort. A late OS result cannot
    // become an unhandled rejection or release the caller into another request.
    void work.then(
      (value) => {
        clean();
        resolve(value);
      },
      (error: unknown) => {
        clean();
        reject(error);
      },
    );
    if (signal.aborted) cancel();
  });
}

const marker = 'VIEWER_PROVIDER_CHECK_OK';
const instructions = [
  'This is a synthetic API compatibility check with no files, tools or conversation history.',
  `Reply with exactly ${marker} when no response schema is supplied.`,
  'When a response schema is supplied, return only a JSON object matching it.',
  'If the schema has an ok field, set ok to true.',
  `Otherwise use kind reply, text ${marker}, null path/query/commandID and empty patches/renames.`,
  'Do not propose or perform any action. Do not include Markdown.',
].join(' ');
const requestText = 'Run only this synthetic compatibility check.';
const simpleSchema = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
};
const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string(),
        message: z.object({ content: z.string(), refusal: z.string().nullish() }),
      }),
    )
    .min(1),
});

/** The three requests differ only in response_format, keeping model and token budget fixed. */
export function providerCheckBody(model: string, kind: ProviderCheckKind): Record<string, unknown> {
  return {
    model,
    messages: [
      { role: 'system', content: instructions },
      { role: 'user', content: requestText },
    ],
    max_tokens: 12000,
    stream: false,
    ...(kind === 'text'
      ? {}
      : {
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'file_action',
              strict: true,
              schema:
                kind === 'simple-schema'
                  ? simpleSchema
                  : geminiGenerationSchema(z.toJSONSchema(chatStepSchema)),
            },
          },
        }),
  };
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function errorMessages(data: unknown): string[] {
  const envelopes = Array.isArray(data) ? data.slice(0, 4) : [data];
  return envelopes.flatMap((envelope) => {
    const error = object(object(envelope).error);
    const details = Array.isArray(error.details) ? error.details.slice(0, 8) : [];
    return [
      error.message,
      ...details.flatMap((detail) => {
        const violations = object(detail).fieldViolations;
        return Array.isArray(violations)
          ? violations.slice(0, 8).map((item) => object(item).description)
          : [];
      }),
    ].filter((value): value is string => typeof value === 'string');
  });
}

function decoded(value: string): string {
  return value
    .replace(/(?:%[0-9a-f]{2})+/gi, (encoded) => {
      try {
        return decodeURIComponent(encoded);
      } catch {
        return encoded;
      }
    })
    .replace(
      /\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi,
      (_match, unicode: string | undefined, ascii: string | undefined) =>
        String.fromCharCode(parseInt(unicode ?? ascii!, 16)),
    )
    .replace(
      /&#(?:x([0-9a-f]{1,6})|(\d{1,7}));/gi,
      (match, hex: string | undefined, decimal: string | undefined) => {
        const code = parseInt(hex ?? decimal!, hex ? 16 : 10);
        return code <= 0x10ffff ? String.fromCodePoint(code) : match;
      },
    );
}

/** Used only for fixed-input checks; ordinary model errors never expose provider text. */
export function redactProviderCheckMessage(value: string, secret: string): string {
  const protectedValues = [secret, instructions, requestText, marker].filter(Boolean);
  const variants = new Set(
    protectedValues.flatMap((item) => [
      item,
      encodeURIComponent(item),
      JSON.stringify(item).slice(1, -1),
      Buffer.from(item).toString('base64'),
      Buffer.from(item).toString('base64').replace(/=+$/, ''),
      Buffer.from(item).toString('base64url'),
    ]),
  );
  const redact = (text: string) => {
    for (const variant of variants) text = text.replaceAll(variant, '[redacted]');
    return text;
  };
  let text = redact(value);
  for (let pass = 0; pass < 3; pass++) text = redact(decoded(text));
  // Do not return echoed request objects, headers or HTML, even with their key redacted.
  if (
    /<\/?[a-z][^>]*>/i.test(text) ||
    /["'](?:messages|headers|authorization|api[_-]?key|prompt|input)["']\s*:/i.test(text)
  )
    return 'Provider echoed request details or HTML; diagnostic text omitted.';
  text = text
    .replace(/\b(?:authorization|proxy-authorization|x-api-key)\s*:[^\r\n]*/gi, '[header omitted]')
    .replace(/\bBearer\s+[a-z0-9._~+/=-]+/gi, '[credential omitted]')
    .replace(/\bAIza[a-z0-9_-]{16,}/gi, '[credential omitted]')
    .replace(/\b(?:sk-(?:proj-|ant-)?|gsk_)[a-z0-9_-]{12,}/gi, '[credential omitted]')
    .replace(
      /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret|password)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi,
      '[credential omitted]',
    )
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, '[URL omitted]')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ');
  // Redaction precedes truncation so a boundary can never reveal a key prefix.
  return redact(text).trim().slice(0, 2000);
}

function validResponse(data: unknown, kind: ProviderCheckKind): boolean {
  const envelope = completionSchema.safeParse(data);
  if (!envelope.success) return false;
  const choice = envelope.data.choices[0]!;
  if (choice.finish_reason !== 'stop' || choice.message.refusal) return false;
  if (kind === 'text') return choice.message.content.trim() === marker;
  let value: unknown;
  try {
    value = JSON.parse(choice.message.content);
  } catch {
    return false;
  }
  if (kind === 'simple-schema')
    return z
      .object({ ok: z.literal(true) })
      .strict()
      .safeParse(value).success;
  const result = chatStepSchema.safeParse(value);
  return (
    result.success &&
    result.data.kind === 'reply' &&
    result.data.text === marker &&
    result.data.path === null &&
    result.data.query === null &&
    result.data.commandID === null &&
    result.data.patches.length === 0 &&
    result.data.renames.length === 0
  );
}

export async function runProviderCheck(options: {
  providerID: string;
  kind: ProviderCheckKind;
  model: string;
  endpoint: string;
  secret: string;
  signal: AbortSignal;
  request: typeof fetch;
}): Promise<ProviderCheckResult> {
  const { providerID, kind, model, endpoint, secret, signal, request } = options;
  const result = (
    outcome: ProviderCheckResult['outcome'],
    detail: string,
    httpStatus?: number,
  ): ProviderCheckResult => ({
    providerID,
    kind,
    outcome,
    detail,
    ...(httpStatus === undefined ? {} : { httpStatus }),
  });
  let response: Response;
  try {
    response = await requestProvider(request, endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + secret },
      body: JSON.stringify(providerCheckBody(model, kind)),
      signal,
      redirect: 'error',
    });
  } catch {
    if (signal.aborted) throw providerAbort(signal);
    return result('connection-error', 'The compatibility check could not connect to the provider.');
  }
  if (!response.ok) {
    try {
      const detailsSignal = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
      const data = await providerResponseJSON(response, detailsSignal, 32768);
      const messages = errorMessages(data).map((message) =>
        redactProviderCheckMessage(message, secret),
      );
      const detail = messages.filter(Boolean).join('\n').slice(0, 2000);
      return result(
        'http-error',
        detail || 'The provider returned no readable error message.',
        response.status,
      );
    } catch {
      if (signal.aborted) throw providerAbort(signal);
      return result(
        'http-error',
        'The provider error details were empty, unreadable, too large or timed out.',
        response.status,
      );
    }
  }
  try {
    const data = await providerResponseJSON(response, signal);
    return validResponse(data, kind)
      ? result('passed', 'The provider returned the expected synthetic response.', response.status)
      : result(
          'invalid-response',
          'The provider responded, but its result did not match the fixed expected response.',
          response.status,
        );
  } catch {
    if (signal.aborted) throw providerAbort(signal);
    return result(
      'invalid-response',
      'The provider returned an unreadable, invalid or oversized response.',
      response.status,
    );
  }
}
