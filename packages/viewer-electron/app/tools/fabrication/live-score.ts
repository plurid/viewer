/**
 * THE LIVE EVALUATION'S SCORE: one check's result held against its job's truth, and every run
 * summed. A finding finds a planted problem when it is of that problem's kind and names its DXF, or,
 * naming no DXF, its part; a second finding of the same problem is a duplicate, and a finding of no
 * planted problem is a false finding. Outlines are compared with the drawing's labelled regions and
 * text runs, and the photo's part, by intersection over union (docs/reference/fabrication.md).
 */
import type { CheckFinding, CheckResult, PageText } from '../../src/domain/fabrication/check';
import type { FindingKind, InventoryKind } from '../../src/domain/fabrication/answer';
import type { FindingGrade } from '../../src/domain/tours/tour';
import type { FindingOrigin } from '../../src/domain/fabrication/check';
import type { SegmentationSource } from '../../src/domain/models/segmentation';
import type { UnitBox } from '../../src/domain/files/regions';
import type {
  FractionBox,
  LiveJobTruth,
  PlantedKind,
  PlantedProblem,
} from '../playground/samples/fabrication-jobs';
import { quoteOn } from '../../src/domain/fabrication/grade';
import { plantedKinds, plantedLabels } from '../playground/samples/fabrication-jobs';

/** Who a call went to: the reading model, or SAM. */
export type CallRoute = 'model' | 'segmentation';
export interface TokenUsage {
  input: number;
  output: number;
  total: number;
  /** In US dollars, when the reply gives it. */
  cost?: number;
}
export interface CallLog {
  route: CallRoute;
  /** 0 when no reply came. */
  status: number;
  milliseconds: number;
  /** The request body's bytes. */
  sent: number;
  usage?: TokenUsage;
  /** The reply's body, as it came. */
  reply?: string;
  error?: string;
}
/** Why an attempt gave no result. */
export type FailureKind =
  'schema' | 'json' | 'incomplete' | 'http' | 'timeout' | 'network' | 'other';
export type AttemptOutcome = 'graded' | FailureKind;
export interface AttemptLog {
  outcome: AttemptOutcome;
  error?: string;
  /** Where the answer misses the schema, each `path: message`. */
  schemaIssues?: string[];
  calls: CallLog[];
}
/** One region outlined for a tour stop: the model's box, and what stood for it. */
export interface OutlineLog {
  /** The drawing or photo, and a drawing's page. */
  file?: string;
  page?: number;
  box: UnitBox;
  polygon: [number, number][];
  source: SegmentationSource;
  confidence?: number;
  note?: string;
  stop?: string;
}
/** A file of the job by its ref, as the check listed it. */
export interface ScoredSource {
  ref: string;
  kind: InventoryKind;
  name: string;
}
export interface RunInput {
  truth: LiveJobTruth;
  repeat: number;
  sources: readonly ScoredSource[];
  attempts: readonly AttemptLog[];
  result?: CheckResult;
  outlines: readonly OutlineLog[];
  /** A request's or drawing page's text, by ref and page; undefined when it has none. */
  text(ref: string, page: number): string | undefined;
  /** A drawing page's text runs, by file name and page. */
  runs(file: string, page: number): readonly PageText[];
}

export interface ProblemScore {
  id: string;
  kind: PlantedKind;
  part: string;
  description: string;
  found: boolean;
  /** The grades of the findings that found it. */
  grades: FindingGrade[];
  origins: FindingOrigin[];
  findings: string[];
}
export interface FindingScore {
  id: string;
  kind: FindingKind;
  origin: FindingOrigin;
  grade: FindingGrade;
  summary: string;
  /** The planted problem it finds; none for a false finding. */
  problem?: string;
  duplicate?: boolean;
}
export interface QuoteScore {
  checked: number;
  onPage: number;
  notOnPage: number;
  /** Quotes of a page Viewer has no text for. */
  noText: number;
  /** Quotes not on their page, each with where it was looked for. */
  missed: string[];
}
export interface RequestScore {
  /** Parts the request asks for. */
  parts: number;
  /** Of them, the parts the model listed. */
  listed: number;
  quantity: number;
  thickness: number;
  /** Listed with their own DXF, or with none when the job has none. */
  dxf: number;
}
export interface OutlineScore {
  file?: string;
  page?: number;
  stop?: string;
  source: SegmentationSource;
  confidence?: number;
  note?: string;
  /** The outline's best IoU with a truth region of its page or photo, and that region. */
  iou?: number;
  region?: string;
  /** The model's box's best IoU, the same way. */
  boxIoU?: number;
}
export interface RunScore {
  job: string;
  name: string;
  control: boolean;
  repeat: number;
  graded: boolean;
  attempts: number;
  failures: FailureKind[];
  problems: ProblemScore[];
  findings: FindingScore[];
  quotes: QuoteScore;
  request: RequestScore;
  outlines: OutlineScore[];
  calls: Omit<CallLog, 'reply'>[];
}

/** The grade a found problem should get: Viewer measures pitches and diameters and checks the
 * quotes of thicknesses and quantities; a missing DXF and an open count it cannot measure. */
export const expectedGrades: Record<PlantedKind, FindingGrade> = {
  pitch: 'confirmed',
  diameter: 'confirmed',
  thickness: 'confirmed',
  quantity: 'confirmed',
  'missing-dxf': 'unverified',
  'piece-count': 'unverified',
};
/** The finding kinds that find a problem; a missing DXF is found by any finding naming its part. */
const findingKinds: Record<PlantedKind, readonly FindingKind[] | 'any'> = {
  pitch: ['pitch'],
  diameter: ['diameter'],
  thickness: ['thickness'],
  quantity: ['quantity'],
  'missing-dxf': 'any',
  'piece-count': ['quantity'],
};
const squashed = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

function mentions(item: CheckFinding, problem: PlantedProblem): boolean {
  const text = squashed(
    [item.finding.summary, item.finding.drawing?.quote, item.question].filter(Boolean).join(' '),
  );
  return text.includes(squashed(problem.part));
}
/** Whether a finding is of a planted problem: its kind, about its DXF, or its part without one. */
export function findsProblem(item: CheckFinding, problem: PlantedProblem): boolean {
  const kinds = findingKinds[problem.kind];
  if (kinds !== 'any' && !kinds.includes(item.finding.kind)) return false;
  if (!problem.dxf) return !item.names.dxf && mentions(item, problem);
  return item.names.dxf === problem.dxf || (!item.names.dxf && mentions(item, problem));
}

/** Area of a polygon, by the shoelace formula. */
function polygonArea(points: readonly (readonly [number, number])[]): number {
  let sum = 0;
  for (let index = 0; index < points.length; index++) {
    const [x1, y1] = points[index]!,
      [x2, y2] = points[(index + 1) % points.length]!;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}
/** A polygon clipped to a box, edge by edge (Sutherland and Hodgman): the box is convex, so the
 * polygon may be any simple one. */
function clipped(points: readonly (readonly [number, number])[], box: FractionBox) {
  const [left, top, right, bottom] = box;
  const edges: [inside: (p: readonly [number, number]) => boolean, axis: 0 | 1, at: number][] = [
    [(p) => p[0] >= left, 0, left],
    [(p) => p[0] <= right, 0, right],
    [(p) => p[1] >= top, 1, top],
    [(p) => p[1] <= bottom, 1, bottom],
  ];
  let out = [...points];
  for (const [inside, axis, at] of edges) {
    const input = out;
    out = [];
    input.forEach((current, index) => {
      const previous = input[(index + input.length - 1) % input.length]!;
      const cross = (): [number, number] => {
        const t = (at - previous[axis]) / (current[axis] - previous[axis]);
        const point: [number, number] = [
          previous[0] + t * (current[0] - previous[0]),
          previous[1] + t * (current[1] - previous[1]),
        ];
        point[axis] = at;
        return point;
      };
      if (inside(current)) {
        if (!inside(previous)) out.push(cross());
        out.push(current);
      } else if (inside(previous)) out.push(cross());
    });
    if (!out.length) return out;
  }
  return out;
}
/** Intersection over union of a polygon and a box, both in fractions of the picture. */
export function polygonIoU(polygon: readonly (readonly [number, number])[], box: FractionBox) {
  const [left, top, right, bottom] = box;
  const boxArea = Math.max(0, right - left) * Math.max(0, bottom - top);
  const shared = polygonArea(clipped(polygon, box));
  const union = polygonArea(polygon) + boxArea - shared;
  return union > 0 ? shared / union : 0;
}
const corners = ({ x, y, width, height }: UnitBox): [number, number][] => [
  [x, y],
  [x + width, y],
  [x + width, y + height],
  [x, y + height],
];

/** The labelled regions of a picture: the truth's, and a drawing page's text runs. */
function regionsOf(input: RunInput, file: string, page: number | undefined) {
  return [
    ...input.truth.regions
      .filter((region) => region.file === file && region.page === page)
      .map(({ label, box }) => ({ label, box })),
    ...(page === undefined ? [] : input.runs(file, page)).map((run) => ({
      label: `text “${run.text}”`,
      box: run.box as FractionBox,
    })),
  ];
}
function best(
  polygon: readonly (readonly [number, number])[],
  regions: readonly { label: string; box: FractionBox }[],
) {
  let top: { iou: number; label: string } | undefined;
  for (const region of regions) {
    const iou = polygonIoU(polygon, region.box);
    if (!top || iou > top.iou) top = { iou, label: region.label };
  }
  return top;
}
const round = (value: number, places = 3) => Number(value.toFixed(places));

export function scoreRun(input: RunInput): RunScore {
  const { truth, result } = input;
  const byRef = new Map(input.sources.map((source) => [source.ref, source]));
  const problems: ProblemScore[] = truth.problems.map((problem) => ({
    id: problem.id,
    kind: problem.kind,
    part: problem.part,
    description: problem.description,
    found: false,
    grades: [],
    origins: [],
    findings: [],
  }));
  const scores = new Map(problems.map((score) => [score.id, score]));
  const findings: FindingScore[] = [];
  for (const item of result?.findings ?? []) {
    const matching = truth.problems.filter((problem) => findsProblem(item, problem));
    const fresh = matching.find((problem) => !scores.get(problem.id)!.found);
    const problem = fresh ?? matching[0];
    if (problem) {
      const score = scores.get(problem.id)!;
      score.found = true;
      score.grades.push(item.grade.status);
      score.origins.push(item.origin);
      score.findings.push(item.finding.id);
    }
    findings.push({
      id: item.finding.id,
      kind: item.finding.kind,
      origin: item.origin,
      grade: item.grade.status,
      summary: item.finding.summary,
      ...(problem ? { problem: problem.id } : {}),
      ...(problem && !fresh ? { duplicate: true } : {}),
    });
  }

  // Every quote of the model's answer, against the text of the page it names.
  const quotes: QuoteScore = { checked: 0, onPage: 0, notOnPage: 0, noText: 0, missed: [] };
  const quote = (ref: string, page: number | null, value: string | null) => {
    if (!value) return;
    quotes.checked++;
    const text = input.text(ref, page ?? 1);
    if (text === undefined) quotes.noText++;
    else if (quoteOn(text, value)) quotes.onPage++;
    else {
      quotes.notOnPage++;
      quotes.missed.push(`“${value}” on page ${page ?? 1} of ${byRef.get(ref)?.name ?? ref}`);
    }
  };
  const answer = result
    ? {
        request: result.request,
        findings: result.findings.filter((item) => item.origin === 'model'),
      }
    : undefined;
  for (const part of answer?.request ?? []) {
    quote(part.ref, 1, part.quote);
    if (part.drawing) quote(part.drawing.ref, part.drawing.page, part.drawing.quote);
  }
  for (const { finding } of answer?.findings ?? [])
    if (finding.drawing) quote(finding.drawing.ref, finding.drawing.page, finding.drawing.quote);

  // The request as the model read it, part by part.
  const request: RequestScore = {
    parts: truth.requested.length,
    listed: 0,
    quantity: 0,
    thickness: 0,
    dxf: 0,
  };
  for (const asked of truth.requested) {
    const read = answer?.request.find((part) => squashed(part.part).includes(squashed(asked.part)));
    if (!read) continue;
    request.listed++;
    if (read.quantity === asked.quantity) request.quantity++;
    if (read.thickness === asked.thickness) request.thickness++;
    const dxf = read.dxf ? byRef.get(read.dxf)?.name : undefined;
    if (dxf === asked.dxf) request.dxf++;
  }

  const outlines: OutlineScore[] = input.outlines.map((outline) => {
    const regions = outline.file ? regionsOf(input, outline.file, outline.page) : [];
    const drawn = best(outline.polygon, regions);
    const boxed = best(corners(outline.box), regions);
    return {
      ...(outline.file ? { file: outline.file } : {}),
      ...(outline.page === undefined ? {} : { page: outline.page }),
      ...(outline.stop ? { stop: outline.stop } : {}),
      source: outline.source,
      ...(outline.confidence === undefined ? {} : { confidence: outline.confidence }),
      ...(outline.note ? { note: outline.note } : {}),
      ...(drawn ? { iou: round(drawn.iou), region: drawn.label } : {}),
      ...(boxed ? { boxIoU: round(boxed.iou) } : {}),
    };
  });

  return {
    job: truth.id,
    name: truth.job,
    control: truth.control,
    repeat: input.repeat,
    graded: !!result,
    attempts: input.attempts.length,
    failures: input.attempts.flatMap((attempt) =>
      attempt.outcome === 'graded' ? [] : [attempt.outcome],
    ),
    problems,
    findings,
    quotes,
    request,
    outlines,
    calls: input.attempts.flatMap((attempt) => attempt.calls.map(({ reply: _, ...call }) => call)),
  };
}

export interface Spread {
  count: number;
  mean?: number;
  median?: number;
  p90?: number;
  max?: number;
}
export function spread(values: readonly number[]): Spread {
  if (!values.length) return { count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (share: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)]!;
  const middle = sorted.length / 2;
  return {
    count: sorted.length,
    mean: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    median: round(
      sorted.length % 2 ? sorted[Math.floor(middle)]! : (sorted[middle - 1]! + sorted[middle]!) / 2,
    ),
    p90: round(at(0.9)),
    max: round(sorted.at(-1)!),
  };
}
type Grades = Record<FindingGrade, number>;
const noGrades = (): Grades => ({ confirmed: 0, refuted: 0, unverified: 0 });
/** US dollars per million tokens. */
export interface Price {
  input: number;
  output: number;
}
export interface LiveMetrics {
  runs: number;
  graded: number;
  recall: Record<
    PlantedKind | 'all',
    { planted: number; found: number; confirmed: number; expected: number }
  >;
  falseFindings: {
    total: number;
    perRun: number;
    byOrigin: Record<FindingOrigin, number>;
    byGrade: Grades;
    jobs: {
      job: string;
      name: string;
      control: boolean;
      runs: number;
      findings: number;
      grades: Grades;
    }[];
  };
  duplicates: number;
  grades: { all: Grades; planted: Grades; false: Grades };
  quotes: Omit<QuoteScore, 'missed'>;
  request: RequestScore;
  attempts: {
    total: number;
    retried: number;
    failedRuns: number;
    failures: Record<FailureKind, number>;
  };
  outlines: {
    total: number;
    sam: number;
    fallback: number;
    fallbackRate: number;
    reasons: Record<string, number>;
    iou: Spread;
    boxIoU: Spread;
  };
  latency: Record<CallRoute, Spread>;
  tokens: { input: number; output: number; total: number; calls: number; cost?: number };
}

export function liveMetrics(runs: readonly RunScore[], price?: Price): LiveMetrics {
  const recall = Object.fromEntries(
    [...plantedKinds, 'all'].map((kind) => [
      kind,
      { planted: 0, found: 0, confirmed: 0, expected: 0 },
    ]),
  ) as LiveMetrics['recall'];
  const grades = { all: noGrades(), planted: noGrades(), false: noGrades() };
  const falseFindings: LiveMetrics['falseFindings'] = {
    total: 0,
    perRun: 0,
    byOrigin: { model: 0, viewer: 0 },
    byGrade: noGrades(),
    jobs: [],
  };
  const quotes = { checked: 0, onPage: 0, notOnPage: 0, noText: 0 };
  const request: RequestScore = { parts: 0, listed: 0, quantity: 0, thickness: 0, dxf: 0 };
  const failures: Record<FailureKind, number> = {
    schema: 0,
    json: 0,
    incomplete: 0,
    http: 0,
    timeout: 0,
    network: 0,
    other: 0,
  };
  const reasons: Record<string, number> = {};
  const tokens: LiveMetrics['tokens'] = { input: 0, output: 0, total: 0, calls: 0 };
  let duplicates = 0,
    reported = 0;
  for (const run of runs) {
    for (const problem of run.problems)
      for (const key of [problem.kind, 'all'] as const) {
        recall[key].planted++;
        if (!problem.found) continue;
        recall[key].found++;
        if (problem.grades.includes('confirmed')) recall[key].confirmed++;
        if (problem.grades.includes(expectedGrades[problem.kind])) recall[key].expected++;
      }
    let job = falseFindings.jobs.find((item) => item.job === run.job);
    if (!job) {
      job = {
        job: run.job,
        name: run.name,
        control: run.control,
        runs: 0,
        findings: 0,
        grades: noGrades(),
      };
      falseFindings.jobs.push(job);
    }
    job.runs++;
    for (const finding of run.findings) {
      grades.all[finding.grade]++;
      if (finding.duplicate) duplicates++;
      if (finding.problem) {
        if (!finding.duplicate) grades.planted[finding.grade]++;
        continue;
      }
      grades.false[finding.grade]++;
      falseFindings.total++;
      falseFindings.byOrigin[finding.origin]++;
      falseFindings.byGrade[finding.grade]++;
      job.findings++;
      job.grades[finding.grade]++;
    }
    for (const key of ['checked', 'onPage', 'notOnPage', 'noText'] as const)
      quotes[key] += run.quotes[key];
    for (const key of ['parts', 'listed', 'quantity', 'thickness', 'dxf'] as const)
      request[key] += run.request[key];
    for (const failure of run.failures) failures[failure]++;
    for (const outline of run.outlines)
      if (outline.source === 'model-box') {
        const reason = (outline.note ?? 'no reason given').replace(
          /^SAM 3\.1 gave no outline: /,
          '',
        );
        reasons[reason] = (reasons[reason] ?? 0) + 1;
      }
    for (const call of run.calls) {
      if (!call.usage) continue;
      tokens.calls++;
      tokens.input += call.usage.input;
      tokens.output += call.usage.output;
      tokens.total += call.usage.total;
      if (call.usage.cost !== undefined) {
        tokens.cost = (tokens.cost ?? 0) + call.usage.cost;
        reported++;
      }
    }
  }
  if (!reported && price && tokens.calls)
    tokens.cost = (tokens.input * price.input + tokens.output * price.output) / 1_000_000;
  if (tokens.cost !== undefined) tokens.cost = round(tokens.cost, 4);
  falseFindings.perRun = runs.length ? round(falseFindings.total / runs.length, 2) : 0;
  const outlines = runs.flatMap((run) => run.outlines);
  const sam = outlines.filter((outline) => outline.source === 'segmentation');
  const calls = runs.flatMap((run) => run.calls);
  const latency = (route: CallRoute) =>
    spread(
      calls.filter((call) => call.route === route && call.status).map((call) => call.milliseconds),
    );
  return {
    runs: runs.length,
    graded: runs.filter((run) => run.graded).length,
    recall,
    falseFindings,
    duplicates,
    grades,
    quotes,
    request,
    attempts: {
      total: runs.reduce((sum, run) => sum + run.attempts, 0),
      retried: runs.filter((run) => run.attempts > 1).length,
      failedRuns: runs.filter((run) => !run.graded).length,
      failures,
    },
    outlines: {
      total: outlines.length,
      sam: sam.length,
      fallback: outlines.length - sam.length,
      fallbackRate: outlines.length ? round((outlines.length - sam.length) / outlines.length) : 0,
      reasons,
      iou: spread(sam.flatMap((outline) => (outline.iou === undefined ? [] : [outline.iou]))),
      boxIoU: spread(
        outlines.flatMap((outline) => (outline.boxIoU === undefined ? [] : [outline.boxIoU])),
      ),
    },
    latency: { model: latency('model'), segmentation: latency('segmentation') },
    tokens,
  };
}

const percent = (part: number, whole: number) =>
  whole ? `${Math.round((part / whole) * 1000) / 10}%` : 'none';
const seconds = (milliseconds?: number) =>
  milliseconds === undefined ? 'none' : `${(milliseconds / 1000).toFixed(1)} s`;
const fixed = (value?: number) => (value === undefined ? 'none' : value.toFixed(2));
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ');

export interface SummaryContext {
  model: string;
  endpoint: string;
  started: string;
  jobs: number;
  repeat: number;
  retries: number;
  price?: Price;
  /** What stopped the evaluation before every run was made. */
  stopped?: string;
}
/** The run as a Markdown page: what was found and missed, false findings, grades, quotes, schema
 * failures, outlines and calls. */
export function liveSummary(
  metrics: LiveMetrics,
  runs: readonly RunScore[],
  context: SummaryContext,
): string {
  const lines: string[] = [];
  const add = (...items: string[]) => lines.push(...items);
  add(
    '# Live fabrication evaluation',
    '',
    `Muse Spark \`${context.model}\` and SAM 3.1 at ${context.endpoint}, started ${context.started}. ` +
      `${context.jobs} jobs, ${context.repeat} ${context.repeat === 1 ? 'run' : 'runs'} each, ` +
      `${context.retries} ${context.retries === 1 ? 'retry' : 'retries'} allowed. ${metrics.graded} of ${metrics.runs} runs graded.`,
    ...(context.stopped ? ['', `The evaluation stopped early: ${context.stopped}`] : []),
    '',
    '## Planted problems found',
    '',
    '| Problem | Planted | Found | Recall | Confirmed | Graded as expected |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  );
  for (const kind of [...plantedKinds, 'all'] as const) {
    const row = metrics.recall[kind];
    if (kind !== 'all' && !row.planted) continue;
    add(
      `| ${kind === 'all' ? '**All**' : `${plantedLabels[kind]} (${expectedGrades[kind]})`} | ${row.planted} | ${row.found} | ${percent(row.found, row.planted)} | ${row.confirmed} | ${row.expected} |`,
    );
  }
  const missed = runs.flatMap((run) =>
    run.problems
      .filter((problem) => !problem.found)
      .map((problem) => `- ${run.job} run ${run.repeat}, ${problem.part}: ${problem.description}`),
  );
  add(
    '',
    missed.length ? 'Missed:' : 'Every planted problem was found.',
    ...(missed.length ? ['', ...missed] : []),
  );

  add(
    '',
    '## Findings not planted',
    '',
    '| Job | Control | Runs | False findings | Confirmed | Refuted | Unverified |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...metrics.falseFindings.jobs.map(
      (job) =>
        `| ${job.job} ${job.name} | ${job.control ? 'yes' : 'no'} | ${job.runs} | ${job.findings} | ${job.grades.confirmed} | ${job.grades.refuted} | ${job.grades.unverified} |`,
    ),
    '',
    `All jobs: ${metrics.falseFindings.total} false findings in ${metrics.runs} runs (${metrics.falseFindings.perRun} a run): ` +
      `${metrics.falseFindings.byOrigin.model} by the model, ${metrics.falseFindings.byOrigin.viewer} raised by Viewer from the model's reading. ` +
      `Duplicates of a found problem: ${metrics.duplicates}.`,
  );
  const invented = runs.flatMap((run) =>
    run.findings
      .filter((finding) => !finding.problem)
      .map(
        (finding) =>
          `- ${run.job} run ${run.repeat}, ${finding.id} ${finding.kind} (${finding.origin}, ${finding.grade}): ${finding.summary}`,
      ),
  );
  if (invented.length) add('', ...invented);

  const { all, planted, false: unplanted } = metrics.grades;
  add(
    '',
    "## Viewer's grades",
    '',
    '| Findings | Confirmed | Refuted | Unverified |',
    '| --- | ---: | ---: | ---: |',
    `| Of planted problems | ${planted.confirmed} | ${planted.refuted} | ${planted.unverified} |`,
    `| Not planted | ${unplanted.confirmed} | ${unplanted.refuted} | ${unplanted.unverified} |`,
    `| All, with duplicates | ${all.confirmed} | ${all.refuted} | ${all.unverified} |`,
  );

  const { quotes, request } = metrics;
  add(
    '',
    '## Quotes and the request',
    '',
    `Quotes on their page: ${quotes.onPage} of ${quotes.checked} (${percent(quotes.onPage, quotes.checked)}); not on it: ${quotes.notOnPage}; page without text: ${quotes.noText}.`,
    '',
    `Request parts listed: ${request.listed} of ${request.parts}; quantity right ${request.quantity}, thickness right ${request.thickness}, DXF right ${request.dxf}.`,
  );
  const quoted = runs.flatMap((run) =>
    run.quotes.missed.map((text) => `- ${run.job} run ${run.repeat}: ${text}`),
  );
  if (quoted.length) add('', ...quoted);

  const { attempts } = metrics;
  const failed = Object.entries(attempts.failures).filter(([, count]) => count);
  add(
    '',
    '## Schema failures and retries',
    '',
    `Attempts: ${attempts.total} for ${metrics.runs} runs; ${attempts.retried} runs retried; ${attempts.failedRuns} not graded after their retries.`,
    `Failures: ${failed.length ? failed.map(([kind, count]) => `${kind} ${count}`).join(', ') : 'none'}.`,
  );

  const { outlines } = metrics;
  add(
    '',
    '## Outlines',
    '',
    `Regions outlined: ${outlines.total}; by SAM 3.1: ${outlines.sam}; the model's box stood in: ${outlines.fallback} (${percent(outlines.fallback, outlines.total)}).`,
    ...Object.entries(outlines.reasons).map(([reason, count]) => `- ${count} × ${cell(reason)}`),
    '',
    'Intersection over union with the nearest labelled region of the page or photo:',
    '',
    '| Outline | Count | Median | Mean |',
    '| --- | ---: | ---: | ---: |',
    `| SAM 3.1 | ${outlines.iou.count} | ${fixed(outlines.iou.median)} | ${fixed(outlines.iou.mean)} |`,
    `| The model's box | ${outlines.boxIoU.count} | ${fixed(outlines.boxIoU.median)} | ${fixed(outlines.boxIoU.mean)} |`,
  );

  const { latency, tokens } = metrics;
  add(
    '',
    '## Calls',
    '',
    '| Call | Count | Median | Mean | P90 | Max |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...(
      [
        ['Muse Spark', latency.model],
        ['SAM 3.1', latency.segmentation],
      ] as const
    ).map(
      ([label, row]) =>
        `| ${label} | ${row.count} | ${seconds(row.median)} | ${seconds(row.mean)} | ${seconds(row.p90)} | ${seconds(row.max)} |`,
    ),
    '',
    tokens.calls
      ? `Tokens: ${tokens.input.toLocaleString('en')} in, ${tokens.output.toLocaleString('en')} out, ${tokens.total.toLocaleString('en')} in all, from ${tokens.calls} replies that report usage.` +
          (tokens.cost === undefined
            ? ' Cost: not reported; pass --price to compute it.'
            : ` Cost: $${tokens.cost}${context.price ? ` at $${context.price.input} in and $${context.price.output} out per million tokens` : ', as the replies report it'}.`)
      : 'Tokens: no reply reported usage.',
  );

  add(
    '',
    '## Runs',
    '',
    '| Run | Graded | Attempts | Found | False | Outlines | Model time |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...runs.map((run) => {
      const model = run.calls.filter((call) => call.route === 'model');
      return `| ${run.job} ${run.name}, run ${run.repeat} | ${run.graded ? 'yes' : 'no'} | ${run.attempts} | ${run.problems.filter((problem) => problem.found).length} of ${run.problems.length} | ${run.findings.filter((finding) => !finding.problem).length} | ${run.outlines.length} | ${seconds(model.reduce((sum, call) => sum + call.milliseconds, 0))} |`;
    }),
    '',
  );
  return lines.join('\n');
}
