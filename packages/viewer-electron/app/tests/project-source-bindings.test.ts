import { describe, expect, it } from 'vitest';
import type { Pane } from '../src/domain/contracts';
import { projectReference } from '../src/domain/workspaces/project';
import { projectBindings } from '../src/renderer/workspace/projects';

describe('projectBindings external collections and terminal parents', () => {
  it('binds an external folder plane directly and a preview plane to its parent folder', () => {
    const panes: Pane[] = [
      {
        id: 'f1',
        type: 'folder',
        path: '/work/other',
        mode: 'list',
        sort: 'name',
        descending: false,
        showHidden: false,
        history: ['/work/other'],
        historyIndex: 0,
      },
      { id: 'p1', type: 'preview', path: '/work/media/photo.png' },
    ];
    const bindings = projectBindings('/work/project', panes);
    expect(bindings).toEqual({
      'external-1': '/work/other',
      'external-2': '/work/media',
    });
    expect(projectReference('/work/project', '/work/other', bindings)).toEqual({
      binding: 'external-1',
      path: '.',
    });
  });

  it('binds an external terminal plane to its own folder rather than its parent', () => {
    const panes: Pane[] = [
      { id: 't1', type: 'terminal', path: '/work/tools', profileID: 'default' },
    ];
    const bindings = projectBindings('/work/project', panes);
    expect(bindings).toEqual({ 'external-1': '/work/tools' });
  });

  it('binds external collection sources so projectReference succeeds on project creation', () => {
    const panes: Pane[] = [
      {
        id: 'f1',
        type: 'folder',
        path: '/work/project',
        mode: 'list',
        sort: 'name',
        descending: false,
        showHidden: false,
        history: ['/work/project'],
        historyIndex: 0,
      },
      {
        id: 'c1',
        type: 'collection',
        path: '/work/project',
        collectionID: 'f3c1a9d2-4b6e-4c8a-9d1e-2a7b5c3e8f40',
      },
    ];
    const bindings = projectBindings('/work/project', panes, [
      {
        id: 'collection',
        name: 'Files',
        kind: 'explicit',
        sources: ['/other/downloads/archive.zip'],
      },
    ]);
    expect(() =>
      projectReference('/work/project', '/other/downloads/archive.zip', bindings),
    ).not.toThrow();
  });
});
