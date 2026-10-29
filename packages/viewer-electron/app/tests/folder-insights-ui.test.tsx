// @vitest-environment jsdom
/**
 * The insight strip in a folder plane: its cards come from the listing, an action selects the
 * files it covers and runs the command a person would pick from the menu on them, and a dismissed
 * card stays hidden in its folder until Show hidden insights.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FileEntry } from '../src/domain/contracts';
import type { SettingsPatch, SettingsSnapshot } from '../src/domain/services';
import { FolderExplorer } from '../src/renderer/explorer/FolderExplorer';
import { CommandsContext } from '../src/renderer/commands/context';
import { CommandRegistry, type CommandContext } from '../src/renderer/commands/registry';
import { programCommands } from '../src/renderer/commands/programs';
import { windowCommands, type WindowActions } from '../src/renderer/commands/window';
import { WorkspaceContext, type WorkspaceController } from '../src/renderer/workspace/context';
import { onWindowEvent } from '../src/renderer/app/window-events';
import { activeWorkspace, flushState, getState, initialize } from '../src/renderer/state/store';
import { savePatch, update } from '../src/renderer/state/core';
import { flushPreferences, resetPreferences } from '../src/renderer/state/preferences';
import { browseSession, updateBrowseSession } from '../src/renderer/workspace/sessions';
import { refreshFolder } from '../src/renderer/explorer/useFolder';

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
};
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const now = Date.now();
const day = 24 * 60 * 60 * 1000;
const home = '/Users/a';
const downloads = home + '/Downloads';
const entry = (name: string, extra: Partial<FileEntry> = {}): FileEntry => ({
  path: downloads + '/' + name,
  parent: downloads,
  name,
  extension: name.includes('.') ? name.split('.').pop()!.toLowerCase() : '',
  kind: 'file',
  directory: false,
  size: 1000,
  modified: now - day,
  created: now - day,
  hidden: false,
  mime: name.endsWith('.png') ? 'image/png' : name.endsWith('.heic') ? 'image/heic' : '',
  identity: name,
  ...extra,
});
const installers = [
  entry('Setup.dmg', { modified: now - 30 * day }),
  entry('Driver.pkg', { modified: now - 9 * day }),
];
const listing = [
  ...installers,
  entry('Fresh.dmg'),
  entry('Photos.zip'),
  entry('Photos', { kind: 'directory', directory: true }),
  entry('Scan.pdf', { size: 20 * 1024 * 1024 }),
  entry('Report copy.pdf'),
  entry('Report (1).pdf'),
  ...Array.from({ length: 5 }, (_, index) => entry(`Screenshot ${index}.png`)),
  ...['IMG_1.heic', 'IMG_2.heic', 'IMG_3.heic'].map((name) => entry(name)),
];

const operate = vi.fn(async () => 'job');
const optimizeFiles = vi.fn();
const settingsPatch =
  vi.fn<(patches: SettingsPatch[], revision: number) => Promise<SettingsSnapshot>>();
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
  operate.mockClear();
  optimizeFiles.mockClear();
  settingsPatch.mockReset().mockImplementation(async (patches) => acknowledgement(patches));
  const viewer: Record<string, unknown> = {
    list: vi.fn(async () => ({ path: downloads, parent: home, entries: listing })),
    stat: vi.fn(async () => ({ identity: downloads })),
    onEvent: () => () => {},
    operate,
    settingsPatch,
  };
  // what the plane asks for in passing (watching, lenses, context) answers with nothing
  window.viewer = new Proxy(viewer, {
    get: (target, key: string) => target[key] ?? (async () => undefined),
  }) as unknown as typeof window.viewer;
  initialize({ home, platform: 'darwin', state: null, locations: [], openPaths: [] });
  place(downloads);
});
/** The plane shows this folder, as a list. */
function place(path: string) {
  const [pane] = activeWorkspace().panes;
  update({
    ...getState(),
    saved: {
      ...getState().saved,
      workspaces: getState().saved.workspaces.map((space) => ({
        ...space,
        panes: space.panes.map((item) =>
          item.id === pane!.id && item.type === 'folder'
            ? { ...item, path, mode: 'list' as const }
            : item,
        ),
      })),
    },
  });
}
afterEach(async () => {
  cleanup();
  await flushPreferences();
  await flushState(false);
  resetPreferences();
});

function mount() {
  const paneID = activeWorkspace().panes[0]!.id;
  const registry = new CommandRegistry();
  const workspace = new Proxy({}, { get: () => vi.fn() }) as WorkspaceController;
  const actions = { workspace, ready: true, tool: null } as unknown as WindowActions;
  const context = (): CommandContext => ({
    scope: 'window',
    workspaceID: activeWorkspace().id,
    paneID: getState().activePane,
    selection: [],
    clipboard: null,
    jobs: [],
  });
  registry.register('window', {
    context,
    definitions: () => [
      ...programCommands(workspace, async () => false, undefined, undefined, undefined, {
        optimizeFiles,
      }).filter((command) => command.id === 'optimize-files'),
      ...windowCommands(actions).filter((command) =>
        ['find-duplicates', 'show-hidden-insights'].includes(command.id),
      ),
    ],
  });
  const view = render(
    <CommandsContext.Provider value={registry}>
      <WorkspaceContext.Provider value={workspace}>
        <FolderExplorer id={paneID} />
      </WorkspaceContext.Provider>
    </CommandsContext.Provider>,
  );
  return { view, registry, paneID };
}
const strip = () => screen.getByRole('region', { name: 'Insights' });
const titles = () =>
  within(strip())
    .getAllByRole('article')
    .map((card) => card.querySelector('strong')!.textContent);
const selection = (paneID: string) => browseSession(paneID, downloads).selection;

describe('the insight strip', () => {
  it('shows three cards from the listing, strongest first, above the files', async () => {
    const { view } = mount();
    await waitFor(() => expect(strip()).toBeTruthy());
    expect(titles()).toEqual([
      '2 installers older than a week',
      '1 archive already extracted',
      '1 PDF over 10 MB',
    ]);
    const explorer = view.container.querySelector('.folder-explorer')!;
    expect(strip().nextElementSibling).toBe(explorer.querySelector('.folder-content'));
  });

  it('waits for the listing, stays through a reload and steps aside for a search', async () => {
    // a folder no earlier test listed, so its listing is not at hand yet
    const pictures = home + '/Pictures';
    const shots = Array.from({ length: 5 }, (_, index) => ({
      ...entry(`Screenshot ${index}.png`),
      path: `${pictures}/Screenshot ${index}.png`,
      parent: pictures,
    }));
    place(pictures);
    let finish!: () => void;
    const list = window.viewer.list as unknown as ReturnType<typeof vi.fn>;
    list.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ path: pictures, parent: home, entries: shots });
        }),
    );
    const { paneID } = mount();
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'Insights' })).toBeNull();
    await act(async () => finish());
    expect(strip()).toBeTruthy();
    expect(titles()).toEqual(['5 screenshots']);
    const card = strip().firstElementChild;
    act(() => refreshFolder(pictures));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(strip().firstElementChild).toBe(card);
    await act(async () => finish());
    expect(strip().firstElementChild).toBe(card);
    act(() => updateBrowseSession(paneID, pictures, { searchOpen: true, query: 'scan' }));
    expect(screen.queryByRole('region', { name: 'Insights' })).toBeNull();
    act(() => updateBrowseSession(paneID, pictures, { searchOpen: false, query: '' }));
    expect(strip()).toBeTruthy();
  });

  it('selects the installers and asks before moving exactly them to the Trash', async () => {
    const { paneID } = mount();
    await waitFor(() => expect(strip()).toBeTruthy());
    const card = within(strip()).getAllByRole('article')[0]!;
    fireEvent.click(within(card).getByRole('button', { name: 'Move to Trash…' }));
    expect(selection(paneID)).toEqual(installers.map((file) => file.path));
    const dialog = await screen.findByRole('dialog', { name: 'Move to Trash?' });
    expect(dialog.textContent).toContain('2 items');
    expect(operate).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move to Trash' }));
    await waitFor(() => expect(operate).toHaveBeenCalledOnce());
    expect(operate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'trash',
        sources: installers.map((file) => file.path),
      }),
    );
  });

  it('offers each command only where it applies, and runs it on the insight’s files', async () => {
    savePatch({
      ui: {
        ...getState().saved.ui,
        insightsDismissed: { [downloads]: ['downloads.installers', 'archives.extracted'] },
      },
    });
    const { paneID } = mount();
    await waitFor(() => expect(strip()).toBeTruthy());
    expect(titles()).toEqual(['1 PDF over 10 MB', '2 files named as copies', '5 screenshots']);
    fireEvent.click(screen.getByRole('button', { name: 'Optimize…' }));
    await waitFor(() => expect(optimizeFiles).toHaveBeenCalledOnce());
    expect(optimizeFiles.mock.calls[0]![0].map((file: FileEntry) => file.path)).toEqual([
      downloads + '/Scan.pdf',
    ]);
    expect(selection(paneID)).toEqual([downloads + '/Scan.pdf']);
    // Find duplicates looks at the whole folder, with nothing selected
    const requested: string[][] = [];
    const stop = onWindowEvent('viewer:duplicates', (paths) => requested.push(paths));
    fireEvent.click(screen.getByRole('button', { name: 'Find duplicates…' }));
    await waitFor(() => expect(requested).toEqual([[downloads]]));
    stop();
    expect(selection(paneID)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Put in a folder…' }));
    expect(selection(paneID)).toHaveLength(5);
    expect(await screen.findByRole('dialog', { name: 'New folder with 5 items' })).toBeTruthy();
  });

  it('keeps a dismissed card hidden in its folder until Show hidden insights', async () => {
    const { registry } = mount();
    await waitFor(() => expect(strip()).toBeTruthy());
    const show = () => registry.list({ ids: ['show-hidden-insights'], scope: 'window' });
    expect(show()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss 2 installers older than a week' }));
    expect(titles()).toEqual([
      '1 archive already extracted',
      '1 PDF over 10 MB',
      '2 files named as copies',
    ]);
    expect(getState().saved.ui.insightsDismissed).toEqual({
      [downloads]: ['downloads.installers'],
    });
    await act(async () => flushPreferences());
    expect(settingsPatch).toHaveBeenCalledWith(
      [{ path: 'ui.insightsDismissed', value: { [downloads]: ['downloads.installers'] } }],
      expect.any(Number),
    );
    const [command] = show();
    expect(command?.label).toBe('Show hidden insights');
    await act(async () => {
      await registry.run(command!);
    });
    expect(titles()[0]).toBe('2 installers older than a week');
    expect(getState().saved.ui.insightsDismissed).toEqual({});
  });

  it('stays away when insights are off', async () => {
    const { settings } = getState();
    update({
      ...getState(),
      settings: {
        ...settings,
        settings: {
          ...settings.settings,
          browsing: { ...settings.settings.browsing, insights: false },
        },
      },
    });
    const { view } = mount();
    // listed: the status line counts the items
    await waitFor(() =>
      expect(view.container.querySelector('.folder-status')!.textContent).toContain(
        `${listing.length} items`,
      ),
    );
    expect(screen.queryByRole('region', { name: 'Insights' })).toBeNull();
  });
});

describe('model suggestions in a folder', () => {
  it('asks the model once the person stays in the folder, with its name and kinds', async () => {
    const modelSuggestions = vi.fn(async () => ({ provider: 'Test model', picks: {} }));
    Object.assign(window.viewer, { modelSuggestions });
    const { settings } = getState();
    update({
      ...getState(),
      settings: {
        ...settings,
        settings: {
          ...settings.settings,
          providers: [
            {
              id: 'p',
              name: 'Test model',
              kind: 'openai',
              endpoint: 'https://example.invalid/v1',
              model: 'test',
              allowContent: false,
            },
          ],
          browsing: { ...settings.settings.browsing, modelSuggestions: true },
        },
      },
    });
    const { view } = mount();
    await waitFor(() =>
      expect(view.container.querySelector('.folder-status')!.textContent).toContain(
        `${listing.length} items`,
      ),
    );
    expect(modelSuggestions).not.toHaveBeenCalled();
    await waitFor(() => expect(modelSuggestions).toHaveBeenCalledOnce(), { timeout: 3000 });
    const [request] = modelSuggestions.mock.calls[0] as unknown as [
      { folder: string; kinds: { kind: string; commands: { id: string }[] }[] },
    ];
    expect(request.folder).toBe('Downloads');
    // file actions only: no Trash, renaming, navigation or open-ended request
    expect(
      request.kinds.find((kind) => kind.kind === 'pdf')?.commands.map((item) => item.id),
    ).toEqual([
      'optimize-files',
      'find-duplicates',
      'compress',
      'recipe.batch-rename',
      'recipe.book-name',
      'recipe.rename',
      'recipe.organize',
      'recipe.summarize',
    ]);
  });
});
