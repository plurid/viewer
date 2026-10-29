/**
 * Counters for the responsiveness harness (`tests/native/responsiveness.ts`). Off unless
 * VIEWER_PERF=1; then IPC requests and events, startup marks and main-thread delay are
 * written to stdout as `VIEWER_PERF {json}` lines, four times a second.
 */
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

/** Startup in order: Electron ready, first window, its page loaded, then the first bootstrap. */
export type StartupMark =
  | 'main:ready'
  | 'main:window'
  | 'main:loaded'
  | 'bootstrap:start'
  | 'bootstrap:state'
  | 'bootstrap:settings'
  | 'bootstrap:services'
  | 'bootstrap:done';

export interface TrafficCounter {
  calls: number;
  bytes: number;
  /** Time the main process spent answering; requests only. */
  milliseconds: number;
}

export interface PerformanceReport {
  /** Epoch milliseconds, comparable with a renderer's `performance.timeOrigin + now()`. */
  time: number;
  marks: Partial<Record<StartupMark, number>>;
  requests: Record<string, TrafficCounter>;
  events: Record<string, TrafficCounter>;
  /** Main-thread delay since the previous report, in milliseconds. */
  delay: { p50: number; p99: number; max: number };
}

export const performanceReportPrefix = 'VIEWER_PERF ';
const reportInterval = 250;

type DelayHistogram = ReturnType<typeof monitorEventLoopDelay>;

const epochMilliseconds = () => performance.timeOrigin + performance.now();

/** JSON size approximates the structured-clone payload; this only runs in the harness. */
function payloadBytes(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

function count(
  counters: Map<string, TrafficCounter>,
  key: string,
  bytes: number,
  milliseconds = 0,
): void {
  const counter = counters.get(key) ?? { calls: 0, bytes: 0, milliseconds: 0 };
  counter.calls++;
  counter.bytes += bytes;
  counter.milliseconds += milliseconds;
  counters.set(key, counter);
}

export class PerformanceMeter {
  readonly enabled: boolean;
  private readonly marks: PerformanceReport['marks'] = {};
  private readonly requests = new Map<string, TrafficCounter>();
  private readonly events = new Map<string, TrafficCounter>();
  private delay?: DelayHistogram;
  private timer?: NodeJS.Timeout;

  constructor(
    environment: NodeJS.ProcessEnv = process.env,
    private readonly write: (line: string) => void = (line) => process.stdout.write(line),
  ) {
    this.enabled = environment.VIEWER_PERF === '1';
  }

  /** Starts the delay histogram and the periodic report. */
  start(): void {
    if (!this.enabled || this.timer) return;
    this.delay = monitorEventLoopDelay({ resolution: 10 });
    this.delay.enable();
    this.timer = setInterval(() => this.flush(), reportInterval);
    this.timer.unref();
  }

  mark(name: StartupMark): void {
    if (this.enabled && this.marks[name] === undefined) this.marks[name] = epochMilliseconds();
  }

  /** Runs one IPC request, counting its payloads and the time the main process took. */
  async measure<T>(method: string, args: unknown, work: () => Promise<T>): Promise<T> {
    if (!this.enabled) return work();
    const started = epochMilliseconds();
    const result = await work();
    count(
      this.requests,
      method,
      payloadBytes(args) + payloadBytes(result),
      epochMilliseconds() - started,
    );
    return result;
  }

  event(type: string, event: unknown): void {
    if (this.enabled) count(this.events, type, payloadBytes(event));
  }

  report(): PerformanceReport {
    const milliseconds = (nanoseconds: number) => Math.round(nanoseconds / 1e4) / 100;
    const delay = this.delay;
    return {
      time: epochMilliseconds(),
      marks: { ...this.marks },
      requests: Object.fromEntries(this.requests),
      events: Object.fromEntries(this.events),
      delay: {
        p50: delay ? milliseconds(delay.percentile(50)) : 0,
        p99: delay ? milliseconds(delay.percentile(99)) : 0,
        max: delay ? milliseconds(delay.max) : 0,
      },
    };
  }

  private flush(): void {
    this.write(performanceReportPrefix + JSON.stringify(this.report()) + '\n');
    this.delay?.reset();
  }
}

export const performanceMeter = new PerformanceMeter();
