// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CommandContext } from '../src/renderer/commands/registry';
import type { FileEntry, ViewerAPI } from '../src/domain/contracts';
import type { SettingsEditor } from '../src/renderer/ui/settings/editor';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { settingCatalog } from '../src/domain/preferences/catalog';
import { CommandPalette } from '../src/renderer/commands/CommandPalette';
import { CommandsContext } from '../src/renderer/commands/context';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { activeWorkspace, flushState, getState, initialize } from '../src/renderer/state/store';
import { flushPreferences, resetPreferences } from '../src/renderer/state/preferences';
import { CatalogSettings } from '../src/renderer/ui/settings/CatalogSettings';
import { WorkspaceContext } from '../src/renderer/workspace/context';

const directory = '/fixtures/Long job name with spaces and diacritics Șurub/drawings (final)';
const copyPaths = vi.fn<ViewerAPI['copyPaths']>(async () => {});
const chooseFolder = vi.fn<ViewerAPI['chooseFolder']>(async () => '/fixtures/Next job');
const openPath = vi.fn(async () => {});
const run = vi.fn(async () => {});
const onClose = vi.fn();
const files = ['Bracket.dxf', 'Plate.dxf'].map((name) => ({
  name,
  path: `${directory}/${name}`,
  directory: false,
  kind: 'file',
  extension: 'dxf',
})) as FileEntry[];

HTMLDialogElement.prototype.showModal ??= function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function () {
  this.removeAttribute('open');
};
Element.prototype.scrollIntoView ??= vi.fn();

beforeEach(() => {
  window.viewer = {
    copyPaths,
    chooseFolder,
    save: async () => {},
    settingsPatch: vi.fn(),
    list: async () => ({ path: directory, parent: '/fixtures', entries: files }),
    stat: async () => ({ identity: 'folder' }),
    watch: async () => {},
    unwatch: async () => {},
    onEvent: () => () => {},
  } as unknown as ViewerAPI;
  initialize({ home: directory, platform: 'darwin', state: null, locations: [], openPaths: [] });
});

afterEach(async () => {
  cleanup();
  await flushPreferences();
  await flushState(false);
  resetPreferences();
});

it.each(['commands', 'files'] as const)(
  'copies only the directory in the %s palette, keeping selection and keyboard navigation',
  async (mode) => {
    const context: CommandContext = {
      scope: 'folder',
      workspaceID: activeWorkspace().id,
      paneID: getState().activePane,
      directory,
      selection: files,
      jobs: [],
      clipboard: null,
    };
    const registry = new CommandRegistry();
    registry.register('window', {
      context: () => context,
      definitions: () =>
        ['Bracket', 'Plate'].map((name) => ({
          id: name,
          label: `Open ${name}`,
          group: 'Files' as const,
          when: () => true,
          run,
        })),
    });
    render(
      <WorkspaceContext.Provider value={{ openPath } as unknown as WorkspaceController}>
        <CommandsContext.Provider value={registry}>
          <CommandPalette mode={mode} onMode={vi.fn()} onClose={onClose} />
        </CommandsContext.Provider>
      </WorkspaceContext.Provider>,
    );
    const field = screen.getByRole('combobox');
    fireEvent.change(field, { target: { value: mode === 'commands' ? 'Open' : 'dxf' } });
    await waitFor(() => expect(document.querySelectorAll('.command-result')).toHaveLength(2));
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    const selected = field.getAttribute('aria-activedescendant');
    expect(screen.getByText('2 selected ·')).toBeTruthy();
    expect(screen.getByText(directory).title).toBe(directory);
    const copy = screen.getByRole('button', { name: 'Copy path' });
    copy.focus();
    await act(async () => fireEvent.click(copy));
    expect(copyPaths).toHaveBeenCalledWith([directory]);
    expect(onClose).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(openPath).not.toHaveBeenCalled();
    expect(field.getAttribute('aria-activedescendant')).toBe(selected);
    field.focus();
    fireEvent.keyDown(field, { key: 'ArrowUp' });
    expect(field.getAttribute('aria-activedescendant')).not.toBe(selected);
    expect(document.activeElement).toBe(field);
  },
);

it.each([
  ['newPlaneLocation', 'newPlanePath'],
  ['emptyWorkspaceLocation', 'emptyWorkspacePath'],
] as const)(
  'copies the %s custom folder without editing the preference',
  async (location, field) => {
    const snapshot = getState().settings;
    snapshot.settings.browsing[location] = 'custom';
    snapshot.settings.browsing[field] = directory;
    const editor: SettingsEditor = {
      snapshot,
      patch: vi.fn(),
      patches: vi.fn(),
      save: vi.fn(),
      error: vi.fn(),
    };
    render(
      <CatalogSettings
        editor={editor}
        definitions={settingCatalog.filter((item) => item.path === `settings.browsing.${location}`)}
        query=""
      />,
    );
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy path' })));
    expect(copyPaths).toHaveBeenCalledWith([directory]);
    expect(editor.patch).not.toHaveBeenCalled();
    expect(editor.patches).not.toHaveBeenCalled();
    expect(chooseFolder).not.toHaveBeenCalled();
    expect(snapshot.settings.browsing[field]).toBe(directory);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Change folder…' })));
    expect(editor.patches).toHaveBeenCalledWith([
      { path: `settings.browsing.${field}`, value: '/fixtures/Next job' },
      { path: `settings.browsing.${location}`, value: 'custom' },
    ]);
  },
);
