import { afterEach, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import type * as ChildProcesses from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { runSharingRead } from '../src/desktop/files/network-sharing';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
afterEach(() => vi.useRealTimers());
it('kills an unresponsive tool after the SIGTERM grace and settles even if its callback never runs', async () => {
  vi.useFakeTimers();
  const kill = vi.fn();
  vi.mocked(execFile).mockImplementation(() => ({ kill }) as unknown as ChildProcess);
  const read = runSharingRead('shares');
  await vi.advanceTimersByTimeAsync(2250);
  expect(await read).toMatchObject({ ok: false, stdout: '' });
  expect(kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
});
it('bounds a real child that ignores SIGTERM without leaving it running', async () => {
  const actual = await vi.importActual<typeof ChildProcesses>('node:child_process');
  let child: ChildProcess | undefined;
  vi.mocked(execFile).mockImplementation((_file, _args, options, callback) => {
    child = actual.execFile(
      process.execPath,
      ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
      options,
      callback,
    );
    return child;
  });
  const started = performance.now();
  const watchdog = setTimeout(() => child?.kill('SIGKILL'), 3500);
  try {
    const result = await runSharingRead('shares');
    expect(result.ok).toBe(false);
    expect(performance.now() - started).toBeLessThan(3000);
    if (child?.signalCode === null) await new Promise((resolve) => child!.once('exit', resolve));
    expect(child?.signalCode).toBe('SIGKILL');
  } finally {
    clearTimeout(watchdog);
    if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});
