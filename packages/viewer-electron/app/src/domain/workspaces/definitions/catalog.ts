import { findNodeAtLocation, parseTree } from 'jsonc-parser';
import type { Node } from 'jsonc-parser';
import type {
  DefinitionEntry,
  DefinitionProblem,
  DefinitionRootState,
  ProjectManagerReadState,
  ResolvedDefinitionPlane,
  WorkspaceDefinition,
  WorkspaceProject,
  WorkspacesFile,
} from './schema';
import { definitionEntrySchema, definitionKeySchema } from './schema';
import { keyFor, stubName } from './keys';
import { normalizedProjectName, resolveDefinitionPath } from './paths';
import { fuzzyPathScore } from '../../search/path-fuzzy';
import { typoScore } from '../../search/approximate';

export function sourceLines(text: string): (offset: number) => number {
  const starts = [0];
  for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1))
    starts.push(index + 1);
  return (offset) => {
    let low = 0;
    let high = starts.length;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (starts[middle]! <= offset) low = middle;
      else high = middle;
    }
    return low + 1;
  };
}

export function definitionLocations(text: string): {
  lines: Map<string, number>;
  diagnostics: DefinitionProblem[];
  lineFor(key: string, path?: readonly (string | number)[]): number | undefined;
} {
  const lines = new Map<string, number>();
  const nodes = new Map<string, Node>();
  const diagnostics: DefinitionProblem[] = [];
  const lineAt = sourceLines(text);
  const tree = parseTree(text, [], { allowTrailingComma: true, disallowComments: false });
  const workspaces = tree?.children?.find((node) => node.children?.[0]?.value === 'workspaces')
    ?.children?.[1];
  for (const property of workspaces?.children ?? []) {
    const key = String(property.children?.[0]?.value);
    const line = lineAt(property.offset);
    const earlier = lines.get(key);
    if (earlier !== undefined)
      diagnostics.push({
        source: 'workspaces.jsonc',
        level: 'warning',
        key,
        line,
        message: `“${key}” is defined at lines ${earlier} and ${line}. The later one is used.`,
      });
    lines.set(key, line);
    const value = property.children?.[1];
    if (value) nodes.set(key, value);
  }
  return {
    lines,
    diagnostics,
    lineFor: (key, path = []) => {
      const node = nodes.get(key);
      const issue = node && findNodeAtLocation(node, [...path]);
      return issue ? lineAt(issue.offset) : lines.get(key);
    },
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

export function definitionBasis(
  definition: Pick<
    WorkspaceDefinition,
    'root' | 'planes' | 'tiling' | 'focus' | 'terminalProfile' | 'look'
  >,
  hash: (text: string) => string,
): string {
  return hash(
    JSON.stringify(
      canonical({
        root: definition.root,
        planes: definition.planes,
        tiling: definition.tiling,
        focus: definition.focus,
        terminalProfile: definition.terminalProfile,
        look: definition.look,
      }),
    ),
  );
}

export interface CatalogInput {
  file: WorkspacesFile;
  projects: readonly WorkspaceProject[];
  home: string;
  text?: string;
  rootStates?: ReadonlyMap<string, DefinitionRootState>;
  hash: (text: string) => string;
  terminalProfiles?: readonly string[];
  settingProfiles?: readonly string[];
  projectManagerState?: ProjectManagerReadState;
  work?: { suggestions: number };
}

export const missingDefinitionRoot =
  'The root folder is missing. This workspace is left out of search.';

/** Cheap leaf and namespace comparisons keep edit-distance work to sixteen candidates per typo. */
function suggestionFor(
  key: string,
  candidates: readonly string[],
  work?: CatalogInput['work'],
): string | undefined {
  const lower = key.toLowerCase();
  const parent = lower.slice(0, lower.lastIndexOf('/') + 1);
  const leaf = lower.slice(parent.length);
  const best: { key: string; score: number }[] = [];
  for (const candidate of candidates) {
    const split = candidate.lastIndexOf('/') + 1;
    const other = candidate.slice(split);
    let prefix = 0;
    while (prefix < Math.min(leaf.length, other.length) && leaf[prefix] === other[prefix]) prefix++;
    if (!prefix || Math.abs(leaf.length - other.length) > 4) continue;
    const score =
      (candidate.slice(0, split) === parent ? 1000 : 0) +
      prefix * 20 -
      Math.abs(leaf.length - other.length);
    if (best.length === 16 && score <= best[15]!.score) continue;
    best.push({ key: candidate, score });
    best.sort((a, b) => b.score - a.score);
    if (best.length > 16) best.pop();
  }
  let suggestion: string | undefined;
  let high = 0;
  for (const candidate of best) {
    if (work) work.suggestions++;
    const score = Math.max(fuzzyPathScore(candidate.key, lower), typoScore(candidate.key, lower));
    if (score > high) {
      high = score;
      suggestion = candidate.key;
    }
  }
  return suggestion;
}

export function resolveCatalog(input: CatalogInput): {
  definitions: WorkspaceDefinition[];
  diagnostics: DefinitionProblem[];
  rootProblems: Map<string, DefinitionProblem>;
} {
  const { file, projects, home, hash } = input;
  const { diagnostics, lineFor } = definitionLocations(input.text ?? '');
  const stubs = new Map(projects.map((project) => [project.key, project]));
  const entries = new Map<string, DefinitionEntry>();
  const candidates = projects.map((project) => project.key.toLowerCase());
  const originalKeys = new Map(projects.map((project) => [project.key.toLowerCase(), project.key]));
  let waiting = 0;
  const problem = (
    key: string,
    message: string,
    level: DefinitionProblem['level'] = 'error',
    path: readonly (string | number)[] = [],
  ) => {
    diagnostics.push({ source: 'workspaces.jsonc', key, line: lineFor(key, path), level, message });
  };
  const rejected = (key: string, message: string, path: readonly (string | number)[] = []) => {
    problem(
      key,
      message +
        (stubs.has(key)
          ? `${/[.!?]$/.test(message) ? '' : '.'} The plain project stays in effect.`
          : ''),
      'error',
      path,
    );
  };
  for (const [key, raw] of Object.entries(file.workspaces)) {
    const result = definitionEntrySchema.safeParse(raw);
    if (!definitionKeySchema.safeParse(key).success) {
      problem(key, 'Use a definition key with up to eight safe path segments.');
      continue;
    }
    if (!result.success) {
      for (const issue of result.error.issues)
        rejected(
          key,
          `${issue.path.length ? issue.path.join('.') + ': ' : ''}${issue.message}`,
          (issue.code === 'unrecognized_keys'
            ? [...issue.path, issue.keys[0]!]
            : issue.path
          ).filter((part): part is string | number => typeof part !== 'symbol'),
        );
      continue;
    }
    const entry = result.data;
    const count = entry.planes?.length || 1 + (stubs.get(key)?.paths.length ?? 0);
    const indexes = (
      split: NonNullable<NonNullable<DefinitionEntry['tiling']>['split']>,
    ): number[] =>
      'plane' in split ? [split.plane] : [...indexes(split.first), ...indexes(split.second)];
    if (
      (entry.focus !== undefined && entry.focus >= count) ||
      (entry.tiling?.split && indexes(entry.tiling.split).some((index) => index >= count))
    ) {
      rejected(
        key,
        'Focus and split leaves must name an existing plane index.',
        entry.focus !== undefined && entry.focus >= count ? ['focus'] : ['tiling', 'split'],
      );
      continue;
    }
    if (!stubs.has(key) && !entry.root) {
      if (input.projectManagerState && input.projectManagerState !== 'read') {
        waiting++;
        continue;
      }
      const suggested = suggestionFor(key, candidates, input.work);
      const suggestion = suggested && originalKeys.get(suggested);
      problem(
        key,
        `No VS Code project matches this key and the entry names no root.${suggestion ? ` Did you mean “${suggestion}”?` : ''}`,
      );
      continue;
    }
    entries.set(key, entry);
  }
  if (waiting)
    diagnostics.push({
      source: 'workspaces.jsonc',
      level: 'note',
      message:
        input.projectManagerState === 'off'
          ? `VS Code Project Manager is off; ${waiting} ${waiting === 1 ? 'override has' : 'overrides have'} no root.`
          : `${waiting} ${waiting === 1 ? 'override waits' : 'overrides wait'} for VS Code Project Manager.`,
    });
  const names = new Map<string, string>();
  for (const project of projects) {
    const name = normalizedProjectName(project.name);
    if (!names.has(name)) names.set(name, project.key);
  }
  const roots = new Map<string, string>();
  const rootDepths = new Map<string, number>();
  const rootFailures = new Set<string>();
  const rootFor = (key: string, chain: string[] = []): string => {
    if (chain.includes(key) || chain.length >= 4)
      throw new Error('Cyclic roots or root reference depth exceeds four.');
    const known = roots.get(key);
    if (known) {
      if (chain.length + (rootDepths.get(key) ?? 1) > 4)
        throw new Error('Root reference depth exceeds four.');
      return known;
    }
    const entry = entries.get(key);
    const project = stubs.get(key);
    if (!entry && !project) throw new Error(`Unknown definition root: ${key}.`);
    let root: string;
    let depth = 1;
    try {
      const written = entry?.root ?? project?.root;
      if (!written) throw new Error('No root is defined.');
      const reference = /^\{\{ROOT:([^{}]+)\}\}/.exec(written)?.[1]?.trim();
      if (reference) {
        const target =
          names.get(normalizedProjectName(reference)) ??
          (reference.includes('>') ? keyFor(reference) : reference);
        rootFor(target, [...chain, key]);
        depth += rootDepths.get(target) ?? 1;
      }
      root = resolveDefinitionPath(written, { home, roots, names, resolvingRoot: true });
    } catch (error) {
      if (!project || !entry?.root) throw error;
      problem(
        key,
        `Invalid override root: ${(error as Error).message} The plain project stays in effect.`,
        'error',
        ['root'],
      );
      entries.delete(key);
      rootFailures.add(key);
      root = project.root;
      depth = 1;
    }
    roots.set(key, root);
    rootDepths.set(key, depth);
    return root;
  };
  const keys = [...new Set([...stubs.keys(), ...entries.keys()])];
  for (const key of keys) {
    try {
      rootFor(key);
    } catch (error) {
      problem(key, (error as Error).message, 'error', ['root']);
      rootFailures.add(key);
    }
  }
  const definitions: WorkspaceDefinition[] = [];
  const rootProblems = new Map<string, DefinitionProblem>();
  for (const key of keys) {
    const root = roots.get(key);
    if (!root) continue;
    const project = stubs.get(key);
    const entry = entries.get(key);
    if (entry?.root && project && !rootFailures.has(key))
      problem(key, 'This override replaces the Project Manager root.', 'note');
    const planes = entry?.planes?.length
      ? entry.planes
      : [
          { kind: 'folder' as const, path: '{{ROOT}}' },
          ...(project?.paths ?? []).map((path) => ({ kind: 'folder' as const, path })),
        ];
    const resolved = planes.flatMap((plane, index): ResolvedDefinitionPlane[] => {
      try {
        if (plane.kind === 'scratch') return [{ index, plane }];
        const context = { home, root, roots, names };
        if (plane.kind === 'search')
          return [
            {
              index,
              plane: {
                ...plane,
                ...(plane.root === undefined
                  ? {}
                  : { root: resolveDefinitionPath(plane.root, context) }),
              },
            },
          ];
        let result = { ...plane, path: resolveDefinitionPath(plane.path, context) };
        if (
          result.kind === 'terminal' &&
          result.profileID &&
          input.terminalProfiles &&
          !input.terminalProfiles.includes(result.profileID)
        ) {
          problem(
            key,
            `Plane ${index}: unknown terminal profile. The default profile is used.`,
            'warning',
            ['planes', index, 'profileID'],
          );
          result = { ...result, profileID: undefined };
        }
        return [{ index, plane: result }];
      } catch (error) {
        problem(key, `Plane ${index} is left out: ${(error as Error).message}`, 'warning', [
          'planes',
          index,
          plane.kind === 'search' ? 'root' : 'path',
        ]);
        return [];
      }
    });
    if (!resolved.length) {
      resolved.push({ index: -1, plane: { kind: 'folder', path: root } });
      problem(key, 'All planes were skipped. A files plane opens at the root.', 'warning', [
        'planes',
      ]);
    }
    const terminalProfile =
      entry?.terminalProfile &&
      (!input.terminalProfiles || input.terminalProfiles.includes(entry.terminalProfile))
        ? entry.terminalProfile
        : undefined;
    if (entry?.terminalProfile && !terminalProfile)
      problem(key, 'Unknown terminal profile. The default profile is used.', 'warning', [
        'terminalProfile',
      ]);
    const look = entry?.look && { ...entry.look };
    if (look?.profile && input.settingProfiles && !input.settingProfiles.includes(look.profile)) {
      problem(key, 'Unknown setting profile. The default profile is used.', 'warning', [
        'look',
        'profile',
      ]);
      delete look.profile;
    }
    const definition = {
      key,
      name: entry?.name ?? stubName(project?.name ?? key.split('/').join(' > ')).slice(0, 100),
      root,
      projectName: project?.name,
      source: entry
        ? project
          ? ('override' as const)
          : ('standalone' as const)
        : ('project-manager' as const),
      planes: resolved,
      tiling: entry?.tiling,
      focus: entry?.focus,
      terminalProfile,
      look,
      aliases: [...new Set([...(entry?.aliases ?? []), ...(project?.tags ?? [])])],
      curated: entry?.curated ?? false,
      hidden: entry?.hidden ?? false,
    };
    const rootState = input.rootStates?.get(root) ?? 'unknown';
    const rootProblem: DefinitionProblem = {
      source: entry ? 'workspaces.jsonc' : 'projects.json',
      key,
      line: lineFor(key, ['root']) ?? project?.line,
      level: 'warning',
      message: missingDefinitionRoot,
    };
    rootProblems.set(key, rootProblem);
    if (rootState === 'missing') diagnostics.push(rootProblem);
    definitions.push({
      ...definition,
      rootState,
      basis: definitionBasis(definition, hash),
    });
  }
  return { definitions, diagnostics, rootProblems };
}
