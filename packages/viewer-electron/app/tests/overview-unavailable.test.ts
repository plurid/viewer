// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandContext } from '../src/renderer/commands/registry';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { arrangementCommands } from '../src/renderer/commands/window-commands/arrangement';
import type { WindowActions } from '../src/renderer/commands/window-commands/scope';
import { windowScopes } from '../src/renderer/commands/window-commands/scope';
import { activeWorkspace, getState, initialize } from '../src/renderer/state/store';
import { changeWorkspace, replaceState } from '../src/renderer/state/core';
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

async function overviewRow(docked = false, scope: CommandContext['scope'] = 'window') {
  const actions = {
    workspace: { isDocked: () => docked },
    ready: true,
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
  const rows = registry.discover({ scope });
  return rows.find((row) => row.id === 'overview');
}

describe('Overview when the minimap is not there', () => {
  beforeEach(() => {
    Object.assign(window, { viewer: { save: vi.fn(async () => {}) } });
    initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
  });

  it('asks for a plane in an empty space', async () => {
    changeWorkspace((space) => ({ ...space, panes: [], roots: [] }));
    const row = await overviewRow();
    expect(row?.available).toBe(false);
    expect(row?.reason).toBe('Open a plane first.');
  });

  it('names the window palette in a plane-scoped list with open planes', async () => {
    const row = await overviewRow(false, 'folder');
    expect(activeWorkspace().panes.length).toBeGreaterThan(0);
    expect(row?.available).toBe(false);
    expect(row?.reason).toBe('Choose Overview in Commands (⌘K).');
  });

  it('offers Overview when only engine roots remain', async () => {
    changeWorkspace((space) => ({ ...space, panes: [], roots: ['engine-root'] }));
    const row = await overviewRow();
    expect(row?.available).toBe(true);
    expect(row?.reason).toBeUndefined();
  });

  it('resolves the unavailable reason at invocation time', () => {
    let docked = false;
    const actions = {
      workspace: { isDocked: () => docked },
      ready: true,
      overview: vi.fn(),
    } as unknown as WindowActions;
    const overview = arrangementCommands(windowScopes(actions)).find(
      (command) => command.id === 'overview',
    )!;
    const context = { scope: 'window' } as CommandContext;
    expect(typeof overview.unavailable).toBe('function');
    if (typeof overview.unavailable !== 'function') throw new Error('Expected a live reason.');
    docked = true;
    expect(overview.when(context)).toBe(false);
    expect(overview.unavailable(context)).toContain('Reveal Space');
    docked = false;
    changeWorkspace((space) => ({ ...space, panes: [], roots: [] }));
    expect(overview.when(context)).toBe(false);
    expect(overview.unavailable(context)).toBe('Open a plane first.');
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

  it('names Reveal Space when a plane is docked', async () => {
    withSpace({ minimap: true, minimapAuto: false });
    const row = await overviewRow(true);
    expect(row?.available).toBe(false);
    expect(row?.reason).toBe('A docked plane fills the window. Choose Reveal Space (⌘↩) first.');
  });
});
