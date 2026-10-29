/**
 * A window remembers when each listed job became undoable, to pick the most recent Undo. It
 * lists the last 100 jobs; the times of older ones were kept for the whole session.
 */
import { beforeEach, expect, it, vi } from 'vitest';
import type { OperationJob } from '../src/domain/contracts';
import { initialize } from '../src/renderer/state/store';
import { receiveJob, undoableTime } from '../src/renderer/state/jobs';

beforeEach(() => {
  vi.stubGlobal('window', { dispatchEvent: vi.fn(), viewer: { save: vi.fn(async () => {}) } });
  initialize({ home: '/fixtures', platform: 'darwin', locations: [], state: null, openPaths: [] });
});

it('forgets the undo time of a job that left the list', () => {
  const job = (index: number) =>
    ({ id: `job-${index}`, status: 'completed', revision: 1, undoable: true }) as OperationJob;
  for (let index = 0; index < 150; index++) receiveJob(job(index));
  expect(undoableTime('job-149')).toBeGreaterThan(0);
  expect(undoableTime('job-50')).toBeGreaterThan(0);
  expect(undoableTime('job-49')).toBe(0);
  expect(undoableTime('job-0')).toBe(0);
});
