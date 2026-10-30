/**
 * A JOB'S QUANTITIES AND THICKNESSES, RECONCILED. The request comes first: its message, then a
 * drawing's title block or parts list, as the model read them with their quotes, which Viewer
 * checks against the page text. A file name comes second, as a fallback and a cross-check. Where
 * two of them disagree, Viewer raises a finding and grades it like the model's, and never picks one
 * silently. A drawing of several separate pieces is never assumed to count sets or pieces: the
 * request decides, else the question is asked (docs/reference/fabrication.md).
 */
import type {
  FabricationAnswer,
  Finding,
  FindingKind,
  InventorySource,
  RequestPart,
} from './answer';
import type { UnreadValue } from './check';
import type { Grade, GradeJob } from './grade';
import { gradeFinding, gradeTolerance } from './grade';
import { quoteGives, quoteOn } from './quotes';
import { readJobName, thicknessText } from './names';

/** Where a value comes from, in the order Viewer takes it. */
export type ValueSource = 'request' | 'drawing' | 'name';
export const valueSourceLabels: Record<ValueSource, string> = {
  request: 'from the request',
  drawing: 'from the drawing',
  name: 'from the file name',
};
export interface PartQuantity {
  /** Sets of what the drawing holds, as nesting counts them. */
  sets: number;
  /** Pieces cut: the sets times the separate pieces the drawing holds. */
  pieces: number;
  source: ValueSource;
  /** "4, from the request", or "4 sets × 2 pieces = 8 pieces, from the file name". */
  text: string;
  quote?: string;
}
export interface PartThickness {
  value: number;
  source: ValueSource;
  /** "6 mm, from the request". */
  text: string;
  quote?: string;
}
/** A DXF part as the job asks for it. */
export interface PartPlan {
  ref: string;
  path: string;
  name: string;
  /** Separate pieces the drawing holds: its outlines, or 1 when it was not measured. */
  pieces: number;
  quantity?: PartQuantity;
  thickness?: PartThickness;
  /** What the job leaves open, asked in place of a number. */
  question?: string;
}
/** A finding Viewer raised itself, graded as the model's are. */
export interface ViewerFinding {
  finding: Finding;
  grade: Grade;
  /** The DXF part it is about, when it is about one. */
  part?: string;
  /** What the request says, when the finding sets it against a drawing. */
  request?: { ref: string; value: number; quote: string | null };
  question?: string;
  /** What the answer leaves unread in the request. */
  unread?: UnreadValue;
}
export interface ReconcileJob {
  answer: FabricationAnswer;
  sources: readonly InventorySource[];
  /** Who read the job, as its findings name it: "Muse Spark". */
  reader?: string;
  /** The inventory, DXF parts and page text, as grading reads them. */
  grading: GradeJob;
  /** The separate pieces a DXF part holds, or undefined when it was not measured. */
  pieces(ref: string): number | undefined;
}

type Compared = Extract<FindingKind, 'thickness' | 'quantity'>;
interface Reading {
  source: ValueSource;
  value: number;
  /** The request or drawing it is read from, and its page; a name has neither. */
  ref?: string;
  page?: number;
  quote: string | null;
}
const amount = (kind: Compared, value: number) =>
  kind === 'thickness' ? thicknessText(value) : `${value} ${value === 1 ? 'piece' : 'pieces'}`;
/** Whether two values say the same: within the grading tolerance for a thickness; for a
 * quantity, the same count, or one the other times the pieces the drawing holds. */
function agree(kind: Compared, a: number, b: number, pieces: number): boolean {
  if (kind === 'thickness') return Math.abs(a - b) <= gradeTolerance;
  return a === b || a === b * pieces || b === a * pieces;
}

export function reconcileJob(job: ReconcileJob): { parts: PartPlan[]; findings: ViewerFinding[] } {
  const { answer } = job;
  const byRef = new Map(job.sources.map((source) => [source.ref, source]));
  const used = answer.findings.map((finding) => Number(finding.id.slice(1)));
  let next = Math.max(0, ...used) + 1;
  const findings: ViewerFinding[] = [];
  const parts: PartPlan[] = [];
  const said = (kind: Compared, ref: string, drawing?: string) =>
    answer.findings.some(
      (finding) =>
        finding.kind === kind &&
        (finding.dxf?.ref === ref || (drawing !== undefined && finding.drawing?.ref === drawing)),
    );
  /** Where a quoted reading fails: no quote, a quote not on its page, or one without the value. */
  const unchecked = (kind: Compared, reading: Reading): string | undefined => {
    if (reading.source === 'name' || !reading.ref) return undefined;
    const name = byRef.get(reading.ref)?.name ?? reading.ref;
    const page = reading.page ?? 1;
    if (!reading.quote)
      return `The ${reading.source} value has no quote, so Viewer cannot check it.`;
    const text = job.grading.text?.(reading.ref, page);
    if (text && !quoteOn(text, reading.quote))
      return `“${reading.quote}” is not on page ${page} of ${name}.`;
    if (!quoteGives(reading.quote, reading.value))
      return `“${reading.quote}” does not give ${amount(kind, reading.value)}.`;
    return undefined;
  };
  const raise = (entry: Omit<ViewerFinding, 'grade'>, grade: (finding: Finding) => Grade) => {
    if (next > 99) return;
    findings.push({ ...entry, grade: grade(entry.finding) });
  };
  const documentValue = (reading: Reading) => ({
    ref: reading.ref!,
    page: reading.page ?? 1,
    value: reading.value,
    quote: reading.quote,
    box: null,
    feature: null,
  });

  for (const source of job.sources) {
    if (source.kind !== 'dxf') continue;
    const asked = answer.request.filter((part) => part.dxf === source.ref);
    const name = readJobName(source.name);
    const pieces = job.pieces(source.ref) ?? 1;
    const label = name.part ?? asked[0]?.part ?? source.name;
    const plan: PartPlan = { ref: source.ref, path: source.path, name: source.name, pieces };

    const readings = (kind: Compared): Partial<Record<ValueSource, Reading>> => {
      const result: Partial<Record<ValueSource, Reading>> = {};
      const counted = asked.filter((part) => part[kind] !== null);
      if (counted.length)
        result.request = {
          source: 'request',
          // Parts the request lists apart that are one drawing: a left and a right, say.
          value:
            kind === 'quantity'
              ? counted.reduce((sum, part) => sum + part.quantity!, 0)
              : counted[0]!.thickness!,
          ref: counted[0]!.ref,
          page: 1,
          quote:
            counted
              .map((part) => part.quote)
              .filter(Boolean)
              .join(' · ') || null,
        };
      const drawn = asked.find((part) => part.drawing && part.drawing[kind] !== null)?.drawing;
      if (drawn)
        result.drawing = {
          source: 'drawing',
          value: drawn[kind]!,
          ref: drawn.ref,
          page: drawn.page,
          quote: drawn.quote,
        };
      const read = name[kind];
      if (read) result.name = { source: 'name', value: read.value, quote: read.text };
      return result;
    };

    for (const kind of ['thickness', 'quantity'] as const) {
      const { request, drawing, name: named } = readings(kind);
      // The request against the name, or the drawing against it when the request gives nothing.
      const against = request ?? drawing;
      if (
        against &&
        named &&
        !agree(kind, against.value, named.value, pieces) &&
        !said(kind, source.ref)
      )
        raise(
          {
            part: source.ref,
            finding: {
              id: `F${next++}`,
              kind,
              summary: `The ${against.source} asks for ${amount(kind, against.value)} of ${label}; its file name gives ${amount(kind, named.value)} (“${named.quote}”).`,
              drawing: documentValue(against),
              dxf: { ref: source.ref, value: named.value, axis: null, entities: [] },
              photo: null,
              proposal: null,
            },
          },
          (finding) => {
            const graded = gradeFinding(finding, job.grading);
            const problem = graded.status === 'confirmed' && unchecked(kind, against);
            return problem ? { ...graded, status: 'unverified', reason: problem } : graded;
          },
        );
      // The request against the drawing.
      if (
        request &&
        drawing &&
        !agree(kind, request.value, drawing.value, pieces) &&
        !said(kind, source.ref, drawing.ref)
      ) {
        const drawingName = byRef.get(drawing.ref!)?.name ?? drawing.ref!;
        raise(
          {
            part: source.ref,
            request: { ref: request.ref!, value: request.value, quote: request.quote },
            finding: {
              id: `F${next++}`,
              kind,
              summary: `The request asks for ${amount(kind, request.value)} of ${label}; ${drawingName} gives ${amount(kind, drawing.value)}.`,
              drawing: documentValue(drawing),
              dxf: null,
              photo: null,
              proposal: null,
            },
          },
          (finding) => {
            const problem = unchecked(kind, request) ?? unchecked(kind, drawing);
            return {
              finding: finding.id,
              status: problem ? 'unverified' : 'confirmed',
              entities: [],
              reason:
                problem ??
                `The request says “${request.quote}”; page ${drawing.page ?? 1} of ${drawingName} says “${drawing.quote}”.`,
              tolerance: kind === 'thickness' ? gradeTolerance : 0,
            };
          },
        );
      }
      const chosen = request ?? drawing ?? named;
      if (!chosen) continue;
      const from = valueSourceLabels[chosen.source];
      const quote = chosen.quote ?? undefined;
      if (kind === 'thickness') {
        plan.thickness = {
          value: chosen.value,
          source: chosen.source,
          text: `${thicknessText(chosen.value)}, ${from}`,
          ...(quote ? { quote } : {}),
        };
        continue;
      }
      if (chosen.source === 'name') {
        // Only a name gives it: its count is taken as sets, and said to be so.
        plan.quantity = {
          sets: chosen.value,
          pieces: chosen.value * pieces,
          source: 'name',
          text:
            pieces === 1
              ? `${chosen.value}, ${from} (“${chosen.quote}”)`
              : `${chosen.value} sets × ${pieces} pieces = ${chosen.value * pieces} pieces, ${from} (“${chosen.quote}”); nothing else in the job says whether it counts sets or pieces`,
          ...(quote ? { quote } : {}),
        };
        continue;
      }
      if (chosen.value % pieces === 0) {
        const sets = chosen.value / pieces;
        plan.quantity = {
          sets,
          pieces: chosen.value,
          source: chosen.source,
          text:
            pieces === 1
              ? `${chosen.value}, ${from}`
              : `${sets} sets × ${pieces} pieces = ${chosen.value} pieces, ${from}`,
          ...(quote ? { quote } : {}),
        };
        continue;
      }
      plan.question = `${source.name} holds ${pieces} separate pieces, and the ${chosen.source} asks for ${chosen.value}, which is not a whole number of sets. How many sets should be cut?`;
      raise(
        {
          part: source.ref,
          question: plan.question,
          finding: {
            id: `F${next++}`,
            kind: 'quantity',
            summary: plan.question,
            drawing: documentValue(chosen),
            dxf: { ref: source.ref, value: named?.value ?? null, axis: null, entities: [] },
            photo: null,
            proposal: null,
          },
        },
        (finding) => ({
          finding: finding.id,
          status: 'unverified',
          entities: [],
          reason: `Viewer does not choose between sets and pieces: ${chosen.value} pieces of a drawing of ${pieces} is ${(chosen.value / pieces).toLocaleString('en', { maximumFractionDigits: 2 })} sets.`,
          tolerance: 0,
        }),
      );
    }
    parts.push(plan);
  }
  unread(job, said, (entry, reason) =>
    raise({ ...entry, finding: { ...entry.finding, id: `F${next++}` } }, (finding) => ({
      finding: finding.id,
      status: 'unverified',
      entities: [],
      reason,
      tolerance: 0,
    })),
  );
  return { parts, findings };
}

/** A finding about what the answer leaves unread, before Viewer numbers it. */
type UnreadEntry = Omit<ViewerFinding, 'grade' | 'finding'> & { finding: Omit<Finding, 'id'> };
const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
/** Whether a request's part names a DXF part: its words hold the part its file name gives. */
function names(part: RequestPart, dxf: InventorySource): boolean {
  const named = plain(readJobName(dxf.name).part ?? dxf.name.replace(/\.dxf$/i, ''));
  return !!named && plain(part.part).includes(named);
}
/**
 * What the answer leaves unread in a request sent as text, each part apart, never with a number
 * of Viewer's own: a part it lists without a quantity, a DXF part no listed part is, and a listed
 * part that is a DXF part it does not name. A part the model already found a quantity of is left.
 */
function unread(
  job: ReconcileJob,
  said: (kind: Compared, ref: string) => boolean,
  raise: (entry: UnreadEntry, reason: string) => void,
): void {
  const request = job.sources.find((source) => source.kind === 'request');
  if (!request) return;
  const reader = job.reader ?? 'The model';
  const parts = job.answer.request;
  const again = 'Check the request or run the check again.';
  const finding = (summary: string, part: RequestPart | undefined, dxf?: InventorySource) => ({
    kind: 'quantity' as const,
    summary,
    drawing: {
      ref: part?.ref ?? request.ref,
      page: 1,
      value: null,
      quote: part?.quote ?? null,
      box: null,
      feature: null,
    },
    dxf: dxf ? { ref: dxf.ref, value: null, axis: null, entities: [] } : null,
    photo: null,
    proposal: null,
  });
  const noQuantity = (part: RequestPart, dxf?: InventorySource) => {
    if (dxf && said('quantity', dxf.ref)) return;
    raise(
      {
        unread: 'quantity',
        ...(dxf ? { part: dxf.ref } : {}),
        finding: finding(
          `${reader} did not read a quantity for ${part.part} from the request. ${again}`,
          part,
          dxf,
        ),
      },
      `The answer lists ${part.part} with no quantity, so nothing was compared.`,
    );
  };
  const placed = new Set<RequestPart>();
  for (const dxf of job.sources.filter((source) => source.kind === 'dxf')) {
    const linked = parts.filter((part) => part.dxf === dxf.ref);
    const loose = parts.filter((part) => !part.dxf && names(part, dxf));
    for (const part of [...linked, ...loose]) placed.add(part);
    for (const part of linked) if (part.quantity === null) noQuantity(part, dxf);
    if (linked.length || said('quantity', dxf.ref)) continue;
    const name = readJobName(dxf.name).part ?? dxf.name;
    const [part] = loose;
    if (!part)
      raise(
        {
          unread: 'part',
          part: dxf.ref,
          finding: finding(
            `${reader} did not read ${name} from the request. ${again}`,
            undefined,
            dxf,
          ),
        },
        `The answer lists no part of the request for ${dxf.name}, so nothing was compared.`,
      );
    else if (part.quantity === null) noQuantity(part, dxf);
    else
      raise(
        {
          unread: 'part',
          part: dxf.ref,
          finding: finding(
            `${reader} did not match ${part.part} in the request to ${dxf.name}. ${again}`,
            part,
            dxf,
          ),
        },
        `The answer lists ${part.part} without its DXF, so its values are not used for ${dxf.name}.`,
      );
  }
  for (const part of parts) if (!placed.has(part) && part.quantity === null) noQuantity(part);
}
