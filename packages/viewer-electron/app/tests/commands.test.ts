import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry } from '../src/domain/contracts';
import {
  CommandRegistry,
  rankCommands,
  type CommandContext,
  type CommandDefinition,
  type ResolvedCommand,
} from '../src/renderer/commands/registry';
import { folderCommands, type FolderActions } from '../src/renderer/commands/folder';
import { contextMenuSections, type MenuSection } from '../src/renderer/commands/menu';
import { textEditFor } from '../src/renderer/commands/editing';
import { copyPathCommand } from '../src/renderer/commands/copy-path';
import { programCommands } from '../src/renderer/commands/programs';
import { planOrigin } from '../src/renderer/actions/commands';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import {
  activeWorkspace,
  flushState,
  getState,
  initialize,
  refreshClipboard,
  receiveSettings,
  rememberCommand,
} from '../src/renderer/state/store';

const file = (name: string, directory = false): FileEntry => ({
  path: `/fixtures/${name}`,
  parent: '/fixtures',
  name,
  directory,
  kind: directory ? 'directory' : 'file',
  extension: 'txt',
  size: 10,
  created: 0,
  modified: 0,
  hidden: false,
  mime: 'text/plain',
  identity: name,
});
const actions: FolderActions = {
  open: vi.fn(),
  dialog: vi.fn(),
  trash: vi.fn(),
  info: vi.fn(),
  openWith: vi.fn(),
  destination: vi.fn(),
  search: vi.fn(),
  path: vi.fn(),
  refresh: vi.fn(),
  selectAll: vi.fn(),
  invertSelection: vi.fn(),
};
const operate = vi.fn();
const save = vi.fn();
let context: CommandContext;
let registry: CommandRegistry;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('window', {
    dispatchEvent: vi.fn(),
    viewer: {
      save,
      operate,
      copyPaths: vi.fn(async () => {}),
      clipboardRead: vi.fn(async () => null),
    },
  });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
  const pane = activeWorkspace().panes[0];
  context = {
    scope: 'files',
    workspaceID: activeWorkspace().id,
    paneID: pane.id,
    folder: pane.type === 'folder' ? pane : undefined,
    directory: pane.path,
    path: pane.path,
    selection: [file('one.txt')],
    clipboard: null,
    jobs: [],
  };
  registry = new CommandRegistry((id, chosen) => rememberCommand(id, chosen.selection));
  registry.register(`folder:${pane.id}`, {
    context: () => context,
    definitions: () => folderCommands(actions),
    valid: (invocation, live) => invocation.path === live.path,
  });
});
afterEach(async () => {
  await flushState(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('contextual commands', () => {
  it('keeps a command an agent ran out of Recent commands (2026-10-20)', async () => {
    // An agent's commands ran through the person's path and were ranked first in the palette.
    const chosen = vi.fn();
    const own = new CommandRegistry(chosen);
    const run = vi.fn();
    own.register('window', {
      context: () => context,
      definitions: () => [{ id: 'probe', label: 'Probe', group: 'Test', when: () => true, run }],
    });
    expect(await own.invoke('probe', { remember: false })).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    expect(chosen).not.toHaveBeenCalled();
    await own.invoke('probe', {});
    // with its context, so the selection's kind learns what was chosen for it
    expect(chosen).toHaveBeenCalledWith(
      'probe',
      expect.objectContaining({ directory: '/fixtures' }),
    );
  });
  it('offers native actions through captured selection and hides them on other platforms', async () => {
    const definitions = folderCommands(actions);
    for (const id of ['tags', 'make-alias', 'native-quick-look', 'share']) {
      expect(definitions.find((command) => command.id === id)!.when(context)).toBe(true);
      expect(
        definitions.find((command) => command.id === id)!.when({ ...context, selection: [] }),
      ).toBe(false);
    }
    await registry.invoke('tags', { paneID: context.paneID });
    expect(actions.info).toHaveBeenCalledWith(
      expect.objectContaining({ selection: context.selection }),
    );
    initialize({ home: '/fixtures', platform: 'linux', state: null, locations: [], openPaths: [] });
    for (const id of ['tags', 'make-alias', 'native-quick-look', 'share'])
      expect(definitions.find((command) => command.id === id)!.when(context)).toBe(false);
  });
  it('offers converting image copies only to another format', () => {
    const definitions = folderCommands(actions);
    const image = (name: string): FileEntry => ({
      ...file(name),
      extension: name.slice(name.lastIndexOf('.') + 1),
    });
    const offered = (...names: string[]) =>
      ['convert-png', 'convert-jpeg', 'rotate-copy-left'].filter((id) =>
        definitions
          .find((command) => command.id === id)!
          .when({ ...context, selection: names.map(image) }),
      );
    expect(offered('Shot.png')).toEqual(['convert-jpeg', 'rotate-copy-left']);
    expect(offered('Photo.JPG', 'Scan.jpeg')).toEqual(['convert-png', 'rotate-copy-left']);
    // A mixed selection converts each other image; one already in the format gets a copy.
    expect(offered('Shot.png', 'Photo.jpg')).toEqual([
      'convert-png',
      'convert-jpeg',
      'rotate-copy-left',
    ]);
    expect(offered('Photo.heic')).toEqual(['convert-png', 'convert-jpeg', 'rotate-copy-left']);
  });
  const commandsIn = (sections: MenuSection[]): string[] =>
    sections.flatMap((section) =>
      section.entries.flatMap((entry) =>
        entry.kind === 'command' ? [entry.command.id] : commandsIn(entry.sections),
      ),
    );
  it('keeps recent shortcuts in their normal groups with independent row IDs', () => {
    const commands = registry.list({ paneID: context.paneID });
    const pinned = { ...commands[0], id: 'custom.fixture', group: 'Actions', primary: true };
    commands.push(pinned);
    const sections = contextMenuSections(commands, ['missing', 'rename', 'copy', 'info']);
    expect(sections[0].label).toBe('Recent');
    expect(commandsIn([sections[0]])).toEqual(['rename', 'copy']);
    expect(sections[1].label).toBe('Pinned');
    expect(commandsIn([sections[1]])).toEqual(['custom.fixture']);
    expect(commandsIn(sections.slice(1)).sort()).toEqual(
      commands.map((command) => command.id).sort(),
    );
    const rowIDs = (sections: MenuSection[]): string[] =>
      sections.flatMap((section) =>
        section.entries.flatMap((entry) => [
          entry.id,
          ...(entry.kind === 'submenu' ? rowIDs(entry.sections) : []),
        ]),
      );
    expect(new Set(rowIDs(sections)).size).toBe(rowIDs(sections).length);
    expect(commandsIn(sections).filter((id) => id === 'rename')).toHaveLength(2);
    const view = sections
      .flatMap((section) => section.entries)
      .find((entry) => entry.id === 'menu.View');
    expect(view?.kind).toBe('submenu');
    if (view?.kind === 'submenu') {
      expect(
        view.sections.flatMap((section) => section.entries).map((entry) => entry.id),
      ).toContain('menu.Columns');
      expect(
        view.sections.flatMap((section) => section.entries).map((entry) => entry.id),
      ).toContain('menu.Group by');
    }
    expect(rankCommands(commands, 'date created', [])[0].id).toBe('column.created');
  });
  it('keeps a scoped view picker immediate and background menus free of selected-file actions', () => {
    const scoped = registry.list({
      paneID: context.paneID,
      ids: ['view-list', 'view-grid', 'view-columns', 'view-gallery'],
    });
    const sections = contextMenuSections(scoped, [], true);
    expect(
      sections.flatMap((section) => section.entries).every((entry) => entry.kind === 'command'),
    ).toBe(true);
    expect(commandsIn(sections)).toEqual(scoped.map((command) => command.id));
    const columnPicker = registry.list({
      paneID: context.paneID,
      ids: ['column.modified', 'column.created', 'column.kind', 'column.size', 'wrap-file-names'],
    });
    expect(
      contextMenuSections(columnPicker, [], true)
        .flatMap((section) => section.entries)
        .every((entry) => entry.kind === 'command'),
    ).toBe(true);
    const background = registry.list({
      paneID: context.paneID,
      scope: 'folder',
      context: { selection: [] },
    });
    const ids = commandsIn(contextMenuSections(background, ['rename', 'copy']));
    expect(ids).not.toContain('rename');
    expect(ids).not.toContain('copy');
    expect(ids).toContain('new-folder');
  });
  it('finds a collection plane by its pane, as folder and preview planes are found', () => {
    const collection = { ...context, paneID: 'collection-pane' };
    const before = registry.scopedSnapshot('collection-pane');
    registry.register('collection:collection-pane', {
      context: () => collection,
      definitions: () => folderCommands(actions),
      valid: () => true,
    });
    expect(registry.context('collection-pane')).toBe(collection);
    expect(registry.scopedSnapshot('collection-pane')).toBeGreaterThan(before);
  });
  it('searches short aliases and label prefixes before loose matches', () => {
    const rows = registry.list({ paneID: context.paneID });
    expect(rankCommands(rows, 'rn', [])[0].id).toBe('rename');
    expect(rankCommands(rows, 'cp', [])[0].id).toBe('copy');
    expect(rankCommands(rows, 'nf', [])[0].id).toBe('new-folder');
    expect(rankCommands(rows, 're', [])[0].id).toBe('rename');
    expect(rankCommands(rows, 'zz', [])).toEqual([]);
  });
  it('drops commands that only scatter the letters of a word another command contains', () => {
    const row = (id: string, label: string, aliases: string[] = []) =>
      ({ id, label, aliases, group: 'Files' }) as unknown as ResolvedCommand;
    const rows = [
      row('convert', 'Convert images…'),
      row('invert', 'Invert selection'),
      row('chat', 'Chat about files', ['conversation']),
    ];
    expect(rankCommands(rows, 'convert', []).map((item) => item.id)).toEqual(['convert']);
    // with no command containing the word, approximate matches still help
    expect(rankCommands(rows, 'convrt', []).map((item) => item.id)).toContain('convert');
    // and several words still match across a label
    expect(
      rankCommands([row('copy-path', 'Copy full path')], 'copy path', []).map((item) => item.id),
    ).toEqual(['copy-path']);
  });
  it('places the last two applicable actions first without duplicates', () => {
    const rows = registry.list({ paneID: context.paneID });
    const ranked = rankCommands(rows, '', ['missing', 'rename', 'copy', 'info']);
    expect(ranked.slice(0, 2).map((item) => item.id)).toEqual(['rename', 'copy']);
    expect(ranked.filter((item) => item.id === 'rename')).toHaveLength(1);
    expect(rankCommands(rows, 'new', ['rename', 'copy'])[0].id).toBe('new-folder');
  });
  it('copies selected paths as text and falls back to the clicked folder without a selection', async () => {
    const paths = [file('first.txt'), file('folder with spaces', true)];
    const selected = registry
      .list({ paneID: context.paneID, context: { selection: paths } })
      .find((command) => command.id === 'copy-path')!;
    context = { ...context, selection: [file('other.txt')] };
    await registry.run(selected);
    expect(window.viewer.copyPaths).toHaveBeenLastCalledWith(paths.map((file) => file.path));
    const background = registry
      .list({ paneID: context.paneID, scope: 'folder', context: { selection: [] } })
      .find((command) => command.id === 'copy-path')!;
    await registry.run(background);
    expect(window.viewer.copyPaths).toHaveBeenLastCalledWith([context.directory]);
    expect(operate).not.toHaveBeenCalled();
  });
  it('copies preview and sidebar paths without treating an unrelated file selection as their target', async () => {
    await copyPathCommand.run({ ...context, scope: 'preview', path: '/fixtures/model.step' });
    expect(window.viewer.copyPaths).toHaveBeenLastCalledWith(['/fixtures/model.step']);
    await copyPathCommand.run({
      ...context,
      scope: 'sidebar',
      sidebar: { section: 'favorites', path: '/fixtures/project' },
    });
    expect(window.viewer.copyPaths).toHaveBeenLastCalledWith(['/fixtures/project']);
    expect(copyPathCommand.when({ ...context, scope: 'workspace' })).toBe(false);
  });
  it('binds a menu action to its clicked target, while the next invocation uses the next target', async () => {
    const first = registry
      .list({ paneID: context.paneID, context: { selection: [file('one.txt')] } })
      .find((item) => item.id === 'rename')!;
    context = { ...context, selection: [file('two.txt')] };
    await registry.run(first);
    expect(actions.dialog).toHaveBeenLastCalledWith(
      'rename',
      expect.objectContaining({ selection: [file('one.txt')] }),
    );
    await registry.invoke('rename', { paneID: context.paneID });
    expect(actions.dialog).toHaveBeenLastCalledWith(
      'rename',
      expect.objectContaining({ selection: [file('two.txt')] }),
    );
    expect(getState().saved.ui.recentCommands).toEqual(['rename']);
    expect(JSON.stringify(getState().saved.ui.recentCommands)).not.toContain('/fixtures');
  });
  it('omits unavailable and background file actions; directory quick preview is absent', () => {
    context = { ...context, selection: [file('folder', true)] };
    expect(
      registry.list({ paneID: context.paneID }).some((item) => item.id === 'quick-preview'),
    ).toBe(false);
    const background = registry.list({
      paneID: context.paneID,
      scope: 'folder',
      context: { selection: [] },
    });
    expect(
      background.some((item) => ['rename', 'trash', 'copy', 'quick-preview'].includes(item.id)),
    ).toBe(false);
    expect(background.some((item) => item.id === 'new-folder')).toBe(true);
    context = { ...context, selection: [file('one.txt'), file('two.txt')] };
    expect(registry.list({ paneID: context.paneID }).some((item) => item.id === 'rename')).toBe(
      false,
    );
  });
  it('rechecks availability and refuses stale folder or unregistered preview commands', async () => {
    const first = registry.list({ paneID: context.paneID }).find((item) => item.id === 'rename')!;
    context = { ...context, path: '/other' };
    expect(await registry.run(first)).toBe(false);
    expect(actions.dialog).not.toHaveBeenCalled();
    const run = vi.fn();
    let available = true;
    const definitions: CommandDefinition[] = [
      { id: 'preview.fit', label: 'Fit', group: 'Preview', when: () => available, run },
    ];
    const remove = registry.register('preview:test', {
      context: () => ({ ...context, paneID: 'test' }),
      definitions: () => definitions,
    });
    const fit = registry.list({ paneID: 'test' })[0];
    available = false;
    expect(await registry.run(fit)).toBe(false);
    available = true;
    remove();
    expect(await registry.run(fit)).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
  it('opens a Trash confirmation without invoking a destructive adapter', async () => {
    await registry.invoke('trash', { paneID: context.paneID });
    expect(actions.trash).toHaveBeenCalledWith(
      expect.objectContaining({ selection: [file('one.txt')] }),
    );
    expect(operate).not.toHaveBeenCalled();
  });
  it('does not paste an outdated file clipboard', async () => {
    context = { ...context, clipboard: { paths: ['/fixtures/source'], cut: true } };
    await registry.invoke('paste', { paneID: context.paneID });
    expect(operate).not.toHaveBeenCalled();
    await refreshClipboard();
    expect(getState().clipboard).toBeNull();
  });
  it('delegates native edit actions to text only while editing', () => {
    expect(textEditFor('copy', true)).toBe('copy');
    expect(textEditFor('undo-file', true)).toBe('undo');
    expect(textEditFor('select-all', true)).toBe('selectAll');
    expect(textEditFor('rename', true)).toBeUndefined();
    expect(textEditFor('copy', false)).toBeUndefined();
  });
  it('clears inaccessible clipboard items during background discovery without blocking navigation', async () => {
    vi.mocked(window.viewer.clipboardRead).mockResolvedValueOnce({
      paths: ['/fixtures/source'],
      cut: true,
    });
    await refreshClipboard();
    expect(getState().clipboard?.cut).toBe(true);
    vi.mocked(window.viewer.clipboardRead).mockRejectedValueOnce(new Error('Allow folder access.'));
    await expect(refreshClipboard(true)).resolves.toBeUndefined();
    expect(getState().clipboard).toBeNull();
    await registry.invoke('go-to', { paneID: context.paneID });
    expect(actions.dialog).toHaveBeenCalledWith(
      'go-to',
      expect.objectContaining({ directory: '/fixtures' }),
    );
  });
  it('reports a denied Paste and clears an earlier cut clipboard', async () => {
    vi.mocked(window.viewer.clipboardRead).mockResolvedValueOnce({
      paths: ['/fixtures/source'],
      cut: true,
    });
    await refreshClipboard();
    context = { ...context, clipboard: getState().clipboard };
    vi.mocked(window.viewer.clipboardRead).mockRejectedValueOnce(new Error('Allow folder access.'));
    await expect(registry.invoke('paste', { paneID: context.paneID })).rejects.toThrow(
      'Allow folder access.',
    );
    expect(getState().clipboard).toBeNull();
    expect(operate).not.toHaveBeenCalled();
  });
});

describe('custom actions that name a missing item (2026-10-20)', () => {
  it('says the recipe is missing instead of opening an empty Run action dialog', async () => {
    const settings = getState().settings;
    receiveSettings({
      ...settings,
      revision: settings.revision + 1,
      settings: {
        ...settings.settings,
        customActions: [
          {
            id: 'run-missing',
            name: 'Run missing',
            aliases: [],
            icon: 'command',
            shortcut: '',
            order: 0,
            pinned: false,
            when: { target: 'any', extensions: [], min: 0, max: 10000 },
            executor: { kind: 'recipe', recipeID: 'missing' },
          },
        ],
      },
    });
    const workspace = {} as WorkspaceController;
    const action = programCommands(workspace, async () => {}).find(
      (command) => command.id === 'custom.run-missing',
    )!;
    await expect(action.run(context)).rejects.toThrow('no longer exists');
    expect(window.dispatchEvent).not.toHaveBeenCalled();
  });
  it('says a built-in command it names is not available, instead of doing nothing', async () => {
    const settings = getState().settings;
    receiveSettings({
      ...settings,
      revision: settings.revision + 1,
      settings: {
        ...settings.settings,
        customActions: [
          {
            id: 'run-unknown',
            name: 'Run unknown',
            aliases: [],
            icon: 'command',
            shortcut: '',
            order: 0,
            pinned: false,
            when: { target: 'any', extensions: [], min: 0, max: 10000 },
            executor: { kind: 'builtin', command: 'no-such-command' },
          },
        ],
      },
    });
    const action = programCommands({} as WorkspaceController, async () => false).find(
      (command) => command.id === 'custom.run-unknown',
    )!;
    await expect(action.run(context)).rejects.toThrow('not a command available here');
  });
});

describe('where an action plan came from (2026-10-20)', () => {
  it('names a watch rule’s run as its own, not the person’s selection', () => {
    expect(planOrigin({ actor: 'user', workspaceID: 'watch-rule' })).toBe('Watch rule');
    expect(planOrigin({ actor: 'agent', workspaceID: 'workspace' })).toBe('Agent proposal');
    expect(planOrigin({ actor: 'user', workspaceID: 'workspace' })).toBe('Your selection');
  });
});
