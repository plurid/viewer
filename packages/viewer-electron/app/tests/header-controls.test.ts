// @vitest-environment jsdom
/**
 * THE PLANE HEADER'S CONTROLS: Essential for everyone, existing profiles included, once; Full one
 * choice away; every control its own key, which a profile or a workspace may override.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
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
import { usePreviewControlsSlot } from '../src/renderer/previews/controls';
import { RelatedPlanes } from '../src/renderer/workspace/RelatedPlanes';
import { changeWorkspace } from '../src/renderer/state/core';
import { initialize, updateFolderPresentation } from '../src/renderer/state/store';
import { setWorkspaceOverride } from '../src/renderer/state/workspaces';
import { choiceLabel } from './support/choice-button';

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
  const header = (registry = new CommandRegistry()) =>
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
          { value: registry },
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

  it('opens the seven View choices on the current mode with type-ahead and no search field', () => {
    Object.assign(window.viewer, { onEvent: () => () => {}, lens: async () => ({ lenses: [] }) });
    const modes = ['list', 'grid', 'columns', 'gallery', 'map', 'side-by-side', 'stacked'];
    initialize({
      home: '/fixtures',
      platform: 'darwin',
      state: null,
      locations: [],
      openPaths: [],
    });
    changeWorkspace((space) => ({
      ...space,
      panes: space.panes.map((pane) =>
        pane.type === 'folder' ? { ...pane, id: 'plane', mode: 'grid' } : pane,
      ),
    }));
    const registry = new CommandRegistry();
    registry.register('plane', {
      context: () => ({
        workspaceID: 'sample',
        paneID: 'plane',
        scope: 'folder',
        selection: [],
        jobs: [],
        clipboard: null,
      }),
      definitions: () =>
        modes.map((mode) => ({
          id: 'view-' + mode,
          label: mode,
          group: 'View',
          when: () => true,
          run: vi.fn(),
        })),
    });
    const view = header(registry);
    fireEvent.click(view.getByRole('button', { name: 'View mode' }));
    expect(view.queryByRole('textbox')).toBeNull();
    const list = view.getByRole('menu');
    const selected = () =>
      document.getElementById(list.getAttribute('aria-activedescendant') ?? '')?.textContent;
    expect(selected()).toContain('grid');
    fireEvent.keyDown(list, { key: 'm' });
    expect(selected()).toContain('map');
  });

  it('opens a searchable lens menu on the active lens and Enter keeps that lens', async () => {
    const lenses = Array.from({ length: 10 }, (_, i) => ({
      file: `lens-${i}.jsonc`,
      local: true,
      lens: { id: `lens-${i}`, name: `Lens ${i}` },
    }));
    Object.assign(window.viewer, { onEvent: () => () => {}, lens: async () => ({ lenses }) });
    initialize({
      home: '/fixtures',
      platform: 'darwin',
      state: null,
      locations: [],
      openPaths: [],
    });
    changeWorkspace((space) => ({
      ...space,
      panes: space.panes.map((pane) => ({ ...pane, id: 'plane' })),
    }));
    updateFolderPresentation('/fixtures', { group: 'lens', lens: 'lens-7' });
    const registry = new CommandRegistry();
    const choose = vi.fn();
    registry.register('plane', {
      context: () => ({
        workspaceID: 'sample',
        paneID: 'plane',
        scope: 'folder',
        selection: [],
        jobs: [],
        clipboard: null,
      }),
      definitions: () =>
        lenses.map(({ lens }) => ({
          id: 'group.lens.' + lens.id,
          label: lens.name,
          group: 'View',
          when: () => true,
          run: () => choose(lens.id),
        })),
    });
    const view = header(registry);
    fireEvent.click(await view.findByRole('button', { name: 'Lens: Lens 7' }));
    const search = view.getByRole('textbox', { name: 'Search Lenses' });
    const selected = document.getElementById(search.getAttribute('aria-activedescendant')!);
    expect(selected?.textContent).toBe('Lens 7');
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(choose).toHaveBeenCalledExactlyOnceWith('lens-7'));
  });

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
  it('shows "…" for what gave way though the person hid it, its room counted only then', async () => {
    act(() => changeWorkspace((space) => ({ ...space, profileID: 'full' })));
    act(() => setWorkspaceOverride('ui.space.headerControls.actions', false));
    // jsdom lays nothing out: a narrow header of 30 px controls
    const wide = (element: HTMLElement) => (element.hasAttribute('data-spilled') ? 0 : 30);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return wide(this);
    });
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return wide(this);
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.matches('.plane-controls') ? 200 : wide(this);
    });
    try {
      const view = header();
      await act(async () => {});
      expect(view.container.querySelector('[data-spilled]')).toBeTruthy();
      expect(button(view, 'Preview actions')?.getAttribute('data-header-menu')).toBe('spill');
    } finally {
      vi.restoreAllMocks();
    }
  });
  it('gives a format no header slot while its plane is pinned, so its tools stand in its content', () => {
    const header = (pinned: boolean) =>
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
            createElement(() => {
              const slot = usePreviewControlsSlot('plane');
              return createElement(
                'div',
                { 'data-slot': slot ? 'header' : 'content' },
                createElement(PlaneHeader, {
                  context: {
                    treePlane: {
                      routeDivisions: {
                        plane: { parameters: { id: 'plane' } },
                        path: { parameters: {} },
                      },
                      ...(pinned ? { pinned: { left: 0, top: 0, width: 400, height: 300 } } : {}),
                    },
                  } as unknown as PluridPlaneChromeContext,
                }),
              );
            }),
          ),
        ),
      );
    expect(header(false).container.querySelector('[data-slot]')!.getAttribute('data-slot')).toBe(
      'header',
    );
    cleanup();
    expect(header(true).container.querySelector('[data-slot]')!.getAttribute('data-slot')).toBe(
      'content',
    );
  });
  it('shows every control under the Full profile', () => {
    const view = header();
    act(() => changeWorkspace((space) => ({ ...space, profileID: 'full' })));
    expect(button(view, 'Layout')).toBeTruthy();
    expect(button(view, 'What can I do here?')).toBeTruthy();
  });
  it('keeps roots and branches navigable, and the parent-only child has one route back', () => {
    changeWorkspace((space) => ({
      ...space,
      panes: ['root', 'branch', 'leaf'].map((id) => ({
        id,
        type: 'preview',
        path: `/Jobs/${id}.pdf`,
      })),
    }));
    const parents: Record<string, string> = { branch: 'root', leaf: 'branch' };
    const workspace = {
      subscribeLinks: () => () => {},
      subtree: (id: string) =>
        id === 'root'
          ? ['root', 'branch', 'leaf']
          : id === 'branch'
            ? ['branch', 'leaf']
            : ['leaf'],
      parentPaneID: (id: string) => parents[id],
    } as unknown as WorkspaceController;
    const related = (id: string, parentShown: boolean) =>
      createElement(
        WorkspaceContext.Provider,
        { value: workspace },
        createElement(RelatedPlanes, { id, parentShown }),
      );
    const view = render(related('root', false));
    expect(view.getByRole('button', { name: choiceLabel('Related planes') }).textContent).toBe('1');
    view.rerender(related('branch', true));
    expect(view.getByRole('button', { name: choiceLabel('Related planes') }).textContent).toBe('2');
    view.rerender(related('leaf', true));
    expect(view.queryByRole('button', { name: choiceLabel('Related planes') })).toBeNull();
    view.rerender(related('leaf', false));
    expect(view.getByRole('button', { name: choiceLabel('Related planes') }).textContent).toBe('1');
  });
});
