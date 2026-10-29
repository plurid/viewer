/**
 * A snapshot and its events, or two replies, can arrive in either order. An event that arrives
 * while a snapshot loads is applied on top of it; an older reply never replaces a newer one.
 */
import { describe, expect, it, vi } from 'vitest';
import { followSnapshot, latestReplies } from '../src/renderer/state/requests';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** A value held as React state holds it, with listeners standing in for desktop events. */
function harness(initial: string[]) {
  let value = initial;
  const listeners = new Set<(event: string) => void>();
  return {
    value: () => value,
    emit: (event: string) => listeners.forEach((listener) => listener(event)),
    subscribe: (listener: (event: string) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (update: (value: string[]) => string[]) => {
      value = update(value);
    },
  };
}

describe('following a snapshot', () => {
  it('applies an event that arrived during the load on top of the snapshot', async () => {
    const state = harness([]);
    const load = deferred<string[]>();
    followSnapshot({
      load: () => load.promise,
      subscribe: state.subscribe,
      apply: (items, event) => [...items, event],
      set: state.set,
      failed: () => {},
    });
    state.emit('newer');
    load.resolve(['older']);
    await load.promise;
    await Promise.resolve();
    expect(state.value()).toEqual(['older', 'newer']);
    state.emit('later');
    expect(state.value()).toEqual(['older', 'newer', 'later']);
  });

  it('keeps only the latest reload, and the shown value when a load fails', async () => {
    const state = harness(['shown']);
    const loads = [deferred<string[]>(), deferred<string[]>(), deferred<string[]>()];
    let next = 0;
    const failed = vi.fn();
    const following = followSnapshot({
      load: () => loads[next++]!.promise,
      subscribe: state.subscribe,
      apply: (items, event) => [...items, event],
      set: state.set,
      failed,
    });
    following.reload();
    loads[1]!.resolve(['second']);
    loads[0]!.resolve(['first']);
    await Promise.all([loads[0]!.promise, loads[1]!.promise]);
    await Promise.resolve();
    expect(state.value()).toEqual(['second']);
    following.reload();
    state.emit('during');
    loads[2]!.reject(new Error('offline'));
    await loads[2]!.promise.catch(() => {});
    await Promise.resolve();
    expect(state.value()).toEqual(['second', 'during']);
    expect(failed).toHaveBeenCalledOnce();
    following.stop();
    state.emit('after');
    expect(state.value()).toEqual(['second', 'during']);
  });
});

describe('latest replies', () => {
  it('ignores a reply overtaken by a newer request', async () => {
    const request = latestReplies();
    const applied: string[] = [];
    const slow = deferred<string>();
    const fast = deferred<string>();
    request(
      slow.promise,
      (value) => applied.push(value),
      () => {},
    );
    request(
      fast.promise,
      (value) => applied.push(value),
      () => {},
    );
    fast.resolve('newer');
    slow.resolve('older');
    await Promise.all([slow.promise, fast.promise]);
    await Promise.resolve();
    expect(applied).toEqual(['newer']);
  });
});
