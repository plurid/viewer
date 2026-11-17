import type { Pane, Workspace } from '../../contracts';
import type { TileSplit } from '../tiling';
import { pruneTileTree } from '../tiling';
import type {
  DefinitionEntry,
  DefinitionPlane,
  DefinitionSplit,
  WorkspaceDefinition,
} from './schema';
import { definitionEntrySchema } from './schema';
import { slug } from './keys';
import { normalizedProjectName, resolveDefinitionPath, tokenizePath } from './paths';
import { definitionShares } from '../ownership';

export interface SkippedDefinitionPlane {
  id: string;
  kind: Pane['type'];
  reason: string;
}
export interface CapturedDefinition {
  entry: DefinitionEntry;
  planes: Record<string, number>;
  skipped: SkippedDefinitionPlane[];
  literalPaths: string[];
  dropsCommands: boolean;
}
export interface CaptureDefinitionInput {
  workspace: Workspace;
  order: readonly string[];
  definition: WorkspaceDefinition;
  entry: DefinitionEntry;
  definitions: readonly WorkspaceDefinition[];
  home: string;
  terminalProfile?: string;
}
const supported = (pane: Pane) =>
  ['folder', 'preview', 'terminal', 'scratch', 'search'].includes(pane.type);
export const canCaptureDefinition = (workspace: Workspace): boolean =>
  workspace.panes.some(supported);
const holds = (root: string, file: string) =>
  file === root || file.startsWith(root === '/' ? '/' : root + '/');
const parent = (file: string) => file.slice(0, file.lastIndexOf('/')) || '/';

export function proposeDefinition(
  workspace: Workspace,
  definitions: readonly WorkspaceDefinition[],
  home: string,
): { key: string; name: string; root: string } {
  const paths = workspace.panes
    .filter(supported)
    .map((pane) => (pane.type === 'preview' ? parent(pane.path) : pane.path));
  if (!paths.length) throw new Error('This workspace has no planes a definition can hold.');
  const primary = definitionShares(
    workspace,
    definitions.filter((item) => item.projectName || item.source === 'found'),
    'proposal',
  )[0]?.definition;
  let root = paths[0] ?? home;
  for (const file of paths) while (!holds(root, file)) root = parent(root);
  return {
    key: primary?.key ?? slug(workspace.name).slice(0, 200),
    name: workspace.name,
    root: primary?.root ?? root,
  };
}

export function captureDefinition(input: CaptureDefinitionInput): CapturedDefinition {
  const { workspace, definition, entry, home } = input;
  const byID = new Map(workspace.panes.map((pane) => [pane.id, pane]));
  if (
    input.order.length !== workspace.panes.length ||
    new Set(input.order).size !== input.order.length ||
    input.order.some((id) => !byID.has(id))
  )
    throw new Error('The plane order must name this workspace’s planes once each.');
  const roots = new Map(
    input.definitions
      .filter((item) => item.source !== 'found')
      .map((item) => [item.key, item.root]),
  );
  const names = new Map(
    input.definitions.flatMap((item) =>
      item.projectName ? [[normalizedProjectName(item.projectName), item.key] as const] : [],
    ),
  );
  const context = { root: definition.root, roots, names, home };
  const planes: DefinitionPlane[] = [];
  const capturedIDs: string[] = [];
  // Unavailable written planes must not look like planes the person deliberately closed.
  const provenance = workspace.definition?.planes;
  const stale =
    workspace.definition?.key === definition.key && workspace.definition.basis !== definition.basis;
  const matches = (plane: DefinitionPlane, pane: Pane): boolean => {
    if (pane.type === 'scratch') return plane.kind === 'scratch' && pane.path === definition.root;
    if (pane.type === 'search') {
      if (plane.kind !== 'search') return false;
      if (plane.root === undefined) return !!pane.allLocations;
      if (pane.allLocations) return false;
    } else if (plane.kind !== (pane.type === 'preview' ? 'file' : pane.type)) return false;
    const written = plane.kind === 'search' ? plane.root : 'path' in plane ? plane.path : undefined;
    if (written === undefined) return false;
    try {
      return resolveDefinitionPath(written, context) === pane.path;
    } catch {
      return false;
    }
  };
  const livePanes = workspace.panes.filter(
    (pane) => supported(pane) && provenance?.[pane.id] !== -1,
  );
  const associations = stale
    ? new Map(
        livePanes.flatMap((pane) => {
          const candidates = (entry.planes ?? []).flatMap((plane, index) =>
            matches(plane, pane) ? [index] : [],
          );
          const previous =
            pane.type === 'terminal' ? (pane.definitionPlane ?? provenance?.[pane.id]) : undefined;
          const index =
            pane.type === 'terminal' && candidates.length > 1
              ? previous !== undefined && candidates.includes(previous)
                ? previous
                : -1
              : (candidates[0] ?? -1);
          return index < 0 ? [] : [[pane.id, index] as const];
        }),
      )
    : new Map(Object.entries(provenance ?? {}));
  const opened = new Set(
    provenance
      ? Object.values(provenance)
      : [
          ...definition.planes.map((item) => item.index),
          ...workspace.panes.flatMap((pane) =>
            pane.type === 'terminal' && pane.definitionPlane !== undefined
              ? [pane.definitionPlane]
              : [],
          ),
        ],
  );
  const retained = new Map(
    (entry.planes ?? []).flatMap((plane, index) =>
      (stale ? livePanes.some((pane) => matches(plane, pane)) : opened.has(index))
        ? []
        : [[index, plane] as const],
    ),
  );
  const indexes: Record<string, number> = Object.create(null);
  const synthetic: Record<string, number> = Object.create(null);
  const writtenIndexes = new Map<number, number>();
  const skipped: SkippedDefinitionPlane[] = [];
  const literalPaths: string[] = [];
  const keptCommands = new Set<number>();
  const inheritedProfile = definition.terminalProfile ?? input.terminalProfile;
  const original = (
    kind: DefinitionPlane['kind'],
    file: string,
    index?: number,
  ): DefinitionPlane | undefined => {
    const candidates =
      index === undefined
        ? (entry.planes ?? [])
        : [entry.planes?.[index]].filter((plane): plane is DefinitionPlane => !!plane);
    return candidates.find((plane) => {
      if (plane.kind !== kind || plane.kind === 'scratch') return false;
      const written = plane.kind === 'search' ? plane.root : plane.path;
      if (written === undefined) return plane.kind === 'search';
      try {
        return resolveDefinitionPath(written, context) === file;
      } catch {
        return false;
      }
    });
  };
  const pathFor = (file: string, previous?: string) => {
    const path = tokenizePath(file, context, previous);
    if (path.startsWith('/')) literalPaths.push(file);
    return path;
  };
  for (const id of input.order) {
    const pane = byID.get(id)!;
    if (provenance?.[id] === -1) {
      synthetic[id] = -1;
      continue;
    }
    if (!supported(pane) || planes.length + retained.size === 30) {
      skipped.push({
        id,
        kind: pane.type,
        reason: supported(pane)
          ? 'The definition limit is 30 planes.'
          : 'This kind stays in the open workspace.',
      });
      continue;
    }
    let captured: DefinitionPlane;
    if (pane.type === 'scratch') captured = { kind: 'scratch' };
    else if (pane.type === 'search') {
      const previous = original('search', pane.path, associations.get(id));
      captured = {
        kind: 'search',
        query: pane.query,
        name: pane.name,
        ...(pane.allLocations
          ? {}
          : { root: pathFor(pane.path, previous?.kind === 'search' ? previous.root : undefined) }),
        ...((pane.recursive ?? true) !== true || (previous && Object.hasOwn(previous, 'recursive'))
          ? { recursive: pane.recursive ?? true }
          : {}),
        ...((pane.content ?? false) !== false || (previous && Object.hasOwn(previous, 'content'))
          ? { content: pane.content ?? false }
          : {}),
      };
      if (
        previous?.kind === 'search' &&
        previous.query === pane.query &&
        previous.name === pane.name &&
        (previous.root === undefined) === !!pane.allLocations &&
        (previous.recursive ?? true) === (pane.recursive ?? true) &&
        (previous.content ?? false) === (pane.content ?? false)
      )
        captured = previous;
    } else if (pane.type === 'terminal') {
      const selectedIndex = stale
        ? associations.get(id)
        : (pane.definitionPlane ?? provenance?.[id]);
      const previous =
        stale && selectedIndex === undefined
          ? undefined
          : original('terminal', pane.path, selectedIndex);
      const writtenIndex = selectedIndex ?? (previous && entry.planes?.indexOf(previous));
      const resolved = definition.planes.find((item) => item.index === writtenIndex)?.plane;
      const effectiveProfile =
        resolved?.kind === 'terminal'
          ? (resolved.profileID ?? inheritedProfile)
          : previous?.kind === 'terminal'
            ? (previous.profileID ?? inheritedProfile)
            : inheritedProfile;
      const command =
        pane.definitionPlane === undefined || pane.definitionPlane < 0 ? undefined : previous;
      captured = {
        kind: 'terminal',
        path: pathFor(pane.path, previous?.kind === 'terminal' ? previous.path : undefined),
        ...(pane.profileID !== inheritedProfile ? { profileID: pane.profileID } : {}),
      };
      if (command?.kind === 'terminal' && command.command !== undefined) {
        captured.command = command.command;
        keptCommands.add(writtenIndex!);
      }
      if (
        previous?.kind === 'terminal' &&
        effectiveProfile === pane.profileID &&
        previous.command === captured.command
      )
        captured = previous;
    } else {
      const kind = pane.type === 'folder' ? 'folder' : 'file';
      const previous = original(kind, pane.path, associations.get(id));
      captured = previous ?? {
        kind,
        path: pathFor(pane.path),
      };
    }
    indexes[id] = planes.length;
    capturedIDs.push(id);
    planes.push(captured);
  }
  if (!planes.length && !retained.size)
    throw new Error('This workspace has no planes a definition can hold.');
  if (retained.size) {
    const live = planes.splice(0);
    let cursor = 0;
    for (
      let position = 0;
      position < Math.max(entry.planes?.length ?? 0, live.length + retained.size);
      position++
    ) {
      const kept = retained.get(position);
      if (kept) {
        writtenIndexes.set(position, planes.length);
        if (kept.kind === 'terminal' && kept.command !== undefined) keptCommands.add(position);
        planes.push(kept);
      } else if (cursor < live.length) {
        indexes[capturedIDs[cursor]!] = planes.length;
        planes.push(live[cursor++]!);
      }
    }
  }
  for (const [id, index] of Object.entries(indexes)) {
    const original = associations.get(id) ?? entry.planes?.indexOf(planes[index]!);
    if (original !== undefined && original >= 0) writtenIndexes.set(original, index);
  }
  const remapSplit = (node: DefinitionSplit): DefinitionSplit | undefined => {
    if ('plane' in node) {
      const index = writtenIndexes.get(node.plane);
      return index === undefined ? undefined : { plane: index };
    }
    const first = remapSplit(node.first);
    const second = remapSplit(node.second);
    return first && second ? { ...node, first, second } : (first ?? second);
  };
  const retainedTiling = entry.tiling && {
    ...entry.tiling,
    ...(entry.tiling.split ? { split: remapSplit(entry.tiling.split) } : {}),
  };
  const tree =
    workspace.tiling?.tree && pruneTileTree(workspace.tiling.tree, new Set(Object.keys(indexes)));
  const split = (node: TileSplit): DefinitionSplit =>
    'pane' in node
      ? { plane: indexes[node.pane]! }
      : {
          axis: node.axis,
          ratio: node.ratio,
          first: split(node.first),
          second: split(node.second),
        };
  const { planes: _planes, tiling: _tiling, focus: _focus, ...metadata } = entry;
  let tiling = workspace.tiling && {
    layout: workspace.tiling.layout,
    ...(workspace.tiling.main !== 0.6 || entry.tiling?.main !== undefined
      ? { main: workspace.tiling.main }
      : {}),
    ...(tree ? { split: split(tree) } : {}),
  };
  const focus =
    workspace.activePane !== undefined && Object.hasOwn(indexes, workspace.activePane)
      ? indexes[workspace.activePane]
      : undefined;
  const indexedIDs = new Map([...associations].map(([id, index]) => [index, id]));
  const writtenTree = (node: DefinitionSplit): TileSplit =>
    'plane' in node
      ? { pane: indexedIDs.get(node.plane) ?? `missing:${node.plane}` }
      : {
          axis: node.axis,
          ratio: node.ratio,
          first: writtenTree(node.first),
          second: writtenTree(node.second),
        };
  const projected =
    entry.tiling?.split &&
    pruneTileTree(writtenTree(entry.tiling.split), new Set(Object.keys(indexes)));
  if (
    retained.size &&
    entry.tiling &&
    workspace.tiling?.layout === entry.tiling.layout &&
    workspace.tiling.main === (entry.tiling.main ?? 0.6) &&
    JSON.stringify(projected) === JSON.stringify(tree)
  )
    tiling = retainedTiling;
  const initialFocus =
    indexedIDs.get(definition.focus ?? 0) ?? indexedIDs.get(definition.planes[0]?.index ?? -1);
  const unchangedFocus =
    !stale &&
    !!provenance &&
    workspace.activePane === initialFocus &&
    Object.entries(provenance).every(
      ([id, index]) => !Object.hasOwn(indexes, id) || indexes[id] === index,
    );
  const implicitPlanes =
    !entry.planes &&
    planes.length === definition.planes.length &&
    planes.every((plane, index) => {
      const previous = definition.planes[index]?.plane;
      return (
        plane.kind === 'folder' &&
        previous?.kind === 'folder' &&
        resolveDefinitionPath(plane.path, context) === previous.path
      );
    });
  const capturedEntry = {
    ...metadata,
    ...(implicitPlanes ? {} : { planes }),
    ...(tiling ? { tiling } : retained.size && retainedTiling ? { tiling: retainedTiling } : {}),
    ...(unchangedFocus
      ? entry.focus === undefined
        ? {}
        : { focus: writtenIndexes.get(entry.focus) ?? focus ?? 0 }
      : focus !== undefined && (entry.focus !== undefined || focus !== 0)
        ? { focus }
        : focus === undefined && entry.focus !== undefined
          ? {
              focus:
                writtenIndexes.get(entry.focus) ?? (entry.focus < planes.length ? entry.focus : 0),
            }
          : {}),
  };
  definitionEntrySchema.parse(capturedEntry);
  return {
    entry: capturedEntry,
    planes: { ...synthetic, ...indexes },
    skipped,
    literalPaths: [...new Set(literalPaths)],
    dropsCommands: (entry.planes ?? []).some(
      (plane, index) =>
        plane.kind === 'terminal' && plane.command !== undefined && !keptCommands.has(index),
    ),
  };
}
