/** Offline experiment protocol. The Viewer bridge does not expose these operations. */
import { z } from 'zod';
import { canvasDocumentSchema, canvasRequestSchema } from '../canvases/document';
import type { CanvasReply } from '../canvases/document';
import { canvasSourceSchema, canvasSourceDataSchema } from '../canvases/sources';
import { robotModelSchema } from './model';
import { robotCheckBindingSchema } from './task';
import type { RobotCheckReport, RobotComparisonReport } from './task';
import { placementCheckBindingSchema } from './placement';
import type { PlacementReport, PlacementComparison } from './placement';
export const experimentSourceSchema = canvasSourceSchema.extend({
  data: canvasSourceDataSchema.safeExtend({ robot: robotModelSchema.optional() }),
});
export type ExperimentSource = z.infer<typeof experimentSourceSchema>;
export const experimentDocumentSchema = canvasDocumentSchema.extend({
  sources: z.array(experimentSourceSchema),
  history: z.array(
    canvasDocumentSchema.shape.history.element.extend({ sources: z.array(experimentSourceSchema) }),
  ),
  robotCheck: robotCheckBindingSchema.optional(),
  placementCheck: placementCheckBindingSchema.optional(),
});
export type ExperimentDocument = z.infer<typeof experimentDocumentSchema>;
export const experimentRequestSchema = z.union([
  canvasRequestSchema,
  z.discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('check-placements'),
        id: z.uuid(),
        revision: z.number().int().nonnegative(),
        stateRevision: z.number().int().nonnegative(),
        sourceID: z.uuid(),
        briefSourceID: z.uuid(),
        stateKey: z.string().min(1).max(200),
      })
      .strict(),
    z.object({ kind: z.literal('placement-report'), id: z.uuid() }).strict(),
    z.object({ kind: z.literal('placement-comparison'), id: z.uuid() }).strict(),
    z
      .object({
        kind: z.literal('save-placement-check'),
        id: z.uuid(),
        revision: z.number().int().nonnegative(),
        stateRevision: z.number().int().nonnegative(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('check-robot'),
        id: z.uuid(),
        revision: z.number().int().nonnegative(),
        stateRevision: z.number().int().nonnegative(),
        sourceID: z.uuid(),
        stateKey: z.string().min(1).max(200),
      })
      .strict(),
    z.object({ kind: z.literal('robot-report'), id: z.uuid() }).strict(),
    z.object({ kind: z.literal('robot-comparison'), id: z.uuid() }).strict(),
    z
      .object({
        kind: z.literal('save-robot-comparison'),
        id: z.uuid(),
        revision: z.number().int().nonnegative(),
        stateRevision: z.number().int().nonnegative(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('save-robot-check'),
        id: z.uuid(),
        revision: z.number().int().nonnegative(),
        stateRevision: z.number().int().nonnegative(),
      })
      .strict(),
  ]),
]);
export type ExperimentRequest = z.infer<typeof experimentRequestSchema>;
export type ExperimentReply = Omit<CanvasReply, 'document'> & {
  document: ExperimentDocument;
  robotReport?: RobotCheckReport;
  robotComparison?: RobotComparisonReport;
  placementReport?: PlacementReport;
  placementComparison?: PlacementComparison;
};
export type ExperimentAPI = {
  canvas(request: ExperimentRequest): Promise<ExperimentReply>;
};
