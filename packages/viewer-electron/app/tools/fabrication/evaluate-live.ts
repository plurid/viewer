/**
 * The live fabrication evaluation: Viewer's laser-job check, run through its own service
 * (desktop/fabrication/service.ts) with the real Meta provider and SAM 3.1, on the eight generated
 * jobs of tools/playground/samples/fabrication-jobs.ts. It writes the jobs, checks each one, scores
 * the result against the job's truth (live-score.ts), and writes `summary.md`, `answers.json` with
 * every raw reply, and `truth.json` to --out, which must be new or empty. The key comes from
 * META_API_KEY only; it is held in memory, never printed, written or logged.
 *
 *   node --import tsx tools/fabrication/evaluate-live.ts --out <folder>
 *     [--jobs J1,J7] [--repeat <n>] [--model <id>] [--effort <value>] [--retries <n>]
 *     [--price <input>,<output>]
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CheckRecord, CheckResult, RenderedPage } from '../../src/domain/fabrication/check';
import type { ModelDataPermission } from '../../src/domain/models/permissions';
import type { ReasoningEffort } from '../../src/domain/models/providers';
import type { ModelProvider } from '../../src/domain/services';
import type { ModelPermissions } from '../../src/desktop/models/model-permissions';
import type { PhotoEncoder } from '../../src/desktop/fabrication/inputs';
import type { LiveJob } from '../playground/samples/fabrication-jobs';
import type {
  AttemptLog,
  CallLog,
  CallRoute,
  FailureKind,
  LiveMetrics,
  OutlineLog,
  Price,
  RunScore,
  TokenUsage,
} from './live-score';
import { fabricationAnswerSchema } from '../../src/domain/fabrication/answer';
import { checkInstructions, pageText } from '../../src/domain/fabrication/prompt';
import { modelEndpoint, modelPermissionCovers } from '../../src/domain/models/permissions';
import { providerPresets } from '../../src/domain/models/providers';
import { defaultSettings } from '../../src/domain/services';
import { errorMessage } from '../../src/domain/errors';
import { FabricationChecks } from '../../src/desktop/fabrication/service';
import { photoPlan, requestInput, requestText } from '../../src/desktop/fabrication/inputs';
import { ModelPermissionRequired } from '../../src/desktop/models/model-permissions';
import { Credentials, Providers } from '../../src/desktop/models/providers';
import { samSegmenter } from '../../src/desktop/models/segmentation';
import { transformImage } from '../../src/desktop/transforms/image';
import { liveJobs } from '../playground/samples/fabrication-jobs';
import { drawPagesInNode, nodePages } from './live-pages';
import { liveMetrics, liveSummary, scoreRun } from './live-score';

export interface LiveOptions {
  /** A new or empty folder for the jobs and the results. */
  out: string;
  key: string;
  /** Job ids, J1 to J8; every job unless given. */
  jobs?: readonly string[];
  repeat?: number;
  model?: string;
  /** How long Muse Spark reasons; the API's own unless given. */
  effort?: ReasoningEffort;
  /** Runs again after a failure a person would retry: a schema miss, a timeout, a busy server. */
  retries?: number;
  price?: Price;
  /** The network; tests give a stub. */
  request?: typeof fetch;
  /** The photo encoder; Viewer's image processor in this process unless given. */
  encodePhoto?: PhotoEncoder;
  wait?(milliseconds: number): Promise<void>;
  now?(): number;
  log?(line: string): void;
}
export interface LiveReport {
  metrics: LiveMetrics;
  runs: RunScore[];
  summary: string;
  files: { summary: string; answers: string; truth: string; jobs: string };
}

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const processors = path.join(
  appRoot,
  'assets',
  `viewer-processors-${process.platform}-${process.arch}`,
);
/** The window the checks belong to. */
const owner = 1;

/** Re-encodes a photo as the app's image worker does, in this process. */
const processorPhoto: PhotoEncoder = async (bytes, signal) => {
  signal.throwIfAborted();
  if (!existsSync(path.join(processors, 'node_modules', 'sharp')))
    throw new Error(
      `Viewer's image processor is not built in ${path.relative(appRoot, processors)}: run pnpm start once, or leave out the jobs with photos (J1, J4 and J7).`,
    );
  return transformImage(processors, bytes, photoPlan);
};

/** The key from META_API_KEY, held in memory only: never saved, printed or logged. */
class EnvironmentKey extends Credentials {
  constructor(
    private readonly secret: string,
    folder: string,
  ) {
    super(folder, refuse, refuse);
  }
  override async forProvider(): Promise<string> {
    return this.secret;
  }
  override async get(): Promise<string> {
    return this.secret;
  }
}
const refuse = async (): Promise<never> => {
  throw new Error('The evaluation keeps its key in memory only.');
};

/** Token counts from an OpenAI-style `usage` or a Llama-style `metrics` list, when given. */
export function replyUsage(text: string): TokenUsage | undefined {
  let body: { usage?: Record<string, unknown>; metrics?: { metric?: unknown; value?: unknown }[] };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return undefined;
  }
  const number = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  const metric = (name: string) =>
    number(body.metrics?.find((item) => item?.metric === name)?.value);
  const usage = body.usage ?? {};
  const input =
    number(usage.prompt_tokens) ?? number(usage.input_tokens) ?? metric('num_prompt_tokens');
  const output =
    number(usage.completion_tokens) ??
    number(usage.output_tokens) ??
    metric('num_completion_tokens');
  const total = number(usage.total_tokens) ?? metric('num_total_tokens');
  if (input === undefined && output === undefined && total === undefined) return undefined;
  const cost = number(usage.cost) ?? number(usage.total_cost);
  return {
    input: input ?? 0,
    output: output ?? 0,
    total: total ?? (input ?? 0) + (output ?? 0),
    ...(cost === undefined ? {} : { cost }),
  };
}

/** The network, each call logged with its time, status, usage and reply; never its headers. */
function recorded(
  request: typeof fetch,
  log: (call: CallLog) => void,
  now: () => number,
): typeof fetch {
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const route: CallRoute = /\/responses$/.test(url) ? 'segmentation' : 'model';
    const sent = typeof init?.body === 'string' ? Buffer.byteLength(init.body) : 0;
    const started = now();
    let status = 0;
    try {
      const response = await request(input, init);
      status = response.status;
      const reply = await response.text();
      const usage = replyUsage(reply);
      log({
        route,
        status,
        milliseconds: now() - started,
        sent,
        ...(usage ? { usage } : {}),
        reply,
      });
      return new Response(reply, {
        status: response.status,
        statusText: response.statusText,
        headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
      });
    } catch (error) {
      log({ route, status, milliseconds: now() - started, sent, error: errorMessage(error) });
      throw error;
    }
  };
}

/** Why an attempt gave no result, from the service's error and the model's reply. */
export function failureOf(error: unknown, calls: readonly CallLog[]): FailureKind {
  const message = errorMessage(error);
  const model = calls.find((call) => call.route === 'model');
  if (/does not fit the check’s form/.test(message)) return 'schema';
  if (model && model.status >= 400) return 'http';
  if (/invalid JSON/.test(message)) return 'json';
  if (/refused or incomplete|invalid response envelope/.test(message)) return 'incomplete';
  if (/timed out/.test(message)) return 'timeout';
  if (
    /connection failed|empty response|could not be read/.test(message) ||
    (model && !model.status)
  )
    return 'network';
  return 'other';
}
/** Whether a person would run the check again: not after a refused key or a request it rejects. */
function retriable(failure: FailureKind, calls: readonly CallLog[]): boolean {
  if (failure === 'other') return false;
  if (failure !== 'http') return true;
  const status = calls.find((call) => call.route === 'model')?.status ?? 0;
  return status === 429 || status >= 500;
}
/** Where the model's reply misses the answer's schema. */
function schemaIssues(calls: readonly CallLog[]): string[] {
  const reply = calls.find((call) => call.route === 'model')?.reply;
  try {
    const envelope = JSON.parse(reply ?? '') as { choices?: { message?: { content?: string } }[] };
    const parsed = fabricationAnswerSchema.safeParse(
      JSON.parse(envelope.choices?.[0]?.message?.content ?? ''),
    );
    return parsed.success
      ? []
      : parsed.error.issues
          .slice(0, 12)
          .map((issue) => `${issue.path.join('.') || 'the answer'}: ${issue.message}`);
  } catch {
    return [];
  }
}

async function writeJobs(folder: string, jobs: readonly LiveJob[]) {
  for (const job of jobs) {
    const directory = path.join(folder, job.truth.job);
    await mkdir(directory, { recursive: true });
    for (const file of job.files)
      await writeFile(path.join(directory, file.name), file.bytes, { flag: 'wx' });
  }
}
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';

export async function evaluateLive(options: LiveOptions): Promise<LiveReport> {
  const all = liveJobs();
  const unknown = (options.jobs ?? []).filter((id) => !all.some((job) => job.truth.id === id));
  if (unknown.length)
    throw new Error(
      `No job ${unknown.join(', ')}. The jobs are ${all.map((job) => job.truth.id).join(', ')}.`,
    );
  const jobs = options.jobs?.length
    ? all.filter((job) => options.jobs!.includes(job.truth.id))
    : all;
  const repeat = options.repeat ?? 1,
    retries = options.retries ?? 1;
  const now = options.now ?? (() => performance.now());
  const log = options.log ?? (() => {});
  const wait =
    options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  if (!options.key) throw new Error('The evaluation needs META_API_KEY in the environment.');

  const out = path.resolve(options.out);
  const present = await readdir(out).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  if (present.length)
    throw new Error(
      `${out} is not empty. Choose a new folder for --out; the evaluation never overwrites.`,
    );
  const files = {
    summary: path.join(out, 'summary.md'),
    answers: path.join(out, 'answers.json'),
    truth: path.join(out, 'truth.json'),
    jobs: path.join(out, 'jobs'),
  };
  await mkdir(files.jobs, { recursive: true });
  await writeJobs(files.jobs, jobs);
  await writeFile(files.truth, json(jobs.map((job) => job.truth)), { flag: 'wx' });

  const provider: ModelProvider = {
    id: 'meta-live-evaluation',
    name: 'Meta',
    kind: 'meta',
    endpoint: providerPresets.meta.endpoint,
    model: options.model ?? providerPresets.meta.model!,
    allowContent: false,
    ...(options.effort ? { effort: options.effort } : {}),
  };
  // Running the evaluation is the person's consent to send these generated jobs, pictures included.
  const granted: ModelDataPermission = {
    providerID: provider.id,
    kind: provider.kind,
    endpoint: modelEndpoint(provider),
    level: 'images',
  };
  const permissions: Pick<ModelPermissions, 'run'> = {
    async run(asked, level, signal, work, actor) {
      if (!modelPermissionCovers(granted, asked, level, actor)) throw new ModelPermissionRequired();
      return work(signal);
    },
  };
  let calls: CallLog[] = [];
  const providers = new Providers(
    new EnvironmentKey(options.key, out),
    recorded(options.request ?? fetch, (call) => calls.push(call), now),
    permissions,
  );
  const reader = providerPresets.meta.family ?? provider.name;
  const checks = new FabricationChecks({
    settings: () => ({ ...defaultSettings(out), providers: [provider] }),
    access: async () => {},
    permission: async () => granted,
    generate: (...args) => providers.generate(...args),
    encodePhoto: options.encodePhoto ?? processorPhoto,
    // As the app wires it: SAM on the reading model's provider, the model's box when SAM gives none.
    segmenter: (asked) =>
      samSegmenter(
        (picture, prompt, signal) => providers.segment(asked, picture, prompt, signal),
        reader,
      ),
  });

  const started = new Date();
  const runs: RunScore[] = [];
  const answers: unknown[] = [];
  log(
    `Checking ${jobs.length} jobs, ${repeat === 1 ? 'once' : `${repeat} times`} each: ` +
      `${jobs.length * repeat} Muse Spark calls and a SAM 3.1 call for each region a tour marks, more with retries.`,
  );
  // What ran is written even when a run stops the evaluation: its calls were paid for.
  let stopped: unknown;
  try {
    for (let round = 1; round <= repeat; round++)
      for (const job of jobs) {
        const { truth } = job;
        const opened = await checks.request(
          { kind: 'open', paths: [path.join(files.jobs, truth.job)] },
          owner,
        );
        if (opened.kind !== 'opened') throw new Error(`${truth.job} did not open as a check.`);
        const drawn = await drawPagesInNode(opened.sources);
        if (drawn.problems.length) throw new Error(drawn.problems.join(' '));
        const texts = new Map<string, string>();
        const runsByPage = new Map<string, RenderedPage['text']>();
        for (const page of drawn.pages) {
          const file = opened.sources.find((source) => source.ref === page.ref)!.name;
          texts.set(`${page.ref}:${page.page}`, pageText(page.text));
          runsByPage.set(`${file}:${page.page}`, page.text);
        }
        for (const source of opened.sources)
          if (source.kind === 'request') {
            const bytes = job.files.find((file) => file.name === source.name)!.bytes;
            texts.set(`${source.ref}:1`, requestText(requestInput(source.ref, source.name, bytes)));
          }

        const attempts: AttemptLog[] = [];
        let result: CheckResult | undefined;
        for (let attempt = 0; attempt <= retries; attempt++) {
          calls = [];
          try {
            const reply = await checks.request(
              { kind: 'run', id: opened.id, providerID: provider.id, pages: drawn.pages },
              owner,
            );
            if (reply.kind !== 'result') throw new Error('The check gave no result.');
            result = reply;
            attempts.push({ outcome: 'graded', calls });
            break;
          } catch (error) {
            const failure = failureOf(error, calls);
            const issues = failure === 'schema' ? schemaIssues(calls) : [];
            attempts.push({
              outcome: failure,
              error: errorMessage(error),
              ...(issues.length ? { schemaIssues: issues } : {}),
              calls,
            });
            log(
              `${truth.id} run ${round}, attempt ${attempt + 1}: ${failure}: ${errorMessage(error)}`,
            );
            if (!retriable(failure, calls) || attempt === retries) break;
            if (['http', 'timeout', 'network'].includes(failure)) await wait(2000 * (attempt + 1));
          }
        }
        const record = result
          ? (JSON.parse(checks.handoff(opened.id)!.record) as CheckRecord)
          : undefined;
        await checks.request({ kind: 'close', id: opened.id }, owner);
        // Every outline the check drew, text and features, from its record.
        const logged = (record?.segmentation ?? []).map((outline): OutlineLog => {
          const [left, top, right, bottom] = outline.box ?? [];
          return {
            file: opened.sources.find((source) => source.ref === outline.ref)?.name ?? outline.ref,
            ...(outline.page === undefined ? {} : { page: outline.page }),
            kind: outline.kind,
            ...(outline.box
              ? { box: { x: left!, y: top!, width: right! - left!, height: bottom! - top! } }
              : {}),
            polygon: outline.region.map(([x, y]) => [x, y]),
            source: outline.source,
            ...(outline.confidence === undefined ? {} : { confidence: outline.confidence }),
            ...(outline.note ? { note: outline.note } : {}),
            stop: outline.stop,
          };
        });
        const score = scoreRun({
          truth,
          repeat: round,
          sources: opened.sources,
          attempts,
          ...(result ? { result } : {}),
          outlines: logged,
          text: (ref, page) => texts.get(`${ref}:${page}`) || undefined,
          runs: (file, page) => runsByPage.get(`${file}:${page}`) ?? [],
        });
        runs.push(score);
        const { instructions: _instructions, schema: _schema, ...kept } = record ?? {};
        answers.push({
          job: truth.id,
          name: truth.job,
          repeat: round,
          attempts,
          ...(record ? { record: kept } : {}),
          ...(result
            ? {
                findings: result.findings.map(({ correction, ...item }) => ({
                  ...item,
                  ...(correction
                    ? {
                        correction: {
                          plan: correction.plan,
                          name: correction.name,
                          description: correction.description,
                        },
                      }
                    : {}),
                })),
                parts: result.parts.map(({ path: _path, ...part }) => part),
                issues: result.issues,
                notSent: result.notSent,
                tour: { stops: result.tour.stops.length, skipped: result.tour.skipped },
              }
            : {}),
          outlines: logged,
          score,
        });
        const found = score.problems.filter((problem) => problem.found).length;
        const invented = score.findings.filter((finding) => !finding.problem).length;
        log(
          `${truth.id} ${truth.job}, run ${round}: ${result ? `${result.findings.length} findings` : 'not graded'}, ` +
            `${found} of ${score.problems.length} planted found, ${invented} not planted, ${score.attempts} ${score.attempts === 1 ? 'attempt' : 'attempts'}.`,
        );
      }
  } catch (error) {
    stopped = error;
  } finally {
    checks.close();
  }

  const metrics = liveMetrics(runs, options.price);
  const summary = liveSummary(metrics, runs, {
    model: provider.model,
    ...(options.effort ? { effort: options.effort } : {}),
    endpoint: provider.endpoint,
    started: started.toISOString(),
    jobs: jobs.length,
    repeat,
    retries,
    ...(options.price ? { price: options.price } : {}),
    ...(stopped ? { stopped: errorMessage(stopped) } : {}),
  });
  const document = json({
    version: 1,
    started: started.toISOString(),
    model: provider.model,
    effort: options.effort ?? null,
    endpoint: provider.endpoint,
    segmentation: providerPresets.meta.segmentation,
    repeat,
    retries,
    ...(options.price ? { price: options.price } : {}),
    pages: nodePages,
    instructions: checkInstructions,
    ...(stopped ? { stopped: errorMessage(stopped) } : {}),
    metrics,
    runs: answers,
  });
  // A last guard: the key never reaches a file.
  if (document.includes(options.key) || summary.includes(options.key))
    throw new Error('The results would hold the API key, so nothing more was written.');
  await writeFile(files.answers, document, { flag: 'wx' });
  await writeFile(files.summary, summary, { flag: 'wx' });
  if (stopped) throw stopped;
  return { metrics, runs, summary, files };
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf('--' + name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} needs a value.`);
  return value;
}
function whole(name: string, least: number): number | undefined {
  const value = argument(name);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < least)
    throw new Error(`--${name} takes a whole number from ${least}.`);
  return number;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = argument('out');
  if (!out) throw new Error('Give --out <folder>: a new or empty folder outside the repository.');
  const key = process.env.META_API_KEY;
  if (!key) throw new Error('Set META_API_KEY in the environment; the evaluation never prints it.');
  const priced = argument('price')?.split(',').map(Number);
  if (priced && (priced.length !== 2 || priced.some((value) => !(value >= 0))))
    throw new Error('--price takes US dollars per million tokens: <input>,<output>.');
  const jobs = argument('jobs')
    ?.split(',')
    .map((id) => id.trim().toUpperCase());
  const repeat = whole('repeat', 1),
    retries = whole('retries', 0),
    model = argument('model'),
    effort = argument('effort');
  const efforts = providerPresets.meta.efforts ?? [];
  if (effort && !efforts.includes(effort as ReasoningEffort))
    throw new Error(`--effort takes ${efforts.join(' or ')}; leave it out for the API’s own.`);
  const report = await evaluateLive({
    out,
    key,
    ...(jobs ? { jobs } : {}),
    ...(repeat ? { repeat } : {}),
    ...(retries === undefined ? {} : { retries }),
    ...(model ? { model } : {}),
    ...(effort ? { effort: effort as ReasoningEffort } : {}),
    ...(priced ? { price: { input: priced[0]!, output: priced[1]! } } : {}),
    log: (line) => console.log(line),
  });
  const { recall, falseFindings, outlines } = report.metrics;
  console.log(
    `Found ${recall.all.found} of ${recall.all.planted} planted problems; ${falseFindings.total} findings not planted; ` +
      `${outlines.text.runs} of ${outlines.text.total} quoted texts marked by their runs; SAM outlined ${outlines.features.sam} of ${outlines.features.total} features.`,
  );
  console.log(`Summary: ${report.files.summary}`);
  console.log(`Every answer: ${report.files.answers}`);
}
