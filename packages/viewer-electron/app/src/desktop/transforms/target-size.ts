import { optimizationAttemptLimit } from '../../domain/operations/optimization-target';
import type {
  OptimizationOutcome,
  OptimizationTarget,
} from '../../domain/operations/optimization-target';

interface Candidate {
  data: Buffer;
  quality: number;
}

/** Bound encoding work and retain only the smallest and best fitting candidates.
 * Codec sizes need not be perfectly monotonic: report the best measured result. */
export async function encodeToTarget(
  target: OptimizationTarget,
  maximumQuality: number,
  encode: (quality: number, attempt: number, signal: AbortSignal) => Promise<Buffer>,
  signal: AbortSignal,
): Promise<{ data: Buffer; outcome: OptimizationOutcome }> {
  signal = AbortSignal.any([signal, AbortSignal.timeout(180_000)]);
  let attempts = 0;
  let smallest: Candidate | undefined;
  let fitting: Candidate | undefined;
  const probe = async (quality: number) => {
    signal.throwIfAborted();
    const data = await encode(quality, ++attempts, signal);
    if (!data.length) throw new Error('The processor returned an empty candidate.');
    signal.throwIfAborted();
    const candidate = { data, quality };
    if (!smallest || data.length < smallest.data.length) smallest = candidate;
    const fits = data.length <= target.bytes;
    if (fits && (!fitting || quality > fitting.quality)) fitting = candidate;
    return fits;
  };
  const maximum = Math.max(target.minimumQuality, Math.min(100, maximumQuality));
  if (!(await probe(maximum)) && maximum > target.minimumQuality) {
    let low = target.minimumQuality;
    let high = maximum;
    if (await probe(low))
      while (high - low > 1 && attempts < optimizationAttemptLimit) {
        const quality = Math.floor((low + high) / 2);
        if (await probe(quality)) low = quality;
        else high = quality;
      }
  }
  const selected = fitting ?? smallest!;
  return {
    data: selected.data,
    outcome: {
      bytes: target.bytes,
      met: selected.data.length <= target.bytes,
      quality: selected.quality,
      attempts,
    },
  };
}
