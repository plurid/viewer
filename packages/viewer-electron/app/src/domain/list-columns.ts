import type { ListColumn, UIPreferences } from './contracts';

export const listColumns: { id: ListColumn; label: string; width: number; visible: boolean }[] = [
  { id: 'name', label: 'Name', width: 0, visible: true },
  { id: 'modified', label: 'Date modified', width: 160, visible: true },
  { id: 'created', label: 'Date created', width: 160, visible: false },
  { id: 'kind', label: 'Kind', width: 96, visible: true },
  { id: 'extension', label: 'Extension', width: 80, visible: false },
  { id: 'size', label: 'Size', width: 95, visible: true },
];
export const columnMinimum = (column: ListColumn) => (column === 'name' ? 120 : 60);
export const columnMaximum = (column: ListColumn) => (column === 'name' ? 1600 : 600);
export function columnWidth(column: ListColumn, width: number): number {
  return Math.max(columnMinimum(column), Math.min(columnMaximum(column), Math.round(width)));
}
export function visibleListColumns(
  preferences: Pick<UIPreferences['list'], 'visible'> & { order?: ListColumn[] },
): ListColumn[] {
  const columns = listColumns
    .filter((column) => column.id === 'name' || preferences.visible[column.id])
    .map((column) => column.id);
  if (!preferences.order) return columns;
  return [...new Set(['name' as const, ...preferences.order, ...columns])].filter((column) =>
    columns.includes(column),
  );
}
export function listLayout(
  columns: readonly ListColumn[],
  widths: UIPreferences['list']['widths'],
) {
  return {
    template: columns
      .map((column) =>
        column === 'name' && !widths.name ? 'minmax(200px, 1fr)' : `${widths[column]}px`,
      )
      .join(' '),
    // Includes the shared 18px insets; the vertical scrollbar gutter is added by CSS.
    minimum: columns.reduce((total, column) => total + (widths[column] || 200), 36),
  };
}
