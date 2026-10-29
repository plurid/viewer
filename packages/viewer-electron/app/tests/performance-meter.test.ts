/**
 * The responsiveness meter costs nothing unless VIEWER_PERF=1, and then counts each IPC request
 * and event with its payload and reports as prefixed JSON lines.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import {
  PerformanceMeter,
  performanceReportPrefix,
  type PerformanceReport,
} from '../src/desktop/diagnostics/performance';

afterEach(() => {
  vi.useRealTimers();
});

describe('the performance meter', () => {
  it('only runs the work while off', async () => {
    const write = vi.fn();
    const meter = new PerformanceMeter({}, write);
    meter.start();
    meter.mark('main:ready');
    meter.event('job', { type: 'job' });
    expect(await meter.measure('list', ['/x'], async () => 'listed')).toBe('listed');
    expect(meter.enabled).toBe(false);
    expect(meter.report()).toMatchObject({ marks: {}, requests: {}, events: {} });
    expect(write).not.toHaveBeenCalled();
  });

  it('counts requests, events and the first of each mark', async () => {
    const meter = new PerformanceMeter({ VIEWER_PERF: '1' }, () => {});
    await meter.measure('list', ['/x'], async () => ['a', 'b']);
    await meter.measure('list', ['/y'], async () => []);
    meter.event('job', { type: 'job', id: 1 });
    meter.mark('main:ready');
    const first = meter.report().marks['main:ready'];
    meter.mark('main:ready');
    const report = meter.report();
    expect(report.requests.list).toMatchObject({ calls: 2 });
    expect(report.requests.list!.bytes).toBe(
      JSON.stringify(['/x']).length +
        JSON.stringify(['a', 'b']).length +
        JSON.stringify(['/y']).length +
        JSON.stringify([]).length,
    );
    expect(report.events.job).toMatchObject({ calls: 1 });
    expect(report.marks['main:ready']).toBe(first);
  });

  it('reports as prefixed JSON on its interval', () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    const meter = new PerformanceMeter({ VIEWER_PERF: '1' }, (line) => lines.push(line));
    meter.start();
    meter.event('open', { type: 'open' });
    vi.advanceTimersByTime(260);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.startsWith(performanceReportPrefix)).toBe(true);
    const report = JSON.parse(lines[0]!.slice(performanceReportPrefix.length)) as PerformanceReport;
    expect(report.events.open!.calls).toBe(1);
    expect(report.delay).toEqual(expect.objectContaining({ max: expect.any(Number) }));
  });
});

describe('sending a desktop event', () => {
  it('reaches a live window and skips a closed one', async () => {
    vi.resetModules();
    const { sendEvent } = await import('../src/desktop/ipc/events');
    const contents = (destroyed: boolean) =>
      ({ isDestroyed: () => destroyed, send: vi.fn() }) as unknown as WebContents & {
        send: ReturnType<typeof vi.fn>;
      };
    const live = contents(false);
    const closed = contents(true);
    sendEvent(live, { type: 'open', paths: ['/x'] });
    sendEvent(closed, { type: 'open', paths: ['/x'] });
    expect(live.send).toHaveBeenCalledWith('viewer:event', { type: 'open', paths: ['/x'] });
    expect(closed.send).not.toHaveBeenCalled();
  });
});
