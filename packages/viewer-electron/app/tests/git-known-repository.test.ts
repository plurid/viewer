// @vitest-environment jsdom
/**
 * Git changes is offered for a folder Git status has already read as a repository, or one in its
 * working tree, or one whose listing showed `.git`; never for any folder. A menu opens without
 * asking Git, and its reason names the branch and the changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { FileEntry } from '../src/domain/contracts';
import type { GitResult } from '../src/domain/comparison/git';
import { suggestionRules } from '../src/domain/suggestions/rules';
import { GitBadge, knownRepository } from '../src/renderer/git/status';
import { useFolder } from '../src/renderer/explorer/useFolder';
import { addPane, getState, initialize, receiveSettings } from '../src/renderer/state/store';
import { windowCommands } from '../src/renderer/commands/window';
import type { WindowActions } from '../src/renderer/commands/window-commands/scope';
import type { CommandContext } from '../src/renderer/commands/registry';

const folder = (path: string): FileEntry => ({
  path,
  parent: path.slice(0, path.lastIndexOf('/')),
  name: path.slice(path.lastIndexOf('/') + 1),
  extension: '',
  kind: 'directory',
  directory: true,
  size: 0,
  modified: 0,
  created: 0,
  hidden: false,
  mime: '',
  identity: path,
});
const ready: GitResult = {
  kind: 'ready',
  snapshot: {
    root: '/work/repo',
    branch: 'main',
    updated: 0,
    changes: ['a', 'b', 'src/c'].map((path) => ({
      path,
      index: '.',
      worktree: 'M',
      status: 'modified' as const,
    })),
  },
};
const git = vi.fn(async ({ path }: { path: string }): Promise<GitResult> =>
  path === '/work/repo' ? ready : { kind: 'outside', message: 'not a git repository' },
);

beforeEach(() => {
  const stubs: Record<string, unknown> = {
    git,
    list: async (path: string) => ({
      entries: path === '/work/viewer' ? [{ ...folder('/work/viewer/.git'), hidden: true }] : [],
    }),
    stat: async (path: string) => folder(path),
    onEvent: () => () => {},
  };
  Object.assign(window, {
    viewer: new Proxy(stubs, {
      get: (target, key: string) => target[key] ?? vi.fn(async () => undefined),
    }),
  });
  initialize({ home: '/work', platform: 'darwin', state: null, locations: [], openPaths: [] });
  const snapshot = structuredClone(getState().settings);
  snapshot.revision++;
  snapshot.settings.git.enabled = true;
  receiveSettings(snapshot);
});
afterEach(() => cleanup());

/** Shows two folders' rows with Git badges, and lists a third, as folder planes do. */
function Folders() {
  useFolder('/work/viewer');
  return createElement(
    'div',
    null,
    createElement(GitBadge, { entry: { ...folder('/work/repo/src'), kind: 'file' } }),
    createElement(GitBadge, { entry: { ...folder('/work/plain/notes'), kind: 'file' } }),
  );
}

describe('a known repository', () => {
  it('comes from Git status read, a listed .git, or the status of the folder listing it', async () => {
    render(createElement(Folders));
    await waitFor(() => expect(knownRepository('/work/repo')).toBeDefined());
    await waitFor(() => expect(knownRepository('/work/viewer')).toBeDefined());
    const repository = { root: '/work/repo', branch: 'main', changes: 3 };
    expect(knownRepository('/work/repo')).toEqual(repository);
    // in the working tree of the folder that lists it
    expect(knownRepository('/work/repo/src')).toEqual(repository);
    expect(knownRepository('/work/repo/.git')).toBeUndefined();
    // read, and outside any repository; a folder it lists is not known either way
    expect(knownRepository('/work/plain')).toBeUndefined();
    expect(knownRepository('/work/plain/notes')).toBeUndefined();
    expect(knownRepository('/work/viewer')).toEqual({ root: '/work/viewer', branch: '' });
    expect(knownRepository('/work/elsewhere')).toBeUndefined();
    // nothing more is read for the asking
    expect(git.mock.calls.map(([request]) => request.path).toSorted()).toEqual([
      '/work/plain',
      '/work/repo',
    ]);
  });

  it('offers Git changes, with its branch and changes, only for one', async () => {
    render(createElement(Folders));
    await waitFor(() => expect(knownRepository('/work/repo')).toBeDefined());
    await waitFor(() => expect(knownRepository('/work/viewer')).toBeDefined());
    const rule = suggestionRules.find((item) => item.id === 'folder.git')!;
    const reason = (path: string) =>
      rule.reason({
        selection: [folder(path)],
        now: 0,
        home: '/work',
        modelReady: false,
        editable: () => false,
        repository: (entry) => knownRepository(entry.path),
      });
    expect(reason('/work/repo/src')).toBe('main · 3 changes');
    expect(reason('/work/viewer')).toBe('A repository');
    expect(reason('/work/plain/notes')).toBeUndefined();

    const paneID = addPane('/work/plain', 'folder', true).id;
    const actions = {
      workspace: new Proxy({}, { get: () => vi.fn() }),
      ready: true,
      tool: null,
    } as unknown as WindowActions;
    const changes = windowCommands(actions).find((command) => command.id === 'git-changes')!;
    const at = (directory: string, selection: FileEntry[]) =>
      changes.when({
        scope: 'files',
        paneID,
        workspaceID: getState().saved.activeWorkspace,
        directory,
        selection,
      } as unknown as CommandContext);
    expect(at('/work/plain', [])).toBe(false);
    expect(at('/work/plain', [folder('/work/plain/notes')])).toBe(false);
    expect(at('/work/repo', [])).toBe(true);
    expect(at('/work', [folder('/work/viewer')])).toBe(true);
    expect(at('/work/repo', [folder('/work/repo/.git')])).toBe(false);
  });
});
