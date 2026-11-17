import { expect, it } from 'vitest';
import { definitionSourceNotice, definitionWasRemoved } from '../src/domain/workspaces/catalog';
import type {
  DefinitionCatalog,
  ProjectManagerReadState,
  WorkspaceDefinitionSource,
  FoundWorkspaceState,
} from '../src/domain/workspaces/definitions/schema';

const catalog = (
  state: ProjectManagerReadState,
  enabled: boolean | undefined,
  found?: FoundWorkspaceState,
): DefinitionCatalog => ({
  revision: 1,
  file: { path: '/data/workspaces.jsonc', state: 'read' },
  projectManager: {
    path: '/p.json',
    state,
    enabled,
    projects: 0,
    missing: 0,
    disabled: 0,
    remote: 0,
    duplicateKeys: 0,
  },
  ...(found ? { found: { state: found, count: 0, hidden: 0 } } : {}),
  definitions: [],
  diagnostics: [],
});
const linked = (source?: WorkspaceDefinitionSource) =>
  ({
    id: 'w',
    name: 'w',
    definition: { key: 'gone', basis: 'a'.repeat(64), ...(source ? { source } : {}) },
    panes: [],
    roots: [],
    arrangement: {},
  }) as never;

it('O1 every origin against every source state', () => {
  const rows: string[] = [];
  for (const source of [undefined, 'project-manager', 'override', 'standalone', 'found'] as const)
    for (const [label, state, enabled] of [
      ['undecided', 'undecided', undefined],
      ['off', 'off', false],
      ['absent-undecided', 'absent', undefined],
      ['absent-on', 'absent', true],
      ['read', 'read', true],
      ['unreadable', 'unreadable', true],
      ['needs-access', 'needs-access', true],
    ] as const)
      for (const found of ['loading', 'ready', 'off', undefined] as const) {
        if (source !== 'found' && found !== 'ready') continue;
        const value = catalog(state, enabled, found);
        const expected =
          source === 'found'
            ? found !== 'loading' && found !== 'off'
            : source === 'standalone' ||
              state === 'read' ||
              (state === 'absent' && enabled === true);
        expect(
          definitionWasRemoved(linked(source), value),
          label + ':' + source + ':' + found,
        ).toBe(expected);
        if (source === 'found' && found === 'off')
          expect(definitionSourceNotice(linked(source), value)).toBe('Finding workspaces is off.');
        rows.push(
          `${source ?? 'unknown'} | ${label} | found=${found} | removed=${definitionWasRemoved(linked(source), value)} | ${definitionSourceNotice(linked(source), value) ?? '-'}`,
        );
      }
});
