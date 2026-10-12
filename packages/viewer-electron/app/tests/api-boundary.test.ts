import { describe, expect, it, vi } from 'vitest';
import { restoreApiErrors } from '../src/renderer/api-boundary';

describe('native API error boundary', () => {
  it('restores cloned permission envelopes as renderer Errors with their message and code', async () => {
    const api = restoreApiErrors({
      read: async () =>
        Promise.reject({ message: 'Allow folder access.', code: 'FILE_ACCESS_REQUIRED' }),
      list: async () => Promise.reject({ message: 'Permission denied.', code: 'EACCES' }),
    });
    await expect(api.read()).rejects.toBeInstanceOf(Error);
    await expect(api.read()).rejects.toMatchObject({
      message: 'Allow folder access.',
      code: 'FILE_ACCESS_REQUIRED',
    });
    await expect(api.list()).rejects.toMatchObject({ code: 'EACCES' });
  });
  it('preserves successful values, synchronous paths, callback arguments and event cleanup', async () => {
    const listener = vi.fn(),
      stop = vi.fn();
    const api = restoreApiErrors({
      bootstrap: async () => ({ home: '/chosen' }),
      droppedPath: (file: { name: string }) => '/chosen/' + file.name,
      subscribe: (callback: (value: string) => void) => {
        callback('changed');
        return stop;
      },
    });
    expect(await api.bootstrap()).toEqual({ home: '/chosen' });
    expect(api.droppedPath({ name: 'Document.pdf' })).toBe('/chosen/Document.pdf');
    const unsubscribe = api.subscribe(listener);
    expect(listener).toHaveBeenCalledExactlyOnceWith('changed');
    expect(unsubscribe).toBe(stop);
    unsubscribe();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(api)).toBe(true);
  });
});
