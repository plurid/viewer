import { z } from 'zod';
import { robotOriginSchema, robotVectorSchema } from './model';

const name = z.string().min(1).max(200);
export const robotTaskSchema = z
  .object({
    version: z.literal(1),
    units: z.object({ length: z.literal('m'), angle: z.literal('rad') }).strict(),
    tool: z.object({ link: name, point: robotVectorSchema }).strict(),
    base: robotOriginSchema,
    tolerance: z.number().finite().min(0.000001).max(0.005),
    targets: z
      .array(z.object({ id: name, position: robotVectorSchema }).strict())
      .min(1)
      .max(16),
    poses: z
      .array(
        z
          .object({
            targetID: name,
            positions: z
              .record(name, z.number().finite().min(-1e6).max(1e6))
              .refine((value) => Object.keys(value).length <= 64),
          })
          .strict(),
      )
      .min(1)
      .max(16),
  })
  .strict()
  .superRefine((task, context) => {
    const targets = new Set(task.targets.map((target) => target.id));
    const poses = new Set(task.poses.map((pose) => pose.targetID));
    if (
      targets.size !== task.targets.length ||
      poses.size !== task.poses.length ||
      targets.size !== poses.size ||
      [...poses].some((id) => !targets.has(id))
    )
      context.addIssue({
        code: 'custom',
        message: 'Supply exactly one candidate pose for every unique target.',
      });
  });
export type RobotTask = z.infer<typeof robotTaskSchema>;

// Persist the inputs' identity, never a result supplied by a frame or imported manifest.
export const robotCheckBindingSchema = z
  .object({
    sourceID: z.uuid(),
    stateKey: name,
    revision: z.number().int().nonnegative(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    inputHash: z.string().regex(/^[a-f0-9]{64}$/),
    checker: z.literal('position-v1'),
    at: z.number().finite(),
  })
  .strict();
export type RobotCheckBinding = z.infer<typeof robotCheckBindingSchema>;
export interface RobotPoseCheck {
  targetID: string;
  actual: [number, number, number];
  residual: number;
  withinTolerance: boolean;
  violations: { joint: string; value: number; lower: number; upper: number; unit: 'm' | 'rad' }[];
}
export type RobotCheckReport =
  | { status: 'stale'; reason: string }
  | {
      status: 'checked';
      passed: boolean;
      input: RobotTask;
      poses: RobotPoseCheck[];
      scope: 'Endpoint positions and hard joint limits only';
      unchecked: 'Orientation, intervals between poses, collision, dynamics and hardware calibration';
    };

export interface RobotComparisonSide {
  id: string;
  title: string;
  revision: number;
  stateRevision: number;
  inputHash: string;
  report: Extract<RobotCheckReport, { status: 'checked' }>;
}
export type RobotComparisonReport =
  | { status: 'unavailable'; reason: string }
  | {
      status: 'compared';
      sourceHash: string;
      original: RobotComparisonSide;
      alternative: RobotComparisonSide;
    };
