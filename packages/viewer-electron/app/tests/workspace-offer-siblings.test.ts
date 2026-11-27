import { describe, expect, it } from 'vitest';
import type { FolderPane, Workspace } from '../src/domain/contracts';
import type { WorkspaceDefinition } from '../src/domain/workspaces/definitions/schema';
import { workspaceOffer } from '../src/domain/workspaces/offer';

const root = '/Users/sample/Projects/acme';
const folder = (id: string, p: string): FolderPane => ({
  id,
  type: 'folder',
  path: p,
  mode: 'list',
  sort: 'name',
  descending: false,
  showHidden: false,
  history: [p],
  historyIndex: 0,
});

const current: Workspace = {
  id: 'ws-current',
  name: 'Workspace',
  panes: [folder('p1', '/Users/sample/Downloads'), folder('p2', '/Users/sample/Desktop')],
  roots: ['p1', 'p2'],
  arrangement: {},
  activePane: 'p1',
};

const def = (key: string, extra: Partial<WorkspaceDefinition> = {}): WorkspaceDefinition => ({
  key,
  name: key,
  root,
  source: 'standalone',
  planes: [{ index: 0, plane: { kind: 'folder', path: root } }],
  aliases: [],
  curated: false,
  hidden: false,
  rootState: 'present',
  basis: 'a'.repeat(64),
  ...extra,
});

const richDev = def('acme/dev', {
  planes: [
    { index: 0, plane: { kind: 'folder', path: root } },
    { index: 1, plane: { kind: 'folder', path: root + '/src' } },
    { index: 2, plane: { kind: 'terminal', path: root } },
  ],
});

describe('hidden or plain definition hides sibling definition on same root', () => {
  it('offers acme/dev when it is the first definition for the root', () => {
    const hiddenOld = def('acme/old', { hidden: true });
    const offer = workspaceOffer({
      folder: root + '/src',
      current,
      workspaces: [current],
      definitions: [richDev, hiddenOld],
    });
    expect(offer?.definition.key).toBe('acme/dev');
  });

  it('offers acme/dev even when a hidden definition for the same root precedes it', () => {
    const hiddenOld = def('acme/old', { hidden: true });
    const offer = workspaceOffer({
      folder: root + '/src',
      current,
      workspaces: [current],
      definitions: [hiddenOld, richDev],
    });
    expect(offer?.definition.key).toBe('acme/dev');
  });

  it('offers a remembered definition even when a plain definition for the same root precedes it', () => {
    const plain = def('acme/plain');
    const remembered = def('acme/remembered', {
      remembered: { at: 1, basis: 'a'.repeat(64), planes: 3 },
    });
    const offer = workspaceOffer({
      folder: root + '/src',
      current,
      workspaces: [current],
      definitions: [plain, remembered],
    });
    expect(offer?.definition.key).toBe('acme/remembered');
  });
});
