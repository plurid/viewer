import { useMemo } from 'react';
import type { FileEntry } from '../../domain/contracts';
import type { FolderPresentation } from '../../domain/preferences/folder-presentation';
import { baseName, parentPath } from '../../domain/workspaces/planes';
import {
  resolveLens,
  type LensDocument,
  type LensOp,
  type ResolvedLens,
} from '../../domain/files/lenses';
import {
  activeLens,
  editLens,
  setCollapsedGroups,
  useLenses,
  type LensView,
} from '../state/lenses';
import { report } from '../state/store';
import { lensSections, type ViewSections } from './sections';

/** Names of the dropped items that sit directly inside `folder`; lenses group only those. */
export function childNames(folder: string, paths: readonly string[]): string[] {
  return [...new Set(paths.filter((file) => parentPath(file) === folder).map(baseName))];
}
/** Puts items in a lens group (null: Unsorted), letting the layout choose their places. */
function placeInGroup(
  folder: string,
  document: LensDocument,
  paths: readonly string[],
  group: string | null,
  label: string,
): void {
  const names = childNames(folder, paths);
  if (!names.length) {
    if (paths.length) report(new Error('Only items in this folder can be grouped here.'));
    return;
  }
  editLens(
    folder,
    document.file,
    names.map((name): LensOp => ({ kind: 'place', name, group })),
    `Move to “${label}”`,
  );
}

/**
 * A folder's lenses and, when it is grouped by one, its items in lens order with headings.
 * `listing` is every item in the folder (hidden ones too, so they still count as present);
 * `visible` is what the view shows, already filtered and sorted.
 */
export function useLensGrouping(
  path: string,
  listing: readonly FileEntry[],
  visible: readonly FileEntry[],
  presentation: Pick<FolderPresentation, 'group' | 'lens'>,
  filtering: boolean,
  context?: ViewSections['context'],
): {
  view: LensView;
  /** The lens grouping this folder, when grouped by a lens. */
  document?: LensDocument;
  resolved?: ResolvedLens;
  entries?: FileEntry[];
  /** Every visible item in lens order, collapsed groups' too. */
  ordered?: FileEntry[];
  sections?: ViewSections;
} {
  const view = useLenses(path);
  const document = activeLens(view.data, presentation);
  const resolved = useMemo(
    () => (document ? resolveLens(document.lens, listing) : undefined),
    [document, listing],
  );
  const stored = document ? view.data?.collapsed[document.lens.id] : undefined;
  const collapsed = useMemo(() => new Set(stored ?? []), [stored]);
  const grouped = useMemo(
    () =>
      document && resolved
        ? lensSections(document.lens, resolved, visible, collapsed, filtering)
        : undefined,
    [document, resolved, visible, collapsed, filtering],
  );
  const sections = useMemo((): ViewSections | undefined => {
    if (!grouped || !document) return undefined;
    return {
      ...grouped.sections,
      toggle: (section) => {
        if (!section.group) return;
        const next = new Set(collapsed);
        if (next.has(section.group)) next.delete(section.group);
        else next.add(section.group);
        setCollapsedGroups(path, document.lens.id, [...next]);
      },
      drop: document.writable
        ? (section, paths) =>
            placeInGroup(path, document, paths, section.group ?? null, section.label)
        : undefined,
      context,
    };
  }, [grouped, document, collapsed, path, context]);
  return {
    view,
    document,
    resolved,
    entries: grouped?.entries,
    ordered: grouped?.ordered,
    sections,
  };
}
