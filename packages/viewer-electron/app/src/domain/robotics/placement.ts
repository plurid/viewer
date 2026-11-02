import { z } from 'zod';
import { robotOriginSchema, robotVectorSchema } from './model';
import { robotTaskSchema } from './task';
import type { RobotPoseCheck } from './task';

const name = z.string().min(1).max(100);
export const mountingAreaSchema = z
  .object({
    min: z.tuple([z.number().finite(), z.number().finite()]),
    max: z.tuple([z.number().finite(), z.number().finite()]),
  })
  .strict()
  .refine((area) => area.min.every((v, i) => v < area.max[i]!), 'Area bounds must increase.');
export const placementBriefSchema = z
  .object({
    version: z.literal(1),
    units: robotTaskSchema.shape.units,
    tool: robotTaskSchema.shape.tool,
    tolerance: robotTaskSchema.shape.tolerance,
    bench: mountingAreaSchema,
    reference: robotVectorSchema,
    targets: robotTaskSchema.shape.targets,
    mounts: z
      .array(z.object({ id: name, label: name, base: robotOriginSchema }).strict())
      .min(1)
      .max(8),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.mounts.map((m) => m.id)).size === v.mounts.length &&
      new Set(v.targets.map((t) => t.id)).size === v.targets.length,
    'Mounts and targets need unique IDs.',
  );
export const placementStudySchema = z
  .object({
    version: z.literal(1),
    reserved: z.array(mountingAreaSchema).max(8),
    candidates: z
      .array(z.object({ id: name, poses: robotTaskSchema.shape.poses }).strict())
      .min(1)
      .max(8),
    selected: name.optional(),
  })
  .strict();
export const placementCheckBindingSchema = z
  .object({
    sourceID: z.uuid(),
    briefSourceID: z.uuid(),
    stateKey: z.string().min(1).max(200),
    revision: z.number().int().nonnegative(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    briefHash: z.string().regex(/^[a-f0-9]{64}$/),
    inputHash: z.string().regex(/^[a-f0-9]{64}$/),
    checker: z.literal('placement-v1'),
    at: z.number().finite(),
  })
  .strict();
export type PlacementBrief = z.infer<typeof placementBriefSchema>;
export type PlacementStudy = z.infer<typeof placementStudySchema>;
export type PlacementReport =
  | { status: 'stale'; reason: string }
  | {
      status: 'checked';
      brief: PlacementBrief;
      input: PlacementStudy;
      candidates: {
        id: string;
        label: string;
        allowed: boolean;
        passed: boolean;
        reached: number;
        total: number;
        maximumError: number;
        distance: number;
        poses: RobotPoseCheck[];
      }[];
      recommended?: string;
      scope: string;
    };
export type PlacementComparison =
  | { status: 'unavailable'; reason: string }
  | {
      status: 'compared';
      original: {
        id: string;
        title: string;
        report: Extract<PlacementReport, { status: 'checked' }>;
      };
      alternative: {
        id: string;
        title: string;
        report: Extract<PlacementReport, { status: 'checked' }>;
      };
    };
