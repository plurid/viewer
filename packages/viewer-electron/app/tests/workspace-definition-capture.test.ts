import { describe, expect, it } from 'vitest';
import type { Pane } from '../src/domain/contracts';
import { captureDefinition, proposeDefinition } from '../src/domain/workspaces/definitions/capture';
import { tokenizePath } from '../src/domain/workspaces/definitions/paths';
import { sampleDefinition, sampleWorkspace } from './workspace-definition-fixtures';

describe('definition capture', () => {
  it('chooses the longest root, preserves spelling, uses Home and falls back literally', () => {
    const context = {
      home: '/home/sample',
      root: '/projects/sample',
      roots: new Map([
        ['sample', '/projects/sample'],
        ['nested', '/projects/sample/nested'],
      ]),
    };
    expect(tokenizePath('/projects/sample/nested/src', context)).toBe('{{ROOT:nested}}/src');
    expect(tokenizePath('/projects/sample/src', context)).toBe('{{ROOT}}/src');
    expect(tokenizePath('/projects/sample/src', context, './src')).toBe('./src');
    expect(tokenizePath('/projects/sample/src', context, '{{ROOT:gone}}/src')).toBe('{{ROOT}}/src');
    expect(tokenizePath('/home/sample/Notes', context)).toBe('~/Notes');
    expect(tokenizePath('/projects/samples/src', context)).toBe('/projects/samples/src');
    expect(
      tokenizePath('/projects/sample', { ...context, resolvingRoot: true, roots: new Map() }),
    ).toBe('/projects/sample');
    expect(tokenizePath('/home/sample', context)).toBe('~');
    expect(tokenizePath('/projects/sample', { home: '/', roots: new Map() })).toBe(
      '~/projects/sample',
    );
  });
  it('captures the split order and focus and copies commands only by written plane index', () => {
    const definition = sampleDefinition();
    const workspace = sampleWorkspace('sample', {
      panes: [
        {
          id: 'folder',
          type: 'folder',
          path: definition.root + '/src',
          history: [],
          historyIndex: -1,
        } as unknown as Pane,
        {
          id: 'terminal',
          type: 'terminal',
          path: definition.root,
          profileID: 'default',
          definitionPlane: 1,
        },
        { id: 'other', type: 'terminal', path: definition.root, profileID: 'default' },
      ],
      roots: ['folder', 'terminal', 'other'],
      activePane: 'terminal',
      tiling: {
        layout: 'even-horizontal',
        main: 0.7,
        panes: ['terminal', 'folder'],
        tree: { axis: 'x', ratio: 0.3, first: { pane: 'terminal' }, second: { pane: 'folder' } },
      },
    });
    const entry = {
      name: 'Kept',
      aliases: ['alias'],
      curated: true,
      focus: 0,
      hidden: true,
      root: '/projects/sample/site',
      planes: [
        { kind: 'folder' as const, path: './src' },
        { kind: 'terminal' as const, path: '{{ROOT}}', command: 'echo sample' },
      ],
    };
    const captured = captureDefinition({
      workspace,
      order: ['terminal', 'folder', 'other'],
      definition,
      entry,
      definitions: [definition],
      home: '/home/sample',
    });
    expect(captured.entry).toMatchObject({
      name: 'Kept',
      aliases: ['alias'],
      curated: true,
      hidden: true,
      root: entry.root,
      focus: 0,
      tiling: { split: { axis: 'x', ratio: 0.3, first: { plane: 0 }, second: { plane: 1 } } },
      planes: [
        { kind: 'terminal', path: '{{ROOT}}', command: 'echo sample' },
        { kind: 'folder', path: './src' },
        { kind: 'terminal' },
      ],
    });
    expect(captured.entry.planes![2]).not.toHaveProperty('command');
    expect(captured.dropsCommands).toBe(false);
    workspace.panes[1] = { ...workspace.panes[1]!, definitionPlane: -1 } as Pane;
    expect(
      captureDefinition({
        workspace,
        order: ['terminal', 'folder', 'other'],
        definition,
        entry,
        definitions: [definition],
        home: '/home/sample',
      }).dropsCommands,
    ).toBe(true);
  });
  it('reports kinds it cannot hold and requires the full pane order', () => {
    const definition = sampleDefinition();
    const workspace = sampleWorkspace('sample', {
      panes: [
        { id: 'scratch', type: 'scratch', path: definition.root, bufferID: 'buffer' },
        {
          id: 'browser',
          type: 'browser',
          path: definition.root,
          url: 'https://example.test',
        } as unknown as Pane,
      ],
    });
    const input = {
      workspace,
      order: ['scratch', 'browser'],
      definition,
      entry: {},
      definitions: [definition],
      home: '/home/sample',
    };
    expect(captureDefinition(input).skipped).toEqual([
      { id: 'browser', kind: 'browser', reason: expect.any(String) },
    ]);
    expect(() => captureDefinition({ ...input, order: ['scratch'] })).toThrow('once each');
  });
  it('proposes the majority project, shorter root on a tie, or a slug and common folder', () => {
    const broad = sampleDefinition('sample', { root: '/projects/sample' });
    const nested = sampleDefinition('sample/api', { root: '/projects/sample/api' });
    const workspace = sampleWorkspace('sample', {
      name: 'Sample Room',
      panes: [
        { id: 'one', type: 'scratch', path: '/projects/sample/web', bufferID: 'one' },
        { id: 'two', type: 'scratch', path: '/projects/sample/api', bufferID: 'two' },
      ],
    });
    expect(proposeDefinition(workspace, [broad, nested], '/home/sample').key).toBe('sample');
    expect(proposeDefinition(workspace, [], '/home/sample')).toEqual({
      key: 'Sample-Room',
      name: 'Sample Room',
      root: '/projects/sample',
    });
  });
});
