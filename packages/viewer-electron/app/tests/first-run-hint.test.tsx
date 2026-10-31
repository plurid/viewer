// @vitest-environment jsdom
/**
 * THE FIRST-RUN TIPS: one card above a new profile's first folder names Space, ⌘K and title
 * dragging. Each step leaves the card once used; with both used, or the card dismissed, it retires
 * for good. A profile made before it, the person's own included, never shows it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import type { UIPreferences } from '../src/domain/contracts';
import type { FirstRunHint } from '../src/domain/preferences/first-run';
import type { SettingsPatch, SettingsSnapshot } from '../src/domain/services';
import { defaultSettings } from '../src/domain/services';
import {
  firstRunHintAfter,
  firstRunStepsLeft,
  normalizeFirstRunHint,
} from '../src/domain/preferences/first-run';
import { normalizePreferences } from '../src/domain/preferences/ui';
import { preferencesSchema } from '../src/domain/preferences/presentation/ui-schema';
import { SettingsService } from '../src/desktop/preferences/settings';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import type { CommandContext } from '../src/renderer/commands/registry';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { CommandsContext } from '../src/renderer/commands/context';
import { CommandPalette } from '../src/renderer/commands/CommandPalette';
import type { LineHost } from '../src/renderer/command-line/host';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { WorkspaceContext } from '../src/renderer/workspace/context';
import { FolderInsights } from '../src/renderer/explorer/FolderInsights';
import {
  activeWorkspace,
  addPane,
  flushState,
  getState,
  initialize,
  quickPreview,
} from '../src/renderer/state/store';
import { savePatch, update } from '../src/renderer/state/core';
import { flushPreferences, resetPreferences } from '../src/renderer/state/preferences';

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
};

describe('the first-run hint', () => {
  it('drops each step once used and retires once both are, or stays as it is', () => {
    const fresh: FirstRunHint = { used: [] };
    expect(firstRunStepsLeft(fresh)).toEqual(['quick-preview', 'palette']);
    const previewed = firstRunHintAfter(fresh, 'quick-preview');
    expect(previewed).toEqual({ used: ['quick-preview'] });
    expect(firstRunStepsLeft(previewed)).toEqual(['palette']);
    // the same step again records nothing new
    expect(firstRunHintAfter(previewed, 'quick-preview')).toBe(previewed);
    expect(firstRunHintAfter(previewed, 'palette')).toBe('retired');
    expect(firstRunHintAfter('retired', 'palette')).toBe('retired');
    // no hint is never started
    expect(firstRunHintAfter(undefined, 'palette')).toBeUndefined();
    expect(firstRunStepsLeft(undefined)).toEqual([]);
    expect(firstRunStepsLeft('retired')).toEqual([]);
  });

  it('keeps a valid saved hint, reads both steps as retired and anything else as none', () => {
    expect(normalizeFirstRunHint({ used: ['palette', 'other'] })).toEqual({ used: ['palette'] });
    expect(normalizeFirstRunHint({ used: ['quick-preview', 'palette'] })).toBe('retired');
    expect(normalizeFirstRunHint('retired')).toBe('retired');
    for (const value of [undefined, 'shown', [], { used: 'palette' }])
      expect(normalizeFirstRunHint(value)).toBeUndefined();
    // the defaults never start one, so preferences normalized from nothing show no tips
    expect(normalizePreferences()).not.toHaveProperty('firstRunHint');
    expect(normalizePreferences({ firstRunHint: { used: [] } }).firstRunHint).toEqual({
      used: [],
    });
    const ui = normalizePreferences();
    for (const firstRunHint of ['retired', { used: [] }, { used: ['palette'] }])
      expect(preferencesSchema.safeParse({ ...ui, firstRunHint }).success).toBe(true);
    for (const firstRunHint of ['shown', { used: ['menu'] }, { used: [], seen: true }])
      expect(preferencesSchema.safeParse({ ...ui, firstRunHint }).success).toBe(false);
  });
});

describe('which profiles start the hint', () => {
  let root: string;
  beforeEach(async () => {
    root = await temporaryRoot('viewer-first-run-hint-');
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
  const file = () => path.join(root, 'config.jsonc');

  it('starts it in a new profile, explains it in config.jsonc and keeps what was used', async () => {
    const first = service();
    await first.load();
    expect(first.snapshot().ui.firstRunHint).toEqual({ used: [] });
    const text = await readFile(file(), 'utf8');
    expect(parse(text).ui.firstRunHint).toEqual({ used: [] });
    expect(text).toContain('App-managed: the tips a new profile shows above its first folder.');
    // the workspace window records each step
    await first.patch(
      [{ path: 'ui.firstRunHint', value: { used: ['palette'] } }],
      first.snapshot().revision,
      'workspace',
    );
    const later = service();
    await later.load();
    expect(later.snapshot().ui.firstRunHint).toEqual({ used: ['palette'] });
  });

  it('never starts it in a profile made before it', async () => {
    const ui = normalizePreferences();
    await writeFile(
      file(),
      '// mine\n' + JSON.stringify({ version: 1, settings: defaultSettings(root), ui }),
    );
    const existing = service();
    await existing.load();
    expect(existing.snapshot().ui).not.toHaveProperty('firstRunHint');
    expect(parse(await readFile(file(), 'utf8')).ui).not.toHaveProperty('firstRunHint');
  });

  it('never starts it in a profile of an earlier format', async () => {
    const ui = normalizePreferences();
    await writeFile(
      file(),
      JSON.stringify({ version: 1, settings: defaultSettings(root), ui: { ...ui, version: 3 } }),
    );
    const upgraded = service();
    await upgraded.load();
    expect(upgraded.snapshot().ui).not.toHaveProperty('firstRunHint');
  });

  it('never starts it for saved workspaces whose configuration is missing', async () => {
    const seeded = service();
    await seeded.load({ ui: normalizePreferences(), look: 'dark' });
    expect(seeded.snapshot().ui).not.toHaveProperty('firstRunHint');
  });

  it('never starts it while config.jsonc cannot be read', async () => {
    await writeFile(file(), '{ "version": 1, "settings": ');
    const broken = service();
    await broken.load();
    expect(broken.snapshot().ui).not.toHaveProperty('firstRunHint');
  });
});

describe('the tips above a folder', () => {
  const home = '/Users/a';
  const settingsPatch =
    vi.fn<(patches: SettingsPatch[], revision: number) => Promise<SettingsSnapshot>>();
  /** What the desktop answers: the patches applied to the snapshot it holds. */
  function acknowledgement(patches: SettingsPatch[]): SettingsSnapshot {
    const snapshot = structuredClone(getState().settings);
    snapshot.revision++;
    for (const patch of patches) {
      const keys = patch.path.split('.');
      let target = snapshot as unknown as Record<string, unknown>;
      for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
      target[keys.at(-1)!] = structuredClone(patch.value);
    }
    return snapshot;
  }
  /** This profile's interface preferences, as config.jsonc gave them. */
  function profile(ui: Partial<UIPreferences>) {
    const next = { ...getState().saved.ui, ...ui };
    savePatch({ ui: next });
    update({ ...getState(), settings: { ...getState().settings, ui: next } });
  }
  const registry = new CommandRegistry();
  const context = (): CommandContext => ({
    scope: 'window',
    workspaceID: activeWorkspace().id,
    paneID: getState().activePane,
    directory: home,
    selection: [],
    jobs: [],
    clipboard: null,
  });
  registry.register('window', { context, definitions: () => [] });
  const workspace = {} as WorkspaceController;
  const provide = (child: ReturnType<typeof createElement>) =>
    createElement(
      CommandsContext.Provider,
      { value: registry },
      createElement(WorkspaceContext.Provider, { value: workspace }, child),
    );
  function folder(paneID = activeWorkspace().panes[0]!.id) {
    return render(
      provide(createElement(FolderInsights, { paneID, folder: home, entries: [], select() {} })),
    );
  }
  function openPalette() {
    const host: LineHost = {
      registry,
      context,
      workspace,
      invoke: vi.fn(async () => true),
      newWorkspace: vi.fn(),
      switchWorkspace: vi.fn(),
      palette: vi.fn(),
    };
    return render(
      provide(
        createElement(CommandPalette, {
          mode: 'commands',
          onMode: vi.fn(),
          onClose: vi.fn(),
          line: { host, run: vi.fn() },
        }),
      ),
    );
  }
  const tips = () => screen.queryByRole('article', { name: 'Tips' });
  const written = () => settingsPatch.mock.calls.flatMap(([patches]) => patches);

  beforeEach(() => {
    settingsPatch.mockReset().mockImplementation(async (patches) => acknowledgement(patches));
    Object.assign(window, {
      viewer: {
        save: vi.fn(async () => {}),
        settingsPatch,
        list: vi.fn(async () => ({ entries: [] })),
        onEvent: () => () => {},
      },
    });
    initialize({ home, platform: 'darwin', state: null, locations: [], openPaths: [] });
  });
  afterEach(async () => {
    cleanup();
    document.body.replaceChildren();
    await flushPreferences();
    await flushState(false);
    resetPreferences();
  });

  it('shows in a new profile, with the keys the palette answers to', () => {
    profile({ firstRunHint: { used: [] } });
    folder();
    expect(tips()?.querySelector('ul')?.textContent).toBe(
      'Space previews the selected file⌘K finds any actionDrag a plane’s title to move it',
    );
    expect([...tips()!.querySelectorAll('kbd')].map((key) => key.textContent)).toEqual([
      'Space',
      '⌘K',
    ]);
  });

  it('follows the person’s own palette keys, and names dragging only while titles move planes', () => {
    profile({
      firstRunHint: { used: [] },
      space: { ...getState().saved.ui.space, dragging: false },
    });
    update({
      ...getState(),
      settings: {
        ...getState().settings,
        settings: { ...getState().settings.settings, shortcuts: { palette: 'Cmd+Shift+P' } },
      },
    });
    folder();
    expect([...tips()!.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      'Space previews the selected file',
      '⇧⌘P finds any action',
    ]);
  });

  it('shows once, in the workspace’s first folder plane', () => {
    profile({ firstRunHint: { used: [] } });
    act(() => {
      addPane(home + '/Documents', 'folder', true, { remember: false });
    });
    const [first, second] = activeWorkspace().panes;
    expect(second?.type).toBe('folder');
    folder(second!.id);
    expect(tips()).toBeNull();
    cleanup();
    folder(first!.id);
    expect(tips()).not.toBeNull();
  });

  it('retires for good once Quick preview and the palette have each been used', async () => {
    profile({ firstRunHint: { used: [] } });
    folder();
    act(() => quickPreview([home + '/Notes.txt']));
    expect([...tips()!.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      '⌘K finds any action',
      'Drag a plane’s title to move it',
    ]);
    act(() => quickPreview(null));
    await act(async () => flushPreferences());
    expect(written()).toEqual([{ path: 'ui.firstRunHint', value: { used: ['quick-preview'] } }]);

    openPalette();
    expect(getState().saved.ui.firstRunHint).toBe('retired');
    expect(tips()).toBeNull();
    await act(async () => flushPreferences());
    expect(written().at(-1)).toEqual({ path: 'ui.firstRunHint', value: 'retired' });
    // used again, nothing more is written
    const writes = settingsPatch.mock.calls.length;
    act(() => quickPreview([home + '/Notes.txt']));
    await act(async () => flushPreferences());
    expect(settingsPatch.mock.calls.length).toBe(writes);
  });

  it('retires for good when dismissed', async () => {
    profile({ firstRunHint: { used: ['palette'] } });
    folder();
    expect(tips()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss tips' }));
    expect(tips()).toBeNull();
    expect(getState().saved.ui.firstRunHint).toBe('retired');
    await act(async () => flushPreferences());
    expect(written()).toEqual([{ path: 'ui.firstRunHint', value: 'retired' }]);
  });

  it('never shows in a profile without one, and writes nothing when its steps are used', async () => {
    expect(getState().saved.ui).not.toHaveProperty('firstRunHint');
    const view = folder();
    expect(view.container.querySelector('.folder-insights')).toBeNull();
    act(() => quickPreview([home + '/Notes.txt']));
    openPalette();
    await act(async () => flushPreferences());
    expect(settingsPatch).not.toHaveBeenCalled();
    expect(getState().saved.ui).not.toHaveProperty('firstRunHint');
  });
});
