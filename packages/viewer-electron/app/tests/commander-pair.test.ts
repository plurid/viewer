// @vitest-environment jsdom
/**
 * A COMMANDER'S PAIR (2026-10-24): two folder planes paired, each naming the other; ⌃⌘C and ⌃⌘X
 * copy and move the selection to the other; swap; the two following each other into subfolders;
 * select and deselect by a glob or a query.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import {
  activeWorkspace,
  addRootFolder,
  getState,
  initialize,
  navigate,
  pairOf,
  pairPanes,
  setPairSync,
  unpairPane,
} from '../src/renderer/state/store';
import { pairCommands } from '../src/renderer/commands/window-commands/pair';
import { windowScopes, type WindowActions } from '../src/renderer/commands/window-commands/scope';
import type { CommandContext, CommandDefinition } from '../src/renderer/commands/registry';
import { parsePattern, matchesQuery } from '../src/domain/file-query';
import { registerFolderHandle } from '../src/renderer/explorer/folder-handles';
import { runLine } from '../src/renderer/command-line/run';
import type { LineHost } from '../src/renderer/command-line/host';
import { CommandRegistry } from '../src/renderer/commands/registry';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import type { FileEntry, FolderPane } from '../src/domain/contracts';

const folders = new Set(['/fixtures/a', '/fixtures/a/Docs', '/fixtures/b', '/fixtures/b/Docs']);
const viewer = {
  save: vi.fn(async () => {}),
  operate: vi.fn(async () => 'job'),
  stat: vi.fn(async (path: string) => {
    if (!folders.has(path)) throw new Error('ENOENT');
    return { path, name: path.split('/').pop(), directory: true };
  }),
  taggedFiles: vi.fn(async () => []),
};
let first: string;
let second: string;
beforeEach(() => {
  for (const method of Object.values(viewer)) method.mockClear();
  Object.assign(window, { viewer });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
  act(() => {
    first = addRootFolder({ path: '/fixtures/a' })!.id;
    second = addRootFolder({ path: '/fixtures/b' })!.id;
  });
});
const pane = (id: string) =>
  activeWorkspace().panes.find((item) => item.id === id) as FolderPane | undefined;

describe('a pair', () => {
  it('names each other; pairing anew lets the old partner go; unpair ends it', () => {
    act(() => pairPanes(first, second));
    expect(pairOf(first)?.id).toBe(second);
    expect(pairOf(second)?.id).toBe(first);
    const third = addRootFolder({ path: '/fixtures/c' })!.id;
    act(() => pairPanes(first, third));
    expect(pairOf(first)?.id).toBe(third);
    expect(pairOf(second)).toBeUndefined();
    act(() => unpairPane(third));
    expect(pairOf(first)).toBeUndefined();
  });
  it('follows into subfolders and back up, when asked; not a jump elsewhere', async () => {
    act(() => pairPanes(first, second));
    act(() => navigate(first, '/fixtures/a/Docs'));
    await act(async () => {});
    expect(pane(second)?.path).toBe('/fixtures/b');
    act(() => setPairSync(first, true));
    expect(pane(second)?.pairSync).toBe(true);
    act(() => navigate(first, '/fixtures/a'));
    act(() => navigate(first, '/fixtures/a/Docs'));
    await vi.waitFor(() => expect(pane(second)?.path).toBe('/fixtures/b/Docs'));
    act(() => navigate(first, '/fixtures/a'));
    await vi.waitFor(() => expect(pane(second)?.path).toBe('/fixtures/b'));
    // the partner's own move does not move this one back
    expect(pane(first)?.path).toBe('/fixtures/a');
    act(() => navigate(first, '/elsewhere'));
    await act(async () => {});
    expect(pane(second)?.path).toBe('/fixtures/b');
  });
  it('says when the other folder has no such subfolder', async () => {
    act(() => {
      pairPanes(first, second);
      setPairSync(first, true);
      navigate(first, '/fixtures/a/Only here');
    });
    await vi.waitFor(() =>
      expect(getState().notice ?? '').toBe('The other folder has no Only here.'),
    );
    expect(pane(second)?.path).toBe('/fixtures/b');
  });
});

describe('the pair’s commands', () => {
  const focusPane = vi.fn();
  const actions = {
    workspace: { focusPane } as unknown as WorkspaceController,
    ready: true,
    palette: vi.fn(),
  } as unknown as WindowActions;
  const context = (selection: string[] = []): CommandContext =>
    ({
      scope: 'window',
      workspaceID: activeWorkspace().id,
      paneID: first,
      folder: pane(first),
      directory: pane(first)?.path,
      selection: selection.map((path) => ({ path, name: path.split('/').pop() }) as FileEntry),
    }) as unknown as CommandContext;
  const find = (id: string) =>
    pairCommands(windowScopes(actions)).find((command) => command.id === id) as CommandDefinition;
  it('copy and move the selection to the other folder, named in their labels', async () => {
    act(() => pairPanes(first, second));
    const copy = find('copy-to-pair');
    expect(copy.when(context())).toBe(false);
    const chosen = context(['/fixtures/a/notes.md']);
    expect(copy.when(chosen)).toBe(true);
    expect(typeof copy.label === 'function' ? copy.label(chosen) : copy.label).toBe('Copy to b');
    await copy.run(chosen);
    expect(viewer.operate).toHaveBeenCalledWith({
      kind: 'copy',
      sources: ['/fixtures/a/notes.md'],
      destination: '/fixtures/b',
    });
    await find('move-to-pair').run(chosen);
    expect(viewer.operate).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'move' }));
  });
  it('swap the two folders, and go to the other', () => {
    act(() => pairPanes(first, second));
    act(() => void find('swap-pair-folders').run(context()));
    expect([pane(first)?.path, pane(second)?.path]).toEqual(['/fixtures/b', '/fixtures/a']);
    act(() => void find('focus-pair').run(context()));
    expect(focusPane).toHaveBeenCalledWith(second, { activate: true });
  });
  it('are not there without a pair', () => {
    for (const id of ['copy-to-pair', 'swap-pair-folders', 'focus-pair', 'unpair'])
      expect(find(id).when(context(['/fixtures/a/x'])), id).toBe(false);
  });
});

describe('select by pattern', () => {
  const entries = ['notes.md', 'draft.md', 'photo.png', 'IMG_0042.jpg', 'Docs'].map(
    (name) =>
      ({
        name,
        path: '/fixtures/a/' + name,
        extension: name.includes('.') ? name.split('.').pop()! : '',
        directory: !name.includes('.'),
        hidden: false,
        kind: name.includes('.') ? 'file' : 'directory',
      }) as FileEntry,
  );
  it('reads globs, each word one; else a query', () => {
    const names = (text: string) =>
      entries.filter((item) => matchesQuery(parsePattern(text), item)).map((item) => item.name);
    expect(names('*.md *.png')).toEqual(['notes.md', 'draft.md', 'photo.png']);
    expect(names('IMG_????.jpg')).toEqual(['IMG_0042.jpg']);
    expect(names('kind:folder')).toEqual(['Docs']);
  });
  it('adds to the selection and takes out of it, from the command line', async () => {
    let selected: FileEntry[] = [entries[4]!];
    const remove = registerFolderHandle(first, {
      path: () => '/fixtures/a',
      entries: () => entries,
      selected: () => selected,
      select: (chosen) => {
        selected = [...chosen];
      },
    });
    const registry = new CommandRegistry();
    const host = {
      registry,
      workspace: {} as WorkspaceController,
      context: () =>
        ({ scope: 'window', paneID: first, selection: [] }) as unknown as CommandContext,
      invoke: vi.fn(async () => true),
      newWorkspace: vi.fn(),
      switchWorkspace: vi.fn(),
      palette: vi.fn(),
    } satisfies LineHost;
    expect(await runLine('select *.md', host)).toEqual({
      ok: true,
      message: '2 matching; 3 selected.',
    });
    expect(selected.map((item) => item.name)).toEqual(['notes.md', 'draft.md', 'Docs']);
    await runLine('deselect draft*', host);
    expect(selected.map((item) => item.name)).toEqual(['notes.md', 'Docs']);
    expect((await runLine('select size>', host)).message).toMatch(/size>10mb/);
    remove();
    expect((await runLine('select *.md', host)).message).toMatch(/folder plane/);
  });
});
