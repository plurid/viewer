// @vitest-environment jsdom
/**
 * A COMMAND FOR EVERY SETTING (2026-10-23): each setting in Settings is also a command, in the
 * palette, the menus, a shortcut's reach and an agent's proposals: an on/off setting toggles, a choice
 * offers each of its values, and a number or colour opens Settings at it. A setting the workspace
 * window may not change itself (programs, Trash confirmation, limits) opens Settings at it instead.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { DesktopEvent } from '../src/domain/contracts';
import { SettingsWindow } from '../src/renderer/ui/Settings';
import { settingCatalog } from '../src/domain/setting-catalog';
import { agentCommandID } from '../src/domain/agent-safety';
import { getState, initialize } from '../src/renderer/state/store';
import { windowCommands } from '../src/renderer/commands/window';
import type { WindowActions } from '../src/renderer/commands/window-commands/scope';
import type { CommandContext } from '../src/renderer/commands/registry';

const settingsPatch = vi.fn(async (patches: { path: string; value: unknown }[]) => {
  const snapshot = structuredClone(getState().settings);
  snapshot.revision++;
  for (const { path, value } of patches) {
    const keys = path.split('.').slice(1);
    let target = snapshot.settings as unknown as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
    target[keys.at(-1)!] = value;
  }
  return snapshot;
});
const openSettings = vi.fn(async () => {});
beforeEach(() => {
  settingsPatch.mockClear();
  openSettings.mockClear();
  Object.assign(window, { viewer: { save: vi.fn(async () => {}), settingsPatch, openSettings } });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
const controller: Record<string, unknown> = {
  parentPaneID: () => undefined,
  isDocked: () => false,
  arrangementHistory: () => ({ canUndo: false, canRedo: false }),
  hasRepeatedPreviews: () => false,
};
const actions = {
  workspace: new Proxy(controller, { get: (target, key: string) => target[key] ?? vi.fn() }),
  ready: true,
  tool: null,
} as unknown as WindowActions;
const context = { scope: 'window', workspaceID: '', selection: [] } as unknown as CommandContext;
const commands = () =>
  windowCommands(actions).filter((command) => command.id.startsWith('setting.'));
const find = (id: string) => {
  const command = commands().find((item) => item.id === id);
  if (!command) throw new Error('No command ' + id);
  return command;
};
const label = (id: string) => {
  const value = find(id).label;
  return typeof value === 'string' ? value : value(context);
};

describe('a command for every setting', () => {
  it('covers each catalogued setting, but those with commands of their own', () => {
    const ids = new Set(commands().map((command) => command.id.split('=')[0]));
    const own = ['ui.sidebar.visible', 'ui.titlebar.visible'];
    for (const definition of settingCatalog) {
      if (own.includes(definition.path) || definition.path.startsWith('ui.list.')) continue;
      expect(ids.has('setting.' + definition.path), definition.path).toBe(true);
    }
    for (const path of own) expect(ids.has('setting.' + path)).toBe(false);
  });
  it('toggles an on/off setting: the space toolbar, minimap and viewcube', async () => {
    expect(label('setting.ui.space.toolbar')).toBe('Hide space toolbar');
    expect(label('setting.ui.space.minimap')).toBe('Hide minimap');
    await act(async () => find('setting.ui.space.minimap').run(context));
    expect(getState().saved.ui.space.minimap).toBe(false);
    expect(label('setting.ui.space.minimap')).toBe('Show minimap');
    await act(async () => find('setting.ui.space.headerControls.back').run(context));
    expect(getState().saved.ui.space.headerControls.back).toBe(false);
    expect(label('setting.ui.space.headerControls.back')).toBe(
      'Turn on: Plane toolbar › Back button',
    );
  });
  it('offers each value of a choice, the current one checked', async () => {
    expect(label('setting.ui.space.backdrop=blur')).toBe('Space background: Blur');
    expect(find('setting.ui.space.backdrop=opaque').icon).toBe('check');
    await act(async () => find('setting.ui.space.backdrop=blur').run(context));
    expect(getState().saved.ui.space.backdrop).toBe('blur');
    expect(find('setting.ui.space.backdrop=blur').icon).toBe('check');
    expect(label('setting.settings.editor.fontFamily=Menlo')).toBe('Editor › Font: Menlo');
  });
  it('changes settings the workspace may change, and opens Settings at the others', async () => {
    await act(async () => find('setting.settings.editor.wordWrap').run(context));
    expect(settingsPatch).toHaveBeenCalledWith(
      [{ path: 'settings.editor.wordWrap', value: true }],
      expect.any(Number),
    );
    expect(getState().settings.settings.editor.wordWrap).toBe(true);
    await act(async () => find('setting.settings.browsing.confirmTrash').run(context));
    expect(openSettings).toHaveBeenLastCalledWith('settings.browsing.confirmTrash');
    await act(async () => find('setting.settings.fileOpening.default=native').run(context));
    expect(openSettings).toHaveBeenLastCalledWith('settings.fileOpening.default');
    expect(settingsPatch).toHaveBeenCalledTimes(1);
  });
  it('opens Settings at a number or a colour', async () => {
    expect(label('setting.ui.space.backdropOpacity')).toBe('Change space background opacity (%)…');
    await act(async () => find('setting.ui.space.color').run(context));
    expect(openSettings).toHaveBeenLastCalledWith('ui.space.color');
  });
});

describe("an agent's setting commands", () => {
  it('may propose the view and presentation it may configure, and nothing else', () => {
    expect(agentCommandID('setting.ui.space.minimap', [])).toBe('setting.ui.space.minimap');
    expect(agentCommandID('setting.ui.space.backdrop=blur', [])).toBe(
      'setting.ui.space.backdrop=blur',
    );
    for (const id of [
      'setting.settings.browsing.confirmTrash',
      'setting.settings.fileOpening.default=native',
      // a number or colour opens Settings, for the person
      'setting.ui.space.backdropOpacity',
      'setting.ui.nothing',
    ])
      expect(() => agentCommandID(id, []), id).toThrow();
  });
});

describe('Settings, opened at a setting', () => {
  it('shows its category and marks its row, and moves to another when asked', async () => {
    history.replaceState(null, '', '/?window=settings&focus=ui.space.minimap');
    let listener: ((event: DesktopEvent) => void) | undefined;
    const snapshot = structuredClone(getState().settings);
    const stubs: Record<string, unknown> = {
      settingsGet: async () => snapshot,
      onEvent: (next: typeof listener) => {
        listener = next;
        return () => {};
      },
    };
    Object.assign(window, {
      viewer: new Proxy(stubs, {
        get: (target, key: string) => target[key] ?? vi.fn(async () => undefined),
      }),
    });
    Element.prototype.scrollIntoView = vi.fn();
    const view = render(createElement(SettingsWindow));
    await waitFor(() =>
      expect(
        view.container
          .querySelector('[data-setting-path="ui.space.minimap"]')
          ?.classList.contains('is-focused'),
      ).toBe(true),
    );
    expect(view.getByRole('heading', { level: 1 }).textContent).toBe('Space');
    act(() => listener?.({ type: 'settings-focus', path: 'settings.editor.wordWrap' }));
    await waitFor(() => expect(view.getByRole('heading', { level: 1 }).textContent).toBe('Editor'));
    cleanup();
    history.replaceState(null, '', '/');
  });
});
