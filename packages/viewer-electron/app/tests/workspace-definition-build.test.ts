import { describe, expect, it } from 'vitest';
import type { FolderPane } from '../src/domain/contracts';
import { buildDefinition } from '../src/domain/workspaces/definitions/build';
import { scratchPaneRecord } from '../src/domain/workspaces/pane-records';
import { sampleDefinition } from './workspace-definition-fixtures';

function builders() {
  let number = 0;
  const id = () => 'plane-' + ++number;
  return {
    id,
    home: '/home/sample',
    terminalProfile: 'login',
    folder: (path: string): FolderPane => ({
      id: id(),
      type: 'folder',
      path,
      mode: 'list',
      sort: 'name',
      descending: false,
      showHidden: false,
      history: [path],
      historyIndex: 0,
    }),
    scratch: (path: string) =>
      scratchPaneRecord(id(), path, { bufferID: id(), title: 'Untitled 1', language: 'markdown' }),
  };
}

describe('definition workspace construction', () => {
  it('builds a stub and attaches its key and basis', () => {
    const definition = sampleDefinition();
    const workspace = buildDefinition(definition, builders());
    expect(workspace.definition).toEqual({
      key: definition.key, basis: definition.basis,
      planes: { [workspace.panes[0]!.id]: 0 },
    });
    expect(workspace.panes[0]).toMatchObject({ type: 'folder', path: definition.root });
    expect(workspace.roots).toEqual([workspace.panes[0]!.id]);
  });
  it('builds every plane kind with focus and a pruned indexed split', () => {
    const definition = sampleDefinition('sample/site', {
      planes: [
        { index: 0, plane: { kind: 'folder', path: '/root' } },
        { index: 2, plane: { kind: 'terminal', path: '/root/api', command: 'npm run dev' } },
        { index: 3, plane: { kind: 'terminal', path: '/root', profileID: 'custom' } },
        { index: 4, plane: { kind: 'file', path: '/root/README.md' } },
        { index: 5, plane: { kind: 'scratch' } },
        { index: 6, plane: { kind: 'search', query: 'TODO', name: 'Todos', root: '/root' } },
      ],
      focus: 2,
      terminalProfile: 'definition-profile',
      tiling: {
        layout: 'main-vertical',
        main: 0.4,
        split: { axis: 'x', ratio: 0.4, first: { plane: 1 }, second: { plane: 2 } },
      },
      look: { profile: 'focus', spaceColor: '#24303a', overrides: { 'ui.space.grid': false } },
    });
    const workspace = buildDefinition(definition, builders());
    expect(workspace.panes.map((pane) => pane.type)).toEqual([
      'folder',
      'terminal',
      'terminal',
      'preview',
      'scratch',
      'search',
    ]);
    expect(workspace.panes[1]).toMatchObject({
      definitionPlane: 2,
      startOnOpen: false,
      profileID: 'definition-profile',
    });
    expect(workspace.panes[2]).not.toHaveProperty('definitionPlane');
    expect(workspace.panes[2]).not.toHaveProperty('startOnOpen');
    expect(workspace.activePane).toBe(workspace.panes[1]!.id);
    expect(workspace.tiling?.tree).toEqual({ pane: workspace.panes[1]!.id });
    expect(workspace).toMatchObject({ profileID: 'focus', spaceColor: '#24303a' });
    expect(JSON.stringify(workspace)).not.toContain('npm run dev');
  });
  it('falls back to the first surviving pane when the focus was skipped', () => {
    const definition = sampleDefinition('sample/site', { focus: 3 });
    const workspace = buildDefinition(definition, builders());
    expect(workspace.activePane).toBe(workspace.panes[0]!.id);
  });
});
