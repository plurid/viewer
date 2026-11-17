/**
 * The workspace offer: the deepest definition root holding the folder in view, offered only when
 * opening it adds something to browsing there, and never to the workspace that already is it.
 */
import { describe, expect, it } from 'vitest';
import type { FolderPane, Workspace } from '../src/domain/contracts';
import type { WorkspaceDefinition } from '../src/domain/workspaces/definitions/schema';
import { workspaceOffer } from '../src/domain/workspaces/offer';
import { richDefinition } from '../src/domain/workspaces/catalog';
import { foundDefinitions } from '../src/domain/workspaces/found/catalog';
import { workspaceInsight } from '../src/domain/suggestions/insights';
import { hashDefinition, sampleDefinition, sampleWorkspace } from './workspace-definition-fixtures';

const home = '/Users/sample';
const root = home + '/code/acme-site';
const folder = (id: string, path: string): FolderPane => ({
  id,
  type: 'folder',
  path,
  mode: 'list',
  sort: 'name',
  descending: false,
  showHidden: false,
  history: [path],
  historyIndex: 0,
});
const found = (path = root, key = 'code/acme-site') =>
  foundDefinitions(
    [{ key, root: path, realpath: path, identity: '1:2', names: [], at: 1 }],
    [],
    home,
    hashDefinition,
  )[0]!;
const remembered = (definition: WorkspaceDefinition, planes = 5): WorkspaceDefinition => ({
  ...definition,
  remembered: { at: 1, basis: definition.basis, planes },
});
/** A workspace browsing Downloads and Desktop, so no definition holds most of it. */
const elsewhere = (extra: Partial<Workspace> = {}) =>
  sampleWorkspace('current', {
    name: 'Workspace',
    panes: [folder('downloads', home + '/Downloads'), folder('desktop', home + '/Desktop')],
    ...extra,
  });
const offer = (
  definitions: readonly WorkspaceDefinition[],
  current: Workspace = elsewhere(),
  workspaces: readonly Workspace[] = [current],
  path = root + '/src/components',
) => workspaceOffer({ folder: path, current, workspaces, definitions });

describe('the workspace offer', () => {
  it('offers the remembered planes of the root holding the folder', () => {
    const definition = remembered(found());
    const result = offer([definition]);
    expect(result).toMatchObject({ reason: 'remembered', command: 'defined:code/acme-site' });
    expect(workspaceInsight(result!)).toMatchObject({
      id: 'workspace.open',
      target: 'window',
      command: 'defined:code/acme-site',
      root,
      paths: [root],
      title: '“acme-site” remembers 5 planes',
      reason: 'Remembers 5 planes',
      action: 'Open Workspace',
    });
    expect(workspaceInsight(offer([remembered(found(), 1)])!).title).toBe(
      '“acme-site” remembers 1 plane',
    );
  });

  it('offers nothing for a plain definition, which opens what browsing already shows', () => {
    const plain = found();
    expect(richDefinition(plain)).toBe(false);
    expect(offer([plain])).toBeUndefined();
    // outside every root, and at home, nothing either
    expect(offer([remembered(plain)], elsewhere(), undefined, home + '/code')).toBeUndefined();
    expect(offer([remembered(plain)], elsewhere(), undefined, home)).toBeUndefined();
  });

  it('names what a rich definition opens', () => {
    const base = sampleDefinition('sample/acme', { root, name: 'acme' });
    const terminal = {
      ...base,
      planes: [{ index: 0, plane: { kind: 'terminal' as const, path: root } }],
    };
    const several = {
      ...base,
      planes: [
        { index: 0, plane: { kind: 'folder' as const, path: root } },
        { index: 1, plane: { kind: 'file' as const, path: root + '/README.md' } },
        { index: 2, plane: { kind: 'terminal' as const, path: root } },
      ],
    };
    const tiled = { ...several, tiling: { layout: 'even-horizontal' as const } };
    for (const [definition, title] of [
      [terminal, '“acme” opens a terminal'],
      [several, '“acme” opens 3 planes'],
      [tiled, '“acme” opens 3 tiled planes'],
    ] as const) {
      expect(richDefinition(definition)).toBe(true);
      const result = offer([definition]);
      expect(result?.reason).toBe('rich');
      expect(workspaceInsight(result!).title).toBe(title);
    }
    expect(workspaceInsight(offer([several])!).reason).toBe('Opens 3 planes');
  });

  it('takes the deepest root, and explicit definitions over found ones for the same root', () => {
    const outer = remembered(found(home + '/code', 'code'));
    const inner = remembered(found(), 3);
    expect(offer([outer, inner])?.definition.key).toBe(inner.key);
    const explicit = remembered(sampleDefinition('sample/acme', { root, name: 'acme' }), 2);
    expect(offer([inner, explicit])?.definition.key).toBe('sample/acme');
  });

  it('skips the workspace linked to the definition or mostly in its root', () => {
    const definition = remembered(found());
    const linked = elsewhere({
      definition: { key: definition.key, basis: definition.basis, source: 'found' },
    });
    expect(offer([definition], linked)).toBeUndefined();
    // two of three planes inside the root is most of the workspace
    const mostly = sampleWorkspace('current', {
      panes: [folder('a', root), folder('b', root + '/src'), folder('c', home + '/Downloads')],
    });
    expect(offer([definition], mostly)).toBeUndefined();
    // one of two is not
    const half = sampleWorkspace('current', {
      panes: [folder('a', root + '/src'), folder('c', home + '/Downloads')],
    });
    expect(offer([definition], half)?.reason).toBe('remembered');
    // a single plane browsing inside the root already is that workspace
    const single = sampleWorkspace('current', { panes: [folder('a', root + '/src')] });
    expect(offer([definition], single)).toBeUndefined();
  });

  it('switches to the workspace already open for the root', () => {
    const definition = found();
    const current = elsewhere();
    const open = sampleWorkspace('w3', {
      name: 'Workspace 3',
      definition: { key: definition.key, basis: definition.basis, source: 'found' },
    });
    const result = offer([definition], current, [current, open]);
    expect(result).toMatchObject({ reason: 'open-elsewhere', command: 'workspace:w3' });
    expect(workspaceInsight(result!)).toMatchObject({
      title: '“acme-site” is open in “Workspace 3”',
      reason: 'Has “acme-site” open',
      action: 'Switch',
    });
    const same = { ...open, name: 'acme-site' };
    expect(workspaceInsight(offer([definition], current, [current, same])!)).toMatchObject({
      title: '“acme-site” is already open',
      reason: 'Already open',
    });
    // a found link does not stand for an explicit definition that took its key
    const explicit = { ...remembered(definition), source: 'standalone' as const };
    expect(offer([explicit], current, [current, open])?.reason).toBe('remembered');
  });

  it('leaves out hidden definitions and missing roots', () => {
    expect(offer([{ ...remembered(found()), hidden: true }])).toBeUndefined();
    expect(offer([{ ...remembered(found()), rootState: 'missing' }])).toBeUndefined();
  });
});
