import worklet from './capture.worklet?worker&url';
import { readMicrophones } from './devices';
import { pcmEnergy, speechMaximumBytes, speechSampleRate } from '../../domain/speech/recognition';

export interface AudioCapture {
  finish(): Promise<Uint8Array>;
  cancel(): void;
}
interface CaptureOptions {
  microphone: string;
  signal: AbortSignal;
  progress(seconds: number, level: number): void;
  limit(): void;
  failed(message: string): void;
}
/** The capture owns every track and audio node, including a stream arriving after cancellation. */
export async function captureAudio(options: CaptureOptions): Promise<AudioCapture> {
  const { signal } = options;
  signal.throwIfAborted();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      ...(options.microphone ? { deviceId: { exact: options.microphone } } : {}),
    },
    video: false,
  });
  void readMicrophones().catch(() => {});
  if (signal.aborted) {
    stream.getTracks().forEach((track) => track.stop());
    signal.throwIfAborted();
  }
  let context: AudioContext;
  try {
    context = new AudioContext({ sampleRate: speechSampleRate });
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
  let source: MediaStreamAudioSourceNode | undefined, node: AudioWorkletNode | undefined;
  let chunks: Uint8Array[] = [],
    size = 0,
    closed = false,
    finishing = false;
  let flushed: (() => void) | undefined;
  const dispose = () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener('abort', cancel);
    stream.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    source?.disconnect();
    node?.disconnect();
    node?.port.close();
    void context.close().catch(() => {});
    flushed?.();
  };
  const cancel = () => {
    dispose();
    chunks = [];
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await context.audioWorklet.addModule(worklet);
    signal.throwIfAborted();
    source = context.createMediaStreamSource(stream);
    node = new AudioWorkletNode(context, 'viewer-speech-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
    });
    node.port.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === 'finished') {
        flushed?.();
        return;
      }
      if (closed || !(event.data instanceof Uint8Array)) return;
      const chunk = event.data.subarray(0, speechMaximumBytes - size);
      if (chunk.length) {
        chunks.push(chunk);
        size += chunk.length;
        options.progress(size / (speechSampleRate * 2), pcmEnergy(chunk));
      }
      if (size >= speechMaximumBytes && !finishing) {
        finishing = true;
        options.limit();
      }
    };
    source.connect(node);
    node.connect(context.destination);
    for (const track of stream.getAudioTracks())
      track.onended = () => {
        cancel();
        options.failed(
          'The microphone disconnected. Choose an available microphone and try again.',
        );
      };
    await context.resume();
    signal.throwIfAborted();
    return {
      cancel,
      async finish() {
        if (closed) throw new Error('The recording has ended.');
        finishing = true;
        stream.getTracks().forEach((track) => {
          track.onended = null;
          track.stop();
        });
        source?.disconnect();
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('The audio recorder did not finish. Try again.')),
            1500,
          );
          flushed = () => {
            clearTimeout(timeout);
            resolve();
          };
          node!.port.postMessage('finish');
        }).finally(dispose);
        signal.throwIfAborted();
        const output = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          output.set(chunk, offset);
          offset += chunk.length;
        }
        chunks = [];
        return output;
      },
    };
  } catch (error) {
    cancel();
    throw error;
  }
}
