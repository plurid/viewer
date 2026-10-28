import { speechSampleRate } from './audio-format';

/** Streaming area resampling preserves timing when hardware ignores the requested sample rate. */
export class PCMEncoder {
  private weight = 0;
  private sum = 0;
  private ratio: number;
  constructor(rate: number) {
    if (!Number.isFinite(rate) || rate < speechSampleRate || rate > 192000)
      throw new Error('Unsupported microphone sample rate.');
    this.ratio = rate / speechSampleRate;
  }
  encode(samples: Float32Array): Int16Array {
    const output: number[] = [];
    for (const sample of samples) {
      let remaining = 1;
      const value = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
      while (remaining > 1e-8) {
        const part = Math.min(remaining, this.ratio - this.weight);
        this.sum += value * part;
        this.weight += part;
        remaining -= part;
        if (this.weight >= this.ratio - 1e-8) {
          const average = this.sum / this.ratio;
          output.push(Math.round(average * (average < 0 ? 32768 : 32767)));
          this.weight = 0;
          this.sum = 0;
        }
      }
    }
    return Int16Array.from(output);
  }
}
