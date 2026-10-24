// @vitest-environment jsdom
/**
 * THE FILE QUERY LANGUAGE WHERE IT IS TYPED (2026-10-24): a filter keeps the last query that read
 * while the next is typed, and says what is wrong; tags are looked up in the folder; `:filter` and
 * `:find` take a query; completion offers its terms.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useFileQuery } from '../src/renderer/explorer/useFileQuery';
import { matchesQuery, type QueryEntry } from '../src/domain/file-query';
import { runLine } from '../src/renderer/command-line/run';
import type { LineHost } from '../src/renderer/command-line/host';
import { lineCompletions } from '../src/renderer/command-line/complete';
import { CommandRegistry, type CommandContext } from '../src/renderer/commands/registry';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { activeWorkspace, getState, initialize } from '../src/renderer/state/store';
import { browseSession } from '../src/renderer/workspace/sessions';

const taggedFiles = vi.fn(async (tag: string) =>
  tag === 'red' ? [{ path: '/fixtures/notes.md' }] : [],
);
beforeEach(() => {
  taggedFiles.mockClear();
  Object.assign(window, { viewer: { save: vi.fn(async () => {}), taggedFiles } });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
const file = (name: string): QueryEntry => ({
  name,
  path: '/fixtures/' + name,
  extension: name.split('.').pop() ?? '',
  directory: false,
  hidden: false,
  kind: 'file',
});

describe('a filter', () => {
  it('stays stable across unrelated renders so the command palette can subscribe without a loop', () => {
    const view = renderHook(({ text }) => useFileQuery(text, '/fixtures'), {
      initialProps: { text: 'ext:md' },
    });
    const initial = view.result.current;
    view.rerender({ text: 'ext:md' });
    expect(view.result.current).toBe(initial);
    view.rerender({ text: 'ext:png' });
    expect(view.result.current).not.toBe(initial);
    expect(matchesQuery(view.result.current.query, file('photo.png'))).toBe(true);
  });
  it('keeps the last query that read while the next is typed, saying what is wrong', () => {
    const view = renderHook(({ text }) => useFileQuery(text, '/fixtures'), {
      initialProps: { text: 'ext:md' },
    });
    expect(matchesQuery(view.result.current.query, file('notes.md'))).toBe(true);
    expect(matchesQuery(view.result.current.query, file('photo.png'))).toBe(false);
    view.rerender({ text: 'ext:md size>' });
    expect(view.result.current.problem).toMatch(/size>10mb/);
    // still ext:md: the list does not jump while a term is half typed
    expect(matchesQuery(view.result.current.query, file('photo.png'))).toBe(false);
  });
  it('looks up the tags it names in the folder', async () => {
    const view = renderHook(() => useFileQuery('tag:red', '/fixtures'));
    await waitFor(() =>
      expect(
        matchesQuery(view.result.current.query, file('notes.md'), view.result.current.facts),
      ).toBe(true),
    );
    expect(taggedFiles).toHaveBeenCalledWith('red', ['/fixtures']);
    expect(
      matchesQuery(view.result.current.query, file('photo.png'), view.result.current.facts),
    ).toBe(false);
  });
});

describe(':filter and :find', () => {
  const host = (): LineHost => {
    const registry = new CommandRegistry();
    const context = () => {
      const pane = activeWorkspace().panes.find((item) => item.id === getState().activePane)!;
      return {
        scope: 'window',
        workspaceID: activeWorkspace().id,
        paneID: pane.id,
        directory: pane.path,
        path: pane.path,
        selection: [],
      } as unknown as CommandContext;
    };
    registry.register('window', { context, definitions: () => [] });
    return {
      registry,
      context,
      workspace: { newSearch: vi.fn() } as unknown as WorkspaceController,
      invoke: vi.fn(async () => true),
      newWorkspace: vi.fn(),
      switchWorkspace: vi.fn(),
      palette: vi.fn(),
    };
  };
  it('filter the folder plane by a query, quotes and all; none clears', async () => {
    const pane = activeWorkspace().panes.find((item) => item.id === getState().activePane)!;
    const live = host();
    await act(async () => void (await runLine('filter ext:md tag:"Project X" -draft', live)));
    expect(browseSession(pane.id, pane.path)).toMatchObject({
      query: 'ext:md tag:"Project X" -draft',
      searchOpen: true,
      subtree: false,
    });
    await act(async () => void (await runLine('filter', live)));
    expect(browseSession(pane.id, pane.path)).toMatchObject({ query: '', searchOpen: false });
    expect((await runLine('filter size>', live)).message).toMatch(/size>10mb/);
  });
  it('find opens a search of this folder and its subfolders', async () => {
    const live = host();
    await runLine('find kind:image modified<7d', live);
    expect(live.workspace.newSearch).toHaveBeenCalledWith(
      'kind:image modified<7d',
      'kind:image modified<7d',
      '/fixtures',
      true,
      false,
    );
    expect((await runLine('find', live)).message).toBe(':find needs a query.');
  });
  it('complete a query’s terms', () => {
    const sources = {
      commands: [],
      family: () => [],
      workspaces: [],
      value: () => undefined,
      places: { home: '/fixtures', folder: '/fixtures' },
    };
    expect(
      lineCompletions('filter ext:md siz', sources).completions.map((item) => item.insert),
    ).toEqual(['filter ext:md size>', 'filter ext:md size<']);
    expect(lineCompletions('help qu', sources).completions.map((item) => item.label)).toContain(
      'query',
    );
  });
});
