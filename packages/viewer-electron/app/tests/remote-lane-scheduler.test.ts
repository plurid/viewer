import { describe, expect, it } from 'vitest';
import { LaneScheduler } from '../src/desktop/remote/lane-scheduler';
import { remoteLimits } from '../src/domain/remote/limits';

interface Gate {
  open(): void;
  promise: Promise<void>;
}

function gate(): Gate {
  let open = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, promise };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('lane scheduler', () => {
  it('runs foreground work ahead of queued thumbnails, in arrival order', async () => {
    const lane = new LaneScheduler({ concurrency: 1 });
    const started: string[] = [];
    const first = gate();
    const signal = new AbortController().signal;
    const job = (name: string, wait?: Gate) => async () => {
      started.push(name);
      await wait?.promise;
    };
    const running = [lane.run(signal, false, job('busy', first))];
    running.push(lane.run(signal, true, job('thumbnail 1')));
    running.push(lane.run(signal, false, job('listing 1')));
    running.push(lane.run(signal, true, job('thumbnail 2')));
    running.push(lane.run(signal, false, job('listing 2')));
    first.open();
    await Promise.all(running);
    expect(started).toEqual(['busy', 'listing 1', 'listing 2', 'thumbnail 1', 'thumbnail 2']);
  });

  it('runs at most two thumbnails at once and keeps the rest of the lane for other work', async () => {
    const lane = new LaneScheduler({ concurrency: 4 });
    const signal = new AbortController().signal;
    const gates = Array.from({ length: 5 }, gate);
    const thumbnails = gates.map((item) => lane.run(signal, true, () => item.promise));
    await flush();
    expect(lane.running).toEqual({
      active: remoteLimits.thumbnailsPerConnection,
      thumbnails: remoteLimits.thumbnailsPerConnection,
      queued: 3,
    });
    const listing = gate();
    const foreground = lane.run(signal, false, () => listing.promise);
    await flush();
    expect(lane.running.active).toBe(3);
    listing.open();
    await foreground;
    for (const item of gates) {
      item.open();
    }
    await Promise.all(thumbnails);
    expect(lane.running).toEqual({ active: 0, thumbnails: 0, queued: 0 });
  });

  it('never runs more than its concurrency', async () => {
    const lane = new LaneScheduler({ concurrency: 3 });
    const signal = new AbortController().signal;
    const gates = Array.from({ length: 6 }, gate);
    const work = gates.map((item) => lane.run(signal, false, () => item.promise));
    await flush();
    expect(lane.running).toMatchObject({ active: 3, queued: 3 });
    for (const item of gates) {
      item.open();
    }
    await Promise.all(work);
  });

  it('drops a request canceled while it waited, without running it', async () => {
    const lane = new LaneScheduler({ concurrency: 1 });
    const busy = gate();
    const running = lane.run(new AbortController().signal, false, () => busy.promise);
    const controller = new AbortController();
    let ran = false;
    const waiting = lane.run(controller.signal, false, async () => {
      ran = true;
    });
    controller.abort();
    busy.open();
    await running;
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    expect(ran).toBe(false);
  });
});
