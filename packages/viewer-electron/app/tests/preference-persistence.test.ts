// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getState, initialize } from '../src/renderer/state/store';
import {
  flushPreferences,
  pendingPreferences,
  queuePreference,
  receiveSettings,
  resetPreferences,
} from '../src/renderer/state/preferences';
import { resetPersistence } from '../src/renderer/state/persistence';
import type { SettingsSnapshot } from '../src/domain/services';

const write = vi.fn();

beforeEach(() => {
  write.mockReset();
  Object.assign(window, { viewer: { save: vi.fn(async () => {}), settingsPatch: write } });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
});

afterEach(() => {
  resetPreferences();
  resetPersistence();
});

describe('window preference durability', () => {
  it('retains a failed preference with its original configuration revision', async () => {
    const snapshot = getState().settings;
    write.mockRejectedValueOnce(new Error('Disk full')).mockResolvedValue(snapshot);
    queuePreference('ui.space.grid', false);
    await expect(flushPreferences()).rejects.toThrow('Disk full');
    expect(pendingPreferences.get('ui.space.grid')).toBe(false);
    await flushPreferences();
    expect(write.mock.calls[1]).toEqual([
      [{ path: 'ui.space.grid', value: false }],
      snapshot.revision,
    ]);
    expect(pendingPreferences.size).toBe(0);
  });

  it('preserves an in-flight choice when another window announces settings', async () => {
    let resolve!: (snapshot: SettingsSnapshot) => void;
    write.mockReturnValueOnce(
      new Promise<SettingsSnapshot>((done) => {
        resolve = done;
      }),
    );
    queuePreference('ui.space.grid', false);
    const flush = flushPreferences();
    const peer = structuredClone(getState().settings);
    peer.revision += 1;
    peer.ui.space.minimap = false;
    receiveSettings(peer);
    expect(getState().saved.ui.space.grid).toBe(false);
    expect(getState().saved.ui.space.minimap).toBe(false);
    resolve({
      ...peer,
      revision: peer.revision + 1,
      ui: {
        ...peer.ui,
        space: {
          ...peer.ui.space,
          grid: false,
        },
      },
    });
    await flush;
    expect(getState().saved.ui.space.grid).toBe(false);
  });

  it('keeps a newer edit when the earlier in-flight write fails', async () => {
    let reject!: (error: Error) => void;
    write.mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    queuePreference('ui.space.grid', false);
    const flush = flushPreferences();
    queuePreference('ui.space.grid', true);
    reject(new Error('Conflict'));
    await expect(flush).rejects.toThrow('Conflict');
    expect(pendingPreferences.get('ui.space.grid')).toBe(true);
  });
});
