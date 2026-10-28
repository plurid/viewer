import { z } from 'zod';
import type { SpeechLanguage } from './recognition';

export const speechProviderKinds = ['meta', 'openai', 'deepgram', 'compatible'] as const;
export type SpeechProviderKind = (typeof speechProviderKinds)[number];
export interface SpeechProviderPreset {
  name: string;
  endpoint: string;
  model: string;
  note: string;
}
export const speechProviderPresets: Record<SpeechProviderKind, SpeechProviderPreset> = {
  meta: {
    name: 'Meta',
    endpoint: 'https://api.meta.ai/v1',
    model: 'muse-voice-transcribe-1.0',
    note: 'Muse Voice Transcribe. Romanian is not in its documented supported language list.',
  },
  openai: {
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini-transcribe',
    note: 'Audio Transcriptions API. Choose a transcription model available to your account.',
  },
  deepgram: {
    name: 'Deepgram',
    endpoint: 'https://api.deepgram.com/v1',
    model: 'nova-3',
    note: 'Pre-recorded Listen API. Language availability depends on the selected model.',
  },
  compatible: {
    name: 'Compatible endpoint',
    endpoint: '',
    model: '',
    note: 'An OpenAI-compatible /audio/transcriptions endpoint. HTTPS or a local loopback HTTP server.',
  },
};
export function validSpeechEndpoint(kind: SpeechProviderKind, endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.username || url.password || url.search || url.hash) return false;
    if (kind !== 'compatible')
      return url.href.replace(/\/+$/, '') === speechProviderPresets[kind].endpoint;
    return (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    );
  } catch {
    return false;
  }
}
const display = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (value) => !/[\u0000-\u001f\u007f]/.test(value),
    'Use ordinary text without control characters.',
  );
export const speechProviderSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(speechProviderKinds),
    name: display,
    endpoint: z
      .string()
      .trim()
      .max(4000)
      .transform((value) => {
        try {
          return new URL(value).href.replace(/\/+$/, '');
        } catch {
          return value;
        }
      }),
    model: display,
  })
  .strict()
  .refine(
    (value) => validSpeechEndpoint(value.kind, value.endpoint),
    'Use the supported provider endpoint, or choose Compatible endpoint.',
  );
export type SpeechProvider = z.infer<typeof speechProviderSchema>;
export type SpeechProviderCheckOutcome =
  | 'available'
  | 'unverified'
  | 'model-unavailable'
  | 'auth-error'
  | 'http-error'
  | 'connection-error'
  | 'invalid-response';
/** Catalog checks never upload audio and cannot grant audio permission. */
export interface SpeechProviderCheck {
  outcome: SpeechProviderCheckOutcome;
  detail: string;
  checkedAt: number;
  httpStatus?: number;
}
export interface SpeechProviderState extends SpeechProvider {
  hasKey: boolean;
  allowed: boolean;
  check?: SpeechProviderCheck;
}
export interface SpeechProvidersSnapshot {
  providers: SpeechProviderState[];
}
export const speechProviderRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('provider-save'), provider: speechProviderSchema }).strict(),
  z.object({ kind: z.literal('provider-remove'), id: z.uuid() }).strict(),
  z
    .object({
      kind: z.literal('provider-key'),
      id: z.uuid(),
      key: z
        .string()
        .trim()
        .max(20000)
        .refine((value) => !/[\r\n\0]/.test(value)),
    })
    .strict(),
  z.object({ kind: z.literal('provider-consent'), id: z.uuid(), allow: z.boolean() }).strict(),
  z.object({ kind: z.literal('provider-check'), id: z.uuid() }).strict(),
]);
export type SpeechProviderRequest = z.infer<typeof speechProviderRequestSchema>;
/** Audio consent binds the model as well as the protocol and endpoint. */
export const speechProviderIdentity = (provider: SpeechProvider) =>
  JSON.stringify([provider.id, provider.kind, provider.endpoint, provider.model]);
export function newSpeechProvider(kind: SpeechProviderKind, id: string): SpeechProvider {
  const preset = speechProviderPresets[kind];
  return { id, kind, name: preset.name, endpoint: preset.endpoint, model: preset.model };
}
const metaLanguages: Partial<Record<SpeechLanguage, string>> = {
  en: 'English',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  pl: 'Polish',
  zh: 'Mandarin Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  ar: 'Arabic',
  hi: 'Hindi',
  tr: 'Turkish',
};
export function metaLanguageBias(language: SpeechLanguage): string[] | undefined {
  if (language === 'auto') return undefined;
  const name = metaLanguages[language];
  if (!name)
    throw new Error(
      'Meta Muse Voice Transcribe does not list this language as supported. Choose local Whisper or another hosted provider.',
    );
  return [name];
}
