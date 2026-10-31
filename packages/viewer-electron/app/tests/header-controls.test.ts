// @vitest-environment jsdom
/**
 * THE PLANE HEADER'S CONTROLS: Essential for everyone, existing profiles included, once; Full one
 * choice away; every control its own key, which a profile or a workspace may override.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import type { PluridPlaneChromeContext } from '@plurid/plurid-data';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import {
  headerControlKeys,
  headerPreset,
  headerPresetPatches,
  headerPresets,
} from '../src/domain/preferences/header';
import { normalizePreferences, uiPreferencesVersion } from '../src/domain/preferences/ui';
import { preferencesSchema } from '../src/domain/preferences/presentation/ui-schema';
import { SettingsService } from '../src/desktop/preferences/settings';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { WorkspaceContext } from '../src/renderer/workspace/context';
import { CommandsContext } from '../src/renderer/commands/context';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { PlaneHeader } from '../src/renderer/workspace/PlaneHeader';
import { changeWorkspace } from '../src/renderer/state/core';
import { initialize } from '../src/renderer/state/store';
import { setWorkspaceOverride } from '../src/renderer/state/workspaces';

const everyOn = Object.fromEntries(headerControlKeys.map((key) => [key, true]));

describe('header presets', () => {
  it('keeps Layout, discovery and the rarer format tools in “…” in Essential', () => {
    expect(headerControlKeys).toHaveLength(14);
    const off = headerControlKeys.filter((key) => !headerPresets.essential[key]);
    expect(off).toEqual(['layout', 'discover', 'formatTools']);
    expect(headerPresets.full).toEqual(everyOn);
  });
  it('names the preset the controls are exactly, and Custom otherwise', () => {
    expect(headerPreset(headerPresets.essential)).toBe('essential');
    expect(headerPreset(headerPresets.full)).toBe('full');
    expect(headerPreset({ ...headerPresets.essential, back: false })).toBe('custom');
    expect(headerPreset({ ...headerPresets.full, layout: false })).toBe('custom');
  });
  it('sets each control by its own path', () => {
    const patches = headerPresetPatches('full');
    expect(patches).toHaveLength(14);
    expect(patches[0]).toEqual({ path: 'ui.space.headerControls.parent', value: true });
    expect(headerPresetPatches('essential')).toContainEqual({
      path: 'ui.space.headerControls.discover',
      value: false,
    });
  });
});

describe('the Essential migration', () => {
  it('starts fresh and earlier profiles from Essential, and keeps this format’s choices', () => {
    expect(normalizePreferences().version).toBe(uiPreferencesVersion);
    expect(normalizePreferences().space.headerControls).toEqual(headerPresets.essential);
    // version 3 had every control on, or the person's own: both become Essential, once
    const earlier = normalizePreferences({
      version: 3,
      space: { headerControls: { ...everyOn, back: false } },
    });
    expect(earlier.space.headerControls).toEqual(headerPresets.essential);
    const current = normalizePreferences({
      version: uiPreferencesVersion,
      space: { headerControls: { layout: true, back: false, close: 'no' } },
    });
    expect(current.space.headerControls).toEqual({
      ...headerPresets.essential,
      layout: true,
      back: false,
    });
  });
  it('validates a hand-written file that leaves a control out as Essential', () => {
    const ui = normalizePreferences();
    const { pins: _pins, discover: _discover, ...controls } = ui.space.headerControls;
    const parsed = preferencesSchema.parse({
      ...ui,
      space: { ...ui.space, headerControls: controls },
    });
    expect(parsed.space.headerControls).toEqual(headerPresets.essential);
    expect(preferencesSchema.safeParse({ ...ui, version: 3 }).success).toBe(false);
  });

  let root: string;
  beforeEach(async () => {
    root = await temporaryRoot('viewer-header-controls-');
  });
  afterEach(async () => {
    await trashTemporary(root);
  });
  const service = () =>
    new SettingsService(
      root,
      root,
      () => true,
      () => {},
    );
  it('rewrites an earlier config.jsonc once, its comments kept, and keeps choices made since', async () => {
    const first = service();
    await first.load();
    const file = path.join(root, 'config.jsonc');
    const config = parse(await readFile(file, 'utf8')) as {
      ui: { version: number; space: { headerControls: Record<string, boolean> } };
    };
    // a version-3 file: ten controls, every one on, and a comment of the person's own
    config.ui.version = 3;
    config.ui.space.headerControls = Object.fromEntries(
      [
        'parent',
        'sidebar',
        'back',
        'forward',
        'view',
        'search',
        'frame',
        'dock',
        'actions',
        'close',
      ].map((key) => [key, true]),
    );
    await writeFile(file, '// mine\n' + JSON.stringify(config, null, 2) + '\n');

    const upgraded = service();
    await upgraded.load();
    expect(upgraded.snapshot().ui.version).toBe(uiPreferencesVersion);
    expect(upgraded.snapshot().ui.space.headerControls).toEqual(headerPresets.essential);
    const text = await readFile(file, 'utf8');
    expect(text).toContain('// mine');
    expect(text).toContain('// UI preference format version. Keep 4.');
    expect(parse(text).ui).toMatchObject({
      version: 4,
      space: { headerControls: headerPresets.essential },
    });

    await upgraded.patch([{ path: 'ui.space.headerControls.layout', value: true }], 0);
    const later = service();
    await later.load();
    expect(later.snapshot().ui.space.headerControls).toEqual({
      ...headerPresets.essential,
      layout: true,
    });
  });
});

describe('the header as this window shows it', () => {
  beforeEach(() => {
    Object.assign(window, { viewer: { save: vi.fn(async () => {}) } });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    initialize({
      home: '/fixtures',
      platform: 'darwin',
      state: null,
      locations: [],
      openPaths: [],
    });
    changeWorkspace((space) => ({
      ...space,
      panes: [{ id: 'plane', type: 'preview', path: '/Jobs/Bracket.pdf' }],
    }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  const header = () =>
    render(
      createElement(
        WorkspaceContext.Provider,
        {
          value: {
            selectForDrag: vi.fn(),
            subscribeLinks: () => () => {},
            subtree: () => [],
            parentPaneID: () => undefined,
          } as unknown as WorkspaceController,
        },
        createElement(
          CommandsContext.Provider,
          { value: new CommandRegistry() },
          createElement(PlaneHeader, {
            context: {
              treePlane: {
                routeDivisions: {
                  plane: { parameters: { id: 'plane' } },
                  path: { parameters: {} },
                },
              },
            } as unknown as PluridPlaneChromeContext,
          }),
        ),
      ),
    );
  const button = (view: ReturnType<typeof header>, name: string) =>
    view.queryByRole('button', { name });

  it('follows a workspace’s own controls and dragging over the general Essential ones', () => {
    const view = header();
    expect(button(view, 'Layout')).toBeNull();
    expect(button(view, 'What can I do here?')).toBeNull();
    expect(button(view, 'Frame plane')).toBeTruthy();
    expect(button(view, 'Preview actions')).toBeTruthy();
    act(() => setWorkspaceOverride('ui.space.headerControls.layout', true));
    expect(button(view, 'Layout')).toBeTruthy();
    // "…" alone: the Layout button, pins and discovery are their own
    act(() => setWorkspaceOverride('ui.space.headerControls.actions', false));
    expect(button(view, 'Preview actions')).toBeNull();
    expect(button(view, 'Layout')).toBeTruthy();
    const heading = view.container.querySelector('.plane-heading')!;
    expect(heading.hasAttribute('data-plurid-drag-handle')).toBe(true);
    act(() => setWorkspaceOverride('ui.space.dragging', false));
    expect(heading.hasAttribute('data-plurid-drag-handle')).toBe(false);
  });
  it('shows every control under the Full profile', () => {
    const view = header();
    act(() => changeWorkspace((space) => ({ ...space, profileID: 'full' })));
    expect(button(view, 'Layout')).toBeTruthy();
    expect(button(view, 'What can I do here?')).toBeTruthy();
  });
});
