// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { OperationJob } from '../src/domain/contracts';
import type { CommandContext } from '../src/renderer/commands/registry';
import type { WindowActions } from '../src/renderer/commands/window-commands/scope';
import { windowScopes } from '../src/renderer/commands/window-commands/scope';
import { historyCommands } from '../src/renderer/commands/window-commands/history';
import { getState, initialize, receiveJob, setOperationsOpen } from '../src/renderer/state/store';
import { useOperationsIndicator } from '../src/renderer/operations/useOperationsIndicator';

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(window, {
    viewer: { save: vi.fn(async () => {}), refresh: vi.fn(async () => {}) },
  });
  initialize({ home: '/fixtures', platform: 'darwin', locations: [], state: null, openPaths: [] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const job = (status: OperationJob['status'], revision = 1): OperationJob => ({
  id: 'indicator-job',
  revision,
  kind: 'mkdir',
  status,
  sources: [],
  completed: [],
  errors: [],
  itemsDone: status === 'completed' ? 1 : 0,
  itemsTotal: 1,
  bytesDone: 0,
  bytesTotal: 0,
  errorCount: status === 'failed' ? 1 : 0,
  undoable: false,
});

it('never flashes for a fast success and shows work still running after one second', () => {
  const { result } = renderHook(useOperationsIndicator);
  act(() => receiveJob(job('running')));
  act(() => vi.advanceTimersByTime(900));
  expect(result.current).toBe(false);
  act(() => receiveJob(job('completed', 2)));
  act(() => vi.advanceTimersByTime(200));
  expect(result.current).toBe(false);
  act(() => receiveJob(job('running', 3)));
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current).toBe(true);
});

it('shows failures and conflicts immediately and stays visible while history is open', () => {
  const { result } = renderHook(useOperationsIndicator);
  act(() => receiveJob(job('failed')));
  expect(result.current).toBe(true);
  act(() => setOperationsOpen(true, true));
  expect(result.current).toBe(true);
  act(() => setOperationsOpen(false));
  expect(result.current).toBe(false);
  act(() => receiveJob(job('collision', 2)));
  expect(result.current).toBe(true);
});

it('opens and closes file operation history from commands even with no jobs', async () => {
  const command = historyCommands(windowScopes({} as WindowActions)).find(
    (command) => command.id === 'recent-operations',
  )!;
  const context: CommandContext = {
    scope: 'window',
    workspaceID: 'workspace',
    jobs: [],
    selection: [],
    clipboard: null,
  };
  expect(command.when(context)).toBe(true);
  await command.run(context);
  expect(getState()).toMatchObject({ operationsOpen: true, operationsHistory: true });
  await command.run(context);
  expect(getState().operationsOpen).toBe(false);
});
