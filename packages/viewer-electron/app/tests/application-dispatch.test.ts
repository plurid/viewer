import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import {
  activateApplication,
  createIndependentWindow,
  dispatchApplicationCommand,
} from '../src/desktop/windows/application-dispatch';
import { installApplicationMenu } from '../src/desktop/windows/application-menu';
import { WorkspaceSessions } from '../src/desktop/windows/workspace-sessions';

const nativeMenu = vi.hoisted(() => ({
  buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => template),
  setApplicationMenu: vi.fn(),
}));
vi.mock('electron', () => ({ Menu: nativeMenu, app: { isPackaged: true } }));

function menuWindow() {
  return {
    webContents: {
      undo: vi.fn(),
      redo: vi.fn(),
      cut: vi.fn(),
      copy: vi.fn(),
      paste: vi.fn(),
      selectAll: vi.fn(),
    },
  };
}

function menuHost() {
  return {
    openSettings: vi.fn(async () => {}),
    newWindow: vi.fn(async () => {}),
    checkForUpdates: vi.fn(async () => {}),
    acknowledgements: vi.fn(async () => {}),
    focusedWindow: vi.fn<() => ReturnType<typeof menuWindow> | null>(() => null),
    settingsWindow: vi.fn<() => ReturnType<typeof menuWindow> | null>(() => null),
    workspaceCommand: vi.fn(),
  };
}

describe('native application menu dispatch', () => {
  it.each(['none', 'blurred-settings', 'settings', 'workspace'] as const)(
    'creates independent workspaces from the actual New Window menu with %s focused',
    async (focus) => {
      const sessions = new WorkspaceSessions();
      const original = sessions.open(1, '/generated/original');
      const created: string[] = [];
      let owner = 1;
      const create = vi.fn(async (workspaceID: string) => {
        sessions.open(++owner, '/generated/general-default', workspaceID);
        created.push(workspaceID);
        return { workspaceID };
      });
      const host = menuHost();
      const settings = menuWindow();
      if (focus !== 'none') host.settingsWindow.mockReturnValue(settings);
      if (focus === 'settings') host.focusedWindow.mockReturnValue(settings);
      if (focus === 'workspace') host.focusedWindow.mockReturnValue(menuWindow());
      host.newWindow.mockImplementation(async () => {
        await createIndependentWindow({
          available: () => true,
          prepare: async () => {},
          createWorkspace: () => sessions.create('/generated/general-default'),
          create,
        });
      });
      installApplicationMenu(
        undefined,
        (id) => () => dispatchApplicationCommand(id, host),
        '/generated/diagnostics.log',
        vi.fn(),
      );
      const template = nativeMenu.buildFromTemplate.mock.calls.at(-1)![0];
      const items = template.find((item) => item.label === 'File')!
        .submenu as MenuItemConstructorOptions[];
      const click = items.find((item) => item.label === 'New Window')!.click as () => Promise<void>;
      await click();
      await click();

      expect(created).toHaveLength(2);
      expect(new Set(created).size).toBe(2);
      expect(created).not.toContain(original.activeWorkspace);
      const state = sessions.snapshot()!;
      expect(state.workspaces).toHaveLength(3);
      expect(state.workspaces[0]!.panes[0]!.path).toBe('/generated/original');
      for (const id of created)
        expect(state.workspaces.find((space) => space.id === id)!.panes[0]!.path).toBe(
          '/generated/general-default',
        );
      expect(host.focusedWindow).not.toHaveBeenCalled();
      expect(host.workspaceCommand).not.toHaveBeenCalled();
    },
  );

  it('tells Quit whether ⌘Q or a click chose it', () => {
    const quit = vi.fn();
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' });
    try {
      installApplicationMenu(undefined, () => () => {}, '/generated/diagnostics.log', quit);
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }
    const template = nativeMenu.buildFromTemplate.mock.calls.at(-1)![0];
    const items = template[0]!.submenu as MenuItemConstructorOptions[];
    const item = items.find((entry) => entry.label === 'Quit Viewer')!;
    expect(item).toMatchObject({ accelerator: 'CmdOrCtrl+Q' });
    expect(items.some((entry) => entry.role === 'quit')).toBe(false);
    const click = item.click as (item: unknown, window: unknown, event: object) => void;
    click(undefined, undefined, { triggeredByAccelerator: true });
    click(undefined, undefined, {});
    expect(quit.mock.calls).toEqual([[true], [false]]);
  });

  it('does not mistake two null window references for a focused Settings window', async () => {
    const host = menuHost();
    await dispatchApplicationCommand('copy', host);
    expect(host.workspaceCommand).toHaveBeenCalledExactlyOnceWith('copy');
  });

  it('keeps Settings editing local while application actions bypass Settings focus', async () => {
    const host = menuHost();
    const settings = menuWindow();
    host.focusedWindow.mockReturnValue(settings);
    host.settingsWindow.mockReturnValue(settings);
    await dispatchApplicationCommand('copy', host);
    await dispatchApplicationCommand('settings', host);
    await dispatchApplicationCommand('new-native-window', host);
    expect(settings.webContents.copy).toHaveBeenCalledOnce();
    expect(host.openSettings).toHaveBeenCalledOnce();
    expect(host.newWindow).toHaveBeenCalledOnce();
    expect(host.workspaceCommand).not.toHaveBeenCalled();
  });

  it('propagates application creation failure instead of falling back to a renderer command', async () => {
    const host = menuHost();
    host.newWindow.mockRejectedValue(new Error('Window unavailable'));
    await expect(dispatchApplicationCommand('new-native-window', host)).rejects.toThrow(
      'Window unavailable',
    );
    expect(host.workspaceCommand).not.toHaveBeenCalled();
  });

  it('does not allocate a workspace when quitting starts during preparation', async () => {
    let available = true;
    const createWorkspace = vi.fn(() => 'must-not-create');
    const create = vi.fn(async () => ({}));
    await createIndependentWindow({
      available: () => available,
      prepare: async () => {
        available = false;
      },
      createWorkspace,
      create,
    });
    expect(createWorkspace).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

function activationWindow(minimized = false, destroyed = false) {
  const calls: string[] = [];
  return {
    calls,
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    restore: vi.fn(() => calls.push('restore')),
    show: vi.fn(() => calls.push('show')),
    focus: vi.fn(() => calls.push('focus')),
  };
}

describe('Dock activation dispatch', () => {
  it.each([false, true])(
    'reveals an existing hidden window, restoring minimized state (%s)',
    async (minimized) => {
      const current = activationWindow(minimized);
      const createWindow = vi.fn(async () => activationWindow());
      await activateApplication({
        available: () => true,
        present: true,
        restoreHotkey: () => false,
        currentWindow: () => current,
        createWindow,
      });
      expect(current.calls).toEqual(minimized ? ['restore', 'show', 'focus'] : ['show', 'focus']);
      expect(createWindow).not.toHaveBeenCalled();
    },
  );

  it('keeps a recovered hotkey target focused instead of choosing the stale ordinary window', async () => {
    const currentWindow = vi.fn(() => activationWindow());
    const createWindow = vi.fn(async () => activationWindow());
    await activateApplication({
      available: () => true,
      present: true,
      restoreHotkey: () => true,
      currentWindow,
      createWindow,
    });
    expect(currentWindow).not.toHaveBeenCalled();
    expect(createWindow).not.toHaveBeenCalled();
  });

  it.each([undefined, activationWindow(false, true)])(
    'creates a window when the old target is absent or destroyed',
    async (current) => {
      const created = activationWindow();
      const createWindow = vi.fn(async () => created);
      await activateApplication({
        available: () => true,
        present: true,
        restoreHotkey: () => false,
        currentWindow: () => current,
        createWindow,
      });
      expect(createWindow).toHaveBeenCalledOnce();
      expect(created.calls).toEqual(['show', 'focus']);
    },
  );

  it('keeps background QA hidden and ignores activation while quitting', async () => {
    const current = activationWindow(true);
    const restoreHotkey = vi.fn(() => true);
    const createWindow = vi.fn(async () => activationWindow());
    const host = { present: false, restoreHotkey, currentWindow: () => current, createWindow };
    await activateApplication({ ...host, available: () => true });
    await activateApplication({ ...host, present: true, available: () => false });
    expect(restoreHotkey).not.toHaveBeenCalled();
    expect(current.calls).toEqual([]);
    expect(createWindow).not.toHaveBeenCalled();
  });
});
