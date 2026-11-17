import type { WorkspaceDefinition, FoundWorkspaceState } from '../definitions/schema';
import { definitionBasis } from '../definitions/catalog';
import { foundAliases, foundKey, foundName } from './keys';

export interface FoundEntry {
  key: string;
  root: string;
  realpath: string;
  identity: string;
  names: string[];
  at: number;
}
export interface FoundKeyChange {
  from: string;
  to: string;
}
export interface FoundCatalogState {
  state: FoundWorkspaceState;
  count: number;
  hidden: number;
}
export function foundDefinitions(
  entries: readonly FoundEntry[],
  explicit: readonly WorkspaceDefinition[],
  home: string,
  hash: (text: string) => string,
  realpath: (root: string) => string = (root) => root,
): WorkspaceDefinition[] {
  const roots = new Set(explicit.flatMap((item) => [item.root, realpath(item.root)]));
  const explicitKeys = new Set(explicit.map((item) => item.key));
  const keys = new Set([...explicitKeys, ...entries.map((entry) => entry.key)]);
  return entries.flatMap((entry): WorkspaceDefinition[] => {
    if (roots.has(entry.root) || roots.has(entry.realpath)) return [];
    roots.add(entry.root);
    roots.add(entry.realpath);
    const key = explicitKeys.has(entry.key) ? foundKey(entry.root, home, keys) : entry.key;
    keys.add(key);
    const definition: WorkspaceDefinition = {
      key,
      name: foundName(entry.root),
      root: entry.root,
      rootState: 'unknown',
      source: 'found',
      planes: [{ index: 0, plane: { kind: 'folder', path: entry.root } }],
      aliases: foundAliases(entry.names),
      hidden: false,
      curated: false,
      basis: '',
    };
    definition.basis = definitionBasis(definition, hash);
    return [definition];
  });
}
