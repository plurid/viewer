// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { FileEntry } from '../src/domain/contracts';
import { getState, savePatch } from '../src/renderer/state/core';
import { initialize } from '../src/renderer/state/workspaces';
import { pathAncestry } from '../src/domain/files/paths';
import { useColumnNavigation } from '../src/renderer/explorer/column-navigation';
import { FileSelection } from '../src/renderer/explorer/selection';
import {
  browseSession,
  clearSessions,
  updateBrowseSession,
} from '../src/renderer/workspace/sessions';

const plain = { shiftKey: false, metaKey: false, ctrlKey: false };
const entry = (path: string): FileEntry => ({
  path,
  parent: path.slice(0, path.lastIndexOf('/')) || '/',
  name: path.split('/').at(-1)!,
  directory: true,
  kind: 'directory',
  extension: '',
  mime: '',
  hidden: false,
  size: 0,
  created: 0,
  modified: 0,
  identity: path,
});
const models = entry('/Projects/Models'),
  other = entry('/Projects/Other');
const entries = [entry('/Projects/Models/Parts')];
beforeEach(clearSessions);
afterEach(cleanup);
function mount() {
  const session = browseSession('folder', models.path);
  const selecting = new FileSelection(session, (selection) =>
    updateBrowseSession('folder', models.path, { selection }),
  );
  const hook = renderHook(() =>
    useColumnNavigation('folder', models.path, entries, true, selecting),
  );
  act(() => {
    hook.result.current.register('/', [entry('/Projects')]);
    hook.result.current.register('/Projects', [models, other]);
  });
  return { ...hook, session };
}
it.each([
  ['/', ['/']],
  ['/Projects/Models', ['/', '/Projects', '/Projects/Models']],
  ['C:\\Projects\\Models', ['C:\\', 'C:\\Projects', 'C:\\Projects\\Models']],
  ['//server/share/Models', ['//server/share', '//server/share/Models']],
])('retains the filesystem root for %s', (path, expected) => {
  expect(pathAncestry(path as string)).toEqual(expected);
});
it('starts at the current folder with its ancestors, and can branch from an ancestor', () => {
  const { result, session } = mount();
  expect(result.current.trail).toEqual(['/', '/Projects', models.path]);
  expect(result.current.activeDirectory()).toBe(models.path);
  expect(result.current.directory()).toBe(models.path);
  act(() => result.current.choose(other, plain, [models, other]));
  expect(result.current.trail).toEqual(['/', '/Projects', other.path]);
  expect(result.current.directory()).toBe(other.path);
  expect(session.selection).toEqual([other.path]);
});
it('moves left through ancestors and right back into the selected folder', () => {
  const { result, session } = mount();
  act(() => expect(result.current.left()).toBe(true));
  expect(session.selection).toEqual([models.path]);
  expect(result.current.activeDirectory()).toBe('/Projects');
  act(() => result.current.right());
  expect(session.selection).toEqual([entries[0].path]);
  expect(result.current.activeDirectory()).toBe(models.path);
  expect(result.current.trail.at(-1)).toBe(entries[0].path);
});
it('does not prune an accessible descendant when an ancestor listing is filtered', () => {
  const { result } = mount();
  act(() => result.current.register('/Projects', [other], [models, other]));
  expect(result.current.trail.at(-1)).toBe(models.path);
  act(() => result.current.register('/Projects', [other]));
  expect(result.current.trail).toEqual(['/', '/Projects']);
  expect(result.current.directory()).toBe('/Projects');
});
it('moves column selection through folders without opening them', () => {
  Object.assign(window, { viewer: { save: async () => {} } });
  initialize({ home: '/Projects', platform: 'darwin', state: null, locations: [], openPaths: [] });
  savePatch({ visits: { [models.path]: { count: 3, last: 1 } } });
  const before = getState().saved.visits;
  const { result } = mount();
  act(() => result.current.choose(other, plain, [models, other]));
  act(() => result.current.choose(other, plain, [models, other]));
  expect(result.current.directory()).toBe(other.path);
  act(() => result.current.activate('/Projects'));
  act(() => result.current.choose(models, plain, [models, other]));
  act(() => result.current.right());
  expect(result.current.directory()).toBe(entries[0].path);
  expect(getState().saved.visits).toEqual(before);
  expect(getState().saved.visits?.[models.path]?.count).toBe(3);
});
