// @vitest-environment jsdom
/**
 * LAYOUT TEMPLATES (2026-10-23): a workspace's planes saved by kind and folder, with their tiling, in
 * config.jsonc; opening one adds those planes, tiled, to the workspace in view, anywhere.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import type { Pane } from '../src/domain/contracts';
import {
  captureTemplate,
  templatePath,
  type LayoutTemplate,
} from '../src/domain/workspaces/layout-templates';
import { windowCommands } from '../src/renderer/commands/window';
import type { WindowActions } from '../src/renderer/commands/window-commands/scope';
import type { CommandContext } from '../src/renderer/commands/registry';
import {
  activeWorkspace,
  getState,
  initialize,
  receiveSettings,
} from '../src/renderer/state/store';
import { layoutTemplateSchema } from '../src/desktop/preferences/settings';

describe('a template', () => {
  const panes = [
    { id: 'a', type: 'folder', path: '/Users/me/Downloads' },
    { id: 'b', type: 'terminal', path: '/Users/me/project', profileID: 'zsh' },
    { id: 'c', type: 'scratch', path: '/Users/me/Desktop', bufferID: 'x' },
    { id: 'd', type: 'preview', path: '/Users/me/notes.md' },
  ] as unknown as Pane[];
  it('keeps each plane by kind and folder, home as ~, in order, with the tiling', () => {
    const template = captureTemplate('Triage', panes, ['b', 'a', 'c', 'd'], '/Users/me', {
      layout: 'main-vertical',
      main: 0.5,
    });
    expect(template).toMatchObject({
      name: 'Triage',
      layout: 'main-vertical',
      main: 0.5,
      planes: [
        { kind: 'terminal', path: '~/project', profileID: 'zsh' },
        { kind: 'folder', path: '~/Downloads' },
        { kind: 'scratch' },
        { kind: 'file', path: '~/notes.md' },
      ],
    });
    expect(template.id).toMatch(/^triage-/);
    expect(layoutTemplateSchema.safeParse(template).success).toBe(true);
  });
  it('reads ~ as home and an empty path as the folder in view', () => {
    expect(templatePath('~/Downloads', '/Users/me', '/Users/me/work')).toBe('/Users/me/Downloads');
    expect(templatePath('', '/Users/me', '/Users/me/work')).toBe('/Users/me/work');
    expect(templatePath('/tmp', '/Users/me', '/Users/me/work')).toBe('/tmp');
  });
});

describe('opening a template', () => {
  const retile = vi.fn();
  const controller: Record<string, unknown> = {
    parentPaneID: () => undefined,
    isDocked: () => false,
    arrangementHistory: () => ({ canUndo: false, canRedo: false }),
    hasRepeatedPreviews: () => false,
    bookmarks: () => [],
    retile,
  };
  const actions = {
    workspace: new Proxy(controller, { get: (target, key: string) => target[key] ?? vi.fn() }),
    ready: true,
    tool: null,
  } as unknown as WindowActions;
  const context = { scope: 'window', workspaceID: '', selection: [] } as unknown as CommandContext;
  beforeEach(() => {
    Object.assign(window, { viewer: { save: vi.fn(async () => {}) } });
    initialize({
      home: '/fixtures',
      platform: 'darwin',
      state: null,
      locations: [],
      openPaths: [],
    });
  });
  it('adds its planes as roots, tiled in its layout', async () => {
    const template: LayoutTemplate = {
      id: 'dev',
      name: 'Dev',
      layout: 'even-horizontal',
      main: 0.6,
      planes: [
        { kind: 'folder', path: '~/src' },
        { kind: 'terminal', path: '' },
        { kind: 'scratch' },
      ],
    };
    const snapshot = structuredClone(getState().settings);
    snapshot.settings.layouts = [template];
    snapshot.revision++;
    act(() => receiveSettings(snapshot));
    const command = windowCommands(actions).find((item) => item.id === 'layout.dev')!;
    expect(command.label).toBe('Open layout “Dev”');
    const before = activeWorkspace().panes.length;
    await act(async () => command.run(context));
    const tiling = activeWorkspace().tiling!;
    expect(tiling.layout).toBe('even-horizontal');
    const added = tiling.panes.map((id) => activeWorkspace().panes.find((pane) => pane.id === id)!);
    expect(added.map((pane) => pane.type)).toEqual(['folder', 'terminal', 'scratch']);
    expect(added[0]!.path).toBe('/fixtures/src');
    expect(activeWorkspace().panes).toHaveLength(before + 3);
    expect(retile).toHaveBeenCalled();
  });
});
