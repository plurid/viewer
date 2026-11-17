import type { SavedState, Workspace } from '../../contracts';
import type { FolderVisits } from '../../files/folder-visits';
import { frecencyScore } from '../../files/folder-visits';
import { isPristineWorkspace } from '../catalog';
import { insideRoot, parentFolder } from './roots';

export const foundRecentAge = 90 * 86_400_000;
export interface FoundEvidence {
  folder: string;
  count: number;
  last: number;
  score: number;
  plane: boolean;
}
export interface FoundCandidateInput {
  home: string;
  now: number;
  visits: FolderVisits;
  recents: readonly string[];
  workspaces: readonly Workspace[];
  workspaceVisits?: SavedState['workspaceVisits'];
  openWindows?: readonly string[];
  emptyLocation?: string;
}
export function candidateFolders(input: FoundCandidateInput): FoundEvidence[] {
  const result = new Map<string, FoundEvidence>();
  const add = (folder: string, count: number, last: number, plane = false) => {
    const old = result.get(folder);
    result.set(folder, {
      folder,
      count: Math.max(old?.count ?? 0, count),
      last: Math.max(old?.last ?? 0, last),
      score: Math.max(old?.score ?? 0, frecencyScore({ count, last }, input.now)),
      plane: plane || !!old?.plane,
    });
  };
  for (const [folder, visit] of Object.entries(input.visits)
    .sort(([, a], [, b]) => frecencyScore(b, input.now) - frecencyScore(a, input.now))
    .slice(0, 500))
    add(folder, visit.count, visit.last);
  for (const folder of input.recents.slice(0, 50)) add(folder, 0, 0);
  for (const space of input.workspaces) {
    const last = input.workspaceVisits?.[space.id] ?? 0;
    if (last < input.now - foundRecentAge && !input.openWindows?.includes(space.id)) continue;
    if (isPristineWorkspace(space, input.home, input.emptyLocation)) continue;
    for (const pane of space.panes) {
      if (result.size >= 1000) break;
      if (['folder', 'terminal', 'scratch', 'search', 'preview'].includes(pane.type))
        add(
          pane.type === 'preview' ? parentFolder(pane.path) : pane.path,
          0,
          Math.max(last, input.now),
          true,
        );
    }
  }
  return [...result.values()].slice(0, 1000);
}
export function qualifyingRoots(
  roots: readonly string[],
  evidence: readonly FoundEvidence[],
  now: number,
  retained: ReadonlySet<string> = new Set(),
): string[] {
  const ranked = [...new Set(roots)]
    .map((root) => {
      const matches = evidence.filter((item) => insideRoot(root, item.folder));
      return {
        root,
        count: matches.reduce((sum, item) => sum + item.count, 0),
        last: Math.max(0, ...matches.map((item) => item.last)),
        plane: matches.some((item) => item.plane),
        score:
          matches.reduce((sum, item) => sum + item.score, 0) +
          Number(matches.some((item) => item.plane)),
      };
    })
    .filter(
      (item) =>
        item.plane ||
        retained.has(item.root) ||
        (item.count >= 3 && item.last >= now - foundRecentAge),
    )
    .sort((a, b) => b.score - a.score || (a.root < b.root ? -1 : 1));
  return [
    ...ranked.filter((item) => retained.has(item.root)),
    ...ranked.filter((item) => !retained.has(item.root)).slice(0, 200),
  ].map((item) => item.root);
}
