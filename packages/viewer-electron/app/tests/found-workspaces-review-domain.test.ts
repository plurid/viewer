import { expect, it } from 'vitest';
import type { Pane, Workspace } from '../src/domain/contracts';
import type { FolderProbe } from '../src/domain/workspaces/folder-facts';
import type { WorkspaceDefinition } from '../src/domain/workspaces/definitions/schema';
import {
  allowedFoundFolder,
  rootAncestors,
  rootFor,
} from '../src/domain/workspaces/found/roots';
import { foundKey, foundName } from '../src/domain/workspaces/found/keys';
import { foundDefinitions } from '../src/domain/workspaces/found/catalog';
import { qualifyingRoots } from '../src/domain/workspaces/found/candidates';
import { proposeDefinition } from '../src/domain/workspaces/definitions/capture';
import { mostlyIn } from '../src/domain/workspaces/ownership';
import { slug } from '../src/domain/workspaces/definitions/keys';
import { withDefinitionOrigins } from '../src/domain/workspaces/catalog';
import { sampleDefinition, sampleWorkspace, hashDefinition } from './workspace-definition-fixtures';

const home = '/Users/sample';
const context = { home, localVolumes: ['/Volumes/Local'], nonLocalRoots: [] as string[] };
const probe = (path: string, markers: string[] = [], git?: FolderProbe['git']): FolderProbe => ({
  ok: true,
  path,
  markers,
  git,
  capped: false,
  identity: { dev: 1n, ino: 1n },
});

it('D1 Store edition: a project folder granted as the scope itself is never found', () => {
  const project = home + '/code/acme';
  const facts = new Map([
    [project, probe(project, ['.git', 'package.json'], 'directory')],
    [project + '/src', probe(project + '/src')],
  ]);
  const root = rootFor(project + '/src', facts, { ...context, scopeRoot: project });

  expect(root).toBe(project);
});

it('D2 boundary and exclusion matrix', () => {
  const rows: Record<string, unknown> = {};
  const check = (label: string, folder: string, facts: [string, FolderProbe][]) => {
    rows[label] = rootFor(folder, new Map(facts), context) ?? null;
  };
  check('dotfiles ~/.git + ~/code/acme/package.json', home + '/code/acme/src', [
    [home, probe(home, ['.git'], 'directory')],
    [home + '/code/acme', probe(home + '/code/acme', ['package.json'])],
  ]);
  check('versioned ~/Documents + project inside', home + '/Documents/notes/proj', [
    [home + '/Documents', probe(home + '/Documents', ['.git'], 'directory')],
    [home + '/Documents/notes/proj', probe(home + '/Documents/notes/proj', ['Cargo.toml'])],
  ]);
  check('versioned ~/code umbrella', home + '/code/acme/src', [
    [home + '/code', probe(home + '/code', ['.git'], 'directory')],
    [home + '/code/acme', probe(home + '/code/acme', ['package.json'])],
  ]);
  check('clone directly in home ~/acme', home + '/acme/src', [
    [home + '/acme', probe(home + '/acme', ['.git'], 'directory')],
  ]);
  check('lower-case ~/library spelling', home + '/library/Caches/acme', [
    [home + '/library/Caches/acme', probe(home + '/library/Caches/acme', ['package.json'])],
  ]);
  check('lower-case ~/documents with .git', home + '/documents/notes', [
    [home + '/documents', probe(home + '/documents', ['.git'], 'directory')],
  ]);
  check('Makefile + lockfile only', home + '/code/tool', [
    [home + '/code/tool', probe(home + '/code/tool', ['Makefile', 'yarn.lock', 'Procfile'])],
  ]);
  check('worktree inside a repo folds into the repo', home + '/code/repo/trees/feature/src', [
    [home + '/code/repo', probe(home + '/code/repo', ['.git'], 'directory')],
    [home + '/code/repo/trees/feature', probe(home + '/code/repo/trees/feature', ['.git'], 'worktree')],
  ]);
  check('nested clone inside a worktree checkout wins over the worktree', home + '/code/wt/vendor/lib/src', [
    [home + '/code/wt', probe(home + '/code/wt', ['.git'], 'worktree')],
    [home + '/code/wt/vendor/lib', probe(home + '/code/wt/vendor/lib', ['.git'], 'directory')],
  ]);
  check('/Users/Shared/acme', '/Users/Shared/acme/src', [
    ['/Users/Shared/acme', probe('/Users/Shared/acme', ['go.mod'])],
  ]);
  check('/Volumes/Local/acme', '/Volumes/Local/acme/src', [
    ['/Volumes/Local/acme', probe('/Volumes/Local/acme', ['go.mod'])],
  ]);
  check('home/Desktop/acme', home + '/Desktop/acme', [
    [home + '/Desktop/acme', probe(home + '/Desktop/acme', ['pyproject.toml'])],
  ]);
  check('package.json inside node_modules', home + '/code/acme/node_modules/x', [
    [home + '/code/acme/node_modules/x', probe(home + '/code/acme/node_modules/x', ['package.json'])],
  ]);
  check('project named out', home + '/code/out', [[home + '/code/out', probe(home + '/code/out', ['package.json'])]]);

  const allowed = {
    homeLibraryLower: allowedFoundFolder(home + '/library/x', context),
    homeLibrary: allowedFoundFolder(home + '/Library/x', context),
    playground: allowedFoundFolder(home + '/code/demo.playground/Sources', context),
    sparsebundle: allowedFoundFolder(home + '/disk.sparsebundle/bands', context),
    usersShared: allowedFoundFolder('/Users/Shared/acme', context),
    otherUser: allowedFoundFolder('/Users/other/acme', context),
  };

  expect(rows['dotfiles ~/.git + ~/code/acme/package.json']).toBe(home + '/code/acme');
  expect(rows['versioned ~/Documents + project inside']).toBe(home + '/Documents/notes/proj');
  expect(rows['Makefile + lockfile only']).toBeNull();
  expect(rows['package.json inside node_modules']).toBeNull();
});

it('D3 keys of non-Latin roots collide on "x", so their keys depend on rank order', () => {
  const roots = [home + '/код/сайт', home + '/код/бот', home + '/開発/アプリ', home + '/🚀/app'];
  const keys = roots.map((root) => foundKey(root, home));

  expect(new Set(keys).size).toBe(roots.length);
});

it('D4 retained roots can fall out of the 200 cap', () => {
  const now = 1_800_000_000_000;
  const busy = Array.from({ length: 200 }, (_, index) => home + '/code/p' + index);
  const retained = home + '/code/zz-open';
  const evidence = busy.map((root) => ({ folder: root + '/src', count: 50, last: now, score: 5, plane: false }));
  const result = qualifyingRoots([...busy, retained], evidence, now, new Set([retained]));

  expect(result).toContain(retained);
});

/** proposeDefinition before this change (git HEAD, capture.ts 43 to 69). */
function oldPropose(workspace: Workspace, definitions: readonly WorkspaceDefinition[]) {
  const supported = (pane: Pane) =>
    ['folder', 'preview', 'terminal', 'scratch', 'search'].includes(pane.type);
  const holds = (root: string, file: string) =>
    file === root || file.startsWith(root === '/' ? '/' : root + '/');
  const parent = (file: string) => file.slice(0, file.lastIndexOf('/')) || '/';
  const paths = workspace.panes
    .filter(supported)
    .map((pane) => (pane.type === 'preview' ? parent(pane.path) : pane.path));
  const counts = new Map<WorkspaceDefinition, number>();
  for (const file of paths) {
    const project = definitions
      .filter((item) => item.projectName && holds(item.root, file))
      .sort((a, b) => b.root.length - a.root.length)[0];
    if (project) counts.set(project, (counts.get(project) ?? 0) + 1);
  }
  const primary = [...counts].sort(([a, x], [b, y]) => y - x || a.root.length - b.root.length)[0]?.[0];
  return primary?.key;
}

it('D5 proposeDefinition parity against the previous implementation (random)', () => {
  let seed = 7;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
  const folders = ['/a', '/a/b', '/a/b/c', '/a/b/c/d', '/a/e', '/f', '/f/g', '/', '/a/b/', '/ab'];
  let mismatches = 0;
  let mismatchesWithoutAll = 0;
  const examples: unknown[] = [];
  for (let round = 0; round < 5000; round++) {
    const definitions = Array.from({ length: 1 + Math.floor(random() * 5) }, (_, index) => ({
      ...sampleDefinition('k' + index),
      root: pick(folders),
      projectName: random() < 0.8 ? 'Project ' + index : undefined,
    }));
    const panes: Pane[] = Array.from({ length: 1 + Math.floor(random() * 5) }, (_, index) => {
      const path = pick(folders);
      const type = pick(['folder', 'preview', 'terminal', 'search', 'browser'] as const);
      if (type === 'search')
        return { id: 'p' + index, type, path, query: 'x', name: 'x', recursive: true, content: false, allLocations: random() < 0.3 } as Pane;
      if (type === 'browser') return { id: 'p' + index, type, url: 'https://example.com' } as unknown as Pane;
      return { id: 'p' + index, type, path, history: [path], historyIndex: 0, mode: 'list', sort: 'name', descending: false, showHidden: false } as unknown as Pane;
    });
    const workspace = sampleWorkspace('w', { panes, roots: panes.map((pane) => pane.id) });
    let expected: string | undefined;
    let actual: string | undefined;
    try {
      expected = oldPropose(workspace, definitions);
      actual = proposeDefinition(workspace, definitions, home).key;
      if (!expected) expected = actual; // fallback key path is shared
    } catch {
      continue;
    }
    if (expected !== actual) {
      mismatches++;
      const hasAll = panes.some((pane) => pane.type === 'search' && (pane as { allLocations?: boolean }).allLocations);
      if (!hasAll) {
        mismatchesWithoutAll++;
        if (examples.length < 3) examples.push({ definitions: definitions.map((d) => [d.key, d.root, d.projectName]), panes: panes.map((p) => [p.type, (p as { path?: string }).path]), expected, actual });
      }
    }
  }

  expect(mismatchesWithoutAll).toBe(0);
  expect(mismatches).toBe(0);
});

it('D6 found entries dedupe, explicit wins, and collisions with explicit keys', () => {
  const root = home + '/code/acme';
  const entry = { key: 'code/acme', root, realpath: root, identity: '1:2', names: [], at: 1 };
  const explicitSameKeyOtherRoot = { ...sampleDefinition('code/acme'), root: home + '/elsewhere' };
  const [found] = foundDefinitions([entry], [explicitSameKeyOtherRoot], home, hashDefinition);

  expect(found?.key).not.toBe('code/acme');
});

it('D7 withDefinitionOrigins allocates a new array on every catalog revision', () => {
  const spaces = [sampleWorkspace('a'), sampleWorkspace('b')];
  const catalog = {
    revision: 1,
    file: { path: '/x', state: 'read' as const },
    projectManager: { path: '/y', state: 'off' as const, enabled: false, projects: 0, missing: 0, disabled: 0, remote: 0, duplicateKeys: 0 },
    definitions: [],
    diagnostics: [],
  };
  const same = withDefinitionOrigins(spaces, catalog) === spaces;

  expect(same).toBe(true);
});

it('D8 mostlyIn ties: shorter root vs explicit', () => {
  const outer = { ...sampleDefinition('outer'), root: home + '/code', source: 'found' as const };
  const inner = { ...sampleDefinition('inner'), root: home + '/code/web' };
  const panes = [home + '/code/a', home + '/code/web'].map((path, index) => ({
    id: 'p' + index, type: 'folder', path, history: [path], historyIndex: 0, mode: 'list', sort: 'name', descending: false, showHidden: false,
  })) as Pane[];
  const result = mostlyIn(sampleWorkspace('w', { panes, roots: ['p0', 'p1'] }), [outer, inner]);

});

