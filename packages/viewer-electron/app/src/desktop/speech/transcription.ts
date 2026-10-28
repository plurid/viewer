import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { SpeechProvider } from '../../domain/speech/providers';
import { metaLanguageBias, validSpeechEndpoint } from '../../domain/speech/providers';
import {
  speechMaximumBytes,
  speechSampleRate,
  type SpeechLanguage,
  type SpeechTranscript,
} from '../../domain/speech/recognition';
import { providerResponseJSON, requestProvider } from '../models/provider-response';

/** The provider receives only this bounded recording, never filenames, paths or file contents. */
export function speechWAV(pcm: Uint8Array): Uint8Array<ArrayBuffer> {
  if (pcm.byteLength < 3200 || pcm.byteLength > speechMaximumBytes || pcm.byteLength % 2)
    throw new Error('Record between 0.1 and 60 seconds of mono audio.');
  const bytes = new Uint8Array(44 + pcm.byteLength),
    view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, speechSampleRate, true);
  view.setUint32(28, speechSampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  bytes.set(pcm, 44);
  return bytes;
}
const transcriptText = z.string().max(48000);
const openaiResponse = z.object({ text: transcriptText });
const metaResponse = z.object({ transcript: transcriptText });
const deepgramResponse = z.object({
  results: z.object({
    channels: z
      .array(
        z.object({
          detected_language: z.string().max(20).optional(),
          alternatives: z.array(z.object({ transcript: transcriptText })).min(1),
        }),
      )
      .min(1),
  }),
});

export class HostedTranscription {
  constructor(private request: typeof fetch = fetch) {}
  async transcribe(
    provider: SpeechProvider,
    secret: string,
    pcm: Uint8Array,
    language: SpeechLanguage,
    outer: AbortSignal,
  ): Promise<SpeechTranscript> {
    outer.throwIfAborted();
    if (!validSpeechEndpoint(provider.kind, provider.endpoint))
      throw new Error('The speech provider endpoint is invalid.');
    if (!secret || /[\r\n\0]/.test(secret))
      throw new Error('Enter this speech provider’s API key in Settings → Speech.');
    const started = Date.now(),
      wav = speechWAV(pcm),
      signal = AbortSignal.any([outer, AbortSignal.timeout(120000)]);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: (provider.kind === 'deepgram' ? 'Token ' : 'Bearer ') + secret,
    };
    const route =
      provider.kind === 'meta'
        ? 'asr/transcribe'
        : provider.kind === 'deepgram'
          ? 'listen'
          : 'audio/transcriptions';
    const url = new URL(provider.endpoint + '/' + route);
    let body: BodyInit;
    if (provider.kind === 'deepgram') {
      url.searchParams.set('model', provider.model);
      url.searchParams.set('smart_format', 'true');
      url.searchParams.set(
        language === 'auto' ? 'detect_language' : 'language',
        language === 'auto' ? 'true' : language,
      );
      headers['Content-Type'] = 'audio/wav';
      body = wav;
    } else if (provider.kind === 'meta') {
      // The settings part is JSON without a filename, as required by Meta's multipart protocol.
      const boundary = 'viewer-' + randomUUID(),
        encode = new TextEncoder();
      const settings = JSON.stringify({
        model: provider.model,
        audioEncoding: 'WAV',
        mode: 'PUSH_TO_TALK',
        ...(language === 'auto' ? {} : { languageBias: metaLanguageBias(language) }),
      });
      const prefix = encode.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="request"\r\nContent-Type: application/json\r\n\r\n${settings}\r\n--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="recording.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
      );
      const suffix = encode.encode(`\r\n--${boundary}--\r\n`),
        multipart = new Uint8Array(prefix.length + wav.length + suffix.length);
      multipart.set(prefix);
      multipart.set(wav, prefix.length);
      multipart.set(suffix, prefix.length + wav.length);
      headers['Content-Type'] = 'multipart/form-data; boundary=' + boundary;
      body = multipart;
    } else {
      const form = new FormData();
      form.append('file', new Blob([wav], { type: 'audio/wav' }), 'recording.wav');
      form.append('model', provider.model);
      form.append('response_format', 'json');
      if (language !== 'auto') form.append('language', language);
      body = form;
    }
    const response = await requestProvider(this.request, url.href, {
      method: 'POST',
      headers,
      body,
      signal,
      redirect: 'error',
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      const recovery =
        response.status === 401 || response.status === 403
          ? 'Check its API key and account access.'
          : response.status === 429
            ? 'Wait and retry; the provider rate or account limit was reached.'
            : response.status === 400 || response.status === 404
              ? 'Check the model, endpoint and language.'
              : 'Try again when the provider is available.';
      throw new Error(`Speech provider returned HTTP ${response.status}. ${recovery}`);
    }
    const raw = await providerResponseJSON(response, signal, 262144);
    outer.throwIfAborted();
    let text: string,
      detected = language === 'auto' ? 'und' : language;
    try {
      if (provider.kind === 'meta') text = metaResponse.parse(raw).transcript;
      else if (provider.kind === 'deepgram') {
        const channel = deepgramResponse.parse(raw).results.channels[0]!;
        text = channel.alternatives[0]!.transcript;
        detected = channel.detected_language ?? detected;
      } else text = openaiResponse.parse(raw).text;
    } catch {
      throw new Error(
        'The speech provider returned an incompatible transcript. Check its protocol and model.',
      );
    }
    signal.throwIfAborted();
    return {
      text: text.trim(),
      language: detected,
      model: provider.model,
      seconds: pcm.byteLength / (speechSampleRate * 2),
      milliseconds: Date.now() - started,
    };
  }
}
