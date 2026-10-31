// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingsService } from '../src/desktop/preferences/settings';
import type { SettingsPatch } from '../src/domain/services';
import { getState, initialize } from '../src/renderer/state/store';
import {
  flushPreferences,
  pendingPreferences,
  queuePreference,
  resetPreferences,
} from '../src/renderer/state/preferences';
import { resetPersistence } from '../src/renderer/state/persistence';
import { choosePlaneToolbar } from '../src/renderer/commands/window-commands/settings';
import { headerPresets } from '../src/domain/preferences/header';
import { temporaryRoot } from '../tools/temporary';

let service: SettingsService;
let release!: () => void;
let entered!: () => void;
let started: Promise<void>;
const write = vi.fn();

beforeEach(async () => {
  const root = await temporaryRoot('viewer-preference-concurrency-');
  service = new SettingsService(
    root,
    '/fixtures',
    () => false,
    () => {},
  );
  await service.load();
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  write.mockReset().mockImplementation(async (patches: SettingsPatch[], revision: number) => {
    if (write.mock.calls.length === 1) {
      entered();
      await gate;
    }
    return service.patch(patches, revision, 'workspace');
  });
  Object.assign(window, { viewer: { save: vi.fn(async () => {}), settingsPatch: write } });
  initialize({
    home: '/fixtures',
    platform: 'darwin',
    state: null,
    settings: service.snapshot(),
    locations: [],
    openPaths: [],
  });
});

afterEach(() => {
  resetPreferences();
  resetPersistence();
  service.close();
});

it('saves a newer intent for the same field after joining its own earlier write', async () => {
  queuePreference('ui.space.toolbar', false);
  const flush = flushPreferences();
  await started;
  queuePreference('ui.space.toolbar', true);
  release();
  await flush;
  expect(service.snapshot().ui.space.toolbar).toBe(true);
  expect(write.mock.calls.map(([, revision]) => revision)).toEqual([0, 1]);
  expect(pendingPreferences.size).toBe(0);
  expect(getState().notice).toBeNull();
});

it('retains conflicts for another field changed by a peer during the write', async () => {
  queuePreference('ui.space.toolbar', false);
  const flush = flushPreferences();
  const conflict = expect(flush).rejects.toThrow(/changed in another window/);
  await started;
  queuePreference('ui.space.minimap', true);
  await service.patch([{ path: 'ui.space.minimap', value: false }], 0);
  release();
  await conflict;
  expect(service.snapshot().ui.space.toolbar).toBe(false);
  expect(service.snapshot().ui.space.minimap).toBe(false);
  expect(pendingPreferences.get('ui.space.minimap')).toBe(true);
});

it('rebases an overlapping child edit after its own parent-object write', async () => {
  queuePreference('ui.space.headerControls', {
    ...service.snapshot().ui.space.headerControls,
    parent: false,
  });
  const flush = flushPreferences();
  await started;
  queuePreference('ui.space.headerControls.close', false);
  release();
  await flush;
  expect(service.snapshot().ui.space.headerControls).toMatchObject({
    parent: false,
    close: false,
  });
});

it('keeps each queued field baseline when an overlapping edit joins an unrelated edit', async () => {
  queuePreference('ui.space.toolbar', false);
  const flush = flushPreferences();
  await started;
  queuePreference('ui.sidebar.visible', false);
  queuePreference('ui.space.toolbar', true);
  release();
  await flush;
  expect(service.snapshot().ui.space.toolbar).toBe(true);
  expect(service.snapshot().ui.sidebar.visible).toBe(false);
  expect(write.mock.calls.map(([, revision]) => revision)).toEqual([0, 0, 1]);
  expect(pendingPreferences.size).toBe(0);
  expect(getState().notice).toBeNull();
});

it('preserves peer sibling conflicts when a queued parent overlaps its own child write', async () => {
  const headerControls = structuredClone(service.snapshot().ui.space.headerControls);
  queuePreference('ui.space.headerControls.close', false);
  const flush = flushPreferences();
  const conflict = expect(flush).rejects.toThrow(/changed in another window/);
  await started;
  queuePreference('ui.space.headerControls', {
    ...headerControls,
    close: true,
  });
  await service.patch([{ path: 'ui.space.headerControls.parent', value: false }], 0);
  release();
  await conflict;
  expect(service.snapshot().ui.space.headerControls).toMatchObject({
    close: false,
    parent: false,
  });
  expect(pendingPreferences.get('ui.space.headerControls')).toEqual({
    ...headerControls,
    close: true,
  });
});

it('writes a plane toolbar preset as one change of its controls', async () => {
  await choosePlaneToolbar('full');
  const flush = flushPreferences();
  await started;
  release();
  await flush;
  expect(write).toHaveBeenCalledTimes(1);
  expect(write.mock.calls[0]![0]).toEqual([
    { path: 'ui.space.headerControls', value: headerPresets.full },
  ]);
  expect(service.snapshot().ui.space.headerControls).toEqual(headerPresets.full);
});
