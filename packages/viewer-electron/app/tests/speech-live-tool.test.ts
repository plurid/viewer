/**
 * The live voice run (tools/speech/transcribe-live.ts) with the network stubbed: a WAV recording read
 * as Viewer records audio, sent once to Meta's transcription route with the key from the environment,
 * and the transcript planned by Muse Spark through Viewer's own prompt. No live call is made.
 */
import { describe, expect, it, vi } from 'vitest';
import { planLines, planTranscript, transcribeWAV, wavPCM } from '../tools/speech/transcribe-live';

const key = 'GENERATED_META_KEY';
/** A WAV file of `seconds` of a tone: PCM16 at `rate`, `channels` channels. */
function wav(seconds: number, rate: number, channels: number): Uint8Array {
  const frames = Math.round(seconds * rate);
  const bytes = new Uint8Array(44 + frames * channels * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) =>
    [...value].forEach((char, index) => (bytes[offset + index] = char.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, frames * channels * 2, true);
  for (let frame = 0; frame < frames; frame++)
    for (let channel = 0; channel < channels; channel++)
      view.setInt16(
        44 + (frame * channels + channel) * 2,
        Math.round(8000 * Math.sin(frame / 10)),
        true,
      );
  return bytes;
}

describe('the WAV file', () => {
  it('is read as Viewer records audio: 16 kHz mono PCM16', () => {
    expect(wavPCM(wav(1, 16000, 1)).byteLength).toBe(32000);
    // a stereo 32 kHz recording is mixed down and resampled
    expect(wavPCM(wav(1, 32000, 2)).byteLength).toBe(32000);
  });
  it('says how to convert what it cannot read', () => {
    expect(() => wavPCM(new TextEncoder().encode('not audio'))).toThrow(/Give a WAV file/);
    expect(() => wavPCM(wav(1, 8000, 1))).toThrow(/16 kHz or more; this file is 8000 Hz/);
  });
});

describe('one live run, the network stubbed', () => {
  it('sends the recording once to Muse Voice Transcribe, with the key only in its header', async () => {
    const request = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ transcript: ' Check this job and prepare the cut sheets. ' }),
    );
    const heard = await transcribeWAV(wav(2, 16000, 1), {
      key,
      language: 'en',
      request: request as unknown as typeof fetch,
    });
    expect(heard).toMatchObject({
      text: 'Check this job and prepare the cut sheets.',
      model: 'muse-voice-transcribe-1.0',
      seconds: 2,
    });
    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe('https://api.meta.ai/v1/asr/transcribe');
    expect((init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${key}`);
    const body = new TextDecoder().decode(init!.body as Uint8Array);
    expect(body).toContain('"model":"muse-voice-transcribe-1.0"');
    expect(body).toContain('"languageBias":["English"]');
    expect(body).not.toContain(key);
  });

  it('reports a refused key without the key', async () => {
    const refused = async () => new Response('{"error":"bad key"}', { status: 401 });
    const error = await transcribeWAV(wav(1, 16000, 1), {
      key,
      request: refused as unknown as typeof fetch,
    }).catch((value: Error) => value);
    expect(String(error)).toContain('HTTP 401');
    expect(String(error)).not.toContain(key);
  });

  it('plans the words with Muse Spark through Viewer’s prompt, and checks the plan', async () => {
    const request = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                steps: [
                  { command: 'check-laser-job', named: '' },
                  { command: 'check-cut-sheets', named: '' },
                ],
                unmatched: '',
                explanation: '',
              }),
            },
          },
        ],
      }),
    );
    const { answer, plan } = await planTranscript('Check this job and prepare the cut sheets.', {
      key,
      request: request as unknown as typeof fetch,
    });
    expect(answer.by).toBe('Muse Spark');
    expect(planLines(plan)).toEqual([
      'Check Job 1042, then prepare its cut sheets.',
      '  1. check-laser-job · runs at once',
      '  2. check-cut-sheets · runs at once',
    ]);
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe('https://api.meta.ai/v1/chat/completions');
    const sent = JSON.parse(String(init!.body)) as { model: string; messages: unknown[] };
    expect(sent.model).toBe('muse-spark-1.3');
    expect(JSON.stringify(sent.messages)).toContain('Check this job and prepare the cut sheets.');
    expect(String(init!.body)).not.toContain(key);
  });
});
