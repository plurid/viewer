/** Shared sizing choices for the command registry and native menus. */
export const planeSizePresets = [
  { id: 'full', label: 'Full', fraction: [1, 1] },
  { id: 'half', label: 'Half', fraction: [1, 2] },
  { id: 'third', label: 'Third', fraction: [1, 3] },
  { id: 'two-thirds', label: 'Two thirds', fraction: [2, 3] },
  { id: 'quarter', label: 'Quarter', fraction: [1, 4] },
  { id: 'three-quarters', label: 'Three quarters', fraction: [3, 4] },
] as const;

export const planeAlignments = [
  { id: 'left', label: 'Align left', axis: 'x', position: 0, icon: 'left' },
  { id: 'center', label: 'Center horizontally', axis: 'x', position: 0.5, icon: 'side-by-side' },
  { id: 'right', label: 'Align right', axis: 'x', position: 1, icon: 'right' },
  { id: 'top', label: 'Align top', axis: 'y', position: 0, icon: 'up' },
  { id: 'middle', label: 'Center vertically', axis: 'y', position: 0.5, icon: 'stacked' },
  { id: 'bottom', label: 'Align bottom', axis: 'y', position: 1, icon: 'down' },
] as const;

export type PlaneLayoutTarget = { workspaceID: string; paneID: string };
export type PlaneSizeFraction = (typeof planeSizePresets)[number]['fraction'];
export interface PlaneLayoutEdit {
  width?: PlaneSizeFraction;
  height?: PlaneSizeFraction;
  x?: 0 | 0.5 | 1;
  y?: 0 | 0.5 | 1;
}

export const planeLayoutCommandIDs = [
  'plane-move',
  'plane-resize',
  'plane-fill',
  ...(['width', 'height'] as const).flatMap((axis) =>
    planeSizePresets.map((preset) => `plane-${axis}-${preset.id}`),
  ),
  ...planeAlignments.map((alignment) => `plane-align-${alignment.id}`),
];
