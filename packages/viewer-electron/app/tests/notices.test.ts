// @vitest-environment jsdom
/** A NOTICE SAYS WHAT KIND IT IS (2026-10-23): information is not shown as a warning. */
import { beforeEach, expect, it, vi } from 'vitest';
import { announce, getState, initialize, report } from '../src/renderer/state/store';

beforeEach(() => {
  Object.assign(window, { viewer: { save: vi.fn(async () => {}) } });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
it('marks information as such, and a problem as one', () => {
  announce('Opened 7 folders as planes.');
  expect(getState()).toMatchObject({ notice: 'Opened 7 folders as planes.', noticeKind: 'info' });
  report(new Error('The folder is gone.'));
  expect(getState()).toMatchObject({ notice: 'The folder is gone.', noticeKind: 'error' });
});
it('reads a validation failure in words, not as its JSON', async () => {
  const { errorMessage } = await import('../src/domain/errors');
  const { z } = await import('zod');
  const result = z.object({ keymap: z.object({ leader: z.string() }) }).safeParse({ keymap: {} });
  expect(errorMessage(result.error)).toBe('keymap.leader: expected string, received undefined');
});
