import { z } from 'zod';
import type { SourceVersion } from './inspection';
import type { Bounds, Drawing, DrawingEntity, Point } from './dxf/math';
import { unitInfo } from './dxf/units';

export const drawingGeometryOptionsSchema = z
  .object({
    offset: z.number().int().min(0).max(50000).default(0),
    limit: z.number().int().min(1).max(100).default(50),
    layer: z.string().min(1).max(200).optional(),
    points: z.boolean().default(false),
  })
  .strict();
export type DrawingGeometryOptions = z.input<typeof drawingGeometryOptionsSchema>;
export interface DrawingGeometryEntity {
  id: string;
  type: string;
  layer: string;
  bounds: Bounds;
  closed: boolean;
  length?: number;
  area?: number;
  radius?: number;
  axes?: [number, number];
  approximate: boolean;
  pointCount: number;
  points?: Point[];
  pointsComplete?: boolean;
}
export interface DrawingGeometryPage {
  path: string;
  version: SourceVersion;
  contentHash: string;
  coordinateSpace: 'drawing-2d';
  units: { code: number; label: string; symbol: string; millimetres: number | null };
  bounds: Bounds;
  entityCount: number;
  matchingEntities: number;
  layers: Drawing['layers'];
  layersTruncated: boolean;
  entities: DrawingGeometryEntity[];
  nextOffset?: number;
  coverage: {
    geometry: 'complete' | 'partial';
    points: 'not-requested' | 'complete' | 'partial';
    reasons: string[];
  };
}
/** Geometry remains in declared drawing units. Unknown units never silently become mm. */
export function drawingGeometryPage(drawing: Drawing, options: DrawingGeometryOptions) {
  const input = drawingGeometryOptionsSchema.parse(options);
  const matching = input.layer
    ? drawing.entities.filter((entity) => entity.layer === input.layer)
    : drawing.entities;
  let remainingPoints = 2000;
  const entities: DrawingGeometryEntity[] = matching
    .slice(input.offset, input.offset + input.limit)
    .map((entity: DrawingEntity) => {
      const points = input.points ? entity.points.slice(0, remainingPoints) : undefined;
      remainingPoints -= points?.length ?? 0;
      return {
        id: entity.id,
        type: entity.type,
        layer: entity.layer,
        bounds: entity.bounds,
        closed: entity.closed,
        length: entity.length,
        area: entity.area,
        radius: entity.radius,
        axes: entity.axes,
        approximate: !!entity.approximate,
        pointCount: entity.points.length,
        ...(points ? { points, pointsComplete: points.length === entity.points.length } : {}),
      };
    });
  const unit = unitInfo(drawing.units);
  return {
    coordinateSpace: 'drawing-2d' as const,
    units: {
      code: drawing.units,
      label: unit.label,
      symbol: unit.symbol,
      millimetres: unit.mm ?? null,
    },
    bounds: drawing.bounds,
    entityCount: drawing.entities.length,
    matchingEntities: matching.length,
    layers: drawing.layers.slice(0, 100),
    layersTruncated: drawing.layers.length > 100,
    entities,
    ...(input.offset + entities.length < matching.length
      ? { nextOffset: input.offset + entities.length }
      : {}),
    coverage: {
      geometry: drawing.warnings.length ? ('partial' as const) : ('complete' as const),
      points: !input.points
        ? ('not-requested' as const)
        : entities.some((entity) => !entity.pointsComplete)
          ? ('partial' as const)
          : ('complete' as const),
      reasons: [
        ...(input.points
          ? [
              'Coordinates describe the shared reader’s 2D paths, including tessellated curves. Use the separate lengths, areas and radii when available.',
            ]
          : []),
        ...drawing.warnings.slice(0, 20).map((warning) => warning.slice(0, 1000)),
        ...(entities.some((entity) => entity.approximate)
          ? [
              'Some entity geometry is sampled. Bounds and measurements retain the reader’s approximation flags.',
            ]
          : []),
        ...(input.points && entities.some((entity) => !entity.pointsComplete)
          ? ['Point output is limited to 2,000 coordinates per page. Request fewer entities.']
          : []),
      ],
    },
  };
}
