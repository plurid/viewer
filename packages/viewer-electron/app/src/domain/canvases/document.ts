import { z } from 'zod';
import { canvasSourcesSchema } from './sources';
import { canvasResultSchema } from './results';
import { robotCheckBindingSchema } from '../robotics/task';
import type { RobotCheckReport, RobotComparisonReport } from '../robotics/task';
import { canvasActionsSchema, canvasActionInputSchema, canvasActionOutputSchema } from './actions';
import type { CanvasActionRun } from './actions';
import { placementCheckBindingSchema } from '../robotics/placement';
import type { PlacementReport, PlacementComparison } from '../robotics/placement';

export const canvasLimits = {
  html: 512_000,
  state: 128_000,
  history: 16,
  assets: 24,
  assetBytes: 32 * 1024 * 1024,
  totalAssetBytes: 96 * 1024 * 1024,
} as const;
export const canvasStateSchema = z
  .record(z.string().min(1).max(200), z.json())
  .refine(
    (value) =>
      new TextEncoder().encode(JSON.stringify(value)).length <= canvasLimits.state &&
      !Object.keys(value).some((key) => ['__proto__', 'constructor', 'prototype'].includes(key)),
    'Canvas state exceeds its limit or contains a reserved key.',
  );
export const canvasAssetSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(255),
    mime: z.string().max(100),
    bytes: z.number().int().nonnegative().max(canvasLimits.assetBytes),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    source: z.string().max(32768).optional(),
    provenance: z.string().max(1000).optional(),
  })
  .strict();
const content = {
  revision: z.number().int().nonnegative(),
  title: z.string().min(1).max(200),
  html: z.string().max(canvasLimits.html),
  defaults: canvasStateSchema,
  assets: z
    .array(canvasAssetSchema)
    .max(canvasLimits.assets)
    .refine(
      (assets) =>
        new Set(assets.map((asset) => asset.id)).size === assets.length &&
        assets.reduce((sum, asset) => sum + asset.bytes, 0) <= canvasLimits.totalAssetBytes,
      'Canvas assets must have unique IDs and total at most 96 MiB.',
    ),
  at: z.number().finite(),
  sources: canvasSourcesSchema.default([]),
};
export const canvasDocumentSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]).transform(() => 2 as const),
    id: z.uuid(),
    conversationID: z.uuid(),
    path: z.string().min(1).max(32768),
    ...content,
    state: canvasStateSchema,
    stateRevision: z.number().int().nonnegative(),
    robotCheck: robotCheckBindingSchema.optional(),
    placementCheck: placementCheckBindingSchema.optional(),
    history: z.array(z.object(content).strict()).max(canvasLimits.history),
    fork: z.object({ id: z.uuid(), revision: z.number().int().nonnegative() }).strict().optional(),
  })
  .strict();
export type CanvasDocument = z.infer<typeof canvasDocumentSchema>;
export type CanvasAsset = z.infer<typeof canvasAssetSchema>;
export type CanvasState = z.infer<typeof canvasStateSchema>;
export const canvasAssetFile = (asset: Pick<CanvasAsset, 'id' | 'name'>) =>
  'assets/' +
  asset.id +
  '.' +
  (asset.name.match(/\.([a-z0-9]{1,12})$/i)?.[1]?.toLowerCase() ?? 'bin');
export const canvasRequestSchema = z.discriminatedUnion('kind', [
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
      kind: z.literal('register-actions'),
      id: z.uuid(),
      revision: z.number().int().nonnegative(),
      frameID: z.uuid(),
      actions: canvasActionsSchema,
    })
    .strict(),
  z.object({ kind: z.literal('detach-actions'), id: z.uuid(), frameID: z.uuid() }).strict(),
  z.object({ kind: z.literal('cancel-action'), id: z.uuid() }).strict(),
  z
    .object({
      kind: z.literal('invoke-action'),
      id: z.uuid(),
      revision: z.number().int().nonnegative(),
      stateRevision: z.number().int().nonnegative(),
      action: z.string().min(1).max(80),
      input: canvasActionInputSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('complete-action'),
      id: z.uuid(),
      frameID: z.uuid(),
      runID: z.uuid(),
      output: canvasActionOutputSchema.optional(),
      error: z.string().max(1000).optional(),
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
  z
    .object({
      kind: z.literal('refresh-source'),
      id: z.uuid(),
      sourceID: z.uuid(),
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('save-result'),
      id: z.uuid(),
      revision: z.number().int().nonnegative(),
      stateRevision: z.number().int().nonnegative(),
      result: canvasResultSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('observe'),
      id: z.uuid(),
      revision: z.number().int().nonnegative(),
      status: z.enum(['ready', 'error']),
      message: z.string().max(1000).optional(),
    })
    .strict(),
  z
    .object({ kind: z.literal('attach'), id: z.uuid(), path: z.string().min(1).max(32768) })
    .strict(),
  z
    .object({
      kind: z.literal('model'),
      id: z.uuid(),
      assetID: z.uuid(),
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ kind: z.literal('read'), id: z.uuid() }).strict(),
  z.object({ kind: z.literal('preview'), id: z.uuid() }).strict(),
  z
    .object({
      kind: z.literal('state'),
      id: z.uuid(),
      revision: z.number().int().nonnegative(),
      contentRevision: z.number().int().nonnegative(),
      patch: canvasStateSchema,
    })
    .strict(),
  z
    .object({ kind: z.literal('undo'), id: z.uuid(), revision: z.number().int().nonnegative() })
    .strict(),
  z
    .object({ kind: z.literal('apply'), id: z.uuid(), revision: z.number().int().nonnegative() })
    .strict(),
  z.object({ kind: z.literal('export'), id: z.uuid() }).strict(),
]);
export type CanvasRequest = z.infer<typeof canvasRequestSchema>;
export type CanvasReply = {
  document: CanvasDocument;
  actionRun?: CanvasActionRun;
  placementReport?: PlacementReport;
  placementComparison?: PlacementComparison;
  preview?: { id: string; url: string };
  exported?: string;
  saved?: string;
  robotReport?: RobotCheckReport;
  robotComparison?: RobotComparisonReport;
};

/** Existing values belong to the person, even when the app no longer displays their controls. */
export function retainedCanvasState(state: CanvasState, defaults: CanvasState): CanvasState {
  for (const key of Object.keys(defaults)) {
    if (!(key in state)) continue;
    const kind = (value: unknown) =>
      value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if (kind(state[key]) !== kind(defaults[key]))
      throw new Error(
        `The new canvas changes the type of saved value “${key}”. Use a new state key to keep the original value.`,
      );
  }
  return canvasStateSchema.parse({ ...defaults, ...state });
}
