import type { DragEvent, MouseEvent } from 'react';
import type { FileEntry } from '../../domain/contracts';
import { fileGroup } from '../../domain/files/entries';
import { lensGroupTree, type Lens, type ResolvedLens } from '../../domain/files/lenses';
import { FILE_DRAG } from './file-drop';
import type { FileGrouping } from '../../domain/files/entries';

/** A heading in a grouped view: a kind or date group, or a lens group. */
export interface ViewSection {
  key: string;
  label: string;
  depth: number;
  /** Items in the section, including any hidden by collapsing it. */
  count: number;
  collapsed?: boolean;
  /** The lens group, or null for Unsorted; absent for kind and date groups. */
  group?: string | null;
}
export interface ViewSections {
  /** In display order; entries are ordered the same way. */
  list: ViewSection[];
  /** The section of a top-level entry. */
  of(entry: FileEntry): string | undefined;
  toggle?(section: ViewSection): void;
  drop?(section: ViewSection, paths: string[]): void;
  context?(section: ViewSection, event: MouseEvent): void;
}
export type ViewRow = { kind: 'header'; section: ViewSection } | { kind: 'entry'; index: number };

/**
 * Interleaves headers with entries already ordered by section. Empty and collapsed sections still
 * get a header; expanded subfolder rows stay with the item they belong to.
 */
export function sectionRows(
  entries: readonly FileEntry[],
  sections: ViewSections | undefined,
  depths?: ReadonlyMap<string, number>,
): ViewRow[] {
  if (!sections?.list.length) return entries.map((_, index): ViewRow => ({ kind: 'entry', index }));
  const rows: ViewRow[] = [];
  let next = 0,
    current: string | undefined;
  for (const [index, entry] of entries.entries()) {
    const key = depths?.get(entry.path) ? current : sections.of(entry);
    if (key !== current && key !== undefined) {
      const target = sections.list.findIndex(
        (section, position) => position >= next && section.key === key,
      );
      if (target >= 0) {
        for (; next <= target; next++) rows.push({ kind: 'header', section: sections.list[next]! });
      }
      current = key;
    }
    rows.push({ kind: 'entry', index });
  }
  for (; next < sections.list.length; next++)
    rows.push({ kind: 'header', section: sections.list[next]! });
  return rows;
}

export type GridRow =
  { kind: 'header'; section: ViewSection } | { kind: 'tiles'; start: number; end: number };
/** A grid's rows: each group starts a new row under a full-width heading. */
export function gridRows(
  entries: readonly FileEntry[],
  sections: ViewSections | undefined,
  columns: number,
): GridRow[] {
  const result: GridRow[] = [];
  let run: number[] = [];
  const flush = () => {
    for (let index = 0; index < run.length; index += columns)
      result.push({
        kind: 'tiles',
        start: run[index]!,
        end: run[Math.min(index + columns, run.length) - 1]! + 1,
      });
    run = [];
  };
  for (const row of sectionRows(entries, sections))
    if (row.kind === 'header') {
      flush();
      result.push(row);
    } else run.push(row.index);
  flush();
  return result;
}
/**
 * The tile a vertical key reaches from `index` in a grid: the same column `rows` rows away (the
 * last tile of a shorter row), or `index` itself at the top or the bottom. Stepping by the column
 * count crossed groups, which start rows of their own, and a page moved as many tiles as rows fit.
 */
export function gridStep(
  rows: readonly GridRow[],
  index: number,
  rowsAway: number,
): number | undefined {
  const tiles = rows.filter(
    (row): row is Extract<GridRow, { kind: 'tiles' }> => row.kind === 'tiles',
  );
  const at = tiles.findIndex((row) => index >= row.start && index < row.end);
  if (at < 0) return undefined;
  const target = tiles[Math.max(0, Math.min(tiles.length - 1, at + rowsAway))]!;
  return Math.min(target.start + index - tiles[at]!.start, target.end - 1);
}

/** Kind and date groups, in the order the sorted entries meet them. */
export function fixedSections(
  entries: readonly FileEntry[],
  group: FileGrouping,
  depths?: ReadonlyMap<string, number>,
): ViewSections | undefined {
  if (group === 'none') return undefined;
  const counts = new Map<string, number>();
  for (const entry of entries)
    if (!depths?.get(entry.path)) {
      const label = fileGroup(entry, group);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  return {
    list: [...counts].map(([label, count]) => ({ key: label, label, depth: 0, count })),
    of: (entry) => fileGroup(entry, group),
  };
}

const sectionKey = (group: string | null) => 'lens:' + (group ?? '');
/** Hidden behind a collapsed group, including groups nested in one. */
function hiddenGroups(lens: Lens, collapsed: ReadonlySet<string>): Set<string> {
  const hidden = new Set<string>();
  for (const { group } of lensGroupTree(lens))
    if (group.parent !== undefined && (collapsed.has(group.parent) || hidden.has(group.parent)))
      hidden.add(group.id);
  return hidden;
}
/**
 * Orders visible entries by lens group, drops those inside collapsed groups, and describes the
 * headings: every group (so empty ones can receive items), and Unsorted when it has items.
 * `ordered` keeps the collapsed groups' items, for the views that have no heading to expand.
 */
export function lensSections(
  lens: Lens,
  resolved: ResolvedLens,
  visible: readonly FileEntry[],
  collapsed: ReadonlySet<string>,
  filtering: boolean,
): {
  entries: FileEntry[];
  ordered: FileEntry[];
  sections: Omit<ViewSections, 'toggle' | 'drop' | 'context'>;
} {
  const hidden = hiddenGroups(lens, collapsed);
  const position = new Map(resolved.sections.map((section, index) => [section.id, index]));
  const groupOf = (entry: FileEntry) => resolved.placements.get(entry.path)?.group ?? null;
  const counts = new Map<string | null, number>();
  for (const entry of visible) counts.set(groupOf(entry), (counts.get(groupOf(entry)) ?? 0) + 1);
  const ordered = visible.toSorted((a, b) => position.get(groupOf(a))! - position.get(groupOf(b))!);
  const entries = ordered.filter((entry) => {
    const group = groupOf(entry);
    return group === null || (!collapsed.has(group) && !hidden.has(group));
  });
  const list: ViewSection[] = [];
  for (const section of resolved.sections) {
    const count = counts.get(section.id) ?? 0;
    if (section.id !== null && hidden.has(section.id)) continue;
    if ((section.id === null || filtering) && !count) continue;
    list.push({
      key: sectionKey(section.id),
      label: section.name,
      depth: section.depth,
      count,
      collapsed: section.id !== null && collapsed.has(section.id),
      group: section.id,
    });
  }
  return { entries, ordered, sections: { list, of: (entry) => sectionKey(groupOf(entry)) } };
}

/** Items dropped on a heading: dragged inside Viewer, or from Finder. */
export async function droppedPaths(event: DragEvent): Promise<string[]> {
  const value: unknown = event.dataTransfer.types.includes(FILE_DRAG)
    ? JSON.parse(event.dataTransfer.getData(FILE_DRAG))
    : await window.viewer.fileDropPaths(Array.from(event.dataTransfer.files));
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
export const acceptsDrop = (event: DragEvent) =>
  event.dataTransfer.types.includes(FILE_DRAG) || event.dataTransfer.types.includes('Files');
