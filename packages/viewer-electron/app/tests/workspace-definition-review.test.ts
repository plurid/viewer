import { describe, expect, it, vi } from 'vitest';
import { parse } from 'jsonc-parser';
import type { CatalogInput } from '../src/domain/workspaces/definitions/catalog';
import { resolveCatalog } from '../src/domain/workspaces/definitions/catalog';
import { workspacesFileSchema } from '../src/domain/workspaces/definitions/schema';
import { decodeProjects } from '../src/desktop/workspaces/project-manager';
import { hashDefinition, sampleProject } from './workspace-definition-fixtures';

const resolve = (workspaces: Record<string, unknown>, extra: Partial<CatalogInput> = {}) =>
  resolveCatalog({
    file: workspacesFileSchema.parse({ version: 1, workspaces }),
    projects: [sampleProject()],
    home: '/home/sample',
    hash: hashDefinition,
    ...extra,
  });

describe('workspace catalog review regressions', () => {
  it('separates an unrecognized override key from the plain-project fallback with a period', () => {
    const result = resolve({ 'sample/site': { nmae: 'Sample' } });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        message: 'Unrecognized key: "nmae". The plain project stays in effect.',
      }),
    );
  });
  it('explains dot segments and excess segments in Project Manager names precisely', () => {
    const result = decodeProjects(
      JSON.stringify([
        { name: 'Sample > .', rootPath: '/one' },
        { name: 'Sample > ..', rootPath: '/two' },
        { name: 'a > b > c > d > e > f > g > h > i', rootPath: '/three' },
      ]),
      '/source/projects.json',
      '/home/sample',
    );
    expect(result.projects).toEqual([]);
    expect(result.diagnostics.map((issue) => issue.message)).toEqual([
      'The derived project key contains a "." or ".." segment.',
      'The derived project key contains a "." or ".." segment.',
      'The derived project key has 9 segments; at most eight are allowed.',
    ]);
  });
  it('opens a root folder if every written plane was skipped and explains each skip', () => {
    const result = resolve({
      'sample/site': {
        planes: [
          { kind: 'folder', path: '{{ROOT:unknown}}' },
          { kind: 'file', path: '{{ROOT:other}}' },
        ],
      },
    });
    expect(result.definitions[0]!.planes).toEqual([
      { index: -1, plane: { kind: 'folder', path: '/projects/sample/site' } },
    ]);
    expect(result.diagnostics.map((issue) => issue.message).join('\n')).toMatch(
      /Plane 0.*\nPlane 1.*\nAll planes were skipped/,
    );
  });
  it('resolves a standalone root reference written as an arrow name', () => {
    const result = resolve(
      {
        'other/api': { root: '/other' },
        child: { root: '{{ROOT:other > api}}/child' },
      },
      { projects: [] },
    );
    expect(result.definitions.find((item) => item.key === 'child')!.root).toBe('/other/child');
    expect(result.definitions[0]!.name).toBe('other api');
  });
  it('reports an invalid field at its own line and explains the override fallback once', () => {
    const text = `{
  "version": 1,
  "workspaces": {
    "sample/site": {
      "planes": [
        { "kind": "folder", "path": "." },
        {
          "kind": "terminal",
          "path": ".",
          "command": "bad\\ncommand"
        }
      ]
    }
  }
}`;
    const result = resolve(parse(text).workspaces, { text });
    expect(result.definitions[0]!.source).toBe('project-manager');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        line: 10,
        key: 'sample/site',
        message: expect.stringMatching(
          /^planes\.1\.command: .*The plain project stays in effect\.$/,
        ),
      }),
    );
    expect(result.diagnostics.every((issue) => !issue.message.includes('sample/site'))).toBe(true);
  });
  it.each(['off', 'absent', 'needs-access'] as const)(
    'groups waiting overrides when the source is %s',
    (state) => {
      const result = resolve(
        {
          'sample/site': {},
          'sample/api': { name: 'API' },
          standalone: { root: '/standalone' },
        },
        { projects: [], projectManagerState: state },
      );
      expect(result.definitions.map((item) => item.key)).toEqual(['standalone']);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]).toMatchObject({
        level: 'note',
        message: expect.stringContaining('2 overrides'),
      });
    },
  );
  it('canonicalizes the fields that build a workspace in code-point order', () => {
    const a = resolve({
      'sample/site': {
        look: {
          overrides: {
            'ui.space.grid': false,
            'ui.space.color': '#123456',
          },
        },
      },
    }).definitions[0]!;
    const b = resolve({
      'sample/site': {
        look: {
          overrides: {
            'ui.space.color': '#123456',
            'ui.space.grid': false,
          },
        },
      },
    }).definitions[0]!;
    expect(a.basis).toBe(b.basis);
    const locale = vi.spyOn(String.prototype, 'localeCompare').mockImplementation(() => {
      throw new Error('Basis ordering must not depend on the locale.');
    });
    try {
      expect(resolve({ 'sample/site': { look: a.look } }).definitions[0]!.basis).toBe(a.basis);
    } finally {
      locale.mockRestore();
    }
  });
  it('ignores discovery metadata in the basis but changes it for each build field', () => {
    const baseline = resolve({}).definitions[0]!.basis;
    expect(
      resolve(
        {
          'sample/site': {
            name: 'New label',
            aliases: ['new'],
            hidden: true,
            curated: true,
          },
        },
        { projects: [sampleProject('sample/site', { name: 'Renamed > site', tags: ['tag'] })] },
      ).definitions[0]!.basis,
    ).toBe(baseline);
    for (const change of [
      { root: '/replacement' },
      { planes: [{ kind: 'terminal', path: '.', command: 'echo sample' }] },
      { tiling: { layout: 'tiled' } },
      { focus: 0 },
      { terminalProfile: 'login' },
      { look: { spaceColor: '#123456' } },
    ])
      expect(resolve({ 'sample/site': change }).definitions[0]!.basis).not.toBe(baseline);
  });
  it('bounds expensive suggestions at the source and override limits', () => {
    const work = { suggestions: 0 };
    const projects = Array.from({ length: 5000 }, (_, index) =>
      sampleProject(`sample/project-${index}`),
    );
    const unknown = Object.fromEntries(
      Array.from({ length: 200 }, (_, index) => [`sample/projct-${index}`, {}]),
    );
    const result = resolve(unknown, { projects, work });
    expect(result.definitions).toHaveLength(5000);
    expect(result.diagnostics).toHaveLength(200);
    expect(work.suggestions).toBeGreaterThan(0);
    expect(work.suggestions).toBeLessThanOrEqual(200 * 16);
  });
});
