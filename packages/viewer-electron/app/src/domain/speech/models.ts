import { z } from 'zod';
import type { SpeechRuntimeStatus } from './recognition';

export interface SpeechModel {
  id: string;
  name: string;
  bytes: number;
  sha256: string;
  url: string;
  multilingual: boolean;
  license: string;
}
export interface SpeechModelRecord {
  id: string;
  model: string;
  file: string;
  status: 'downloading' | 'ready' | 'failed' | 'cancelled' | 'interrupted';
  received: number;
  identity?: string;
  modified?: number;
  error?: string;
  available: boolean;
}
export interface SpeechModelsSnapshot {
  selected?: string;
  runtime: SpeechRuntimeStatus;
  models: (SpeechModel & { installed: boolean; selected: boolean })[];
  records: SpeechModelRecord[];
}
const revision = '5359861c739e955e79d9a303bcbc70fb988958b1';
/** Immutable upstream model revisions and LFS SHA-256s; model weights are never executables. */
export const speechModels: readonly SpeechModel[] = [
  {
    id: 'whisper-tiny',
    name: 'Whisper Tiny',
    bytes: 77691713,
    sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21',
    url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/${revision}/ggml-tiny.bin`,
    multilingual: true,
    license: 'MIT',
  },
  {
    id: 'whisper-base',
    name: 'Whisper Base',
    bytes: 147951465,
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
    url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/${revision}/ggml-base.bin`,
    multilingual: true,
    license: 'MIT',
  },
  {
    id: 'whisper-small',
    name: 'Whisper Small',
    bytes: 487601967,
    sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b',
    url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/${revision}/ggml-small.bin`,
    multilingual: true,
    license: 'MIT',
  },
];
export const speechSetupSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('install'), model: z.string().min(1).max(100) }).strict(),
  z
    .object({
      kind: z.literal('import'),
      model: z.string().min(1).max(100),
      source: z.string().min(1).max(32768),
    })
    .strict(),
  z.object({ kind: z.literal('use'), model: z.string().min(1).max(100) }).strict(),
]);
export type SpeechSetup = z.infer<typeof speechSetupSchema>;
