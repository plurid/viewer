import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '../src/desktop/preferences/settings';
import type { CustomAction } from '../src/domain/automation/actions';
import type { SettingsPatch, SettingsSnapshot } from '../src/domain/services';
import {
  customActionEdit,
  saveSettingsChange,
  terminalProfileEdit,
  terminalProfilesEdit,
  type SettingsChange,
} from '../src/renderer/ui/settings/settings-edits';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let directory: string;
let service: SettingsService;
const action: CustomAction = {
  id: 'inspect',
  name: 'Inspect',
  aliases: [],
  shortcut: '',
  pinned: false,
  order: 0,
  icon: 'code',
  when: { target: 'any', extensions: [], min: 0, max: 10000 },
  executor: { kind: 'executable', executable: '/usr/bin/printf', args: ['%s'], perItem: false },
};

beforeEach(async () => {
  directory = await temporaryRoot('viewer-settings-edits-');
  service = new SettingsService(
    directory,
    directory,
    () => false,
    () => {},
  );
  await service.load();
  await service.patch([{ path: 'settings.customActions', value: [action] }], 0);
});
afterEach(async () => {
  service.close();
  await trashTemporary(directory);
});

function delayedWriter(failFirst = false) {
  let current: SettingsSnapshot = service.snapshot();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const errors: string[] = [];
  const revisions: number[] = [];
  let writes = Promise.resolve();
  const writer = {
    current: () => current,
    async write(patches: SettingsPatch[], revision: number) {
      revisions.push(revision);
      if (revisions.length === 1) {
        await gate;
        if (failFirst) throw new Error('Fixture save failure');
      }
      return service.patch(patches, revision);
    },
    refresh: async () => service.snapshot(),
    accept: (snapshot: SettingsSnapshot) => (current = snapshot),
    error: (message: string) => errors.push(message),
  };
  return {
    enqueue(change: SettingsChange) {
      writes = saveSettingsChange(writes, writer, change);
    },
    settled: () => writes,
    snapshot: () => current,
    release: () => release(),
    revisions,
    errors,
  };
}

describe('queued Settings edits', () => {
  it('preserves independent and nested edits made before the first IPC save completes', async () => {
    const writer = delayedWriter();
    writer.enqueue(customActionEdit('inspect', { name: 'Inspect folder' }));
    await vi.waitFor(() => expect(writer.revisions).toEqual([1]));
    writer.enqueue(customActionEdit('inspect', { pinned: true }));
    writer.enqueue(customActionEdit('inspect', (action) => ({ when: { ...action.when, min: 1 } })));
    writer.enqueue(
      customActionEdit('inspect', (action) => ({ when: { ...action.when, max: 20 } })),
    );
    writer.enqueue(
      customActionEdit('inspect', (action) => ({
        executor: { ...action.executor, executable: '/usr/bin/echo' } as CustomAction['executor'],
      })),
    );
    writer.enqueue(
      customActionEdit('inspect', (action) => ({
        executor: { ...action.executor, args: ['{directory}'] } as CustomAction['executor'],
      })),
    );
    writer.enqueue(terminalProfileEdit('login', { name: 'Development shell' }));
    writer.enqueue(terminalProfileEdit('login', { env: { VIEWER_EDIT_FIXTURE: 'kept' } }));
    writer.enqueue(() => [{ path: 'settings.terminals.tmux.session', value: 'development' }]);
    writer.enqueue(() => [{ path: 'settings.terminals.tmux.windowName', value: '{folder}-dev' }]);
    expect(writer.revisions).toEqual([1]);
    writer.release();
    await writer.settled();
    expect(writer.errors).toEqual([]);
    expect(writer.revisions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const value = writer.snapshot().settings;
    expect(value.customActions[0]).toMatchObject({
      name: 'Inspect folder',
      pinned: true,
      when: { min: 1, max: 20 },
      executor: { executable: '/usr/bin/echo', args: ['{directory}'] },
    });
    expect(value.terminals.profiles[0]).toMatchObject({
      name: 'Development shell',
      env: { VIEWER_EDIT_FIXTURE: 'kept' },
    });
    expect(value.terminals.tmux).toMatchObject({
      session: 'development',
      windowName: '{folder}-dev',
    });
    const reopened = new SettingsService(
      directory,
      directory,
      () => false,
      () => {},
    );
    try {
      await reopened.load();
      expect(reopened.snapshot().settings).toEqual(value);
    } finally {
      reopened.close();
    }
  });

  it('keeps edits while adding/removing profiles and never resurrects a removed action', async () => {
    const writer = delayedWriter();
    writer.enqueue(terminalProfileEdit('login', { name: 'Edited shell' }));
    await vi.waitFor(() => expect(writer.revisions).toEqual([1]));
    writer.enqueue(
      terminalProfilesEdit((profiles) => [
        ...profiles,
        { id: 'extra', name: 'Extra shell', executable: '/bin/sh', args: [], env: {} },
      ]),
    );
    writer.enqueue(terminalProfileEdit('extra', { name: 'Extra edited' }));
    writer.enqueue(
      terminalProfilesEdit((profiles) => profiles.filter((item) => item.id !== 'extra')),
    );
    writer.enqueue(terminalProfileEdit('extra', { env: { VIEWER_EDIT_FIXTURE: 'removed' } }));
    writer.enqueue((current) => [
      {
        path: 'settings.customActions',
        value: current.settings.customActions.filter((item) => item.id !== 'inspect'),
      },
    ]);
    writer.enqueue(customActionEdit('inspect', { name: 'Removed command' }));
    writer.release();
    await writer.settled();
    expect(writer.errors).toEqual([]);
    expect(writer.snapshot().settings.terminals.profiles).toHaveLength(1);
    expect(writer.snapshot().settings.terminals.profiles[0].name).toBe('Edited shell');
    expect(writer.snapshot().settings.customActions).toEqual([]);
  });

  it('recovers after a failed save before applying subsequent edits', async () => {
    const writer = delayedWriter(true);
    writer.enqueue(customActionEdit('inspect', { name: 'Uncommitted' }));
    await vi.waitFor(() => expect(writer.revisions).toEqual([1]));
    writer.enqueue(customActionEdit('inspect', { pinned: true }));
    writer.release();
    await writer.settled();
    expect(writer.errors).toEqual(['Fixture save failure']);
    expect(writer.revisions).toEqual([1, 1]);
    expect(writer.snapshot().settings.customActions[0]).toMatchObject({
      name: 'Inspect',
      pinned: true,
    });
  });
});
