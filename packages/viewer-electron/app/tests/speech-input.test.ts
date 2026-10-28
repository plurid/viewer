import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Speech } from '../src/desktop/speech/service';
import { speechMediaAllowed } from '../src/desktop/speech/media-policy';
import { PCMEncoder } from '../src/domain/speech/pcm';
import {
  pcmEnergy,
  speechMaximumBytes,
  speechRequestSchema,
  type SpeechSessionEvent,
  type SpeechTranscript,
} from '../src/domain/speech/recognition';
import type { SpeechModelsSnapshot, SpeechSetup } from '../src/domain/speech/models';
import { temporaryRoot } from '../tools/temporary';

const runtimeStatus = {
  name: 'whisper.cpp' as const,
  recognitionAvailable: true,
  reason: 'Generated test runtime',
};
const snapshot: SpeechModelsSnapshot = {
  selected: 'test',
  runtime: runtimeStatus,
  models: [],
  records: [],
};
const answer: SpeechTranscript = {
  text: 'Open Documents',
  language: 'en',
  model: 'test',
  seconds: 1,
  milliseconds: 10,
};
const pcm = new Uint8Array(32000);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const services: Speech[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
});
async function fixture() {
  const root = await temporaryRoot('viewer-speech-input-');
  const events: { owner: number; event: SpeechSessionEvent }[] = [];
  const ports = {
    settings: (owner: number) => owner === 2,
    human: (owner: number) => owner > 0,
    foreground: () => true,
    microphone: () => 'granted' as const,
    requestMicrophone: vi.fn(async () => true),
    chooseModel: vi.fn(async (): Promise<string | undefined> => undefined),
    event: (owner: number, event: SpeechSessionEvent) => {
      events.push({ owner, event });
    },
    changed: vi.fn(),
  };
  const models = {
    status: vi.fn(async () => snapshot),
    describe: vi.fn(async () => 'Ready'),
    request: vi.fn(async (_setup: SpeechSetup, _id: string) => snapshot),
    cancel: vi.fn(),
    selectedFile: vi.fn(async () => ({
      file: '/generated/weights.bin',
      model: 'test',
      recordID: 'record',
    })),
    validateSelection: vi.fn(async () => {}),
  };
  const runtime = {
    status: vi.fn(async () => runtimeStatus),
    transcribe: vi.fn(
      async (
        _file: string,
        _model: string,
        _pcm: Uint8Array,
        _language: string,
        _signal: AbortSignal,
      ) => answer,
    ),
  };
  const speech = new Speech(root, models, runtime, ports);
  services.push(speech);
  return { root, speech, models, runtime, ports, events };
}
describe('human speech session ownership', () => {
  it('never records, downloads or writes audio when reading status', async () => {
    const f = await fixture();
    expect(await f.speech.request({ kind: 'status' }, 1)).toMatchObject({
      microphone: 'granted',
      preferences: { language: 'auto' },
    });
    expect(f.ports.requestMicrophone).not.toHaveBeenCalled();
    expect(f.models.request).not.toHaveBeenCalled();
    expect(await readdir(f.root)).toEqual([]);
    await expect(f.speech.request({ kind: 'begin', id: randomUUID() }, 0)).rejects.toThrow(
      'person',
    );
  });
  it('releasing before engine verification prevents a late permission prompt or capture', async () => {
    const f = await fixture(),
      gate = deferred<typeof runtimeStatus>(),
      id = randomUUID();
    f.runtime.status.mockImplementation(() => gate.promise);
    const outcome = f.speech.request({ kind: 'begin', id }, 1).catch((error: Error) => error);
    await f.speech.request({ kind: 'cancel', id }, 1);
    gate.resolve(runtimeStatus);
    expect(await outcome).toBeInstanceOf(Error);
    expect(f.ports.requestMicrophone).not.toHaveBeenCalled();
    expect(f.speech.allowsMicrophone(1)).toBe(false);
  });
  it('releasing during native consent cannot start capture after consent completes', async () => {
    const f = await fixture(),
      gate = deferred<boolean>(),
      id = randomUUID();
    f.ports.requestMicrophone.mockImplementation(() => gate.promise);
    const outcome = f.speech.request({ kind: 'begin', id }, 1).catch((error: Error) => error);
    await vi.waitFor(() => expect(f.ports.requestMicrophone).toHaveBeenCalledOnce());
    f.speech.stopOwner(1);
    gate.resolve(true);
    expect(await outcome).toBeInstanceOf(Error);
    expect(f.speech.allowsMicrophone(1)).toBe(false);
  });
  it('handles denial and a window losing focus before consent returns', async () => {
    const f = await fixture();
    f.ports.requestMicrophone.mockResolvedValueOnce(false);
    await expect(f.speech.request({ kind: 'begin', id: randomUUID() }, 1)).rejects.toThrow(
      'denied',
    );
    expect(f.speech.allowsMicrophone(1)).toBe(false);
    f.ports.foreground = () => false;
    await expect(f.speech.request({ kind: 'begin', id: randomUUID() }, 1)).rejects.toThrow(
      'cancelled',
    );
  });
  it('binds PCM and cancellation to one window and releases microphone authority before inference', async () => {
    const f = await fixture(),
      id = randomUUID();
    await f.speech.request({ kind: 'begin', id }, 1);
    expect(f.speech.allowsMicrophone(1)).toBe(true);
    expect(f.speech.allowsMicrophone(2)).toBe(false);
    await expect(f.speech.request({ kind: 'cancel', id }, 2)).rejects.toThrow('another window');
    await expect(f.speech.request({ kind: 'transcribe', id, pcm }, 2)).rejects.toThrow(
      'another window',
    );
    f.runtime.transcribe.mockImplementation(async () => {
      expect(f.speech.allowsMicrophone(1)).toBe(false);
      return answer;
    });
    expect(await f.speech.request({ kind: 'transcribe', id, pcm }, 1)).toEqual(answer);
    expect(f.models.validateSelection).toHaveBeenCalledWith('record');
    expect(await readdir(f.root)).toEqual([]);
    await expect(f.speech.request({ kind: 'transcribe', id, pcm }, 1)).rejects.toThrow('ended');
  });
  it('holds the inference slot until an aborted engine actually settles and ignores its late result', async () => {
    const f = await fixture(),
      id = randomUUID(),
      gate = deferred<SpeechTranscript>();
    await f.speech.request({ kind: 'begin', id }, 1);
    f.runtime.transcribe.mockImplementation(() => gate.promise);
    const outcome = f.speech
      .request({ kind: 'transcribe', id, pcm }, 1)
      .catch((error: Error) => error);
    await vi.waitFor(() => expect(f.runtime.transcribe).toHaveBeenCalledOnce());
    await f.speech.request({ kind: 'cancel', id }, 1);
    await expect(f.speech.request({ kind: 'begin', id: randomUUID() }, 2)).rejects.toThrow(
      'current recording',
    );
    gate.resolve(answer);
    expect(await outcome).toBeInstanceOf(Error);
    expect(f.events.some((item) => item.event.state === 'completed')).toBe(false);
    await f.speech.request({ kind: 'begin', id: randomUUID() }, 2);
    expect(f.speech.allowsMicrophone(2)).toBe(true);
  });
  it('rejects a replaced model instead of returning the transcript', async () => {
    const f = await fixture(),
      id = randomUUID();
    await f.speech.request({ kind: 'begin', id }, 1);
    f.models.validateSelection.mockRejectedValueOnce(new Error('model changed'));
    await expect(f.speech.request({ kind: 'transcribe', id, pcm }, 1)).rejects.toThrow(
      'model changed',
    );
    expect(f.speech.allowsMicrophone(1)).toBe(false);
  });
  it('keeps preferences in Settings and restores harmless choices without microphone authority', async () => {
    const f = await fixture();
    const preferences = { language: 'ro' as const, microphone: 'generated-device' };
    await expect(f.speech.request({ kind: 'preferences', preferences }, 1)).rejects.toThrow(
      'Settings',
    );
    await f.speech.request({ kind: 'preferences', preferences }, 2);
    await f.speech.close();
    const restored = new Speech(f.root, f.models, f.runtime, f.ports);
    services.push(restored);
    expect(await restored.request({ kind: 'status' }, 2)).toMatchObject({ preferences });
    expect(restored.allowsMicrophone(2)).toBe(false);
    expect(f.ports.requestMicrophone).not.toHaveBeenCalled();
    expect(await readdir(f.root)).toEqual(['speech-preferences-v1.json']);
  });
  it('selects only verified setup results and keeps setup cancellation separate from recording', async () => {
    const f = await fixture();
    await expect(
      f.speech.request({ kind: 'setup', action: 'install', model: 'test' }, 1),
    ).rejects.toThrow('Settings');
    await f.speech.request({ kind: 'setup', action: 'install', model: 'test' }, 2);
    await vi.waitFor(() => expect(f.models.request).toHaveBeenCalledTimes(2));
    expect(f.models.request.mock.calls[1]![0]).toEqual({ kind: 'use', model: 'test' });
    const task = (await f.speech.status(2)).setup[0]!;
    await expect(f.speech.request({ kind: 'cancel-setup', id: task.id }, 1)).rejects.toThrow(
      'another window',
    );
    expect(
      await f.speech.request({ kind: 'setup', action: 'import', model: 'test' }, 2),
    ).toBeNull();
  });
});
describe('microphone and PCM boundaries', () => {
  it('denies browser/document frames, camera, mixed media and requests without a human session', () => {
    const allowed = {
      permission: 'media',
      mainFrame: true,
      trusted: true,
      active: true,
      media: ['audio'],
    };
    expect(speechMediaAllowed(allowed)).toBe(true);
    for (const change of [
      { permission: 'camera' },
      { mainFrame: false },
      { trusted: false },
      { active: false },
      { media: [] },
      { media: ['video'] },
      { media: ['audio', 'video'] },
    ])
      expect(speechMediaAllowed({ ...allowed, ...change })).toBe(false);
  });
  it('bounds IPC to one minute, complete samples and generated session IDs', () => {
    const valid = { kind: 'transcribe', id: randomUUID(), pcm };
    expect(speechRequestSchema.safeParse(valid).success).toBe(true);
    for (const change of [
      { pcm: new Uint8Array(3199) },
      { pcm: new Uint8Array(speechMaximumBytes + 2) },
      { id: 'foreign' },
      { path: '/file.wav' },
    ])
      expect(speechRequestSchema.safeParse({ ...valid, ...change }).success).toBe(false);
    expect(pcmEnergy(pcm)).toBe(0);
  });
  it('resamples across chunk boundaries without losing timing or clipping', () => {
    const encoder = new PCMEncoder(48000),
      samples = new Float32Array(48000).fill(0.5);
    const first = encoder.encode(samples.subarray(0, 137)),
      second = encoder.encode(samples.subarray(137));
    expect(first.length + second.length).toBe(16000);
    expect([...first, ...second].every((sample) => sample === 16384)).toBe(true);
    expect([...new PCMEncoder(16000).encode(Float32Array.of(-2, 2, NaN))]).toEqual([
      -32768, 32767, 0,
    ]);
    expect(() => new PCMEncoder(0)).toThrow('sample rate');
  });
});
