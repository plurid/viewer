import { describe, expect, it } from 'vitest';
import type { FileEntry, Workspace } from '../src/domain/contracts';
import { fileGroup, indexEntries, reconcileSelection } from '../src/domain/files';
import { matchingPane, normalizedPanePath, parentPath } from '../src/domain/planes';
import { rankFiles } from '../src/renderer/commands/registry';
import { operationRoots } from '../src/desktop/operations';
import { repeatedPreviews } from '../src/renderer/workspace/recovery';
import { repeatedPreviewFixture } from './workspace-fixtures';
import type { TreePlane } from '@plurid/plurid-data';
import path from 'node:path';

const file = (name: string, identity = name): FileEntry => ({
  name,
  identity,
  path: `/fixtures/${name}`,
  parent: '/fixtures',
  extension: 'txt',
  kind: 'file',
  directory: false,
  size: 1,
  modified: 0,
  created: 0,
  hidden: false,
  mime: 'text/plain',
});

describe('selection reconciliation', () => {
  it('preserves exact hard-link paths, follows unique renames and clears ambiguous replacements', () => {
    const a = file('a', 'inode-1'),
      b = file('b', 'inode-1'),
      c = file('c', 'inode-2');
    const cache = new Map([a, b, c].map((entry) => [entry.path, entry]));
    expect(reconcileSelection([a.path], cache, '/fixtures', indexEntries([a, b]))).toEqual([
      a.path,
    ]);
    const renamed = { ...c, name: 'renamed', path: '/fixtures/renamed' };
    expect(reconcileSelection([c.path], cache, '/fixtures', indexEntries([renamed]))).toEqual([
      renamed.path,
    ]);
    expect(
      reconcileSelection(
        [a.path],
        cache,
        '/fixtures',
        indexEntries([
          file('a', 'replacement'),
          file('first-link', 'inode-1'),
          file('second-link', 'inode-1'),
        ]),
      ),
    ).toEqual([]);
    expect(reconcileSelection([a.path], cache, '/fixtures', indexEntries([]))).toEqual([]);
  });
  it('keeps a column child selection while the root folder refreshes', () => {
    const child = { ...file('child'), path: '/fixtures/folder/child', parent: '/fixtures/folder' };
    const cache = new Map([[child.path, child]]);
    expect(reconcileSelection([child.path], cache, '/fixtures', indexEntries([]))).toEqual([
      child.path,
    ]);
  });
});
describe('spatial plane reuse', () => {
  it('finds a preview parent including drive-root files', () => {
    expect(parentPath('/images/photo.png')).toBe('/images');
    expect(parentPath('/photo.png')).toBe('/');
    expect(parentPath('C:\\photo.png')).toBe('C:\\');
    expect(parentPath('C:\\images\\photo.png')).toBe('C:\\images');
  });
  it('reuses only matching type/path within the originating root', () => {
    const workspace: Workspace = {
      id: 'one',
      name: 'One',
      roots: [],
      arrangement: {},
      panes: [
        { id: 'first', type: 'preview', path: '/fixtures/model.glb' },
        { id: 'second', type: 'preview', path: '/fixtures/model.glb' },
      ],
    };
    const scope = {
      rootID: 'root-one',
      owners: new Map([
        ['first', 'root-one'],
        ['second', 'root-two'],
      ]),
    };
    expect(
      matchingPane(workspace, '/fixtures/./model.glb', 'preview', 'first', 'darwin', scope)?.id,
    ).toBe('first');
    expect(
      matchingPane(workspace, '/fixtures/model.glb', 'preview', 'other', 'darwin', scope)?.id,
    ).toBe('first');
    expect(
      matchingPane(workspace, '/fixtures/model.glb', 'folder', 'first', 'darwin', scope),
    ).toBeUndefined();
    expect(
      matchingPane(
        { ...workspace, panes: [] },
        '/fixtures/model.glb',
        'preview',
        '',
        'darwin',
        scope,
      ),
    ).toBeUndefined();
    expect(
      matchingPane(workspace, '/fixtures/model.glb', 'preview', 'first', 'darwin', {
        ...scope,
        rootID: 'root-two',
      })?.id,
    ).toBe('second');
    expect(
      matchingPane(workspace, '/fixtures/model.glb', 'preview', '', 'darwin', {
        ...scope,
        rootID: 'root-three',
      }),
    ).toBeUndefined();
    expect(workspace.panes).toHaveLength(2);
    expect(normalizedPanePath('C:\\Files\\.\\model.glb', 'win32')).toBe('c:/files/model.glb');
    expect(normalizedPanePath('/fixtures/a\\b', 'darwin')).toBe('/fixtures/a\\b');
  });
  it('plans explicit recovery of repeated siblings without changing the saved layout', () => {
    const saved = repeatedPreviewFixture('/fixtures');
    const workspace = saved.workspaces[0];
    const tree = JSON.parse(Object.values(workspace.arrangement)[0]).space.tree as TreePlane[];
    const original = JSON.stringify(workspace);
    const groups = repeatedPreviews(workspace, tree, 'legacy-preview-3', 'darwin');
    expect(groups).toHaveLength(1);
    expect(groups[0].keep.planeID).toContain('legacy-preview-3');
    expect(groups[0].close.map((node) => node.routeDivisions.plane.parameters.id)).toEqual([
      'legacy-preview-1',
      'legacy-preview-2',
    ]);
    expect(JSON.stringify(workspace)).toBe(original);
  });
  it('protects intentional copies, manually positioned views, branches and different parents', () => {
    const workspace = repeatedPreviewFixture('/fixtures').workspaces[0];
    const tree = JSON.parse(Object.values(workspace.arrangement)[0]).space.tree as TreePlane[];
    const nodes = tree[0].children!;
    const protectedPane = workspace.panes[1];
    if (protectedPane.type !== 'preview') throw new Error('Expected a preview');
    protectedPane.keepSeparate = true;
    expect(repeatedPreviews(workspace, tree, '', 'darwin')[0].close).toHaveLength(1);
    nodes[1].manuallyPositioned = true;
    expect(repeatedPreviews(workspace, tree, '', 'darwin')).toEqual([]);
    nodes[1].manuallyPositioned = false;
    nodes[1].children = [{ ...nodes[2], planeID: 'child', children: [] }];
    expect(repeatedPreviews(workspace, tree, '', 'darwin')).toEqual([]);
    nodes[1].children = [];
    nodes[1].parentPlaneID = 'another-parent';
    expect(repeatedPreviews(workspace, tree, '', 'darwin')).toEqual([]);
  });
});
describe('bounded filename search', () => {
  it('finds a late match in a large listing before limiting results, retaining fuzzy and accent matching', () => {
    const files = Array.from({ length: 10000 }, (_, index) => file(`item-${index}.txt`));
    const resume = file('Résumé.pdf');
    files.push(resume);
    expect(rankFiles(files, '')).toHaveLength(150);
    expect(rankFiles(files, 'resume')[0]).toBe(resume);
    expect(rankFiles(files, 'rsme')[0]).toBe(resume);
    expect(rankFiles(files, 'item-9999')[0].name).toBe('item-9999.txt');
    expect(rankFiles(files, 'missing-file')).toEqual([]);
  });
});
describe('operation source pruning', () => {
  it('preserves order and path boundaries for descendants and root selections on both platforms', () => {
    expect(operationRoots(['/a/child', '/ab/file', '/a', '/other', '/a'])).toEqual([
      '/ab/file',
      '/a',
      '/other',
    ]);
    expect(operationRoots(['/a/child', '/', '/other'])).toEqual(['/']);
    expect(operationRoots(['C:\\a\\child', 'C:\\ab', 'C:\\a'], path.win32)).toEqual([
      'C:\\ab',
      'C:\\a',
    ]);
  });
});
describe('modified-date grouping', () => {
  it('groups by the local calendar day', () => {
    const justAfterMidnight = new Date(2026, 0, 1, 0, 30).getTime();
    expect(fileGroup({ modified: justAfterMidnight } as FileEntry, 'modified')).toBe('2026-01-01');
  });
});
