import { z } from 'zod';

const parameter = z
  .object({
    type: z.enum(['string', 'number', 'boolean']),
    description: z.string().max(300).optional(),
    enum: z
      .array(z.union([z.string().max(1000), z.number().finite(), z.boolean()]))
      .max(32)
      .optional(),
    minimum: z.number().finite().optional(),
    maximum: z.number().finite().optional(),
  })
  .strict();
const name = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/);
export const canvasActionSchema = z
  .object({
    id: name,
    label: z.string().trim().min(1).max(120),
    inputSchema: z
      .object({
        type: z.literal('object'),
        properties: z.record(name, parameter).refine((v) => Object.keys(v).length <= 24),
        required: z.array(name).max(24),
        additionalProperties: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .refine(
    (v) => v.inputSchema.required.every((key) => key in v.inputSchema.properties),
    'Required action inputs must have a definition.',
  );
export const canvasActionsSchema = z
  .array(canvasActionSchema)
  .max(16)
  .refine((v) => new Set(v.map((a) => a.id)).size === v.length, 'Action IDs must be unique.');
export type CanvasAction = z.infer<typeof canvasActionSchema>;
export const canvasActionInputSchema = z
  .record(name, z.union([z.string().max(1000), z.number().finite(), z.boolean()]))
  .refine((v) => Object.keys(v).length <= 24);
export type CanvasActionInput = z.infer<typeof canvasActionInputSchema>;
export const canvasInvocationSchema = z
  .object({
    action: name,
    input: canvasActionInputSchema,
    revision: z.number().int().nonnegative(),
    stateRevision: z.number().int().nonnegative(),
  })
  .strict();
export const canvasPlacementRequestSchema = z
  .object({
    sourceID: z.uuid(),
    briefSourceID: z.uuid(),
    stateKey: z.string().min(1).max(200),
    revision: z.number().int().nonnegative(),
    stateRevision: z.number().int().nonnegative(),
  })
  .strict();
export const canvasActionOutputSchema = z
  .object({
    result: z
      .json()
      .refine(
        (v) => new TextEncoder().encode(JSON.stringify(v)).length <= 32000,
        'Action results must fit within 32 KB.',
      ),
    patch: z.record(z.string(), z.json()).optional(),
  })
  .strict();
export type CanvasActionOutput = z.infer<typeof canvasActionOutputSchema>;

export function validateCanvasActionInput(action: CanvasAction, raw: unknown): CanvasActionInput {
  const input = canvasActionInputSchema.parse(raw);
  const schema = action.inputSchema;
  for (const key of schema.required)
    if (!Object.hasOwn(input, key)) throw new Error('Missing action input: ' + key);
  for (const [key, value] of Object.entries(input)) {
    const field = Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined;
    if (!field || typeof value !== field.type) throw new Error('Invalid action input: ' + key);
    if (field.enum && !field.enum.includes(value)) throw new Error('Unknown value for: ' + key);
    if (
      typeof value === 'number' &&
      ((field.minimum !== undefined && value < field.minimum) ||
        (field.maximum !== undefined && value > field.maximum))
    )
      throw new Error('Action input is outside its range: ' + key);
  }
  return input;
}

export interface CanvasActionRun {
  id: string;
  canvasID: string;
  frameID: string;
  revision: number;
  stateRevision: number;
  action: string;
  label: string;
  actor: string;
  actorKind: 'user' | 'model';
  input: CanvasActionInput;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  started: number;
  finished?: number;
  result?: CanvasActionOutput['result'];
  error?: string;
}
export type CanvasActionEvent =
  | { kind: 'invoke'; run: CanvasActionRun; state: Record<string, unknown> }
  | { kind: 'settled'; run: CanvasActionRun };
