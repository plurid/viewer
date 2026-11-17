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
  const counts = new Map<WorkspaceDefinition, number>();
  for (const file of paths) {
    const project = definitions
      .filter((item) => item.projectName && holds(item.root, file))
      .sort((a, b) => b.root.length - a.root.length)[0];
    if (project) counts.set(project, (counts.get(project) ?? 0) + 1);
  }
  const primary = [...counts].sort(
    ([a, x], [b, y]) => y - x || a.root.length - b.root.length,
  )[0]?.[0];
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
  const roots = new Map(input.definitions.map((item) => [item.key, item.root]));
  const names = new Map(
    input.definitions.flatMap((item) =>
      item.projectName ? [[normalizedProjectName(item.projectName), item.key] as const] : [],
    ),
  );
  const context = { root: definition.root, roots, names, home };
  const planes: DefinitionPlane[] = [];
  const capturedIDs: string[] = [];
  const provenance = workspace.definition?.planes;
  const opened = new Set(provenance ? Object.values(provenance) : definition.planes.map((item) => item.index));
  const retained = new Map((entry.planes ?? []).flatMap((plane, index) => opened.has(index) ? [] : [[index, plane] as const]));
  const indexes: Record<string, number> = Object.create(null);
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
    if (provenance?.[id] === -1 || (!provenance && definition.planes.every((item) => item.index < 0) && pane.type === 'folder' && pane.path === definition.root && id === input.order[0]))
      continue;
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
      const previous = original('search', pane.path);
      captured = {
        kind: 'search',
        query: pane.query,
        name: pane.name,
        ...(pane.allLocations
          ? {}
          : { root: pathFor(pane.path, previous?.kind === 'search' ? previous.root : undefined) }),
        ...((pane.recursive ?? true) !== true || previous && Object.hasOwn(previous, 'recursive')
          ? { recursive: pane.recursive ?? true } : {}),
        ...((pane.content ?? false) !== false || previous && Object.hasOwn(previous, 'content')
          ? { content: pane.content ?? false } : {}),
      };
      if (previous?.kind === 'search' &&
          previous.query === pane.query && previous.name === pane.name &&
          (previous.root === undefined) === !!pane.allLocations &&
          (previous.recursive ?? true) === (pane.recursive ?? true) &&
          (previous.content ?? false) === (pane.content ?? false))
        captured = previous;
    } else if (pane.type === 'terminal') {
      const previous = original('terminal', pane.path, pane.definitionPlane);
      const command =
        pane.definitionPlane === undefined || pane.definitionPlane < 0
          ? undefined
          : previous;
      captured = {
        kind: 'terminal',
        path: pathFor(pane.path, previous?.kind === 'terminal' ? previous.path : undefined),
        ...(pane.profileID !== inheritedProfile ? { profileID: pane.profileID } : {}),
      };
      if (command?.kind === 'terminal' && command.command !== undefined) {
        captured.command = command.command;
        keptCommands.add(pane.definitionPlane!);
      }
      if (previous?.kind === 'terminal' &&
          (previous.profileID ?? inheritedProfile) === pane.profileID &&
          previous.command === captured.command)
        captured = previous;
    } else {
      const kind = pane.type === 'folder' ? 'folder' : 'file';
      const previous = original(kind, pane.path);
      captured = {
        kind,
        path: pathFor(pane.path, previous && 'path' in previous ? previous.path : undefined),
      };
    }
    indexes[id] = planes.length;
    capturedIDs.push(id);
    planes.push(captured);
  }
  if (!planes.length && !retained.size) throw new Error('This workspace has no planes a definition can hold.');
  if (retained.size) {
    const live = planes.splice(0);
    let cursor = 0;
    for (let position = 0; position < Math.max(entry.planes?.length ?? 0, live.length + retained.size); position++) {
      const kept = retained.get(position);
      if (kept) {
        if (kept.kind === 'terminal' && kept.command !== undefined) keptCommands.add(position);
        planes.push(kept);
      } else if (cursor < live.length) {
        indexes[capturedIDs[cursor]!] = planes.length;
        planes.push(live[cursor++]!);
      }
    }
  }
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
  const tiling = workspace.tiling && {
    layout: workspace.tiling.layout,
    ...(workspace.tiling.main !== 0.6 || entry.tiling?.main !== undefined ? { main: workspace.tiling.main } : {}),
    ...(tree ? { split: split(tree) } : {}),
  };
  const focus = workspace.activePane !== undefined && Object.hasOwn(indexes, workspace.activePane)
    ? indexes[workspace.activePane] : undefined;
  const capturedEntry = {
    ...metadata, planes,
    ...(tiling ? { tiling } : retained.size && entry.tiling ? { tiling: entry.tiling } : {}),
    ...(focus !== undefined && (entry.focus !== undefined || focus !== 0) ? { focus }
      : focus === undefined && entry.focus !== undefined ? { focus: entry.focus } : {}),
  };
  definitionEntrySchema.parse(capturedEntry);
  return {
    entry: capturedEntry,
    planes: indexes,
    skipped,
    literalPaths: [...new Set(literalPaths)],
    dropsCommands: (entry.planes ?? []).some(
      (plane, index) =>
        plane.kind === 'terminal' && plane.command !== undefined && !keptCommands.has(index),
    ),
  };
}
