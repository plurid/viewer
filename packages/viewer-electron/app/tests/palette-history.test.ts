// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, useState } from 'react';
import type { SettingsPatch, SettingsSnapshot } from '../src/domain/services';
import { CommandPalette } from '../src/renderer/commands/CommandPalette';
import { CommandsContext } from '../src/renderer/commands/context';
import { CommandRegistry, type CommandContext } from '../src/renderer/commands/registry';
import type { PaletteMode } from '../src/renderer/commands/palette-modes';
import type { LineHost } from '../src/renderer/command-line/host';
import { WorkspaceContext, type WorkspaceController } from '../src/renderer/workspace/context';
import {
  activeWorkspace,
  flushState,
  getState,
  initialize,
  rememberCommand,
} from '../src/renderer/state/store';
import { replaceState, savePatch } from '../src/renderer/state/core';
import { flushPreferences, resetPreferences } from '../src/renderer/state/preferences';

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
};

const settingsPatch =
  vi.fn<(patches: SettingsPatch[], revision: number) => Promise<SettingsSnapshot>>();
const run = vi.fn();
const execute = vi.fn();
const prompt = vi.fn();

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

beforeEach(() => {
  run.mockClear();
  execute.mockClear();
  prompt.mockReset();
  settingsPatch.mockReset().mockImplementation(async (patches) => acknowledgement(patches));
  Object.assign(window, {
    viewer: {
      save: vi.fn(async () => {}),
      settingsPatch,
      list: vi.fn(async () => ({ entries: [] })),
      onEvent: () => () => {},
      providerPermissionGet: async () => ({
        providerID: 'fixture',
        kind: 'openai',
        endpoint: 'https://fixture.invalid/v1',
        level: 'names',
      }),
      promptLine: prompt,
      promptCancel: vi.fn(async () => {}),
    },
  });
  initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
afterEach(async () => {
  cleanup();
  await flushPreferences();
  await flushState(false);
  resetPreferences();
});

function histories(commands: string[] = [], lines: string[] = []) {
  const state = getState();
  savePatch({
    ui: { ...state.saved.ui, recentCommands: commands },
    lineHistory: lines,
    visits: { '/fixture/kept-place': { count: 3, last: 1 } },
  });
}

function mount(initial: PaletteMode = 'commands') {
  const registry = new CommandRegistry();
  const context = (): CommandContext => ({
    scope: 'window',
    workspaceID: activeWorkspace().id,
    paneID: activeWorkspace().panes[0]!.id,
    path: '/fixture',
    directory: '/fixture',
    selection: [],
    jobs: [],
    clipboard: null,
  });
  registry.register('window', {
    context,
    definitions: () => [
      {
        id: 'frame-all',
        label: 'Frame all planes',
        group: 'Space',
        when: () => true,
        run: execute,
      },
      { id: 'new-file', label: 'New file', group: 'Files', when: () => true, run: execute },
      {
        id: `workspace:${activeWorkspace().id}`,
        label: 'Workspace',
        group: 'Workspaces',
        when: () => true,
        run: execute,
      },
    ],
  });
  const host: LineHost = {
    registry,
    context,
    workspace: {} as WorkspaceController,
    invoke: vi.fn(async () => true),
    newWorkspace: vi.fn(),
    switchWorkspace: vi.fn(),
    palette: vi.fn(),
  };
  function Harness() {
    const [mode, setMode] = useState(initial);
    return createElement(CommandPalette, {
      mode,
      onMode: setMode,
      onClose: vi.fn(),
      line: { host, run },
    });
  }
  return render(
    createElement(
      CommandsContext.Provider,
      { value: registry },
      createElement(WorkspaceContext.Provider, { value: host.workspace }, createElement(Harness)),
    ),
  );
}

describe('palette recent history controls', () => {
  it('clears only recent commands, retaining the search, caret, focus and context through persistence', async () => {
    histories(['frame-all', 'new-file'], ['set grid!']);
    const workspaceID = activeWorkspace().id;
    mount();
    const field = screen.getByRole('combobox', { name: 'Search commands' }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'frame' } });
    field.setSelectionRange(1, 3);
    fireEvent.click(screen.getByRole('button', { name: 'Clear recent commands' }));
    expect(getState().saved.ui.recentCommands).toEqual([]);
    expect(getState().saved.lineHistory).toEqual(['set grid!']);
    expect(getState().saved.visits).toHaveProperty('/fixture/kept-place');
    expect(field.value).toBe('frame');
    expect([field.selectionStart, field.selectionEnd]).toEqual([1, 3]);
    expect(document.activeElement).toBe(field);
    expect(activeWorkspace().id).toBe(workspaceID);
    expect(screen.queryByRole('button', { name: 'Clear recent commands' })).toBeNull();
    await act(async () => flushPreferences());
    expect(settingsPatch).toHaveBeenCalledWith(
      [{ path: 'ui.recentCommands', value: [] }],
      expect.any(Number),
    );
    expect(field.value).toBe('frame');
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps a new recent command recorded while the clear acknowledgement is outstanding', async () => {
    histories(['frame-all']);
    let finish!: (snapshot: SettingsSnapshot) => void;
    let cleared!: SettingsSnapshot;
    settingsPatch.mockImplementationOnce((patches) => {
      cleared = acknowledgement(patches);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Clear recent commands' }));
    const flushing = flushPreferences();
    await waitFor(() => expect(settingsPatch).toHaveBeenCalledTimes(1));
    act(() => rememberCommand('new-file'));
    await act(async () => {
      finish(cleared);
      await flushing;
    });
    expect(getState().saved.ui.recentCommands).toEqual(['new-file']);
    expect(settingsPatch).toHaveBeenLastCalledWith(
      [{ path: 'ui.recentCommands', value: ['new-file'] }],
      expect.any(Number),
    );
  });

  it('clears command-line history while retaining a draft and making empty history navigation inert', () => {
    histories(['frame-all'], ['set grid!', 'frame-all']);
    mount('line');
    const field = screen.getByRole('combobox', { name: 'Command line' }) as HTMLInputElement;
    expect(field.placeholder).toBe('help');
    fireEvent.keyDown(field, { key: 'p', ctrlKey: true });
    expect(field.value).toBe('set grid!');
    fireEvent.change(field, { target: { value: 'set grid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear recent command lines' }));
    expect(getState().saved.lineHistory).toEqual([]);
    expect(getState().saved.ui.recentCommands).toEqual(['frame-all']);
    expect(field.value).toBe('set grid');
    expect(document.activeElement).toBe(field);
    fireEvent.keyDown(field, { key: 'p', ctrlKey: true });
    fireEvent.keyDown(field, { key: 'n', ctrlKey: true });
    expect(field.value).toBe('set grid');
    expect(screen.queryByRole('button', { name: 'Clear recent command lines' })).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('permits native keyboard activation of Clear recent without running the selected line', () => {
    histories([], ['frame-all']);
    mount('line');
    const field = screen.getByRole('combobox', { name: 'Command line' });
    const clear = screen.getByRole('button', { name: 'Clear recent command lines' });
    expect(fireEvent.keyDown(field, { key: 'Tab' })).toBe(true);
    clear.focus();
    expect(fireEvent.keyDown(clear, { key: 'Enter' })).toBe(true);
    expect(fireEvent.keyDown(clear, { key: ' ', code: 'Space' })).toBe(true);
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(clear);
    expect(getState().saved.lineHistory).toEqual([]);
    expect(document.activeElement).toBe(field);
  });

  it('hides empty-history controls and preserves workspace-picker scope when clearing commands', () => {
    mount('line');
    expect(screen.queryByRole('button', { name: /Clear recent/ })).toBeNull();
    cleanup();
    histories([`workspace:${activeWorkspace().id}`], ['frame-all']);
    mount('workspaces');
    const field = screen.getByRole('combobox', { name: 'Search workspaces' }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'Work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear recent commands' }));
    expect(screen.getByRole('combobox', { name: 'Search workspaces' })).toBe(field);
    expect(field.value).toBe('Work');
    expect(getState().saved.lineHistory).toEqual(['frame-all']);
  });

  it('keeps natural-language examples separate from its concise placeholder without inventing request history', async () => {
    histories(['frame-all'], ['set grid!']);
    const state = getState();
    replaceState({
      ...state,
      settings: {
        ...state.settings,
        settings: {
          ...state.settings.settings,
          providers: [
            {
              id: 'fixture',
              name: 'Fixture',
              kind: 'openai',
              endpoint: 'https://fixture.invalid/v1',
              model: 'fixture-model',
              allowContent: false,
            },
          ],
        },
      },
    });
    mount('prompt');
    const field = screen.getByRole('combobox', { name: 'Ask in words' }) as HTMLInputElement;
    expect(field.placeholder).toBe('Ask Viewer…');
    await screen.findByText('For example');
    expect(screen.queryByRole('button', { name: /Clear recent/ })).toBeNull();
    fireEvent.change(field, { target: { value: 'Keep this unsent request' } });
    expect(getState().saved.lineHistory).toEqual(['set grid!']);
    expect(prompt).not.toHaveBeenCalled();
  });
});
