import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { temporaryRoot } from '../tools/temporary';
import { SettingsService } from '../src/desktop/preferences/settings';
import { normalizePreferences } from '../src/domain/preferences/ui';
import type { SettingsPatch, SettingsSnapshot } from '../src/domain/services';
import { defaultSettings } from '../src/domain/services';
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

  it('drops a validation-rejected edit so subsequent valid edits and close flushes succeed', async () => {
    const dir = await temporaryRoot('viewer-settings-queue-');
    const service = new SettingsService(
      path.join(dir, 'profile'),
      '/fixtures',
      () => true,
      () => {},
    );
    await service.load();
    let current = service.snapshot();
    const errors: string[] = [];
    const queue = new SettingsEditQueue({
      current: () => current,
      write: (patches, revision) => service.patch(patches, revision),
      refresh: async () => service.snapshot(),
      accept: (snapshot) => {
        current = snapshot;
      },
      error: (message) => {
        errors.push(message);
      },
    });

    queue.enqueue(() => [{ path: 'settings.terminals.tmux.session', value: 'my session' }]);
    await expect(queue.flush()).rejects.toThrow();
    expect(errors.length).toBeGreaterThan(0);

    queue.enqueue(() => [{ path: 'settings.terminals.tmux.session', value: 'my-session' }]);
    queue.enqueue(() => [{ path: 'settings.appearance', value: 'light' }]);
    await expect(queue.flush()).resolves.toBeUndefined();
    expect(current.settings.terminals.tmux.session).toBe('my-session');
    expect(current.settings.appearance).toBe('light');
  });

  it('resumes flushing queued-behind edits after dropping invalid, diagnostic, or conflicted edits', async () => {
    const dir = await temporaryRoot('viewer-settings-queue-resume-');
    const service = new SettingsService(
      path.join(dir, 'profile'),
      '/fixtures',
      () => true,
      () => {},
    );
    await service.load();
    let current = service.snapshot();
    const errors: string[] = [];
    const queue = new SettingsEditQueue({
      current: () => current,
      write: (patches, revision) => service.patch(patches, revision),
      refresh: async () => service.snapshot(),
      accept: (snapshot) => {
        current = snapshot;
      },
      error: (message) => {
        errors.push(message);
      },
    });

    // Queue a valid edit right behind a validation-rejected edit without calling flush() again.
    queue.enqueue(() => [{ path: 'settings.terminals.tmux.session', value: 'bad session' }]);
    queue.enqueue(() => [{ path: 'settings.appearance', value: 'light' }]);
    await vi.waitFor(() => expect(service.snapshot().settings.appearance).toBe('light'));
    expect(errors.length).toBeGreaterThan(0);

    // Queue a valid edit behind a SETTINGS_CONFLICT edit (stale revision against a peer write).
    const staleRevision = current.revision;
    await service.patch([{ path: 'ui.space.minimap', value: false }], staleRevision);
    queue.enqueue(() => [{ path: 'ui.space.minimap', value: true }]);
    queue.enqueue(() => [{ path: 'ui.space.grid', value: false }]);
    await vi.waitFor(() => expect(service.snapshot().ui.space.grid).toBe(false));
    expect(service.snapshot().ui.space.minimap).toBe(false);
    await expect(queue.flush()).resolves.toBeUndefined();

    // Config diagnostics refusal (SETTINGS_INVALID) also drops the rejected edit cleanly.
    const configPath = service.snapshot().config!.path;
    const { writeFile } = await import('node:fs/promises');
    const validText = await (await import('node:fs/promises')).readFile(configPath, 'utf8');
    await writeFile(configPath, '{ invalid jsonc', 'utf8');
    queue.enqueue(() => [{ path: 'ui.space.grid', value: true }]);
    await expect(queue.flush()).rejects.toThrow();
    await writeFile(configPath, validText, 'utf8');
    await service.reload();
    current = service.snapshot();
    await expect(queue.flush()).resolves.toBeUndefined();
    expect(service.snapshot().ui.space.grid).toBe(false);
  });
});
