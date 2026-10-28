// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { captureAudio } from '../src/renderer/speech/capture';

vi.mock('../src/renderer/speech/capture.worklet?worker&url', () => ({
  default: '/generated-worklet.js',
}));
const track = { stop: vi.fn(), onended: null as (() => void) | null };
const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
const media = vi.fn(async () => stream);
const close = vi.fn(async () => {}),
  disconnect = vi.fn(),
  module = vi.fn(async () => {});
let port: {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage: (value: unknown) => void;
  close: () => void;
};
beforeEach(() => {
  track.stop.mockClear();
  track.onended = null;
  media.mockReset().mockResolvedValue(stream);
  close.mockClear();
  disconnect.mockClear();
  module.mockReset().mockResolvedValue();
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: media },
    configurable: true,
  });
  vi.stubGlobal(
    'AudioContext',
    class {
      audioWorklet = { addModule: module };
      destination = {};
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect };
      }
      resume = async () => {};
      close = close;
    },
  );
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      port = (port = {
        onmessage: null,
        postMessage: () => {
          queueMicrotask(() => port.onmessage?.({ data: 'finished' }));
        },
        close: vi.fn(),
      });
      connect = vi.fn();
      disconnect = disconnect;
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
function options() {
  return {
    microphone: '',
    signal: new AbortController().signal,
    progress: vi.fn(),
    failed: vi.fn(),
    limit: vi.fn(),
  };
}
it('stops a stream arriving after cancellation, without creating audio nodes', async () => {
  let ready!: (value: typeof stream) => void;
  media.mockImplementation(
    () =>
      new Promise((resolve) => {
        ready = resolve;
      }),
  );
  const controller = new AbortController();
  const result = captureAudio({ ...options(), signal: controller.signal }).catch(
    (error: Error) => error,
  );
  controller.abort();
  ready(stream);
  expect(await result).toBeInstanceOf(Error);
  expect(track.stop).toHaveBeenCalledOnce();
  expect(module).not.toHaveBeenCalled();
});
it('releases tracks even when AudioContext construction fails', async () => {
  vi.stubGlobal(
    'AudioContext',
    class {
      constructor() {
        throw new Error('Device unavailable');
      }
    },
  );
  await expect(captureAudio(options())).rejects.toThrow('Device unavailable');
  expect(track.stop).toHaveBeenCalledOnce();
});
it('releases tracks and context when the worklet cannot load', async () => {
  module.mockRejectedValueOnce(new Error('Worklet unavailable'));
  await expect(captureAudio(options())).rejects.toThrow('Worklet unavailable');
  expect(track.stop).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});
it('finishes bounded in-memory PCM and releases nodes before returning audio', async () => {
  const config = options(),
    recorder = await captureAudio({ ...config, microphone: 'selected-device' });
  expect(media).toHaveBeenCalledWith(
    expect.objectContaining({
      audio: expect.objectContaining({ deviceId: { exact: 'selected-device' } }),
      video: false,
    }),
  );
  port.onmessage?.({ data: new Uint8Array(6400).fill(12) });
  const result = await recorder.finish();
  expect(result.length).toBe(6400);
  expect(config.progress).toHaveBeenCalledWith(0.2, expect.any(Number));
  expect(track.stop).toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
  expect(disconnect).toHaveBeenCalled();
});
it('stops immediately when a device disconnects or the owning session is cancelled', async () => {
  const config = options();
  await captureAudio(config);
  track.onended?.();
  expect(config.failed).toHaveBeenCalledWith(expect.stringContaining('disconnected'));
  expect(close).toHaveBeenCalledOnce();
  const controller = new AbortController();
  await captureAudio({ ...options(), signal: controller.signal });
  controller.abort();
  expect(close).toHaveBeenCalledTimes(2);
});
it('caps worklet output even while the UI thread does not consume messages', async () => {
  const messages: unknown[] = [];
  interface Processor {
    process(inputs: Float32Array[][]): boolean;
    port: { onmessage: (event: { data: unknown }) => void };
  }
  let ProcessorClass!: new () => Processor;
  vi.stubGlobal('sampleRate', 16000);
  vi.stubGlobal(
    'AudioWorkletProcessor',
    class {
      port = { onmessage: null, postMessage: (value: unknown) => messages.push(value) };
    },
  );
  vi.stubGlobal('registerProcessor', (_name: string, processor: new () => Processor) => {
    ProcessorClass = processor;
  });
  await import('../src/renderer/speech/capture.worklet');
  const processor = new ProcessorClass(),
    input = new Float32Array(128).fill(0.1);
  for (let i = 0; i < 8000; i++) processor.process([[input]]);
  expect(
    messages
      .filter((value): value is Uint8Array => value instanceof Uint8Array)
      .reduce((total, chunk) => total + chunk.length, 0),
  ).toBe(1920000);
  const count = messages.length;
  processor.process([[input]]);
  expect(messages.length).toBe(count);
  processor.port.onmessage({ data: 'finish' });
  expect(messages.at(-1)).toBe('finished');
});
