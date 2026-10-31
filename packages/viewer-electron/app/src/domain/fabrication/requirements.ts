/**
 * REQUIREMENTS: a source passage supplies a labeled value, or a person confirms it explicitly.
 * A number occurring somewhere in a quote does not establish its role. Unsupported dimensions
 * remain reviewable without becoming correction targets or cut-sheet defaults.
 */
import { z } from 'zod';
import type { FabricationAnswer, Finding, InventorySource, RequestPart } from './answer';
import type { PitchAxis } from './plan';
import type { SourceVersion } from '../files/inspection';
import { sameSourceVersion, sourceVersionSchema } from '../files/inspection';
import { quoteOn } from './quotes';

export const requirementKinds = [
  'pitch',
  'diameter',
  'size',
  'holes',
  'thickness',
  'quantity',
] as const;
export type RequirementKind = (typeof requirementKinds)[number];
export const requirementUnits = ['mm', 'pieces', 'holes'] as const;
export type RequirementUnit = (typeof requirementUnits)[number];

export interface RequirementClaim {
  key: string;
  kind: RequirementKind;
  ref: string;
  page: number;
  value: number | null;
  quote: string | null;
  /** The opaque DXF ref whose requirement is being reviewed. */
  part?: string;
  /** A request's printed part name, for its bounded comma-separated row syntax. */
  label?: string;
  axis?: PitchAxis | null;
}
export interface RequirementEvidence {
  ref: string;
  page: number;
  version: SourceVersion;
  quote: string | null;
}
export type AcceptedRequirement = z.infer<typeof acceptedRequirementSchema>;
export type RequirementVerification = z.infer<typeof requirementVerificationSchema>;

export const requirementClaimSchema = z
  .object({
    key: z.string().min(1).max(200),
    kind: z.enum(requirementKinds),
    ref: z.string().regex(/^S[1-9]\d{0,2}$/),
    page: z.number().int().min(1).max(10_000),
    value: z.number().finite().nullable(),
    quote: z.string().max(10_000).nullable(),
    part: z
      .string()
      .regex(/^S[1-9]\d{0,2}$/)
      .optional(),
    label: z.string().max(120).optional(),
    axis: z.enum(['x', 'y', 'centre']).nullable().optional(),
  })
  .strict();
export const requirementEvidenceSchema = z
  .object({
    ref: z.string().regex(/^S[1-9]\d{0,2}$/),
    page: z.number().int().min(1).max(10_000),
    version: sourceVersionSchema,
    quote: z.string().max(10_000).nullable(),
  })
  .strict();
const acceptedShape = {
  key: z.string().min(1).max(200),
  kind: z.enum(requirementKinds),
  value: z.number().finite().nonnegative(),
  unit: z.enum(requirementUnits),
  evidence: requirementEvidenceSchema,
  part: z
    .string()
    .regex(/^S[1-9]\d{0,2}$/)
    .optional(),
};
export const acceptedRequirementSchema = z.discriminatedUnion('status', [
  z.object({ ...acceptedShape, status: z.literal('source-verified') }).strict(),
  z
    .object({
      ...acceptedShape,
      status: z.literal('human-confirmed'),
      confirmedAt: z.number().finite().nonnegative(),
    })
    .strict(),
]);
export const requirementVerificationSchema = z.union([
  acceptedRequirementSchema,
  z
    .object({
      status: z.literal('unverified'),
      key: z.string().min(1).max(200),
      reason: z.string().min(1).max(10_000),
    })
    .strict(),
]);
export const requirementConfirmationSchema = z
  .object({
    ...acceptedShape,
    confirmedAt: z.number().finite().nonnegative(),
  })
  .strict();
/** Created by the desktop from a person's explicit review, never from a model's answer. */
export type RequirementConfirmation = z.infer<typeof requirementConfirmationSchema>;

export const findingRequirementKey = (id: string) => `finding:${id}`;
export const partRequirementKey = (
  index: number,
  origin: 'request' | 'drawing',
  kind: 'quantity' | 'thickness',
) => `part:${index}:${origin}:${kind}`;

export function findingRequirement(finding: Finding): RequirementClaim | undefined {
  if (!finding.drawing || !requirementKinds.includes(finding.kind as RequirementKind))
    return undefined;
  return {
    key: findingRequirementKey(finding.id),
    kind: finding.kind as RequirementKind,
    ref: finding.drawing.ref,
    page: finding.drawing.page ?? 1,
    value: finding.drawing.value,
    quote: finding.drawing.quote,
    ...(finding.dxf ? { part: finding.dxf.ref, axis: finding.dxf.axis } : {}),
  };
}

export function requestRequirement(
  part: RequestPart,
  index: number,
  origin: 'request' | 'drawing',
  kind: 'quantity' | 'thickness',
): RequirementClaim | undefined {
  const source = origin === 'request' ? part : part.drawing;
  if (!source || source[kind] === null) return undefined;
  return {
    key: partRequirementKey(index, origin, kind),
    kind,
    ref: source.ref,
    page: origin === 'drawing' ? part.drawing!.page : 1,
    value: source[kind],
    quote: source.quote,
    label: part.part,
    ...(part.dxf ? { part: part.dxf } : {}),
  };
}

export function enumerateRequirements(answer: FabricationAnswer): RequirementClaim[] {
  const claims = answer.findings.map(findingRequirement).filter((claim) => claim !== undefined);
  answer.request.forEach((part, index) => {
    for (const origin of ['request', 'drawing'] as const)
      for (const kind of ['quantity', 'thickness'] as const) {
        const claim = requestRequirement(part, index, origin, kind);
        if (claim) claims.push(claim);
      }
  });
  return claims;
}

export const requirementUnit = (kind: RequirementKind): RequirementUnit =>
  kind === 'quantity' ? 'pieces' : kind === 'holes' ? 'holes' : 'mm';
const usable = (value: number, unit: RequirementUnit) =>
  Number.isFinite(value) &&
  (unit === 'mm'
    ? value > 0 && value <= 1e9
    : Number.isInteger(value) && value >= 0 && value <= 20_000);
const normalize = (text: string) =>
  text.normalize('NFKC').toLowerCase().replace(/⌀/g, 'ø').replace(/×/g, 'x');
const labelText = (text: string) => normalize(text).replace(/\s+/g, ' ').trim();
const numeric = '(\\d+(?:[.,]\\d+)?)(?![\\p{N}_.,])';
const number = `(?<![\\p{L}\\p{N}_.,+−-])${numeric}`;
const unit =
  '(mm|millimet(?:er|re)s?|cm|centimet(?:er|re)s?|inches|inch|in|[″"])(?![\\p{L}\\p{N}_])';
const scale = (written: string) =>
  /^(?:cm|centimet)/.test(written) ? 10 : /^(?:in|[″"])/.test(written) ? 25.4 : 1;
const readNumber = (written: string) => Number(written.replace(',', '.'));
const pattern = (source: string) => new RegExp(source, 'giu');

/** A page-wide unit is usable only when it explicitly declares one consistent unit. */
function pageScale(text: string): number | undefined {
  const units = [...normalize(text).matchAll(pattern(`\\bunits?\\s*[:=]\\s*${unit}`))].map(
    (match) => scale(match[1]!),
  );
  return units.length && units.every((value) => value === units[0]) ? units[0] : undefined;
}

/** Values explicitly carrying this role. A bare drawing number never acquires the model's role. */
function sourceValues(claim: RequirementClaim, quote: string, text: string): number[] {
  const passage = normalize(quote);
  const values: number[] = [];
  const lengths = (expression: string) => {
    for (const match of passage.matchAll(pattern(expression))) {
      const following = passage.slice(match.index! + match[0].length).trimStart();
      // A declared page unit cannot turn an explicit unknown unit into millimetres.
      if (
        !match[2] &&
        /^[\p{L}°'"″µμ%/]/u.test(following) &&
        !/^(?:at|on|holes?|pitch)\b/u.test(following)
      )
        continue;
      const multiplier = match[2] ? scale(match[2]) : pageScale(text);
      if (multiplier !== undefined) values.push(readNumber(match[1]!) * multiplier);
    }
  };
  const counts = (expression: string) => {
    for (const match of passage.matchAll(pattern(expression))) {
      const following = passage.slice(match.index! + match[0].length).trimStart();
      if (/^(?:mm|cm|m|in|inches|inch|feet|ft|degrees|deg)\b|^[°'"″µμ%/]/u.test(following))
        continue;
      values.push(readNumber(match[1]!));
    }
  };
  const length = `${number}\\s*(?:${unit})?`;
  const labeled = (role: string) => {
    lengths(`\\b(?:${role})\\s*[:=]?\\s*${length}`);
    lengths(`${length}\\s+(?:${role})\\b`);
  };
  switch (claim.kind) {
    case 'pitch':
      labeled('pitch|centre[ -]to[ -]centre|center[ -]to[ -]center');
      break;
    case 'diameter':
      lengths(`ø\\s*${numeric}\\s*(?:${unit})?`);
      labeled('diameter|dia');
      break;
    case 'size':
      if (claim.axis === 'x') labeled('width');
      if (claim.axis === 'y') labeled('height');
      break;
    case 'holes':
      counts(`\\bholes?\\s*[:=]?\\s*${number}`);
      counts(`${number}\\s+holes?\\b`);
      counts(`${number}\\s*x\\s*ø`);
      break;
    case 'quantity':
      counts(`\\b(?:quantity|qty|pieces?|pcs)\\s*[:=]?\\s*${number}`);
      counts(`${number}\\s*(?:pieces?|pcs|buc)\\b`);
      break;
    case 'thickness':
      labeled('thickness|thick');
      // Existing request rows identify the part, thickness and piece count in that order.
      if (claim.label) {
        const found = pattern(
          `^\\s*[-*]?\\s*(.+?),\\s*${number}\\s*${unit}\\s*,\\s*${number}\\s*(?:pieces?|pcs|buc)\\b`,
        ).exec(passage);
        if (found && labelText(found[1]!) === labelText(claim.label))
          values.push(readNumber(found[2]!) * scale(found[3]!));
      }
      break;
  }
  return [...new Set(values)];
}

/** Source text and confirmations are supplied by the desktop from the captured job. */
export function verifyRequirement(
  claim: RequirementClaim,
  context: {
    source: InventorySource | undefined;
    text?: string;
    confirmation?: RequirementConfirmation;
  },
): RequirementVerification {
  const reject = (reason: string): RequirementVerification => ({
    status: 'unverified',
    key: claim.key,
    reason,
  });
  const { source, text, confirmation } = context;
  if (!source || source.ref !== claim.ref || !['drawing', 'request'].includes(source.kind))
    return reject('The requirement has no captured drawing or request source.');
  if (!sourceVersionSchema.safeParse(source.version).success)
    return reject('The requirement source has no captured file version.');
  if (
    !Number.isInteger(claim.page) ||
    claim.page < 1 ||
    (source.pages !== undefined && claim.page > source.pages)
  )
    return reject(`Page ${claim.page} is not a page of ${source.name}.`);
  const expectedUnit = requirementUnit(claim.kind);
  const accepted = (value: number): AcceptedRequirement => ({
    status: 'source-verified',
    key: claim.key,
    kind: claim.kind,
    value,
    unit: expectedUnit,
    evidence: { ref: source.ref, page: claim.page, version: source.version, quote: claim.quote },
    ...(claim.part ? { part: claim.part } : {}),
  });
  if (confirmation) {
    const parsed = requirementConfirmationSchema.safeParse(confirmation);
    if (
      !parsed.success ||
      confirmation.key !== claim.key ||
      confirmation.kind !== claim.kind ||
      confirmation.part !== claim.part ||
      confirmation.evidence.ref !== source.ref ||
      confirmation.evidence.page !== claim.page ||
      confirmation.evidence.quote !== claim.quote ||
      !sameSourceVersion(confirmation.evidence.version, source.version) ||
      confirmation.unit !== expectedUnit ||
      !usable(confirmation.value, expectedUnit)
    )
      return reject('The human confirmation does not match this requirement and source version.');
    return {
      ...accepted(confirmation.value),
      status: 'human-confirmed',
      confirmedAt: confirmation.confirmedAt,
    };
  }
  if (!claim.quote?.trim()) return reject('The requirement has no quoted source passage.');
  if (!text?.trim())
    return reject('This page has no extracted text; review the requirement in the source.');
  if (!quoteOn(text, claim.quote))
    return reject(`“${claim.quote}” is not on page ${claim.page} of ${source.name}.`);
  const values = sourceValues(claim, claim.quote, text);
  if (values.length !== 1 || !usable(values[0]!, expectedUnit))
    return reject(`The passage does not give one unambiguous ${claim.kind} in ${expectedUnit}.`);
  const value = values[0]!;
  if (claim.value === null || !Number.isFinite(claim.value) || Math.abs(value - claim.value) > 1e-9)
    return reject(
      `The passage gives ${value} ${expectedUnit} for ${claim.kind}; the model's value is not supported.`,
    );
  return accepted(value);
}
