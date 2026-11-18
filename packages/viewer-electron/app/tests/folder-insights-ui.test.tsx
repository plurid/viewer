// @vitest-environment jsdom
/**
 * The insight strip in a files plane: its cards come from the listing, an action selects the
 * files it covers and runs the command a person would pick from the menu on them, and a dismissed
 * card stays hidden in its folder until Show hidden insights.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FileEntry, FolderPane, Pane } from '../src/domain/contracts';
import type { SettingsPatch, SettingsSnapshot } from '../src/domain/services';
import type {
  DefinitionCatalog,
  WorkspaceDefinition,
} from '../src/domain/workspaces/definitions/schema';
import { sampleDefinition } from './workspace-definition-fixtures';
import { offerFor } from '../src/renderer/workspace/workspace-offer';
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

function mount(paneID = activeWorkspace().panes[0]!.id) {
  const registry = new CommandRegistry();
  const workspace = new Proxy({}, { get: () => vi.fn() }) as WorkspaceController;
  const actions = {
    workspace,
    ready: true,
    tool: null,
    switchWorkspace: vi.fn(async () => {}),
  } as unknown as WindowActions;
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
      ...windowCommands(actions).filter(
        (command) =>
          ['find-duplicates', 'show-hidden-insights'].includes(command.id) ||
          command.id.startsWith('defined:') ||
          command.id.startsWith('workspace:'),
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
  return { view, registry, paneID, actions };
}
const strip = () => screen.getByRole('region', { name: 'Insights' });
const titles = () =>
  within(strip())
    .getAllByRole('article')
    .map((card) => card.querySelector('strong')!.textContent);
const selection = (paneID: string) => browseSession(paneID, downloads).selection;

it('enters a double-clicked folder without forwarding its activation to the space', async () => {
  const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
  const space = vi.fn();
  document.addEventListener('dblclick', space);
  try {
    const { view, paneID } = mount();
    const row = await waitFor(() => {
      const row = view.container.querySelector(
        '[data-file-path="' + downloads + '/Photos"] .filename',
      );
      expect(row).not.toBeNull();
      return row!;
    });
    const event = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
    fireEvent(row, event);
    expect(activeWorkspace().panes.find((pane) => pane.id === paneID)?.path).toBe(
      downloads + '/Photos',
    );
    expect(space).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  } finally {
    document.removeEventListener('dblclick', space);
    height.mockRestore();
    width.mockRestore();
  }
});

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

  it.each(['click', 'Enter'])('confirms exactly the selected installers with %s', async (input) => {
    const { paneID } = mount();
    await waitFor(() => expect(strip()).toBeTruthy());
    const card = within(strip()).getAllByRole('article')[0]!;
    fireEvent.click(within(card).getByRole('button', { name: 'Move to Trash…' }));
    expect(selection(paneID)).toEqual(installers.map((file) => file.path));
    const dialog = await screen.findByRole('dialog', { name: 'Move to Trash?' });
    expect(dialog.textContent).toContain('2 items');
    expect(operate).not.toHaveBeenCalled();
    const confirm = within(dialog).getByRole('button', { name: 'Move to Trash' });
    expect(document.activeElement).toBe(confirm);
    if (input === 'Enter') fireEvent.keyDown(confirm, { key: 'Enter', code: 'Enter' });
    else fireEvent.click(confirm);
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
    expect(await screen.findByRole('dialog', { name: 'New Folder with 5 Items' })).toBeTruthy();
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
    expect(command?.label).toBe('Show Hidden Insights');
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

describe('the workspace offer card', () => {
  const root = downloads;
  const remembered = (key: string, path: string, name: string): WorkspaceDefinition => {
    const base = sampleDefinition(key, { root: path, name });
    return { ...base, remembered: { at: now, basis: base.basis, planes: 5 } };
  };
  const definition = () => remembered('sample/inbox', root, 'inbox');
  const folderPane = (id: string, path: string): FolderPane => ({
    id,
    type: 'folder',
    path,
    mode: 'list',
    sort: 'name',
    descending: false,
    showHidden: false,
    history: [path],
    historyIndex: 0,
  });
  const catalogOf = (
    definitions: WorkspaceDefinition[],
    revision = 1,
    dismissedOffers?: string[],
  ): DefinitionCatalog => ({
    revision,
    file: { path: '/data/workspaces.jsonc', state: 'absent' },
    projectManager: {
      path: '/source/projects.json',
      state: 'off',
      enabled: false,
      projects: 0,
      missing: 0,
      disabled: 0,
      remote: 0,
      duplicateKeys: 0,
    },
    definitions,
    diagnostics: [],
    ...(dismissedOffers ? { dismissedOffers } : {}),
  });
  /**
   * The catalog holds the definitions; the workspace's planes are `before`, the plane the tests
   * mount, then `after`, which by default browses outside every root.
   */
  function offering(
    after: Pane[] = [folderPane('desktop', home + '/Desktop')],
    definitions = [definition()],
    before: Pane[] = [],
  ) {
    const state = getState();
    update({
      ...state,
      bootstrap: { ...state.bootstrap, definitions: catalogOf(definitions) },
      saved: {
        ...state.saved,
        workspaces: state.saved.workspaces.map((space) =>
          space.id === state.saved.activeWorkspace
            ? { ...space, panes: [...before, ...space.panes, ...after] }
            : space,
        ),
      },
    });
  }
  const mainPane = () =>
    activeWorkspace().panes.find((pane) => pane.type === 'folder' && pane.path === downloads)!.id;
  const offerCard = () =>
    strip().querySelector<HTMLElement>('[data-insight="workspace.open"]') ?? undefined;
  const elsewhere = [
    folderPane('desktop', home + '/Desktop'),
    folderPane('documents', home + '/Documents'),
    folderPane('music', home + '/Music'),
  ];

  it('leads the cards after the tips, within three, naming the root', async () => {
    savePatch({ ui: { ...getState().saved.ui, firstRunHint: { used: [] } } });
    offering();
    mount();
    await waitFor(() => expect(offerCard()).toBeTruthy());
    const cards = within(strip()).getAllByRole('article');
    expect(cards[0]!.getAttribute('aria-label')).toBe('Tips');
    expect(cards[1]).toBe(offerCard());
    expect(cards.slice(1).map((card) => card.querySelector('strong')!.textContent)).toEqual([
      '“inbox” remembers 5 planes',
      '2 installers older than a week',
      '1 archive already extracted',
    ]);
    // the root as a path label: home as ~, the whole path for the tooltip
    const label = offerCard()!.querySelector('.path-label')!;
    expect(label.getAttribute('title')).toBe(root);
    expect(label.querySelector('.path-label-text')!.textContent).toBe('~/Downloads');
  });

  it('opens the definition by its name without touching the selection', async () => {
    // a name ending in an ellipsis does not make the action read as one that asks first
    offering(undefined, [remembered('sample/inbox', root, 'inbox…')]);
    const workspaceDefinitions = vi.fn(async () => ({ kind: 'elsewhere' as const }));
    Object.assign(window.viewer, { workspaceDefinitions });
    const { paneID } = mount();
    await waitFor(() => expect(offerCard()).toBeTruthy());
    updateBrowseSession(paneID, downloads, { selection: [downloads + '/Scan.pdf'] });
    const action = within(offerCard()!).getByRole('button', { name: 'Open Workspace “inbox…”' });
    expect(action.textContent).toBe('Open Workspace');
    fireEvent.click(action);
    await waitFor(() =>
      expect(workspaceDefinitions).toHaveBeenCalledWith({ kind: 'open', key: 'sample/inbox' }),
    );
    expect(selection(paneID)).toEqual([downloads + '/Scan.pdf']);
  });

  it('is dismissed for its whole root in the private list until Show Hidden Insights', async () => {
    // the root holds the folder in view: the dismissal names the root, never the folder
    const outer = remembered('sample/home', home, 'home');
    offering([folderPane('apps', '/Applications'), folderPane('library', '/Library')], [outer]);
    const workspaceDefinitionFile = vi.fn(async (request: { kind: string }) =>
      request.kind === 'dismiss-offers' ? catalogOf([outer], 2, [home]) : catalogOf([outer], 3),
    );
    Object.assign(window.viewer, { workspaceDefinitionFile });
    const { registry } = mount();
    await waitFor(() => expect(offerCard()).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss “home” remembers 5 planes' }));
    await waitFor(() => expect(offerCard()).toBeUndefined());
    expect(workspaceDefinitionFile).toHaveBeenCalledWith({ kind: 'dismiss-offers', roots: [home] });
    // config.jsonc never holds it
    expect(getState().saved.ui.insightsDismissed ?? {}).toEqual({});
    // the folder's own cards fill the place
    expect(titles()).toEqual([
      '2 installers older than a week',
      '1 archive already extracted',
      '1 PDF over 10 MB',
    ]);
    const [show] = registry.list({ ids: ['show-hidden-insights'], scope: 'window' });
    expect(show).toBeTruthy();
    await act(async () => {
      await registry.run(show!);
    });
    expect(workspaceDefinitionFile).toHaveBeenCalledWith({ kind: 'show-offers' });
    expect(offerCard()).toBeTruthy();
  });

  it('shows in the first files plane the root holds, past other kinds of plane', async () => {
    // two planes of five inside the root, the first a terminal: the card goes to the files plane
    const terminal = { id: 'terminal', type: 'terminal', path: root } as Pane;
    offering(elsewhere, undefined, [terminal]);
    mount(mainPane());
    await waitFor(() => expect(offerCard()).toBeTruthy());
    cleanup();
    // a later files plane of the same root shows none
    offering([folderPane('photos', downloads + '/Photos'), ...elsewhere]);
    mount('photos');
    await waitFor(() => expect(strip()).toBeTruthy());
    expect(offerCard()).toBeUndefined();
  });

  it('with nested roots, shows the outer offer in a plane of the outer root’s own', async () => {
    // the plain inner root holds the first plane, which has nothing to offer
    const inner = sampleDefinition('sample/photos', {
      root: downloads + '/Photos',
      name: 'photos',
    });
    offering(elsewhere, [definition(), inner], [folderPane('photos', downloads + '/Photos')]);
    mount(mainPane());
    await waitFor(() => expect(offerCard()).toBeTruthy());
    expect(offerCard()!.textContent).toContain('“inbox” remembers 5 planes');
    cleanup();
    mount('photos');
    await waitFor(() => expect(strip()).toBeTruthy());
    expect(offerCard()).toBeUndefined();
  });

  it('counts a plane in a hidden inner definition’s folder as the outer root’s own', async () => {
    // search leaves out the hidden inner definition: its folder belongs to the outer workspace
    const inner = {
      ...sampleDefinition('sample/photos', { root: downloads + '/Photos', name: 'photos' }),
      hidden: true,
    };
    offering(elsewhere, [definition(), inner], [folderPane('photos', downloads + '/Photos')]);
    mount('photos');
    await waitFor(() => expect(offerCard()).toBeTruthy());
    expect(offerCard()!.textContent).toContain('“inbox” remembers 5 planes');
  });

  it('keeps the card when its dismissal could not be saved', async () => {
    offering();
    const workspaceDefinitionFile = vi.fn(async () => {
      throw new Error('Dismissed workspace offers could not be saved.');
    });
    Object.assign(window.viewer, { workspaceDefinitionFile });
    mount();
    await waitFor(() => expect(offerCard()).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss “inbox” remembers 5 planes' }));
    await waitFor(() =>
      expect(getState().notice).toBe('Dismissed workspace offers could not be saved.'),
    );
    expect(offerCard()).toBeTruthy();
  });

  it('stays away while insights are off and when the workspace is mostly in the root', async () => {
    offering([]);
    mount();
    await waitFor(() => expect(strip()).toBeTruthy());
    expect(offerCard()).toBeUndefined();
    cleanup();
    offering();
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
    await waitFor(() =>
      expect(view.container.querySelector('.folder-status')!.textContent).toContain(
        `${listing.length} items`,
      ),
    );
    expect(screen.queryByRole('region', { name: 'Insights' })).toBeNull();
  });

  it('offers nothing for a server location', () => {
    const current = { ...activeWorkspace(), panes: elsewhere };
    const dismissed: string[] = [];
    expect(offerFor(downloads, current, [current], [definition()], dismissed)).toBeTruthy();
    for (const folder of ['viewer-sftp://c1' + downloads, 'Users/a/Downloads'])
      expect(offerFor(folder, current, [current], [definition()], dismissed)).toBeUndefined();
    // a definition at the disk's root holds every local folder, never a server's
    const top = remembered('sample/top', '/', 'Macintosh HD');
    const empty = { ...activeWorkspace(), panes: [] };
    expect(offerFor('/Users/a/x', empty, [empty], [top], dismissed)?.root).toBe('/');
    expect(offerFor('viewer-sftp://c1/x', empty, [empty], [top], dismissed)).toBeUndefined();
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
