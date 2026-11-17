import { expect, it } from 'vitest';
import {
  candidateFolders,
  qualifyingRoots,
  foundRecentAge,
} from '../src/domain/workspaces/found/candidates';
import { sampleWorkspace } from './workspace-definition-fixtures';
import type { FolderPane } from '../src/domain/contracts';

const home = '/Users/sample';
const now = 1_800_000_000_000;
const folder = (path: string): FolderPane => ({
  id: path,
  type: 'folder',
  path,
  mode: 'list',
  sort: 'name',
  descending: false,
  showHidden: false,
  history: [path],
  historyIndex: 0,
});
it('bounds evidence and excludes pristine and long-unused workspaces', () => {
  const workspaces = [
    sampleWorkspace('pristine', { name: 'Workspace', panes: [folder(home)], roots: [home] }),
    sampleWorkspace('old', { panes: [folder(home + '/old')] }),
    sampleWorkspace('recent', { panes: [folder(home + '/code/sample')] }),
  ];
  const evidence = candidateFolders({
    home,
    now,
    visits: {},
    recents: [],
    workspaces,
    workspaceVisits: { old: now - foundRecentAge - 1, recent: now },
  });
  expect(evidence.map((item) => item.folder)).toEqual([home + '/code/sample']);
  const large = candidateFolders({
    home,
    now,
    visits: Object.fromEntries(
      Array.from({ length: 800 }, (_, index) => [home + '/p' + index, { count: 3, last: now }]),
    ),
    recents: Array.from({ length: 80 }, (_, index) => home + '/r' + index),
    workspaces: [
      sampleWorkspace('many', {
        panes: Array.from({ length: 1000 }, (_, index) => folder(home + '/w' + index)),
      }),
    ],
    openWindows: ['many'],
  });
  expect(large).toHaveLength(1000);
  expect(large.filter((item) => item.folder.startsWith(home + '/r'))).toHaveLength(50);
});
it('sums visits under a root, requires recent evidence and includes open planes and retained roots', () => {
  expect(
    qualifyingRoots(
      [home + '/two'],
      [{ folder: home + '/two', count: 2, last: now, score: 2, plane: false }],
      now,
    ),
  ).toEqual([]);
  const ordinary = Array.from({ length: 250 }, (_, index) => home + '/ordinary-' + index);
  expect(
    qualifyingRoots(
      ordinary,
      ordinary.map((folder) => ({ folder, count: 3, last: now, score: 1, plane: false })),
      now,
    ),
  ).toHaveLength(200);
  const roots = [
    home + '/code/sample',
    home + '/code/old',
    home + '/code/plane',
    home + '/code/remembered',
  ];
  const evidence = [
    { folder: roots[0]! + '/a', count: 1, last: now, score: 1, plane: false },
    { folder: roots[0]! + '/b', count: 2, last: now, score: 2, plane: false },
    { folder: roots[1]!, count: 50, last: now - foundRecentAge - 1, score: 1, plane: false },
    { folder: roots[2]!, count: 0, last: now, score: 0, plane: true },
  ];
  expect(qualifyingRoots(roots, evidence, now, new Set([roots[3]!]))).toEqual([
    roots[3],
    roots[0],
    roots[2],
  ]);
  expect(
    qualifyingRoots(
      Array.from({ length: 250 }, (_, index) => home + '/r' + index),
      [],
      now,
      new Set(Array.from({ length: 250 }, (_, index) => home + '/r' + index)),
    ),
  ).toHaveLength(250);
});
