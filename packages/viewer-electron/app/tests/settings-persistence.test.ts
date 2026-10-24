import { describe, expect, it, vi } from 'vitest';
import { normalizePreferences } from '../src/domain/preferences/ui';
import { defaultSettings, type SettingsPatch, type SettingsSnapshot } from '../src/domain/services';
import { SettingsEditQueue } from '../src/renderer/settings/persistence/edit-queue';

function fixture() {
  let current: SettingsSnapshot = {
    revision: 0,
    settings: defaultSettings('/fixtures'),
    ui: normalizePreferences(),
    look: 'dark',
    credentials: [],
  };
  const write = vi.fn(async (_patches: SettingsPatch[], _revision: number) => ({
    ...current,
    revision: current.revision + 1,
  }));
  const error = vi.fn();
  const queue = new SettingsEditQueue({
    current: () => current,
    write,
    refresh: async () => current,
    accept: (value) => {
      current = value;
    },
    error,
  });
  return { queue, write, error };
}

describe('Settings persistence barrier', () => {
  it('rejects a failed flush and retries the failed intent before later edits', async () => {
    const { queue, write, error } = fixture();
    write.mockRejectedValueOnce(new Error('Disk full'));
    queue.enqueue(() => [{ path: 'settings.appearance', value: 'light' }]);
    queue.enqueue(() => [{ path: 'ui.space.grid', value: false }]);
    await expect(queue.flush()).rejects.toThrow('Disk full');
    expect(error).toHaveBeenCalledWith('Disk full');
    expect(write).toHaveBeenCalledTimes(1);
    await queue.flush();
    expect(write.mock.calls.map(([patches, revision]) => ({ patches, revision }))).toEqual([
      { patches: [{ path: 'settings.appearance', value: 'light' }], revision: 0 },
      { patches: [{ path: 'settings.appearance', value: 'light' }], revision: 0 },
      { patches: [{ path: 'ui.space.grid', value: false }], revision: 1 },
    ]);
  });

  it('joins a pending write and includes an edit enqueued before that write completes', async () => {
    const { queue, write } = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = write.getMockImplementation()!;
    write.mockImplementationOnce(async (...args) => {
      await gate;
      return first(...args);
    });
    queue.enqueue(() => [{ path: 'ui.space.grid', value: false }]);
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    let acknowledged = false;
    const flush = queue.flush().then(() => {
      acknowledged = true;
    });
    queue.enqueue(() => [{ path: 'ui.space.minimap', value: false }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(acknowledged).toBe(false);
    release();
    await flush;
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]?.[1]).toBe(1);
  });
});
