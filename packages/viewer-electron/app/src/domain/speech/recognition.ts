import { z } from 'zod';
import type { SpeechModelsSnapshot } from './models';

import { speechMaximumBytes } from './audio-format';
export { speechSampleRate, speechMaximumSeconds, speechMaximumBytes } from './audio-format';
export const speechLanguages = [
  ['auto', 'Detect language'],
  ['en', 'English'],
  ['ro', 'Romanian'],
  ['de', 'German'],
  ['fr', 'French'],
  ['es', 'Spanish'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['nl', 'Dutch'],
  ['pl', 'Polish'],
  ['uk', 'Ukrainian'],
  ['ru', 'Russian'],
  ['zh', 'Chinese'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['ar', 'Arabic'],
  ['hi', 'Hindi'],
  ['tr', 'Turkish'],
  ['el', 'Greek'],
  ['hu', 'Hungarian'],
] as const;
export type SpeechLanguage = (typeof speechLanguages)[number][0];
export const speechPreferencesSchema = z
  .object({
    language: z.enum(speechLanguages.map(([id]) => id)).default('auto'),
    microphone: z.string().max(500).default(''),
  })
  .strict();
export type SpeechPreferences = z.infer<typeof speechPreferencesSchema>;
export interface SpeechRuntimeStatus {
  name: 'whisper.cpp';
  version?: string;
  recognitionAvailable: boolean;
  reason: string;
}
export interface SpeechTranscript {
  text: string;
  language: string;
  seconds: number;
  milliseconds: number;
  model: string;
}
export interface SpeechSessionEvent {
  id: string;
  state: 'listening' | 'transcribing' | 'completed' | 'cancelled' | 'failed';
  message?: string;
}
export interface SpeechSetupTask {
  id: string;
  model: string;
  state: 'running' | 'completed' | 'cancelled' | 'failed';
  message?: string;
}
export interface SpeechStatus {
  models: SpeechModelsSnapshot;
  preferences: SpeechPreferences;
  microphone: 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';
  setup: SpeechSetupTask[];
}
export interface SpeechCaptureStart {
  id: string;
  preferences: SpeechPreferences;
}
export type SpeechReply =
  SpeechStatus | SpeechTranscript | SpeechCaptureStart | { id: string } | null;
export type SpeechRequest =
  | { kind: 'status' }
  | { kind: 'preferences'; preferences: SpeechPreferences }
  | { kind: 'setup'; action: 'install' | 'use' | 'import'; model: string }
  | { kind: 'cancel-setup'; id: string }
  | { kind: 'begin'; id: string }
  | { kind: 'transcribe'; id: string; pcm: Uint8Array }
  | { kind: 'cancel'; id: string };

export const speechRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('status') }).strict(),
  z.object({ kind: z.literal('preferences'), preferences: speechPreferencesSchema }).strict(),
  z
    .object({
      kind: z.literal('setup'),
      action: z.enum(['install', 'use', 'import']),
      model: z.string().min(1).max(100),
    })
    .strict(),
  z.object({ kind: z.literal('cancel-setup'), id: z.uuid() }).strict(),
  z.object({ kind: z.literal('begin'), id: z.uuid() }).strict(),
  z
    .object({
      kind: z.literal('transcribe'),
      id: z.uuid(),
      pcm: z
        .instanceof(Uint8Array)
        .refine(
          (value) =>
            value.byteLength >= 3200 &&
            value.byteLength <= speechMaximumBytes &&
            value.byteLength % 2 === 0,
          'Record between 0.1 and 60 seconds of mono audio.',
        ),
    })
    .strict(),
  z.object({ kind: z.literal('cancel'), id: z.uuid() }).strict(),
]);

/** PCM is mono signed little-endian 16-bit, keeping the inference boundary format-free. */
export function pcmEnergy(bytes: Uint8Array): number {
  if (bytes.byteLength % 2) throw new Error('Audio has an incomplete sample.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let sum = 0;
  for (let i = 0; i < bytes.byteLength; i += 2) sum += (view.getInt16(i, true) / 32768) ** 2;
  return Math.sqrt(sum / Math.max(1, bytes.byteLength / 2));
}
