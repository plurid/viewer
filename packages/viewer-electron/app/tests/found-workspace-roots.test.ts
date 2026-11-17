import { expect, it } from 'vitest';
import type { FolderProbe } from '../src/domain/workspaces/folder-facts';
import {
  allowedFoundFolder,
  foundVolumeRoots,
  rootAncestors,
  rootFor,
} from '../src/domain/workspaces/found/roots';

const home = '/Users/sample';
const context = { home, localVolumes: ['/Volumes/Local'] };

it('never guesses that an unknown mount is local', () => {
  expect(allowedFoundFolder(home + '/code/sample', { home, ...foundVolumeRoots() })).toBe(false);
  expect(
    foundVolumeRoots([
      { path: '/', local: true },
      { path: '/Volumes/Local', local: true },
      { path: '/Volumes/Remote', local: false },
    ]),
  ).toEqual({ localVolumes: ['/Volumes/Local'], nonLocalRoots: ['/Volumes/Remote'] });
});
const probe = (
  path: string,
  markers: string[] = [],
  git?: FolderProbe['git'],
  workspaces = false,
): FolderProbe => ({
  ok: true,
  path,
  markers,
  git,
  package: { workspaces },
  capped: false,
  identity: { dev: 1n, ino: 1n },
});

it('rejects network mounts nested below home and recognizes the Data volume spelling', () => {
  expect(
    allowedFoundFolder(home + '/mount/project', { ...context, nonLocalRoots: [home + '/mount'] }),
  ).toBe(false);
  expect(allowedFoundFolder('/System/Volumes/Data' + home + '/code/sample', context)).toBe(true);
});

it.each([
  home,
  home + '/Desktop',
  home + '/Documents',
  home + '/Downloads',
  home + '/Movies',
  home + '/Music',
  home + '/Pictures',
  home + '/Public',
  '/Users/Shared',
  '/Volumes/Local',
])('never chooses a boundary as a root: %s', (folder) => {
  expect(
    rootFor(folder, new Map([[folder, probe(folder, [], 'directory')]]), context),
  ).toBeUndefined();
});

it.each([
  '/tmp/project',
  '/private/project',
  '/opt/homebrew/project',
  '/System/project',
  '/Users/other/code',
  '/Volumes/Remote/code',
  home + '/Library/code',
  home + '/.config/code',
  home + '/code/node_modules/pkg',
  home + '/code/.git/worktrees/sample',
  home + '/App.app/Contents',
  home + '/Homebrew/code',
])('excludes private, generated and non-local folders: %s', (folder) => {
  expect(allowedFoundFolder(folder, context)).toBe(false);
});

it('folds monorepos into the outermost git directory, with a hidden outer root falling back inside', () => {
  const outer = home + '/code/sample';
  const inner = outer + '/packages/web';
  const facts = new Map([
    [outer, probe(outer, [], 'directory')],
    [inner, probe(inner, ['package.json'])],
  ]);
  expect(rootFor(inner, facts, context)).toBe(outer);
  expect(rootFor(inner, facts, { ...context, hidden: [outer] })).toBe(inner);
});

it('prefers the nearest git file over workspace markers, and the outermost workspace over manifests', () => {
  const outer = home + '/code/sample';
  const middle = outer + '/packages';
  const inner = middle + '/web';
  const facts = new Map([
    [outer, probe(outer, ['pnpm-workspace.yaml'])],
    [middle, probe(middle, ['package.json'], undefined, true)],
    [inner, probe(inner, ['Cargo.toml'])],
  ]);
  expect(rootFor(inner, facts, context)).toBe(outer);
  facts.set(middle, probe(middle, ['.git'], 'worktree'));
  expect(rootFor(inner, facts, context)).toBe(middle);
  facts.set(inner, probe(inner, ['.git'], 'submodule'));
  expect(rootFor(inner, facts, context)).toBe(inner);
});

it.each([
  'package.json',
  'Cargo.toml',
  'pyproject.toml',
  'go.mod',
  'deno.json',
  'deno.jsonc',
  'Package.swift',
  'Sample.xcodeproj',
  'Sample.xcworkspace',
  'Gemfile',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'composer.json',
  'mix.exs',
])('recognizes a manifest: %s', (marker) => {
  const folder = home + '/code/sample';
  expect(rootFor(folder, new Map([[folder, probe(folder, [marker])]]), context)).toBe(folder);
});

it.each(['Makefile', 'justfile', 'Procfile'])(
  'does not infer a workspace from %s alone',
  (marker) => {
    const folder = home + '/code/sample';
    expect(rootFor(folder, new Map([[folder, probe(folder, [marker])]]), context)).toBeUndefined();
  },
);

it('bounds ancestry to sixteen levels and stops at Store scope roots', () => {
  const scope = home + '/code';
  const folder = scope + '/sample/src';
  expect(rootAncestors(folder, { ...context, scopeRoot: scope })).toEqual([
    folder,
    scope + '/sample',
    scope,
  ]);
  expect(rootAncestors(home + '/' + Array(30).fill('child').join('/'), context)).toHaveLength(16);
});
