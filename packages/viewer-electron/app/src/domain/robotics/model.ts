import { z } from 'zod';

export const robotLimits = { bytes: 128_000, links: 64, visuals: 256 } as const;
const number = z.number().finite().min(-1e6).max(1e6);
export const robotVectorSchema = z.tuple([number, number, number]);
export type RobotVector = z.infer<typeof robotVectorSchema>;
export const robotOriginSchema = z
  .object({ xyz: robotVectorSchema, rpy: robotVectorSchema })
  .strict();
export type RobotOrigin = z.infer<typeof robotOriginSchema>;
const name = z.string().min(1).max(200);
const definition = z
  .object({
    line: z.number().int().min(1),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    quote: z.string().min(1).max(10_000),
  })
  .strict()
  .refine((value) => value.end > value.start);
const positive = number.refine((value) => value > 0);
export const robotGeometrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('box'), size: z.tuple([positive, positive, positive]) }).strict(),
  z.object({ kind: z.literal('sphere'), radius: positive }).strict(),
  z.object({ kind: z.literal('cylinder'), radius: positive, length: positive }).strict(),
  z
    .object({
      kind: z.literal('mesh'),
      resource: z.string().min(1).max(1024),
      scale: z.tuple([positive, positive, positive]),
    })
    .strict(),
]);
const rgba = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
]);
const visual = z
  .object({ origin: robotOriginSchema, geometry: robotGeometrySchema, color: rgba.optional() })
  .strict();
export const robotJointSchema = z
  .object({
    name,
    type: z.enum(['fixed', 'revolute', 'continuous', 'prismatic']),
    parent: name,
    child: name,
    origin: robotOriginSchema,
    axis: robotVectorSchema,
    limit: z.object({ lower: number, upper: number }).strict().optional(),
    definition,
  })
  .strict();
export type RobotJoint = z.infer<typeof robotJointSchema>;
export const robotModelSchema = z
  .object({
    format: z.literal('urdf'),
    name,
    root: name,
    units: z.object({ length: z.literal('m'), angle: z.literal('rad') }).strict(),
    links: z
      .array(z.object({ name, visuals: z.array(visual).max(robotLimits.visuals) }).strict())
      .min(1)
      .max(robotLimits.links),
    joints: z.array(robotJointSchema).max(robotLimits.links - 1),
    notes: z.array(z.string().max(500)).max(16),
  })
  .strict()
  .superRefine((model, context) => {
    const fail = (message: string) => context.addIssue({ code: 'custom', message });
    const links = new Set(model.links.map((link) => link.name));
    if (
      links.size !== model.links.length ||
      new Set(model.joints.map((j) => j.name)).size !== model.joints.length
    )
      fail('Robot link and joint names must be unique.');
    if (!links.has(model.root) || model.joints.length !== links.size - 1)
      fail('The robot must be one connected tree.');
    if (model.links.reduce((count, link) => count + link.visuals.length, 0) > robotLimits.visuals)
      fail('The robot has too many visual elements.');
    const parents = new Map<string, string>();
    for (const joint of model.joints) {
      if (
        !links.has(joint.parent) ||
        !links.has(joint.child) ||
        parents.has(joint.child) ||
        joint.child === model.root
      )
        fail('Every non-root link must have exactly one known parent.');
      parents.set(joint.child, joint.parent);
      if (joint.type !== 'fixed' && Math.abs(Math.hypot(...joint.axis) - 1) > 1e-9)
        fail('A moving joint needs a normalized axis.');
      if ((joint.type === 'revolute' || joint.type === 'prismatic') && !joint.limit)
        fail('Bounded joints need explicit lower and upper limits.');
      if (joint.limit && joint.limit.lower > joint.limit.upper) fail('Joint limits are reversed.');
    }
    for (const link of links) {
      const seen = new Set<string>();
      let current: string | undefined = link;
      while (current && current !== model.root && !seen.has(current)) {
        seen.add(current);
        current = parents.get(current);
      }
      if (current !== model.root) fail('The robot contains a cycle or disconnected link.');
    }
  });
export type RobotModel = z.infer<typeof robotModelSchema>;
