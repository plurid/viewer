import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizePreferences } from '../src/domain/preferences/ui';
import { defaultSettings } from '../src/domain/services';
import {
  resolveFolderPresentation,
  browserColumnWidth,
} from '../src/domain/preferences/folder-presentation';
import { nativeOpening } from '../src/renderer/explorer/opening';
import { keyCommand, routeExplorerInput } from '../src/renderer/explorer/input';
import { browseSession, clearSessions, remapSessions } from '../src/renderer/workspace/sessions';
import { settingsSchema } from '../src/desktop/preferences/settings';
import {
  activeWorkspace,
  addRootFolder,
  addTerminalPane,
  applyFolderAsDefaults,
  folderPresentation,
  flushState,
  getState,
  initialize,
  navigate,
  receiveFileChanges,
  receiveSettings,
  updateFolderPresentation,
  updatePane,
} from '../src/renderer/state/store';
import type { FileEntry } from '../src/domain/contracts';
import type { SettingsPatch } from '../src/domain/services';
import { columnCommands } from '../src/renderer/commands/columns';
import type { CommandContext } from '../src/renderer/commands/registry';
import { folderCommands, type FolderActions } from '../src/renderer/commands/folder';

function columnContext(): CommandContext {
  const root = activeWorkspace().panes[0]!;
  updatePane(root.id, { mode: 'columns' });
  return {
    scope: 'folder',
    workspaceID: activeWorkspace().id,
    paneID: root.id,
    folder: activeWorkspace().panes[0],
    directory: '/fixtures/Invoices',
    path: root.path,
    selection: [],
    clipboard: null,
    jobs: [],
  } as CommandContext;
}
const folderActions = {
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
} satisfies FolderActions;

beforeEach(() => {
  vi.useFakeTimers();
  clearSessions();
  vi.stubGlobal('window', {
    dispatchEvent: vi.fn(),
    viewer: {
      save: vi.fn(),
      settingsPatch: vi.fn(async (patches: SettingsPatch[]) => {
        const snapshot = structuredClone(getState().settings);
        snapshot.revision++;
        for (const patch of patches) {
          const keys = patch.keys || patch.path.split('.');
          let object = snapshot as unknown as Record<string, unknown>;
          for (const key of keys.slice(0, -1)) {
            object[key] ??= {};
            object = object[key] as Record<string, unknown>;
          }
          if (patch.value === null) delete object[keys.at(-1)!];
          else object[keys.at(-1)!] = patch.value;
        }
        return snapshot;
      }),
    },
  });
  vi.stubGlobal('Element', class {});
  vi.stubGlobal(
    'HTMLElement',
    class {
      closest() {
        return null;
      }
    },
  );
  vi.stubGlobal('document', { querySelector: () => null });
  initialize({ home: '/fixtures', platform: 'darwin', locations: [], state: null, openPaths: [] });
});
afterEach(async () => {
  await flushState(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearSessions();
});

describe('folder appearance and independent explorer sessions', () => {
  it('sorts and reverses the child column from its own live preferences', () => {
    const context = columnContext();
    updateFolderPresentation('/fixtures', { sort: 'size', descending: false });
    updateFolderPresentation(context.directory!, { sort: 'modified', descending: false });
    const sort = columnCommands().find((command) => command.id === 'sort.modified')!;
    expect(typeof sort.label === 'function' && sort.label(context)).toBe(
      'Sort by date modified, descending',
    );
    sort.run(context);
    expect(folderPresentation(context.directory!)).toMatchObject({
      sort: 'modified',
      descending: true,
    });
    expect(folderPresentation('/fixtures')).toMatchObject({ sort: 'size', descending: false });
    sort.run(context);
    expect(folderPresentation(context.directory!).descending).toBe(false);
  });
  it('toggles hidden files in the child without changing its ancestor', () => {
    const context = columnContext();
    updateFolderPresentation('/fixtures', { showHidden: true });
    const hidden = folderCommands(folderActions).find((command) => command.id === 'hidden')!;
    expect(typeof hidden.label === 'function' && hidden.label(context)).toBe('Show hidden files');
    hidden.run(context);
    expect(folderPresentation(context.directory!).showHidden).toBe(true);
    hidden.run(context);
    expect(folderPresentation(context.directory!).showHidden).toBe(false);
    expect(folderPresentation('/fixtures').showHidden).toBe(true);
  });
  it('resets only the child folder view and exports its displayed Columns settings as defaults', () => {
    const context = columnContext();
    updateFolderPresentation(context.directory!, {
      mode: 'grid',
      sort: 'modified',
      descending: true,
      group: 'kind',
      columnWidth: 610,
    });
    columnCommands()
      .find((command) => command.id === 'folder-view-defaults')!
      .run(context);
    const defaults = vi
      .mocked(window.viewer.settingsPatch)
      .mock.calls.flatMap(([patches]) => patches)
      .findLast((patch) => patch.path === 'settings.browsing')?.value;
    expect(defaults).toMatchObject({
      mode: 'columns',
      sort: 'modified',
      descending: true,
      group: 'kind',
      columnWidth: 610,
    });
    columnCommands()
      .find((command) => command.id === 'reset-folder-view')!
      .run(context);
    expect(getState().settings.settings.folders[context.directory!]).toBeUndefined();
    expect(folderPresentation('/fixtures').mode).toBe('columns');
  });
  it('changes view and goes to the parent of the browsed column, preserving the ancestor session', () => {
    const context = columnContext();
    const before = browseSession(context.paneID!, '/fixtures');
    folderCommands(folderActions)
      .find((command) => command.id === 'view-grid')!
      .run(context);
    expect(activeWorkspace().panes[0]).toMatchObject({ path: context.directory, mode: 'grid' });
    expect(folderPresentation('/fixtures').mode).toBe('columns');
    expect(browseSession(context.paneID!, '/fixtures')).toBe(before);
    navigate(context.paneID!, '/fixtures');
    const nested = { ...context, directory: '/fixtures/Invoices/2026' };
    folderCommands(folderActions)
      .find((command) => command.id === 'parent')!
      .run(nested);
    expect(activeWorkspace().panes[0]?.path).toBe('/fixtures/Invoices');
  });
  it('groups the browsed child column and shares its view without changing its ancestor', () => {
    const root = activeWorkspace().panes[0]!;
    updatePane(root.id, { mode: 'columns' });
    const folder = activeWorkspace().panes[0]!;
    const child = '/fixtures/Invoices';
    const context = {
      scope: 'folder',
      workspaceID: activeWorkspace().id,
      paneID: root.id,
      folder,
      directory: child,
      path: root.path,
      selection: [],
      clipboard: null,
      jobs: [],
    } as CommandContext;
    const group = (id: string) =>
      columnCommands()
        .find((command) => command.id === id)!
        .run(context);
    group('group.kind');
    expect(folderPresentation(child).group).toBe('kind');
    expect(folderPresentation(root.path).group).toBe('none');
    expect(addRootFolder({ path: child })).toMatchObject({ path: child });
    expect(folderPresentation(child).group).toBe('kind');
    group('group.modified');
    expect(folderPresentation(child).group).toBe('modified');
    group('group.none');
    expect(folderPresentation(child).group).toBe('none');
  });
  it('makes a Map or lens-grouped folder the default view without its per-folder choices', () => {
    const defaults = structuredClone(getState().settings.settings.browsing);
    updateFolderPresentation('/fixtures', {
      mode: 'map',
      group: 'lens',
      lens: crypto.randomUUID(),
      sort: 'size',
    });
    applyFolderAsDefaults('/fixtures');
    const browsing = vi
      .mocked(window.viewer.settingsPatch)
      .mock.calls.flatMap(([patches]) => patches)
      .findLast((patch) => patch.path === 'settings.browsing')?.value;
    expect(browsing).toMatchObject({ mode: defaults.mode, group: defaults.group, sort: 'size' });
    // The desktop validates it as it does every settings write; Map and lens were rejected.
    expect(
      settingsSchema.safeParse({ ...getState().settings.settings, browsing }).error?.issues,
    ).toBeUndefined();
  });
  it('creates a root in a terminal’s working folder and respects the configured new-plane location', () => {
    const terminal = addTerminalPane('/fixtures/Downloads', 'login', false);
    expect(addRootFolder({ paneID: terminal.id })?.path).toBe('/fixtures/Downloads');
    const incoming = structuredClone(getState().settings);
    incoming.settings.browsing.newPlaneLocation = 'desktop';
    receiveSettings(incoming);
    expect(addRootFolder({ paneID: terminal.id })?.path).toBe('/fixtures/Desktop');
  });
  it('returns to each folder view and shares widths/views across roots while keeping selection local', async () => {
    const root = activeWorkspace().panes[0];
    navigate(root.id, '/fixtures/Downloads');
    updatePane(root.id, { mode: 'list' });
    updateFolderPresentation('/fixtures/Downloads', {
      columnWidth: 610,
      list: { widths: { name: 700 }, visible: { kind: false } },
    });
    const first = browseSession(root.id, '/fixtures/Downloads');
    first.selection = ['/fixtures/Downloads/One.txt'];
    first.scroll = { list: 230 };
    navigate(root.id, '/fixtures/Documents');
    updatePane(root.id, { mode: 'columns' });
    browseSession(root.id, '/fixtures/Documents').selection = ['/fixtures/Documents/Two.txt'];
    navigate(root.id, '/fixtures/Downloads');
    expect(activeWorkspace().panes[0]).toMatchObject({ mode: 'list' });
    expect(browseSession(root.id, '/fixtures/Downloads')).toBe(first);
    const peer = addRootFolder({ path: '/fixtures/Downloads' })!;
    expect(peer.mode).toBe('list');
    expect(browseSession(peer.id, peer.path).selection).toEqual([]);
    updatePane(peer.id, { mode: 'grid' });
    expect(activeWorkspace().panes.find((pane) => pane.id === root.id)).toMatchObject({
      mode: 'grid',
    });
    expect(folderPresentation(peer.path)).toMatchObject({
      columnWidth: 610,
      list: { widths: { name: 700 }, visible: { kind: false } },
    });
    await flushState(false);
    const saved = structuredClone(getState().saved);
    const settings = structuredClone(getState().settings);
    initialize({
      home: '/fixtures',
      platform: 'darwin',
      locations: [],
      openPaths: [],
      state: saved,
      settings,
    });
    expect(folderPresentation('/fixtures/Documents').mode).toBe('columns');
    expect(folderPresentation('/fixtures/Downloads').mode).toBe('grid');
  });
  it('remaps shared overrides and inactive folder sessions after known moves', () => {
    const root = activeWorkspace().panes[0];
    navigate(root.id, '/fixtures/old');
    updatePane(root.id, { mode: 'columns' });
    const session = browseSession(root.id, '/fixtures/old');
    session.expanded = ['/fixtures/old/child'];
    session.columnTrail = ['/fixtures/old/child'];
    navigate(root.id, '/fixtures/elsewhere');
    browseSession(root.id, '/fixtures/elsewhere');
    receiveFileChanges([{ source: '/fixtures/old', destination: '/fixtures/new' }]);
    expect(folderPresentation('/fixtures/new').mode).toBe('columns');
    const returned = browseSession(root.id, '/fixtures/new');
    expect(returned).toBe(session);
    expect(returned.expanded).toEqual(['/fixtures/new/child']);
    remapSessions([{ source: '/fixtures/new', destination: '/fixtures/final' }]);
    expect(returned.columnTrail).toEqual(['/fixtures/final/child']);
  });
  it('merges pending list edits with incoming Settings and clamps browser width at its declared limits', () => {
    updateFolderPresentation('/fixtures', { list: { visible: { kind: false } } });
    const incoming = structuredClone(getState().settings);
    incoming.revision++;
    incoming.settings.browsing.density = 'compact';
    receiveSettings(incoming);
    expect(folderPresentation('/fixtures').list.visible.kind).toBe(false);
    expect(folderPresentation('/fixtures').density).toBe('compact');
    const defaults = defaultSettings('/fixtures');
    defaults.folders['/fixtures'] = { list: { widths: { name: 480 } } };
    expect(
      resolveFolderPresentation('/fixtures', defaults, normalizePreferences()).list.widths.modified,
    ).toBeGreaterThan(0);
    expect(browserColumnWidth(0)).toBe(160);
    expect(browserColumnWidth(2000)).toBe(1600);
  });
});

describe('shared Finder input and file opening', () => {
  const event = (key: string, modifiers: Partial<KeyboardEvent> = {}) => ({
    key,
    target: null,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...modifiers,
    code: modifiers.code || key,
  });
  it('routes Finder keys and settings overrides without passing selection arrows to Plurid', () => {
    const settings = defaultSettings('/fixtures');
    for (const [key, command] of [
      ['ArrowDown', 'open-selection'],
      ['ArrowUp', 'parent'],
      ['[', 'back'],
      [']', 'forward'],
      ['3', 'view-columns'],
    ] as const)
      expect(keyCommand(event(key, { metaKey: true }), settings)).toBe(command);
    expect(keyCommand(event('Enter'), settings)).toBe('rename');
    expect(keyCommand(event(' '), settings)).toBe('quick-preview');
    settings.shortcuts.parent = 'Cmd+P';
    expect(keyCommand(event('p', { metaKey: true }), settings)).toBe('parent');
    expect(keyCommand(event('ArrowUp', { metaKey: true }), settings)).toBeUndefined();
    const input = {
      settings,
      command: vi.fn(),
      move: vi.fn(),
      clear: vi.fn(),
      horizontal: vi.fn(),
    };
    const arrow = event('ArrowDown', { shiftKey: true });
    routeExplorerInput(arrow, input);
    expect(input.move).toHaveBeenCalledWith('ArrowDown', true);
    expect(arrow.stopPropagation).toHaveBeenCalledOnce();
    routeExplorerInput(event('ArrowRight'), input);
    expect(input.horizontal).toHaveBeenCalledWith('right');
  });
  it('never runs a command for a modifier key alone', () => {
    const settings = defaultSettings('/fixtures');
    for (const key of ['Shift', 'Meta', 'Control', 'Alt', 'AltGraph'])
      expect(keyCommand(event(key, { metaKey: true, shiftKey: true }), settings)).toBeUndefined();
    expect(keyCommand(event('N', { metaKey: true, shiftKey: true }), settings)).toBe('new-folder');
    expect(keyCommand(event('n', { metaKey: true }), settings)).toBe('new-root-folder');
  });
  it('opens supported formats in planes, native formats externally, and honors explicit linked/extension overrides', () => {
    const file = (extension: string, mime = 'application/octet-stream') =>
      ({ name: 'Fixture.' + extension, extension, mime, directory: false }) as FileEntry;
    const policy = defaultSettings('/fixtures').fileOpening;
    for (const extension of ['md', 'txt', 'epub', 'pdf', 'json', 'docx', 'xlsx'])
      expect(nativeOpening(file(extension), policy)).toBe(false);
    expect(nativeOpening(file('doc'), policy)).toBe(true);
    expect(
      nativeOpening(file('docx'), { ...policy, types: { ...policy.types, docx: 'native' } }),
    ).toBe(true);
    expect(nativeOpening(file('unrecognized'), policy)).toBe(true);
    expect(nativeOpening(file('docx'), policy, true)).toBe(false);
    expect(nativeOpening(file('pdf'), { default: 'native', types: { pdf: 'plane' } })).toBe(false);
  });
});
