/**
 * One live run of Ask Viewer by voice outside the app. A WAV file is transcribed by Meta's Muse
 * Voice Transcribe exactly as Viewer's hosted speech sends a recording (desktop/speech/
 * transcription.ts). With --plan, Muse Spark then reads the transcript into a plan for a job folder
 * shown as Job 1042, through Viewer's own prompt and checks (desktop/models/prompts.ts,
 * domain/command-line/spoken.ts), beside Viewer's own matching. The key comes from META_API_KEY
 * only: it is held in memory, never printed, written or logged. Nothing is written.
 *
 *   say --file-format=WAVE --data-format=LEI16@16000 -o request.wav "Check this job and prepare the cut sheets"
 *   node --import tsx tools/speech/transcribe-live.ts request.wav
 *     [--language en] [--model <id>] [--plan] [--plan-model <id>] [--text "<words>"]
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SpokenAnswer, SpokenCommand, SpokenPlan } from '../../src/domain/command-line/spoken';
import type { ModelDataPermission } from '../../src/domain/models/permissions';
import type { ModelProvider } from '../../src/domain/services';
import type { SpeechLanguage, SpeechTranscript } from '../../src/domain/speech/recognition';
import type { ModelPermissions } from '../../src/desktop/models/model-permissions';
import { matchSpoken, spokenPlan, spokenText } from '../../src/domain/command-line/spoken';
import { modelEndpoint, modelPermissionCovers } from '../../src/domain/models/permissions';
import { providerPresets } from '../../src/domain/models/providers';
import { defaultSettings } from '../../src/domain/services';
import { newSpeechProvider } from '../../src/domain/speech/providers';
import { speechLanguages, speechSampleRate } from '../../src/domain/speech/recognition';
import { PCMEncoder } from '../../src/domain/speech/pcm';
import { errorMessage } from '../../src/domain/errors';
import { ModelPermissionRequired } from '../../src/desktop/models/model-permissions';
import { answerSpoken } from '../../src/desktop/models/prompts';
import { Credentials, Providers } from '../../src/desktop/models/providers';
import { HostedTranscription } from '../../src/desktop/speech/transcription';

const convert =
  'Convert it with: afconvert -f WAVE -d LEI16@16000 -c 1 <recording> request.wav, or make one with say --file-format=WAVE --data-format=LEI16@16000 -o request.wav "<words>".';

/**
 * A WAV file's audio as Viewer records it, 16 kHz mono PCM16: 16-bit PCM at 16 kHz or more is mixed
 * down and resampled as the microphone's audio is (domain/speech/pcm.ts).
 */
export function wavPCM(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE')
    throw new Error(`Give a WAV file. ${convert}`);
  let format: { kind: number; channels: number; rate: number; bits: number } | undefined;
  let data: Uint8Array | undefined;
  for (let offset = 12; offset + 8 <= bytes.byteLength;) {
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (tag(offset) === 'fmt ' && body + 16 <= bytes.byteLength)
      format = {
        kind: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        rate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    else if (tag(offset) === 'data')
      data = bytes.subarray(body, Math.min(body + size, bytes.length));
    offset = body + size + (size % 2);
  }
  if (!format || !data?.byteLength || !format.channels)
    throw new Error('The WAV file holds no audio.');
  // 1 is PCM; 0xfffe is the extensible form a 16-bit PCM file may also take
  if (![1, 0xfffe].includes(format.kind) || format.bits !== 16)
    throw new Error(`Give 16-bit PCM audio. ${convert}`);
  if (format.rate < speechSampleRate)
    throw new Error(`Give audio at 16 kHz or more; this file is ${format.rate} Hz. ${convert}`);
  const frames = Math.floor(data.byteLength / (2 * format.channels));
  const pcm = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const samples = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    for (let channel = 0; channel < format.channels; channel++)
      sum += pcm.getInt16((frame * format.channels + channel) * 2, true);
    samples[frame] = sum / format.channels / 32768;
  }
  const encoded = new PCMEncoder(format.rate).encode(samples);
  const out = new Uint8Array(encoded.length * 2);
  const writer = new DataView(out.buffer);
  encoded.forEach((sample, index) => writer.setInt16(index * 2, sample, true));
  return out;
}

export interface LiveOptions {
  key: string;
  language?: SpeechLanguage;
  /** Another Muse Voice Transcribe model; Viewer's preset unless given. */
  model?: string;
  /** Another Muse Spark model for --plan; Viewer's preset unless given. */
  planModel?: string;
  /** The network; tests give a stub. */
  request?: typeof fetch;
}
/** Transcribes one WAV recording as Viewer's hosted speech does: once, at most a minute, no retry. */
export async function transcribeWAV(
  wav: Uint8Array,
  options: LiveOptions,
): Promise<SpeechTranscript> {
  if (!options.key) throw new Error('Set META_API_KEY in the environment; this never prints it.');
  const pcm = wavPCM(wav);
  const preset = newSpeechProvider('meta', randomUUID());
  const provider = { ...preset, model: options.model ?? preset.model };
  return new HostedTranscription(options.request ?? fetch).transcribe(
    provider,
    options.key,
    pcm,
    options.language ?? 'auto',
    AbortSignal.timeout(130_000),
  );
}

/**
 * A job folder shown as Job 1042, as the app offers its commands there: the check, what follows it,
 * and two of the folder's own. tests/spoken-requests-live.test.ts keeps it the same as the app's.
 */
export const jobFolderCommands: readonly SpokenCommand[] = [
  {
    id: 'check-laser-job',
    label: 'Check laser job…',
    aliases: [
      'laser',
      'fabrication',
      'check job',
      'check drawing',
      'dxf',
      'cut',
      'hole pitch',
      'muse spark',
    ],
    phrase: 'check Job 1042',
    subject: 'Job 1042',
    available: true,
    run: 'at-once',
  },
  ...(
    [
      [
        'check-cut-sheets',
        'Prepare cut sheets',
        ['cut sheets', 'nest', 'nest the parts', 'nesting'],
        'prepare its cut sheets',
        'at-once',
      ],
      [
        'check-tour',
        'Play the check’s tour',
        ['tour', 'play the tour', 'show the findings', 'walk through the findings'],
        'play its tour',
        'at-once',
      ],
      [
        'check-corrections',
        'Save corrected copies',
        ['save the corrections', 'correct the dxf', 'fix the pitch', 'fix the holes'],
        'save its corrected copies',
        'press',
      ],
      [
        'check-handoff',
        'Export handoff',
        ['handoff', 'export the job', 'export for the shop', 'send to the shop'],
        'export its handoff',
        'press',
      ],
    ] as const
  ).map(([id, label, aliases, follows, run]): SpokenCommand => ({
    id,
    label,
    aliases,
    phrase: follows,
    follows,
    after: ['check-laser-job'],
    available: false,
    unavailable: 'Check a laser job first: this follows its check.',
    run,
  })),
  {
    id: 'sort.modified',
    label: 'Sort by date modified',
    aliases: [],
    phrase: 'sort by date modified',
    available: true,
    run: 'at-once',
  },
  {
    id: 'select-all',
    label: 'Select all',
    aliases: [],
    phrase: 'select all',
    available: true,
    run: 'at-once',
  },
];

/** The key from META_API_KEY, held in memory only: never saved, printed or logged. */
class EnvironmentKey extends Credentials {
  constructor(private readonly secret: string) {
    super(tmpdir(), refuse, refuse);
  }
  override async forProvider(): Promise<string> {
    return this.secret;
  }
  override async get(): Promise<string> {
    return this.secret;
  }
}
const refuse = async (): Promise<never> => {
  throw new Error('This run keeps its key in memory only.');
};

/** Muse Spark's plan for the words, where Job 1042 is shown, checked as the window checks one. */
export async function planTranscript(
  transcript: string,
  options: LiveOptions,
): Promise<{ answer: SpokenAnswer; plan: SpokenPlan }> {
  if (!options.key) throw new Error('Set META_API_KEY in the environment; this never prints it.');
  const provider: ModelProvider = {
    id: 'meta-voice-live',
    name: 'Meta',
    kind: 'meta',
    endpoint: providerPresets.meta.endpoint,
    model: options.planModel ?? providerPresets.meta.model!,
    allowContent: false,
  };
  // Running this is the person's consent to send the words and the sample folder's names.
  const granted: ModelDataPermission = {
    providerID: provider.id,
    kind: provider.kind,
    endpoint: modelEndpoint(provider),
    level: 'names',
  };
  const permissions: Pick<ModelPermissions, 'run'> = {
    async run(asked, level, signal, work, actor) {
      if (!modelPermissionCovers(granted, asked, level, actor)) throw new ModelPermissionRequired();
      return work(signal);
    },
  };
  const providers = new Providers(
    new EnvironmentKey(options.key),
    options.request ?? fetch,
    permissions,
  );
  const answer = await answerSpoken(
    {
      id: randomUUID(),
      transcript,
      context: {
        folder: '/Jobs/Job 1042',
        selection: [],
        commands: jobFolderCommands.map(({ id, label, subject, after }) => ({
          id,
          label,
          ...(subject ? { subject } : {}),
          ...(after ? { after: [...after] } : {}),
        })),
      },
    },
    { ...defaultSettings(tmpdir()), providers: [provider] },
    (...generate) => providers.generate(...generate),
    AbortSignal.timeout(130_000),
  );
  return { answer, plan: spokenPlan(answer, jobFolderCommands) };
}

/** A plan in lines: its sentence, then each step and how it runs, or why there is none. */
export function planLines(plan: SpokenPlan): string[] {
  if (!plan.steps.length) return [plan.problem ?? 'No step.'];
  return [
    spokenText(plan.steps),
    ...plan.steps.map(
      (step, index) =>
        `  ${index + 1}. ${step.command} · ${step.run === 'at-once' ? 'runs at once' : 'waits for a press'}`,
    ),
    ...(plan.mismatch
      ? [`  ${plan.mismatch.named} is not here; ${plan.mismatch.subject} is: it waits for a press.`]
      : []),
    ...(plan.unmatched ? [`  No command for “${plan.unmatched}”: it waits for a press.`] : []),
  ];
}

const argument = (name: string) => {
  const index = process.argv.indexOf('--' + name);
  return index > 0 ? process.argv[index + 1] : undefined;
};
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const key = process.env.META_API_KEY ?? '';
  // whatever is printed, the key never is
  const say = (line: string) => console.log(key ? line.split(key).join('[META_API_KEY]') : line);
  try {
    if (!key) throw new Error('Set META_API_KEY in the environment; this never prints it.');
    const language = (argument('language') ?? 'auto') as SpeechLanguage;
    if (!speechLanguages.some(([id]) => id === language))
      throw new Error(`--language takes ${speechLanguages.map(([id]) => id).join(', ')}.`);
    const options: LiveOptions = {
      key,
      language,
      ...(argument('model') ? { model: argument('model')! } : {}),
      ...(argument('plan-model') ? { planModel: argument('plan-model')! } : {}),
    };
    let words = argument('text');
    if (words === undefined) {
      const valued = new Set(['--language', '--model', '--plan-model', '--text']);
      const file = process.argv
        .slice(2)
        .find((value, index, all) => !value.startsWith('--') && !valued.has(all[index - 1]!));
      if (!file) throw new Error('Give a WAV file, or --text "<words>" to plan without audio.');
      const heard = await transcribeWAV(new Uint8Array(await readFile(file)), options);
      words = heard.text;
      say(`Transcript: “${heard.text}”`);
      say(
        `${heard.model} · ${heard.seconds.toFixed(1)} s of audio · ${heard.milliseconds} ms · language ${heard.language}`,
      );
    }
    if (process.argv.includes('--plan') || argument('text') !== undefined) {
      if (!words.trim()) throw new Error('The transcript is empty, so there is nothing to plan.');
      const { answer, plan } = await planTranscript(words, options);
      say(`Plan by ${answer.by}, where Job 1042 is shown:`);
      for (const line of planLines(plan)) say(line);
      if (!plan.steps.length && answer.explanation) say(`  ${answer.by}: ${answer.explanation}`);
      say('Viewer’s own matching, without a model:');
      for (const line of planLines(
        spokenPlan(matchSpoken(words, jobFolderCommands), jobFolderCommands),
      ))
        say(line);
    }
  } catch (error) {
    say(`Stopped: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
