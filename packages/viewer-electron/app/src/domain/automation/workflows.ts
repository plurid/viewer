import { z } from 'zod';
import { projectPathSchema } from '../workspaces/project';
import { sourceVersionSchema } from '../files/inspection';
import type { DefinitionDocument } from '../definitions';
import type { ActionContext } from '../services';
const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/);
export const workflowReferenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('selection') }).strict(),
  z.object({ kind: z.literal('input'), name: id }).strict(),
  z.object({ kind: z.literal('step'), id }).strict(),
]);
export type WorkflowReference = z.infer<typeof workflowReferenceSchema>;
const base = { id, needs: z.array(id).max(100).default([]) };
export const workflowStepSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...base,
      kind: z.literal('inspect'),
      sources: z.array(workflowReferenceSchema).min(1).max(100),
      content: z.boolean().default(false),
      ocr: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('compare'),
      left: workflowReferenceSchema,
      right: workflowReferenceSchema,
      hashes: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('recipe'),
      sources: z.array(workflowReferenceSchema).min(1).max(100),
      recipeID: id,
      instructions: z.string().max(12000).optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('copy'),
      sources: z.array(workflowReferenceSchema).min(1).max(100),
      destination: workflowReferenceSchema,
    })
    .strict(),
]);
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export function workflowReferences(step: WorkflowStep): WorkflowReference[] {
  return step.kind === 'compare'
    ? [step.left, step.right]
    : step.kind === 'copy'
      ? [...step.sources, step.destination]
      : step.sources;
}
export function workflowUsesSelection(definition: { steps: WorkflowStep[] }): boolean {
  return definition.steps.some((step) =>
    workflowReferences(step).some((reference) => reference.kind === 'selection'),
  );
}
export const workflowDefinitionSchema = z
  .object({
    version: z.literal(1),
    id,
    name: z.string().trim().min(1).max(100),
    bindings: z
      .array(z.object({ name: id, label: z.string().max(200) }).strict())
      .max(100)
      .default([]),
    inputs: z
      .record(id, projectPathSchema)
      .refine((value) => Object.keys(value).length <= 100, 'Use at most 100 workflow inputs.'),
    steps: z.array(workflowStepSchema).min(1).max(100),
  })
  .strict()
  .superRefine((flow, context) => {
    const steps = new Map(flow.steps.map((step) => [step.id, step]));
    if (steps.size !== flow.steps.length)
      context.addIssue({ code: 'custom', message: 'Workflow step IDs must be unique.' });
    const bindings = new Set(flow.bindings.map((binding) => binding.name));
    if (bindings.size !== flow.bindings.length)
      context.addIssue({ code: 'custom', message: 'Workflow binding names must be unique.' });
    for (const target of Object.values(flow.inputs))
      if (target.binding && !bindings.has(target.binding))
        context.addIssue({ code: 'custom', message: 'Declare every external input binding.' });
    const marks = new Map<string, 'visiting' | 'complete'>();
    const visit = (name: string): boolean => {
      if (marks.get(name) === 'visiting') return false;
      if (marks.get(name) === 'complete') return true;
      const step = steps.get(name);
      if (!step) return false;
      marks.set(name, 'visiting');
      if (!step.needs.every(visit)) return false;
      marks.set(name, 'complete');
      return true;
    };
    for (const step of flow.steps) {
      if (!visit(step.id))
        context.addIssue({
          code: 'custom',
          message: 'Dependencies must reference existing steps without cycles.',
        });
      for (const ref of workflowReferences(step)) {
        if (ref.kind === 'input' && !Object.hasOwn(flow.inputs, ref.name))
          context.addIssue({ code: 'custom', message: 'Declare each referenced input.' });
        if (ref.kind === 'step' && !step.needs.includes(ref.id))
          context.addIssue({
            code: 'custom',
            message: 'A step reference must be an explicit dependency.',
          });
      }
    }
  });
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type WorkflowDocument = DefinitionDocument<WorkflowDefinition>;
export const workflowSourceSchema = z
  .object({ path: z.string().min(1).max(32768), version: sourceVersionSchema })
  .strict();
export const workflowArtifactSchema = z
  .json()
  .refine(
    (value) => JSON.stringify(value).length <= 4000000,
    'Workflow artifacts exceed 4 MB. Narrow the input selection.',
  );
/** Service results may contain absent optional properties; persist only their JSON representation. */
export function workflowArtifact(value: unknown): z.infer<typeof workflowArtifactSchema> {
  const text = JSON.stringify(value);
  if (!text || text.length > 4000000)
    throw new Error('Workflow artifacts exceed 4 MB. Narrow the input selection.');
  return workflowArtifactSchema.parse(JSON.parse(text));
}
export const workflowRecordSchema = z
  .object({
    id,
    kind: z.enum(['inspect', 'compare', 'recipe', 'copy']),
    status: z.enum(['pending', 'running', 'waiting-review', 'completed', 'failed', 'cancelled']),
    sources: z.array(workflowSourceSchema).max(2000),
    outputs: z.array(workflowSourceSchema).max(2000),
    taskID: z.string().max(200).optional(),
    artifact: workflowArtifactSchema.optional(),
    error: z.string().max(2000).optional(),
  })
  .strict();
export type WorkflowRecord = z.infer<typeof workflowRecordSchema>;
export const workflowRunSchema = z
  .object({
    version: z.literal(1),
    id: z.uuid(),
    file: z.string().max(32768),
    revision: z.string().max(100),
    watch: z
      .object({ id: z.uuid(), approval: z.string().length(64) })
      .strict()
      .optional(),
    created: z.number(),
    updated: z.number(),
    status: z.enum(['running', 'paused', 'waiting-review', 'completed', 'failed', 'cancelled']),
    definition: workflowDefinitionSchema,
    bindings: z.record(id, z.string().max(32768)),
    context: z
      .object({
        workspaceID: z.string(),
        rootID: z.string(),
        paneID: z.string(),
        sources: z.array(z.string()).max(2000),
        actor: z.enum(['user', 'agent']),
        clientID: z.string().optional(),
        recursive: z.boolean().optional(),
      })
      .strict(),
    steps: z.array(workflowRecordSchema).max(100),
  })
  .strict();
export type WorkflowRun = z.infer<typeof workflowRunSchema>;
export type WorkflowRequest =
  | { kind: 'choose'; mode: 'open' | 'create'; defaultPath?: string }
  | { kind: 'read'; file: string }
  | { kind: 'save'; file: string; revision: string; definition: WorkflowDefinition }
  | { kind: 'list' }
  | { kind: 'get'; id: string }
  | {
      kind: 'start';
      file: string;
      revision: string;
      bindings: Record<string, string>;
      context: ActionContext;
      /** Private trigger proof. The renderer request schema deliberately excludes this field. */
      watch?: { id: string; approval: string };
    }
  | { kind: 'resume'; id: string }
  | { kind: 'cancel'; id: string }
  | { kind: 'remove'; id: string };
export type WorkflowReply = WorkflowDocument | WorkflowRun | WorkflowRun[] | string | null;
