/**
 * A crashed or hung window asks Reload or Close, and neither waits on its renderer: a hung one is
 * ended first, and its answer is carried out once it reports itself gone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RendererWatch,
  UNRESPONSIVE_GRACE_MS,
  type RendererWatchHost,
  type StoppedWindowChoice,
} from '../src/desktop/windows/window-health';

vi.mock('electron', () => ({ dialog: {} }));

afterEach(() => vi.useRealTimers());

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  let alive = true;
  const answers: ReturnType<typeof deferred<StoppedWindowChoice | undefined>>[] = [];
  const signals: AbortSignal[] = [];
  const host = {
    stopped: vi.fn(),
    resumed: vi.fn(),
    ask: vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      const answer = deferred<StoppedWindowChoice | undefined>();
      answers.push(answer);
      return answer.promise;
    }),
    alive: () => alive,
    crash: vi.fn(() => {
      alive = false;
    }),
    reload: vi.fn(() => {
      alive = true;
    }),
    close: vi.fn(),
    report: vi.fn(),
  } satisfies RendererWatchHost;
  const watch = new RendererWatch(host);
  /** The renderer process ends: on its own, or because the watch ended it. */
  const gone = () => {
    alive = false;
    watch.gone();
  };
  return { host, watch, answers, signals, gone };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('a crashed window', () => {
  it('stops its saves, asks once, and reloads the dead renderer without ending it again', async () => {
    const f = fixture();
    f.gone();
    expect(f.host.stopped).toHaveBeenCalledWith('gone');
    expect(f.watch.phase()).toBe('asking');
    f.gone();
    expect(f.host.ask).toHaveBeenCalledOnce();
    f.answers[0]!.resolve('reload');
    await settle();
    expect(f.host.crash).not.toHaveBeenCalled();
    expect(f.host.reload).toHaveBeenCalledOnce();
    expect(f.watch.phase()).toBe('reloading');
    f.watch.loaded();
    expect(f.host.resumed).toHaveBeenCalledOnce();
    expect(f.watch.phase()).toBe('running');
    // a later crash asks again
    f.gone();
    expect(f.host.ask).toHaveBeenCalledTimes(2);
  });

  it('closes at once when the person chooses Close', async () => {
    const f = fixture();
    f.gone();
    f.answers[0]!.resolve('close');
    await settle();
    expect(f.host.close).toHaveBeenCalledOnce();
    expect(f.host.reload).not.toHaveBeenCalled();
  });

  it('asks again when the reloaded page crashes before it loads', async () => {
    const f = fixture();
    f.gone();
    f.answers[0]!.resolve('reload');
    await settle();
    f.gone();
    expect(f.host.ask).toHaveBeenCalledTimes(2);
    expect(f.watch.phase()).toBe('asking');
  });
});

describe('a hung window', () => {
  it('waits out its grace and asks nothing when it answers again in time', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.watch.unresponsive();
    await vi.advanceTimersByTimeAsync(UNRESPONSIVE_GRACE_MS - 1);
    f.watch.responsive();
    await vi.advanceTimersByTimeAsync(UNRESPONSIVE_GRACE_MS);
    expect(f.host.stopped).not.toHaveBeenCalled();
    expect(f.host.ask).not.toHaveBeenCalled();
    expect(f.watch.phase()).toBe('running');
  });

  it('past its grace, is ended before Close, and closes only once its process is gone', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.watch.unresponsive();
    await vi.advanceTimersByTimeAsync(UNRESPONSIVE_GRACE_MS);
    expect(f.host.stopped).toHaveBeenCalledWith('unresponsive');
    f.answers[0]!.resolve('close');
    await vi.advanceTimersByTimeAsync(0);
    expect(f.host.crash).toHaveBeenCalledOnce();
    expect(f.host.close).not.toHaveBeenCalled();
    f.gone();
    expect(f.host.close).toHaveBeenCalledOnce();
    expect(f.host.ask).toHaveBeenCalledOnce();
  });

  it('reloads once its ended process reports itself gone', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.watch.unresponsive();
    await vi.advanceTimersByTimeAsync(UNRESPONSIVE_GRACE_MS);
    f.answers[0]!.resolve('reload');
    await vi.advanceTimersByTimeAsync(0);
    expect(f.host.reload).not.toHaveBeenCalled();
    f.gone();
    expect(f.host.reload).toHaveBeenCalledOnce();
    expect(f.host.ask).toHaveBeenCalledOnce();
  });

  it('withdraws the question when the renderer answers again', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.watch.unresponsive();
    await vi.advanceTimersByTimeAsync(UNRESPONSIVE_GRACE_MS);
    f.watch.responsive();
    expect(f.signals[0]!.aborted).toBe(true);
    expect(f.host.resumed).toHaveBeenCalledOnce();
    f.answers[0]!.resolve(undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.watch.phase()).toBe('running');
    expect(f.host.crash).not.toHaveBeenCalled();
  });

  it('counts a save it did not answer as hung past its grace', async () => {
    const f = fixture();
    expect(f.watch.timedOut()).toBe(true);
    expect(f.host.stopped).toHaveBeenCalledWith('unresponsive');
    expect(f.host.ask).toHaveBeenCalledOnce();
    expect(f.watch.timedOut()).toBe(true);
    expect(f.host.ask).toHaveBeenCalledOnce();
    // a reloading window is not stopped: its timed-out save is a failure of its own
    f.answers[0]!.resolve('reload');
    await settle();
    f.gone();
    expect(f.watch.phase()).toBe('reloading');
    expect(f.watch.timedOut()).toBe(false);
  });
});

describe('Quit and closing', () => {
  it('ends a hung renderer for Quit and carries out no answer afterwards', async () => {
    const f = fixture();
    f.watch.timedOut();
    f.watch.release();
    expect(f.signals[0]!.aborted).toBe(true);
    expect(f.host.crash).toHaveBeenCalledOnce();
    f.gone();
    f.answers[0]!.resolve('reload');
    await settle();
    expect(f.host.reload).not.toHaveBeenCalled();
    expect(f.host.close).not.toHaveBeenCalled();
    expect(f.watch.phase()).toBe('closing');
  });

  it('leaves a working renderer alone at Quit', () => {
    const f = fixture();
    f.watch.release();
    expect(f.host.crash).not.toHaveBeenCalled();
    expect(f.watch.phase()).toBe('running');
  });

  it('withdraws the question when the window closes, and ignores its renderer afterwards', async () => {
    const f = fixture();
    f.gone();
    f.watch.closed();
    expect(f.signals[0]!.aborted).toBe(true);
    f.answers[0]!.resolve('reload');
    await settle();
    f.gone();
    expect(f.host.reload).not.toHaveBeenCalled();
    expect(f.host.ask).toHaveBeenCalledOnce();
  });

  it('keeps a window whose question could not be shown as it is, and reports why', async () => {
    const f = fixture();
    f.host.ask.mockRejectedValueOnce(new Error('No dialog'));
    f.gone();
    await settle();
    expect(f.host.report).toHaveBeenCalledWith(expect.objectContaining({ message: 'No dialog' }));
    expect(f.watch.phase()).toBe('stopped');
  });
});
