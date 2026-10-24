import { describe, expect, it, vi } from 'vitest';
import { WindowCreationRequests } from '../src/desktop/windows/creation-requests';

describe('native workspace creation', () => {
  it('joins requests for one workspace while allowing independent windows', async () => {
    const requests = new WindowCreationRequests<object>();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const window = {};
    const create = vi.fn(async () => {
      await gate;
      return window;
    });
    const first = requests.create('workspace-a', create);
    const duplicate = requests.create('workspace-a', create);
    expect(first).toBe(duplicate);
    const other = {};
    await expect(requests.create('workspace-b', async () => other)).resolves.toBe(other);
    expect(create).toHaveBeenCalledOnce();
    release();
    await expect(first).resolves.toBe(window);
  });

  it('allows a failed creation to be retried', async () => {
    const requests = new WindowCreationRequests<object>();
    await expect(
      requests.create('workspace', async () => {
        throw new Error('Window unavailable');
      }),
    ).rejects.toThrow('Window unavailable');
    const window = {};
    await expect(requests.create('workspace', async () => window)).resolves.toBe(window);
  });
});
