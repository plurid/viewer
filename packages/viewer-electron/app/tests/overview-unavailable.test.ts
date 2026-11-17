// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandContext } from '../src/renderer/commands/registry';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { arrangementCommands } from '../src/renderer/commands/window-commands/arrangement';
import type { WindowActions } from '../src/renderer/commands/window-commands/scope';
import { windowScopes } from '../src/renderer/commands/window-commands/scope';
import { activeWorkspace, getState, initialize } from '../src/renderer/state/store';
import { replaceState } from '../src/renderer/state/core';
import type { UIPreferences } from '../src/domain/contracts';

function withSpace(space: Partial<UIPreferences['space']>): void {
  const state = getState();
  replaceState({
    ...state,
    saved: {
      ...state.saved,
      ui: { ...state.saved.ui, space: { ...state.saved.ui.space, ...space } },
    },
  });
}

async function overviewRow(docked = false) {
  const actions = {
    workspace: { isDocked: () => docked },
    ready: true,
    overviewAvailable: false,
    overview: vi.fn(),
  } as unknown as WindowActions;
  const context: CommandContext = {
    scope: 'window',
    workspaceID: activeWorkspace().id,
    selection: [],
    jobs: [],
    clipboard: null,
  };
  const registry = new CommandRegistry();
  registry.register('window', {
    context: () => context,
    definitions: () =>
      arrangementCommands(windowScopes(actions)).filter((command) => command.id === 'overview'),
  });
  const rows = registry.discover();
  return rows.find((row) => row.id === 'overview');
}

describe('Overview when the minimap is not there', () => {
  beforeEach(() => {
    Object.assign(window, { viewer: { save: vi.fn(async () => {}) } });
    initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
  });

  it('offers Overview below three planes with the automatic minimap', async () => {
    withSpace({ minimap: true, minimapAuto: true });
    const row = await overviewRow();
    expect(activeWorkspace().panes.length).toBeLessThan(3);
    expect(row?.available).toBe(true);
    expect(row?.reason).toBeUndefined();
  });

  it('offers Overview when the minimap is off', async () => {
    withSpace({ minimap: false, minimapAuto: false });
    const row = await overviewRow();
    expect(row?.available).toBe(true);
    expect(row?.reason).toBeUndefined();
  });

  it('names Reveal space when a plane is docked', async () => {
    withSpace({ minimap: true, minimapAuto: false });
    const row = await overviewRow(true);
    expect(row?.available).toBe(false);
    expect(row?.reason).toBe('A docked plane fills the window. Reveal space (⌘↵) first.');
  });
});
