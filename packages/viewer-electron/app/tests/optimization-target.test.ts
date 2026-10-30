import { expect, it, vi } from 'vitest';
import {
  optimizationAttemptLimit,
  optimizationTargetSchema,
} from '../src/domain/operations/optimization-target';
import { encodeToTarget } from '../src/desktop/transforms/target-size';
import { optimizationPlan, formatOptimizationSize } from '../src/domain/operations/optimization';
import { validateTransform } from '../src/domain/operations/transforms';
import { formatBytes } from '../src/domain/files/entries';

it('keeps the highest tested quality within a requested size and bounds work', async () => {
  const encode = vi.fn(async (quality: number) => Buffer.alloc(quality * 100));
  const value = await encodeToTarget(
    { bytes: 5000, minimumQuality: 30 },
    95,
    encode,
    new AbortController().signal,
  );
  expect(value.data.length).toBeLessThanOrEqual(5000);
  expect(value.outcome.quality).toBeGreaterThanOrEqual(49);
  expect(value.outcome.met).toBe(true);
  expect(encode.mock.calls.length).toBeLessThanOrEqual(optimizationAttemptLimit);
  expect(encode.mock.calls.every(([quality]) => quality >= 30 && quality <= 95)).toBe(true);
});

it('finishes after one encode when the starting quality fits', async () => {
  const encode = vi.fn(async () => Buffer.alloc(2048));
  const value = await encodeToTarget(
    { bytes: 4000, minimumQuality: 60 },
    95,
    encode,
    new AbortController().signal,
  );
  expect(value.outcome).toEqual({ bytes: 4000, met: true, quality: 95, attempts: 1 });
  expect(encode).toHaveBeenCalledTimes(1);
});

it('reports an unmet target and keeps the smallest measured candidate even for nonmonotonic sizes', async () => {
  const value = await encodeToTarget(
    { bytes: 1024, minimumQuality: 60 },
    95,
    async (quality) => Buffer.alloc(quality === 95 ? 1500 : 2000),
    new AbortController().signal,
  );
  expect(value.data.length).toBe(1500);
  expect(value.outcome).toEqual({ bytes: 1024, met: false, quality: 95, attempts: 2 });
});

it('does not accept a candidate or continue encoding after cancellation', async () => {
  const abort = new AbortController();
  const encode = vi.fn(async () => {
    abort.abort(new Error('Cancelled by reader'));
    return Buffer.alloc(2048);
  });
  await expect(
    encodeToTarget({ bytes: 1024, minimumQuality: 60 }, 95, encode, abort.signal),
  ).rejects.toThrow('Cancelled by reader');
  expect(encode).toHaveBeenCalledTimes(1);
});

it('validates target budgets centrally for images and PDFs', () => {
  for (const extension of ['pdf', 'jpg', 'png', 'webp', 'avif']) {
    const plan = optimizationPlan(
      { kind: 'file', extension },
      {
        preset: 'balanced',
        targetSize: {
          bytes: 500_000,
          minimumQuality: 60,
        },
      },
    );
    expect(validateTransform(plan, 1)).toMatchObject({
      quality: 95,
      targetSize: { bytes: 500_000, minimumQuality: 60 },
    });
  }
  expect(optimizationTargetSchema.safeParse({ bytes: 1 }).success).toBe(false);
  expect(optimizationTargetSchema.safeParse({ bytes: 5000, minimumQuality: 10 }).success).toBe(
    false,
  );
  expect(() =>
    validateTransform(
      { kind: 'image', format: 'jpeg', quality: 50, targetSize: { bytes: 5000 } },
      1,
    ),
  ).toThrow('Minimum quality');
});

it('uses the same decimal byte units for thresholds and candidate measurements', () => {
  expect(formatOptimizationSize(300_000)).toBe('300 KB');
  expect(formatOptimizationSize(300_001)).toBe(
    (300.001).toLocaleString(undefined, { maximumFractionDigits: 3 }) + ' KB',
  );
  expect(formatOptimizationSize(299_999)).toBe(
    (299.999).toLocaleString(undefined, { maximumFractionDigits: 3 }) + ' KB',
  );
  expect(formatOptimizationSize(2_000_001)).toBe(
    (2.000001).toLocaleString(undefined, { maximumFractionDigits: 6 }) + ' MB',
  );
});

it('shows every size in decimal units, as Finder does', () => {
  const decimal = (value: number, unit: string) =>
    value.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' ' + unit;
  expect(formatBytes(0)).toBe('0 B');
  expect(formatBytes(999)).toBe('999 B');
  expect(formatBytes(1000)).toBe('1 KB');
  expect(formatBytes(1024)).toBe(decimal(1, 'KB'));
  expect(formatBytes(1500)).toBe(decimal(1.5, 'KB'));
  expect(formatBytes(1_000_000)).toBe('1 MB');
  expect(formatBytes(4_400_000_000)).toBe(decimal(4.4, 'GB'));
  // rounding up to the next unit names that unit
  expect(formatBytes(999_960)).toBe('1 MB');
  expect(formatBytes(999_940)).toBe(decimal(999.9, 'KB'));
  expect(formatBytes(2 * 1000 ** 4)).toBe('2 TB');
  expect(formatBytes(3_000_000, 'exact')).toBe('3 MB');
});
