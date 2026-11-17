import { expect, it } from 'vitest';
import type { Workspace } from '../src/domain/contracts';
import { searchPaneRecord } from '../src/domain/workspaces/pane-records';
import {
  definitionShares,
  mostlyIn,
  owningDefinition,
  addsToDefinition,
} from '../src/domain/workspaces/ownership';
import { proposeDefinition } from '../src/domain/workspaces/definitions/capture';
import { sampleDefinition } from './workspace-definition-fixtures';

const home = '/Users/sample';
const outer = { ...sampleDefinition('outer'), root: home + '/code', projectName: 'Sample > Code' };
const inner = { ...sampleDefinition('inner'), root: outer.root + '/web', source: 'found' as const };
const workspace = (folders: string[]): Workspace => ({
  id: 'space',
  name: 'Sample',
  panes: folders.map((path, index) => ({
    id: 'p' + index,
    type: 'folder',
    path,
    history: [path],
    historyIndex: 0,
    mode: 'list',
    sort: 'name',
    descending: false,
    showHidden: false,
  })),
  roots: folders.map((_, index) => 'p' + index),
  arrangement: {},
});
it('uses deepest ownership, with explicit definitions winning a same-root tie', () => {
  const definitions = [inner, outer];
  expect(owningDefinition(inner.root + '/src', definitions)).toBe(inner);
  const explicit = { ...outer, root: inner.root };
  expect(owningDefinition(inner.root, [inner, explicit])).toBe(explicit);
  expect(
    definitionShares(workspace([outer.root, inner.root, inner.root + '/src']), definitions)[0]!
      .definition,
  ).toBe(inner);
});
it('requires sixty percent and two supported planes unless it is the only one', () => {
  expect(mostlyIn(workspace([inner.root]), [inner])).toBe(inner);
  expect(mostlyIn(workspace([inner.root, home + '/other']), [inner])).toBeUndefined();
  expect(mostlyIn(workspace([inner.root, inner.root + '/src', home + '/other']), [inner])).toBe(
    inner,
  );
  expect(addsToDefinition(workspace([inner.root, inner.root + '/src']), inner)).toBe(true);
});
it('keeps proposal parity for project plurality and counts found roots too', () => {
  for (const folders of [
    [outer.root],
    [inner.root, outer.root],
    [outer.root, home + '/elsewhere', home + '/other'],
  ]) {
    const space = workspace(folders);
    const expected = outer.root;
    expect(proposeDefinition(space, [outer], home).root).toBe(expected);
  }
  expect(proposeDefinition(workspace([inner.root]), [outer, inner], home).key).toBe(inner.key);
});

it('counts unowned global searches in the ownership threshold and compares rich planes', () => {
  const space = workspace([inner.root]);
  space.panes.push(searchPaneRecord('search', home, 'sample', 'Sample'));
  expect(mostlyIn(space, [inner])).toBeUndefined();
  const terminal = {
    id: 'terminal',
    type: 'terminal' as const,
    path: inner.root,
    profileID: 'login',
  };
  const rich = {
    ...inner,
    planes: [
      { index: 0, plane: { kind: 'terminal' as const, path: inner.root, profileID: 'login' } },
    ],
  };
  expect(addsToDefinition({ ...space, panes: [terminal] }, rich)).toBe(false);
  expect(
    addsToDefinition({ ...space, panes: [terminal, { ...terminal, id: 'extra' }] }, rich),
  ).toBe(true);
});
