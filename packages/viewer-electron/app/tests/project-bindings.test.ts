import { describe, expect, it } from 'vitest';
import type { Pane } from '../src/domain/contracts';
import { projectBindings } from '../src/renderer/workspace/projects';

describe('a new project binds the folders its planes show outside it', () => {
  it('binds an outside folder plane and a preview’s folder, never a scratch plane’s', () => {
    const panes: Pane[] = [
      { id: 'inside', type: 'preview', path: '/work/project/notes.md' },
      { id: 'photos', type: 'preview', path: '/Users/someone/Pictures/one.png' },
      {
        id: 'scratch',
        type: 'scratch',
        path: '/Users/someone/Desktop',
        bufferID: '6f1c2c0a-6a43-4c51-9e3e-6f3f0d3b9a01',
      },
    ];
    // a scratch plane's folder is only where Save As starts: it would bind the home folder
    expect(projectBindings('/work/project', panes)).toEqual({
      'external-1': '/Users/someone/Pictures',
    });
  });
});
