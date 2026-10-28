import { PCMEncoder } from '../../domain/speech/pcm';
import { speechSampleRate, speechMaximumSeconds } from '../../domain/speech/audio-format';

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class CaptureProcessor extends AudioWorkletProcessor {
  private encoder = new PCMEncoder(sampleRate);
  private samples: number[] = [];
  private ended = false;
  private total = 0;
  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === 'finish') {
        this.ended = true;
        this.flush();
        this.port.postMessage('finished');
      }
    };
  }
  private flush() {
    if (!this.samples.length) return;
    // Write the wire format explicitly; it must not depend on the host's byte order.
    const bytes = new Uint8Array(this.samples.length * 2),
      view = new DataView(bytes.buffer);
    this.samples.forEach((value, i) => view.setInt16(i * 2, value, true));
    this.samples = [];
    this.port.postMessage(bytes, [bytes.buffer]);
  }
  process(inputs: Float32Array[][]): boolean {
    if (!this.ended) {
      const input = inputs[0]?.[0];
      if (input) {
        for (const value of this.encoder.encode(input)) {
          if (this.total >= speechSampleRate * speechMaximumSeconds) break;
          this.samples.push(value);
          this.total++;
        }
        if (this.samples.length >= 3200) this.flush();
        if (this.total >= speechSampleRate * speechMaximumSeconds) {
          this.ended = true;
          this.flush();
        }
      }
    }
    return true;
  }
}
registerProcessor('viewer-speech-capture', CaptureProcessor);
