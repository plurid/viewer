import { afterEach, expect, it, vi } from 'vitest';
import { fetchBytes } from '../tools/processors';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Answers each request with the next outcome: a status, or an error thrown as a dropped link. */
function server(...outcomes: (number | Error)[]) {
  const fetch = vi.fn(async () => {
    const outcome = outcomes.shift()!;
    if (outcome instanceof Error) throw outcome;
    return new Response(outcome === 200 ? 'source' : null, { status: outcome });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
async function settled<T>(work: Promise<T>) {
  const outcome = work.then(
    (value) => ({ value }),
    (error: Error) => ({ error }),
  );
  await vi.runAllTimersAsync();
  return outcome;
}

it('tries a dropped connection and a server error again, and keeps the third answer', async () => {
  vi.useFakeTimers();
  const fetch = server(new TypeError('fetch failed'), 503, 200);
  const result = await settled(fetchBytes('https://example.org/source.tar.gz'));
  expect(result).toEqual({ value: Buffer.from('source') });
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('stops at once on a missing file, and after three failures', async () => {
  vi.useFakeTimers();
  const missing = server(404);
  expect(await settled(fetchBytes('https://example.org/missing'))).toEqual({
    error: new Error('Processor download failed (404): https://example.org/missing'),
  });
  expect(missing).toHaveBeenCalledTimes(1);
  const down = server(new TypeError('fetch failed'), 502, new TypeError('fetch failed'), 200);
  expect(await settled(fetchBytes('https://example.org/down'))).toEqual({
    error: new TypeError('fetch failed'),
  });
  expect(down).toHaveBeenCalledTimes(3);
});
