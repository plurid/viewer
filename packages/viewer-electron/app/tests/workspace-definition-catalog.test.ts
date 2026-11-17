import { describe, expect, it } from 'vitest';
import { parse } from 'jsonc-parser';
import type { WorkspaceProject } from '../src/domain/workspaces/definitions/schema';
import {
  definitionEntrySchema,
  workspacesFileSchema,
} from '../src/domain/workspaces/definitions/schema';
import { resolveCatalog } from '../src/domain/workspaces/definitions/catalog';
import { decodeProjects } from '../src/desktop/workspaces/project-manager';
import { hashDefinition, sampleProject } from './workspace-definition-fixtures';

const catalog = (
  workspaces: Record<string, unknown>,
  projects: WorkspaceProject[] = [sampleProject()],
  text?: string,
) =>
  resolveCatalog({
    file: workspacesFileSchema.parse({ version: 1, workspaces }),
    projects,
    home: '/home/sample',
    hash: hashDefinition,
    text,
  });

describe('independently validated workspace definitions', () => {
  it('makes 324 stubs without live workspace records, including extra paths and tags', () => {
    const projects = Array.from({ length: 324 }, (_, index) =>
      sampleProject(`group/project-${index}`),
    );
    projects[0] = sampleProject('group/site', {
      name: 'Group > site',
      paths: ['/shared/assets'],
      tags: ['client'],
    });
    const result = catalog({}, projects);
    expect(result.definitions).toHaveLength(324);
    expect(result.definitions[0]).toMatchObject({
      name: 'Group site',
      aliases: ['client'],
      source: 'project-manager',
    });
    expect(result.definitions[0]!.planes.map((item) => item.plane)).toEqual([
      { kind: 'folder', path: '/projects/group/site' },
      { kind: 'folder', path: '/shared/assets' },
    ]);
  });
  it('overrides a stub while inheriting its root and builds a standalone entry', () => {
    const result = catalog({
      'sample/site': { name: 'Site', aliases: ['ss'], curated: true },
      'separate/app': { root: '~/Projects/separate', hidden: true },
    });
    expect(result.definitions[0]).toMatchObject({
      name: 'Site',
      root: '/projects/sample/site',
      source: 'override',
      curated: true,
    });
    expect(result.definitions[1]).toMatchObject({
      root: '/home/sample/Projects/separate',
      hidden: true,
      source: 'standalone',
    });
  });
  it('falls back to a stub for an invalid override and retains its valid neighbor', () => {
    const result = catalog({
      'sample/site': { planes: [{ kind: 'terminal', path: '.', command: 'bad\ncommand' }] },
      'other/site': { root: '/other' },
    });
    expect(result.definitions[0]).toMatchObject({ source: 'project-manager' });
    expect(result.definitions).toHaveLength(2);
    expect(result.diagnostics[0]!.message).toContain('command');
  });
  it('reports unknown standalone keys with a suggestion', () => {
    const result = catalog({ 'sample/sit': { name: 'typo' } });
    expect(result.definitions).toHaveLength(1);
    expect(result.diagnostics[0]!.message).toContain('Did you mean “sample/site”');
  });
  it('uses the later duplicate key and names both lines', () => {
    const text =
      '{"version":1,"workspaces":{\n"sample/site":{"name":"First"},\n"sample/site":{"name":"Last"}\n}}';
    const result = catalog(parse(text).workspaces, undefined, text);
    expect(result.definitions[0]!.name).toBe('Last');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        line: 3,
        key: 'sample/site',
        message: expect.stringContaining('lines 2 and 3'),
      }),
    );
  });
  it('drops only an unresolvable plane and retains original indexes', () => {
    const result = catalog({
      'sample/site': {
        planes: [
          { kind: 'folder', path: '{{ROOT:missing}}' },
          { kind: 'terminal', path: '.', command: 'npm run dev' },
        ],
      },
    });
    expect(result.definitions[0]!.planes).toEqual([
      {
        index: 1,
        plane: { kind: 'terminal', path: '/projects/sample/site', command: 'npm run dev' },
      },
    ]);
    expect(result.diagnostics[0]!.message).toContain('Plane 0 is left out');
  });
  it('refuses cyclic and overdeep standalone roots and resolves a named root chain', () => {
    expect(
      catalog({ a: { root: '{{ROOT:b}}' }, b: { root: '{{ROOT:a}}' } }, []).definitions,
    ).toEqual([]);
    const good = catalog(
      { a: { root: '/a' }, b: { root: '{{ROOT:a}}/b' }, c: { root: '{{ROOT:b}}/c' } },
      [],
    );
    expect(good.definitions.at(-1)!.root).toBe('/a/b/c');
    const deep = catalog(
      {
        a: { root: '{{ROOT:b}}' },
        b: { root: '{{ROOT:c}}' },
        c: { root: '{{ROOT:d}}' },
        d: { root: '{{ROOT:e}}' },
        e: { root: '/e' },
      },
      [],
    );
    expect(deep.diagnostics.some((problem) => problem.message.includes('depth'))).toBe(true);
    const reversed = catalog(
      {
        e: { root: '/e' },
        d: { root: '{{ROOT:e}}' },
        c: { root: '{{ROOT:d}}' },
        b: { root: '{{ROOT:c}}' },
        a: { root: '{{ROOT:b}}' },
      },
      [],
    );
    expect(reversed.definitions.some((definition) => definition.key === 'a')).toBe(false);
  });
  it('falls back from an invalid override root and notes an explicit replacement', () => {
    expect(
      catalog({ 'sample/site': { root: '{{ROOT}}/src', name: 'Override' } }).definitions[0],
    ).toMatchObject({ source: 'project-manager' });
    const good = catalog({ 'sample/site': { root: '/replacement' } });
    expect(good.definitions[0]!.root).toBe('/replacement');
    expect(good.diagnostics[0]!.level).toBe('note');
  });
  it('carries missing and unknown root states without changing the basis', () => {
    const input = {
      file: workspacesFileSchema.parse({ version: 1 }),
      projects: [sampleProject()],
      home: '/home/sample',
      hash: hashDefinition,
    };
    const first = resolveCatalog(input).definitions[0]!;
    const missing = resolveCatalog({ ...input, rootStates: new Map([[first.root, 'missing']]) });
    expect(missing.definitions[0]).toMatchObject({ basis: first.basis, rootState: 'missing' });
    expect(first.basis).toMatch(/^[a-f0-9]{64}$/);
    expect(missing.diagnostics[0]!.message).toContain('missing');
  });
  it('has a stable basis across object property order and changes it with a command', () => {
    const a = catalog({ 'sample/site': { name: 'Same', aliases: ['same'] } }).definitions[0]!;
    const b = catalog({ 'sample/site': { aliases: ['same'], name: 'Same' } }).definitions[0]!;
    expect(a.basis).toBe(b.basis);
    expect(
      catalog({
        'sample/site': { planes: [{ kind: 'terminal', path: '.', command: 'echo example' }] },
      }).definitions[0]!.basis,
    ).not.toBe(a.basis);
  });
  it('reports unknown profiles and uses the default ones', () => {
    const result = resolveCatalog({
      file: workspacesFileSchema.parse({
        version: 1,
        workspaces: {
          'sample/site': {
            terminalProfile: 'missing',
            look: { profile: 'missing' },
            planes: [{ kind: 'terminal', path: '.', profileID: 'missing' }],
          },
        },
      }),
      projects: [sampleProject()],
      home: '/home/sample',
      hash: hashDefinition,
      terminalProfiles: ['login'],
      settingProfiles: ['focus'],
    });
    expect(result.diagnostics).toHaveLength(3);
    expect(result.definitions[0]!.terminalProfile).toBeUndefined();
    expect(result.definitions[0]!.look?.profile).toBeUndefined();
  });
  it('validates focus, split references, presentation values and all entry limits', () => {
    expect(catalog({ 'sample/site': { focus: 2 } }).definitions[0]!.source).toBe('project-manager');
    expect(
      catalog({ 'sample/site': { tiling: { layout: 'tiled', split: { plane: 2 } } } })
        .definitions[0]!.source,
    ).toBe('project-manager');
    for (const invalid of [
      { aliases: Array(11).fill('a') },
      { planes: Array(31).fill({ kind: 'scratch' }) },
      { look: { overrides: { 'settings.browsing.confirmTrash': false } } },
      { extends: 'other' },
      { planes: [{ kind: 'terminal', path: '.', command: 'x'.repeat(1001) }] },
    ])
      expect(definitionEntrySchema.safeParse(invalid).success).toBe(false);
    expect(
      workspacesFileSchema.safeParse({
        version: 1,
        workspaces: Object.fromEntries(
          Array.from({ length: 2001 }, (_, index) => [String(index), {}]),
        ),
      }).success,
    ).toBe(false);
  });
});

describe('lenient Project Manager reader', () => {
  it('counts disabled, remote and duplicate projects and expands home without evaluating input', () => {
    const result = decodeProjects(
      JSON.stringify([
        {
          name: 'North > site',
          rootPath: '~/north',
          paths: ['$home/assets'],
          tags: ['work'],
          favorite: true,
        },
        { name: 'North > site', rootPath: '$home/north-again' },
        { name: 'Off', enabled: false },
        { name: 'Remote', rootPath: 'vscode-remote://host/path' },
        { name: 'URI', rootPath: 'file://host/path' },
        { malformed: true },
      ]),
      '/source/projects.json',
      '/home/sample',
    );
    expect(result.status).toMatchObject({ projects: 6, disabled: 1, remote: 2, duplicateKeys: 1 });
    expect(result.projects).toHaveLength(2);
    expect(result.projects[0]).toMatchObject({
      key: 'North/site',
      root: '/home/sample/north',
      paths: ['/home/sample/assets'],
      tags: ['work'],
    });
    expect(result.projects[1]!.key).toBe('North/site-2');
    expect(result.diagnostics.every((problem) => problem.line === 1)).toBe(true);
  });
  it('refuses oversize, oversized entry counts and broken documents with a line', () => {
    expect(() => decodeProjects(' '.repeat(8 * 1024 * 1024 + 1), '/source', '/home')).toThrow(
      'exceeds',
    );
    expect(() =>
      decodeProjects(JSON.stringify(Array(5001).fill({})), '/source', '/home'),
    ).toThrow();
    expect(() => decodeProjects('[\ninvalid]', '/source', '/home')).toThrow('line 2');
  });
});
