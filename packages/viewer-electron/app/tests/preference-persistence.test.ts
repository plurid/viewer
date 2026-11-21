// @vitest-environment jsdom
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { temporaryRoot } from '../tools/temporary';
import { SettingsService } from '../src/desktop/preferences/settings';
import { getState, initialize } from '../src/renderer/state/store';
import {
  flushPreferences,
  pendingPreferences,
  queuePreference,
  receiveSettings,
  resetPreferences,
} from '../src/renderer/state/preferences';
import { receiveFileChanges } from '../src/renderer/state/file-changes';
import { resetPersistence } from '../src/renderer/state/persistence';
import type { SettingsPatch, SettingsSnapshot } from '../src/domain/services';

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

  it('does not wedge flushPreferences at a stale revision after a peer conflict on sidebar rename', async () => {
    const dir = await temporaryRoot('viewer-pref-conflict-');
    const service = new SettingsService(
      path.join(dir, 'profile'),
      '/fixtures',
      () => true,
      () => {},
    );
    await service.load();
    await service.patch([{ path: 'ui.sidebar.locations', value: ['/work/old'] }], 0, 'workspace');
    const initial = service.snapshot();
    Object.assign(window, {
      viewer: {
        save: vi.fn(async () => {}),
        settingsPatch: (patches: SettingsPatch[], revision: number) =>
          service.patch(patches, revision, 'workspace'),
      },
    });
    initialize({
      home: '/fixtures',
      platform: 'darwin',
      state: null,
      settings: initial,
      locations: [],
      openPaths: [],
    });

    const baseRevision = getState().settings.revision;
    const peerSnapshot = await service.patch(
      [{ path: 'ui.sidebar.locations', value: ['/work/new'] }],
      baseRevision,
      'workspace',
    );
    receiveFileChanges([{ source: '/work/old', destination: '/work/new' }]);
    await expect(flushPreferences()).rejects.toThrow(
      'This setting changed in another window or config.jsonc. Review its current value.',
    );
    receiveSettings(peerSnapshot);
    expect(getState().settings.revision).toBe(peerSnapshot.revision);
    await expect(flushPreferences()).resolves.toBeUndefined();
    expect(pendingPreferences.size).toBe(0);
  });

  it('preserves a folder field edit queued after a folder reset in the same batch', async () => {
    const dir = await temporaryRoot('viewer-pref-order-');
    const service = new SettingsService(
      path.join(dir, 'profile'),
      '/fixtures',
      () => true,
      () => {},
    );
    await service.load();
    const initial = service.snapshot();
    Object.assign(window, {
      viewer: {
        save: vi.fn(async () => {}),
        settingsPatch: (patches: SettingsPatch[], revision: number) =>
          service.patch(patches, revision, 'workspace'),
      },
    });
    initialize({
      home: '/fixtures',
      platform: 'darwin',
      state: null,
      settings: initial,
      locations: [],
      openPaths: [],
    });

    queuePreference('@' + JSON.stringify(['settings', 'folders', '/Work', 'mode']), 'grid');
    queuePreference('@' + JSON.stringify(['settings', 'folders', '/Work']), null);
    queuePreference('@' + JSON.stringify(['settings', 'folders', '/Work', 'mode']), 'columns');
    await flushPreferences();
    expect(service.snapshot().settings.folders['/Work']?.mode).toBe('columns');
  });

  it('isolates conflicted fields in a multi-field batch, keeps unrelated edits, and reverts local UI to desktop values', async () => {
    const dir = await temporaryRoot('viewer-pref-isolate-');
    const service = new SettingsService(
      path.join(dir, 'profile'),
      '/fixtures',
      () => true,
      () => {},
    );
    await service.load();
    const initial = service.snapshot();
    Object.assign(window, {
      viewer: {
        save: vi.fn(async () => {}),
        settingsGet: () => Promise.resolve(service.snapshot()),
        settingsPatch: (patches: SettingsPatch[], revision: number) =>
          service.patch(patches, revision, 'workspace'),
      },
    });
    initialize({
      home: '/fixtures',
      platform: 'darwin',
      state: null,
      settings: initial,
      locations: [],
      openPaths: [],
    });

    // Peer changes ui.space.minimap while this window queues both minimap (conflicted) and grid (unrelated).
    await service.patch([{ path: 'ui.space.minimap', value: false }], 0, 'workspace');
    queuePreference('ui.space.minimap', true);
    queuePreference('ui.space.grid', false);

    await expect(flushPreferences()).rejects.toThrow(/changed in another window/);
    // Unrelated edit persisted; conflicted edit dropped and local UI reverted to desktop's winning value.
    expect(service.snapshot().ui.space.grid).toBe(false);
    expect(service.snapshot().ui.space.minimap).toBe(false);
    expect(getState().saved.ui.space.minimap).toBe(false);
    expect(getState().saved.ui.space.grid).toBe(false);
    expect(pendingPreferences.size).toBe(0);
  });

  it('remaps pending sidebar preferences in place on file changes without queuing a conflicting desktop patch', async () => {
    const dir = await temporaryRoot('viewer-pref-file-remap-');
    const service = new SettingsService(
      path.join(dir, 'profile'),
      '/fixtures',
      () => true,
      () => {},
    );
    await service.load();
    await service.patch([{ path: 'ui.sidebar.locations', value: ['/work/old'] }], 0, 'workspace');
    const initial = service.snapshot();
    const patchSpy = vi.fn((patches: SettingsPatch[], revision: number) =>
      service.patch(patches, revision, 'workspace'),
    );
    Object.assign(window, {
      viewer: {
        save: vi.fn(async () => {}),
        settingsGet: () => Promise.resolve(service.snapshot()),
        settingsPatch: patchSpy,
      },
    });
    initialize({
      home: '/fixtures',
      platform: 'darwin',
      state: null,
      settings: initial,
      locations: [],
      openPaths: [],
    });

    // Desktop persists the folder rename; renderer receives file-changes without racing desktop.
    await service.remapFolders([{ source: '/work/old', destination: '/work/new' }]);
    receiveFileChanges([{ source: '/work/old', destination: '/work/new' }]);
    expect(pendingPreferences.size).toBe(0);
    await expect(flushPreferences()).resolves.toBeUndefined();
    expect(patchSpy).not.toHaveBeenCalled();
  });
});
