import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry } from '../src/domain/contracts';
import {
  CommandRegistry,
  rankCommands,
  type CommandContext,
  type CommandDefinition,
} from '../src/renderer/commands/registry';
import { folderCommands, type FolderActions } from '../src/renderer/commands/folder';
import { textEditFor } from '../src/renderer/commands/editing';
import {
  activeWorkspace,
  flushState,
  getState,
  initialize,
  refreshClipboard,
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
  destination: vi.fn(),
  search: vi.fn(),
  path: vi.fn(),
  refresh: vi.fn(),
  selectAll: vi.fn(),
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
    viewer: { save, operate, clipboardRead: vi.fn(async () => null) },
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
  registry = new CommandRegistry(rememberCommand);
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
  it('searches short aliases and label prefixes before loose matches', () => {
    const rows = registry.list({ paneID: context.paneID });
    expect(rankCommands(rows, 'rn', [])[0].id).toBe('rename');
    expect(rankCommands(rows, 'cp', [])[0].id).toBe('copy');
    expect(rankCommands(rows, 'nf', [])[0].id).toBe('new-folder');
    expect(rankCommands(rows, 're', [])[0].id).toBe('rename');
    expect(rankCommands(rows, 'zz', [])).toEqual([]);
  });
  it('places the last two applicable actions first without duplicates', () => {
    const rows = registry.list({ paneID: context.paneID });
    const ranked = rankCommands(rows, '', ['missing', 'rename', 'copy', 'info']);
    expect(ranked.slice(0, 2).map((item) => item.id)).toEqual(['rename', 'copy']);
    expect(ranked.filter((item) => item.id === 'rename')).toHaveLength(1);
    expect(rankCommands(rows, 'new', ['rename', 'copy'])[0].id).toBe('new-folder');
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
});
