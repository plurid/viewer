/**
 * Index status reaches windows at most a few times a second, and at once when indexing starts
 * or finishes, which is what they show.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { IndexStatus } from '../src/domain/services';
import { coalescedIndexStatus } from '../src/desktop/files/file-services';

afterEach(() => {
  vi.useRealTimers();
});

const status = (count: number, running: boolean): IndexStatus => ({ roots: [], count, running });

it('sends a start and a finish at once, and the latest progress between them', () => {
  vi.useFakeTimers();
  const sent: IndexStatus[] = [];
  const emit = coalescedIndexStatus((value) => sent.push(value), 250);
  emit(status(0, true));
  for (let count = 1; count <= 100; count++) emit(status(count, true));
  expect(sent.map((value) => value.count)).toEqual([0]);
  vi.advanceTimersByTime(250);
  expect(sent.map((value) => value.count)).toEqual([0, 100]);
  emit(status(101, true));
  emit(status(102, false));
  vi.advanceTimersByTime(1000);
  expect(sent.map((value) => [value.count, value.running])).toEqual([
    [0, true],
    [100, true],
    [102, false],
  ]);
});
