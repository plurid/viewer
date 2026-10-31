import { z } from 'zod';
import { evidenceRegionSchema, sourceVersionSchema } from '../files/inspection';
import { findingGrades, tourDefinitionSchema, tourStopSchema } from '../tours/tour';
import {
  fabricationAnswerSchema,
  findingSchema,
  inventoryKinds,
  inventoryRefSchema,
  requestPartSchema,
} from './answer';
import { checkStatuses, pageTextSchema } from './check';
import { dxfCorrectionSchema } from './plan';
import {
  acceptedRequirementSchema,
  requirementClaimSchema,
  requirementConfirmationSchema,
  requirementVerificationSchema,
} from './requirements';

const text = z.string().max(20_000);
const file = z.string().min(1).max(4096);
const number = z.number().finite();
const strings = z.array(text).max(1000);
const grade = z
  .object({
    finding: z.string().max(200),
    status: z.enum(findingGrades),
    measured: number.optional(),
    entities: z.array(z.string().max(20)).max(5000),
    reason: text,
    tolerance: number.nonnegative(),
    requirement: requirementVerificationSchema.optional(),
  })
  .strict();
const outline = z
  .object({
    stop: z.string().max(200),
    kind: z.enum(['text', 'feature']),
    source: z.enum(['segmentation', 'model-box', 'page-text']),
    label: text,
    region: evidenceRegionSchema,
    box: z.array(number).length(4).optional(),
    quote: text.optional(),
    confidence: number.optional(),
    note: text.optional(),
  })
  .strict();
const finding = z
  .object({
    finding: findingSchema,
    grade,
    origin: z.enum(['model', 'viewer']),
    readings: z
      .array(z.object({ finding: findingSchema, grade }).strict())
      .max(100)
      .optional(),
    unread: z.enum(['quantity', 'part']).optional(),
    request: z
      .object({ ref: inventoryRefSchema, value: number, quote: text.nullable() })
      .strict()
      .optional(),
    question: text.optional(),
    names: z
      .object({ drawing: text.optional(), dxf: text.optional(), photo: text.optional() })
      .strict(),
    correction: z
      .object({ plan: dxfCorrectionSchema, source: file, version: sourceVersionSchema, name: file })
      .strict()
      .optional(),
    outlines: z.array(outline).max(100),
  })
  .strict();
const provenance = {
  source: z.enum(['request', 'drawing', 'name']),
  quote: text.optional(),
  requirements: z.array(acceptedRequirementSchema).max(200).optional(),
};
export const checkResultSchema = z
  .object({
    kind: z.literal('result'),
    id: z.uuid(),
    provider: z.object({ name: text, model: text }).strict(),
    summary: text,
    request: z.array(requestPartSchema).max(200),
    findings: z.array(finding).max(200),
    issues: strings,
    tour: z
      .object({ name: text, root: file, stops: z.array(tourStopSchema).max(200), skipped: strings })
      .strict(),
    parts: z
      .array(
        z
          .object({
            ref: inventoryRefSchema,
            path: file,
            name: text,
            pieces: number.nonnegative(),
            quantity: z
              .object({ ...provenance, sets: number.nonnegative(), pieces: number.nonnegative() })
              .strict()
              .optional(),
            thickness: z
              .object({ ...provenance, value: number.positive() })
              .strict()
              .optional(),
            question: text.optional(),
          })
          .strict(),
      )
      .max(200),
    notSent: strings,
    seconds: number.nonnegative(),
    requirements: z
      .array(
        z
          .object({ claim: requirementClaimSchema, verification: requirementVerificationSchema })
          .strict(),
      )
      .max(1000)
      .optional(),
  })
  .strict();
const recordPicture = z
  .object({
    image: number.int().positive(),
    page: number.int().positive().optional(),
    width: number.positive(),
    height: number.positive(),
    bytes: number.nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const record = z
  .object({
    version: z.literal(1),
    job: text,
    started: text,
    provider: z.object({ kind: text, name: text, endpoint: text, model: text }).strict(),
    level: z.literal('images'),
    instructions: z.string().max(200_000),
    schema: z.record(z.string(), z.unknown()),
    inputs: z
      .array(
        z
          .object({
            ref: inventoryRefSchema,
            kind: z.enum(inventoryKinds),
            name: text,
            size: number.nonnegative(),
            modified: number,
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            sending: z.enum(['text', 'pages', 'picture', 'measurement', 'not sent']),
            pictures: z.array(recordPicture).max(32),
            note: text.optional(),
          })
          .strict(),
      )
      .max(200),
    output: z.unknown().optional(),
    validation: z.object({ valid: z.boolean(), error: text.optional(), issues: strings }).strict(),
    grades: z.array(grade).max(300),
    segmentation: z
      .array(outline.extend({ ref: inventoryRefSchema, page: number.int().positive().optional() }))
      .max(500),
    causes: z
      .array(z.object({ finding: text, readings: strings, summary: text }).strict())
      .max(100),
    corrections: z.array(z.object({ finding: text, plan: dxfCorrectionSchema }).strict()).max(100),
    tour: z.object({ stops: number.int().nonnegative(), skipped: strings }).strict(),
    timings: z
      .object({
        prepare: number.nonnegative(),
        model: number.nonnegative(),
        check: number.nonnegative(),
        total: number.nonnegative(),
      })
      .strict(),
    error: text.optional(),
  })
  .strict();

/** Private check state contains source text and outcomes, never provider credentials or page pixels. */
export const checkDocumentSchema = z
  .object({
    version: z.literal(1),
    id: z.uuid(),
    created: number.nonnegative(),
    updated: number.nonnegative(),
    status: z.enum(checkStatuses),
    paths: z.array(file).min(1).max(200),
    folder: file,
    job: text,
    sources: z
      .array(
        z
          .object({
            ref: inventoryRefSchema,
            kind: z.enum(inventoryKinds),
            name: text,
            pages: number.int().positive().optional(),
            path: file,
            version: sourceVersionSchema,
          })
          .strict(),
      )
      .max(200),
    skipped: z.array(z.object({ name: text, reason: text }).strict()).max(2000),
    result: checkResultSchema.optional(),
    record: record.optional(),
    tour: z.object({ root: file, definition: tourDefinitionSchema }).strict().optional(),
    verification: z
      .object({
        version: z.literal(1),
        answer: fabricationAnswerSchema,
        texts: z.record(z.string().max(50), z.string().max(500_000)),
        runs: z.record(z.string().max(50), z.array(pageTextSchema).max(3000)),
      })
      .strict()
      .optional(),
    confirmations: z.array(requirementConfirmationSchema).max(1000).default([]),
    corrections: z.record(z.string().max(200), z.uuid()).default({}),
    handoffs: z.array(z.uuid()).max(1000).default([]),
    error: text.optional(),
  })
  .strict();
export type CheckDocument = z.infer<typeof checkDocumentSchema>;

export const checkIndexSchema = z
  .object({
    version: z.literal(1),
    checks: z
      .array(
        z
          .object({
            id: z.uuid(),
            job: text,
            folder: file,
            paths: z.array(file).min(1).max(200),
            status: z.enum(checkStatuses),
            updated: number.nonnegative(),
            summary: text.optional(),
          })
          .strict(),
      )
      .max(10_000),
  })
  .strict();
export type CheckIndex = z.infer<typeof checkIndexSchema>;
