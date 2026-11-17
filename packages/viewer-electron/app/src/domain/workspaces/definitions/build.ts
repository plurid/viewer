import type { FolderPane, Pane, ScratchPane, Workspace } from '../../contracts';
import type { TileSplit } from '../tiling';
import { pruneTileTree } from '../tiling';
import type { DefinitionSplit, WorkspaceDefinition } from './schema';
import { searchPaneRecord, terminalPaneRecord } from '../pane-records';

export interface DefinitionBuilders {
  id(): string;
  folder(path: string): FolderPane;
  scratch(path: string): ScratchPane;
  home: string;
  terminalProfile: string;
}

export function buildDefinition(
  definition: WorkspaceDefinition,
  builders: DefinitionBuilders,
): Workspace {
  const indexed = new Map<number, string>();
  const panes = definition.planes.map(({ index, plane }): Pane => {
    let pane: Pane;
    if (plane.kind === 'folder') pane = builders.folder(plane.path);
    else if (plane.kind === 'scratch') pane = builders.scratch(definition.root);
    else if (plane.kind === 'file') pane = { id: builders.id(), type: 'preview', path: plane.path };
    else if (plane.kind === 'search')
      pane = searchPaneRecord(
        builders.id(),
        builders.home,
        plane.query,
        plane.name,
        plane.root,
        plane.recursive,
        plane.content,
      );
    else {
      pane = terminalPaneRecord(
        builders.id(),
        plane.path,
        plane.profileID ?? definition.terminalProfile ?? builders.terminalProfile,
      );
      if (plane.command !== undefined)
        pane = { ...pane, definitionPlane: index, startOnOpen: false };
    }
    indexed.set(index, pane.id);
    return pane;
  });
  const split = (tree: DefinitionSplit): TileSplit =>
    'plane' in tree
      ? { pane: indexed.get(tree.plane) ?? `missing:${tree.plane}` }
      : {
          axis: tree.axis,
          ratio: tree.ratio,
          first: split(tree.first),
          second: split(tree.second),
        };
  const tree =
    definition.tiling?.split &&
    pruneTileTree(split(definition.tiling.split), new Set(indexed.values()));
  return {
    id: builders.id(),
    name: definition.name,
    panes,
    roots: panes.map((pane) => pane.id),
    arrangement: {},
    activePane: indexed.get(definition.focus ?? 0) ?? panes[0]?.id,
    definition: {
      key: definition.key,
      basis: definition.basis,
      source: definition.source,
      planes: Object.fromEntries([...indexed].map(([index, id]) => [id, index])),
    },
    ...(definition.look?.spaceColor
      ? { spaceColor: definition.look.spaceColor.toLowerCase() }
      : {}),
    ...(definition.look?.profile ? { profileID: definition.look.profile } : {}),
    ...(definition.look?.overrides ? { overrides: definition.look.overrides } : {}),
    ...(definition.tiling && panes.length
      ? {
          tiling: {
            panes: panes.map((pane) => pane.id),
            layout: definition.tiling.layout,
            main: definition.tiling.main ?? 0.6,
            ...(tree ? { tree } : {}),
          },
        }
      : {}),
  };
}
