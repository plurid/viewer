import { afterEach, describe, expect, it, vi } from 'vitest';
import { FLUSH_TIMEOUT_MS, WindowFlushRequests } from '../src/desktop/windows/flush-requests';

afterEach(() => vi.useRealTimers());

describe('native save acknowledgement', () => {
  it('requires the owning window, coalesces repeated requests, and propagates save failure', async () => {
    const requests = new WindowFlushRequests();
    let token = '';
    const first = requests.request(1, 'flush', (value) => {
      token = value;
    });
    const repeated = requests.request(1, 'flush', () => {
      throw new Error('Duplicate send');
    });
    expect(repeated).toBe(first);
    requests.acknowledge(token, 2, { ok: true });
    let saved = false;
    void first.then(
      () => {
        saved = true;
      },
      () => {},
    );
    await Promise.resolve();
    expect(saved).toBe(false);
    requests.acknowledge(token, 1, { ok: false, error: 'Disk full', code: 'ENOSPC' });
    await expect(first).rejects.toMatchObject({ code: 'ENOSPC', message: 'Disk full' });
  });

  it('rejects an expired request and accepts a fresh retry', async () => {
    vi.useFakeTimers();
    const requests = new WindowFlushRequests();
    const first = requests.request(1, 'flush', () => {});
    const rejected = expect(first).rejects.toMatchObject({ code: 'PERSISTENCE_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(FLUSH_TIMEOUT_MS);
    await rejected;
    const second = requests.request(1, 'flush', (token) => {
      requests.acknowledge(token, 1, { ok: true });
    });
    await expect(second).resolves.toBeUndefined();
  });

  it('rejects disconnected owners without ending another window’s save', async () => {
    const requests = new WindowFlushRequests();
    let secondToken = '';
    const first = requests.request(1, 'flush-settings', () => {});
    const second = requests.request(2, 'flush', (token) => {
      secondToken = token;
    });
    requests.disconnected(1);
    await expect(first).rejects.toMatchObject({ code: 'PERSISTENCE_WINDOW_CLOSED' });
    requests.acknowledge(secondToken, 2, { ok: true });
    await second;
  });
});
