/**
 * A laser job checked end to end in the packaged app, the way a person works through it: where
 * **Check laser job…** is offered and why not, the panel's inventory and findings, its title bar,
 * the tour on the real engine, the reviewed correction, the handoff with the nestings it makes, the
 * check kept and shown again, the Layout plane's nesting without a sheet format, dark pages, and the
 * panel staying with its workspace. Job 1042 and the evaluation parts are generated from the
 * playground samples into the run's own folder. A loopback stub answers for the model with the
 * fixture's answer, and for SAM 3.1 as a self-hosted server does; nothing reaches a paid provider.
 * A second instance runs in another profile beside the first. Every file stays; the screenshots,
 * the app's logs and result.json go to the harness's evidence folder.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import DxfParser from 'dxf-parser';
import type { ICircleEntity } from 'dxf-parser';
import { parse as parseJSONC } from 'jsonc-parser';
import type {
  FolderPane,
  Pane,
  PreviewPane,
  SavedState,
  Workspace,
} from '../../src/domain/contracts';
import type { CheckRecord } from '../../src/domain/fabrication/check';
import type { CheckInput } from '../../src/domain/fabrication/prompt';
import type { ApplicationSettings, ModelProvider } from '../../src/domain/services';
import { CURRENT_STATE_VERSION } from '../../src/domain/contracts';
import { fabricationAnswerSchema } from '../../src/domain/fabrication/answer';
import { checkSendingLabels } from '../../src/domain/fabrication/check';
import { checkAnswerSchema, checkInstructions } from '../../src/domain/fabrication/prompt';
import { modelEndpoint } from '../../src/domain/models/permissions';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { defaultSettings } from '../../src/domain/services';
import { tourDefinitionSchema } from '../../src/domain/tours/tour';
import { fabricationSamples, jobMismatch } from '../../tools/playground/samples/fabrication';
import { temporaryRoot } from '../../tools/temporary';
import { jobAnswer, refOf, samReply } from '../fabrication-fixtures';
import { ownedApp, until } from '../owned-app';
import { NativeInteractions } from './runtime/interactions';
import {
  animationFrames,
  attributeOf,
  buttonState,
  click,
  countOf,
  exists,
  pressButton,
} from './runtime/page';
import { pageCall } from './runtime/page-function';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1', 'Run with VIEWER_TEST_PRESERVE=1.');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1', 'Run with VIEWER_TEST_NO_REMOVAL=1.');
const binary = path.resolve(
  process.env.VIEWER_TEST_BINARY ??
    fileURLToPath(
      new URL(
        `../../out/Viewer-${process.platform}-${process.arch}/Viewer.app/Contents/MacOS/Viewer`,
        import.meta.url,
      ),
    ),
);

// The job, generated as `pnpm playground` writes it: fabrication/Job 1042 and fabrication/Evaluation.

const root = await realpath(await temporaryRoot('viewer-native-fabrication-'));
const files = path.join(root, 'Files');
const profile = path.join(root, 'Profile');
const secondProfile = path.join(root, 'Second profile');
await Promise.all([files, profile, secondProfile].map((folder) => mkdir(folder)));
for (const sample of fabricationSamples()) {
  const file = path.join(files, sample.path);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, sample.bytes, { flag: 'wx' });
}
const fabrication = path.join(files, 'fabrication');
const job = path.join(fabrication, 'Job 1042');
const request = path.join(job, 'Job 1042 request.eml');
const drawing = path.join(job, 'Job 1042 drawing.pdf');
const plate = path.join(job, jobMismatch.file);
const corrected = path.join(job, 'g6-PL60-B2-2buc (corrected).dxf');
const handoff = path.join(job, 'Job 1042 handoff');
const sha256 = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const plateHash = await sha256(plate);

// The model: a loopback stub that answers with the fixture's answer for Job 1042.

const model = 'muse-spark-1.3';
/** The SAM model the stub also answers, as a self-hosted SAM 3.1 server names it. */
const segmentation = 'sam-3.1';
/** An object prompt's box and picture size, as SAM 3.1's records write them. */
const objectBox = /x1=\d+;y1=\d+;x2=\d+;y2=\d+;w=\d+;h=\d+/;
/** The answer as Muse Spark writes it, with refs in its prose; the panel shows each as a name. */
function recordedAnswer(input: CheckInput) {
  const inventory = { sources: input.inventory };
  const answer = jobAnswer(inventory);
  const drawingRef = refOf(inventory, 'Job 1042 drawing.pdf');
  const plateRef = refOf(inventory, jobMismatch.file);
  answer.summary = `${plateRef} puts its right holes 48 mm from the left ones; drawing ${drawingRef} gives 50 mm.`;
  answer.findings[0]!.summary = `The bottom holes of ${plateRef} are 48 mm apart; ${drawingRef} gives 50 mm.`;
  answer.tour[1]!.caption = `Drawing ${drawingRef} gives 50 mm between the holes.`;
  return fabricationAnswerSchema.parse(answer);
}
/** The answer's prose as the panel and the tour show it. */
const named = {
  summary:
    'g6-PL60-B2-2buc.dxf puts its right holes 48 mm from the left ones; drawing Job 1042 drawing.pdf gives 50 mm.',
  finding:
    'The bottom holes of g6-PL60-B2-2buc.dxf are 48 mm apart; Job 1042 drawing.pdf gives 50 mm.',
  caption: 'Drawing Job 1042 drawing.pdf gives 50 mm between the holes.',
};
const proseRef = /\bS[1-9]\d{0,2}\b/;

type TextPart = { type: 'text'; text: string };
type ChatPart = TextPart | { type: 'image_url'; image_url: { url: string } };
interface ChatRequest {
  model?: string;
  messages?: { role: string; content: string | ChatPart[] }[];
  response_format?: { type?: string; json_schema?: { strict?: boolean; schema?: unknown } };
}
interface SegmentRequest {
  model?: string;
  input?: { content?: { type: string; text?: string }[] }[];
}
/** One request the stub answered: its route, the pictures it carried and what was wrong with it. */
interface StubCall {
  route: string;
  model?: string;
  images: number;
  problems: string[];
}
const calls: StubCall[] = [];
/** What the app's request gets wrong against the check's instructions, schema and pictures. */
function chatProblems(body: ChatRequest): string[] {
  const [system, user] = body.messages ?? [];
  return [
    ...(body.model === model ? [] : [`the model is ${body.model}`]),
    ...(typeof system?.content === 'string' && system.content.endsWith(checkInstructions)
      ? []
      : ['the instructions are not the check’s']),
    ...(body.response_format?.type === 'json_schema' &&
    body.response_format.json_schema?.strict === true &&
    isDeepStrictEqual(body.response_format.json_schema.schema, checkAnswerSchema)
      ? []
      : ['the answer is not held to the check’s strict schema']),
    ...(Array.isArray(user?.content) && user.content[0]?.type === 'text'
      ? []
      : ['the input is not its text, then its pictures']),
  ];
}
const server = createServer((incoming, response) => {
  const chunks: Buffer[] = [];
  incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
  incoming.on('end', () => {
    const route = incoming.url ?? '';
    const reply = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    try {
      const text = Buffer.concat(chunks).toString('utf8');
      if (incoming.method === 'POST' && route === '/v1/chat/completions') {
        const body = JSON.parse(text) as ChatRequest;
        const parts = body.messages?.[1]?.content;
        const images = Array.isArray(parts)
          ? parts.filter(
              (part) =>
                part.type === 'image_url' &&
                part.image_url.url.startsWith('data:image/jpeg;base64,'),
            ).length
          : 0;
        const problems = chatProblems(body);
        calls.push({ route, model: body.model, images, problems });
        if (problems.length) return reply(400, { error: { message: problems.join('; ') } });
        const input = JSON.parse((parts as [TextPart, ...ChatPart[]])[0].text) as CheckInput;
        const content = JSON.stringify(recordedAnswer(input));
        // a second's wait, so the panel shows what the model reads while it answers
        setTimeout(
          () => reply(200, { choices: [{ finish_reason: 'stop', message: { content } }] }),
          1000,
        );
        return;
      }
      if (incoming.method === 'POST' && route === '/v1/responses') {
        const body = JSON.parse(text) as SegmentRequest;
        const parts = body.input?.[0]?.content ?? [];
        const images = parts.filter((part) => part.type === 'input_image').length;
        const prompt = parts.find((part) => part.type === 'input_text')?.text ?? '';
        const box = objectBox.exec(prompt)?.[0];
        const problems = [
          ...(body.model === segmentation ? [] : [`the SAM model is ${body.model}`]),
          ...(images === 1 ? [] : [`${images} pictures`]),
          ...(box ? [] : ['the prompt is not an object prompt']),
        ];
        calls.push({ route, model: body.model, images, problems });
        if (problems.length) return reply(400, { error: { message: problems.join('; ') } });
        // SAM 3.1's recorded reply, a whole mask, laid over the box the prompt asks about
        const outline = samReply.replace(objectBox, box!);
        return reply(200, { output: [{ content: [{ type: 'output_text', text: outline }] }] });
      }
      calls.push({ route, images: 0, problems: ['an unknown route'] });
      reply(404, { error: { message: 'Unknown route' } });
    } catch (error) {
      calls.push({ route, images: 0, problems: [String(error)] });
      reply(400, { error: { message: String(error) } });
    }
  });
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const provider: ModelProvider = {
  id: 'meta-stub',
  name: 'Meta stub',
  // A Meta provider's requests go only to api.meta.ai; a local server that also answers SAM is
  // the kind of provider a loopback stub can be
  kind: 'local',
  endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
  model,
  allowContent: false,
  segmentation,
};

// Two generated profiles: the run's, and the second instance's.

function settings(providers: ModelProvider[]): ApplicationSettings {
  const value = defaultSettings(files);
  value.hotkey.enabled = false;
  value.providers = providers;
  // the tour ends after its last stop, so its end card counts the stops it showed
  value.tour = { ...value.tour, loop: false };
  value.previews = { ...value.previews, darkPages: 'off' };
  return value;
}
const folderPane = (id: string, folder: string): FolderPane => ({
  id,
  type: 'folder',
  path: folder,
  mode: 'list',
  sort: 'name',
  descending: false,
  showHidden: false,
  history: [folder],
  historyIndex: 0,
});
const workspace = (id: string, name: string, pane: Pane): Workspace => ({
  id,
  name,
  roots: [pane.id],
  activePane: pane.id,
  arrangement: {},
  panes: [pane],
});
async function writeProfile(
  folder: string,
  workspaces: Workspace[],
  providers: ModelProvider[],
): Promise<void> {
  const ui = normalizePreferences();
  ui.sidebar.inNewPlanes = false;
  const state: SavedState = {
    version: CURRENT_STATE_VERSION,
    look: 'dark',
    activeWorkspace: workspaces[0]!.id,
    favorites: [],
    recents: [],
    ui,
    workspaces,
  };
  await writeFile(
    path.join(folder, 'config.jsonc'),
    JSON.stringify({ version: 1, settings: settings(providers), ui }),
    { flag: 'wx' },
  );
  await writeFile(path.join(folder, 'viewer-state-v1.json'), JSON.stringify(state), { flag: 'wx' });
  // The profile's own record of what each provider may receive, as Settings → Models keeps it once
  // the person allows pictures: the run answers no dialog.
  await writeFile(
    path.join(folder, 'model-permissions-v1.json'),
    JSON.stringify({
      version: 1,
      permissions: providers.map((item) => ({
        providerID: item.id,
        kind: item.kind,
        endpoint: modelEndpoint(item),
        level: 'images',
      })),
    }),
    { flag: 'wx' },
  );
}
const drawingPane: PreviewPane = { id: 'drawing', type: 'preview', path: drawing };
await writeProfile(
  profile,
  [
    workspace('jobs', 'Laser jobs', folderPane('jobs', fabrication)),
    workspace('drawing', 'Job drawing', drawingPane),
  ],
  [provider],
);
await writeProfile(secondProfile, [workspace('second', 'Job 1042', folderPane('job', job))], []);

// Page functions: each uses only its own body and arguments.

/** Selects exactly `paths` in the folder list, as a click and ⌘-clicks do; false while a row is
 * not shown yet. */
function selectRows(paths: string[]): boolean {
  const rows = paths.map((file) =>
    [...document.querySelectorAll<HTMLElement>('.folder-explorer [data-file-path]')].find(
      (row) => row.dataset.filePath === file,
    ),
  );
  if (rows.some((row) => !row)) return false;
  rows.forEach((row, index) =>
    row!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: index > 0 }),
    ),
  );
  document.querySelector<HTMLElement>('.folder-explorer')!.focus();
  return true;
}
function selectedRows(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.folder-explorer [aria-selected="true"]')].map(
    (row) => row.dataset.filePath ?? '',
  );
}
/** The palette's rows: each with its detail, or its reason when it is greyed out. */
function paletteRows() {
  return {
    rows: [...document.querySelectorAll<HTMLElement>('.command-result')].map((row) => ({
      label: row.querySelector('.command-result-text > span')?.textContent.trim() ?? '',
      detail: row.querySelector('.command-result-text > small')?.textContent.trim() ?? '',
      selected: row.getAttribute('aria-selected') === 'true',
      unavailable: row.getAttribute('aria-disabled') === 'true',
    })),
    empty: document.querySelector('.command-empty')?.textContent.trim() ?? '',
  };
}
/** Clicks the greyed-out row labelled `label`, as a person might; false without one. */
function clickUnavailable(label: string): boolean {
  const row = [...document.querySelectorAll<HTMLElement>('.command-result.is-unavailable')].find(
    (item) => item.querySelector('.command-result-text > span')?.textContent.trim() === label,
  );
  row?.click();
  return !!row;
}
type PaletteRows = ReturnType<typeof paletteRows>;
function panelState() {
  const panel = document.querySelector<HTMLElement>('.check-panel');
  const text = (element: Element | null | undefined) =>
    element?.textContent.replace(/\s+/g, ' ').trim() ?? '';
  return {
    open: !!panel,
    label: panel?.getAttribute('aria-label') ?? '',
    collapsed: panel?.dataset.collapsed === 'true',
    hidden: panel?.querySelector<HTMLElement>('.check-panel-body')?.hidden ?? false,
    title: text(panel?.querySelector('.check-panel-toggle')),
    sources: [...(panel?.querySelectorAll('.check-files li') ?? [])].map((item) => ({
      ref: text(item.querySelector('.check-ref')),
      name: text(item.querySelector('.check-file')),
      sending: text(item.querySelector('.muted')),
    })),
    model: text(panel?.querySelector('[aria-label="Model"]')),
    summary: text(panel?.querySelector('[aria-label="Summary"] .check-summary')),
    reader: text(panel?.querySelector('[aria-label="Summary"] .muted')),
    findings: [...(panel?.querySelectorAll('.check-finding') ?? [])].map((item) => ({
      grade: text(item.querySelector('.tour-grade')),
      summary: text(item.querySelector('.check-finding-summary')),
      reason: text(item.querySelector('.check-reason')),
      notes: [...item.querySelectorAll(':scope > .check-note')].map(text),
    })),
    correction: text(panel?.querySelector('.check-correction [role="status"]')),
    tour: text(panel?.querySelector('[aria-label="Tour"] .check-note')),
    parts: [...(panel?.querySelectorAll('.check-parts .check-file') ?? [])].map(text),
    since: text(panel?.querySelector('.check-since')),
    stale: text(panel?.querySelector('.check-stale')),
    handoff: text(panel?.querySelector('[aria-label="Handoff"] p[role="status"]')),
    handoffError: text(panel?.querySelector('[aria-label="Handoff"] [role="alert"]')),
    error: text(panel?.querySelector('.check-panel-body > .error')),
  };
}
/** Records each text `selector` shows from now on, under `key`, for `recorded` to read: a step
 * can come and go between two reads. */
function record(key: string, selector: string): void {
  const store = window as unknown as {
    scenarioTexts?: Record<string, string[]>;
    scenarioObservers?: Record<string, MutationObserver>;
  };
  const texts: string[] = [];
  (store.scenarioTexts ??= {})[key] = texts;
  store.scenarioObservers?.[key]?.disconnect();
  const read = () => {
    for (const element of document.querySelectorAll(selector)) {
      const text = element.textContent.replace(/\s+/g, ' ').trim();
      if (text && texts.at(-1) !== text) texts.push(text);
    }
  };
  const observer = new MutationObserver(read);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  (store.scenarioObservers ??= {})[key] = observer;
  read();
}
function recorded(key: string): string[] {
  return (
    (window as unknown as { scenarioTexts?: Record<string, string[]> }).scenarioTexts?.[key] ?? []
  );
}
function tourState() {
  const bar = document.querySelector<HTMLElement>('.tour-bar');
  const text = (element: Element | null | undefined) =>
    element?.textContent.replace(/\s+/g, ' ').trim() ?? '';
  return {
    status: bar?.dataset.status ?? '',
    count: text(bar?.querySelector('.tour-bar-count')),
    caption: text(bar?.querySelector('.tour-bar-caption')),
    place: text(bar?.querySelector('.tour-bar-place .muted')),
    notice: text(bar?.querySelector('.tour-notice')),
    title: text(bar?.querySelector('.tour-bar-text > strong')),
    detail: text(bar?.querySelector('.tour-bar-text > .muted')),
    collapsed: document.querySelector<HTMLElement>('.check-panel')?.dataset.collapsed === 'true',
  };
}
type TourState = ReturnType<typeof tourState>;
/** The plane showing `file`: how much of it is in the window, its error if any, and the outlines
 * drawn over it. */
function planeView(file: string) {
  const plane = [...document.querySelectorAll<HTMLElement>('[data-plurid-plane]')].find(
    (item) => item.querySelector('.plane-heading')?.getAttribute('title') === file,
  );
  if (!plane)
    return { shown: 0, failure: 'No plane shows it.', marks: [] as string[], drawn: false };
  const box = plane.getBoundingClientRect();
  const width = Math.max(0, Math.min(box.right, innerWidth) - Math.max(box.left, 0));
  const height = Math.max(0, Math.min(box.bottom, innerHeight) - Math.max(box.top, 0));
  const overlay = plane.querySelector<SVGElement>('.evidence-overlay');
  return {
    shown: (width * height) / Math.max(1, box.width * box.height),
    failure: /[^.]*could not be (?:displayed|read)[^.]*/.exec(plane.textContent)?.[0] ?? '',
    marks: [...(overlay?.querySelectorAll('g[data-kind]') ?? [])].map(
      (group) => group.getAttribute('data-kind') ?? '',
    ),
    drawn: overlay?.dataset.drawn === 'true',
  };
}
/** The first canvas `selector` matches, sampled: its mean luminance and the share of its pixels
 * darker and lighter than mid grey. A canvas never drawn reads as black. */
function canvasTone(selector: string) {
  const canvas = document.querySelector<HTMLCanvasElement>(selector);
  if (!canvas?.width || !canvas.height) return { width: 0, height: 0, mean: 0, dark: 0, light: 0 };
  const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  let sum = 0,
    samples = 0,
    dark = 0,
    light = 0;
  // every 97th pixel: enough to tell a page from a blank or an inverted one
  for (let index = 0; index < data.length; index += 4 * 97) {
    const luminance = 0.2126 * data[index]! + 0.7152 * data[index + 1]! + 0.0722 * data[index + 2]!;
    sum += luminance;
    samples++;
    if (luminance < 128) dark++;
    else light++;
  }
  return {
    width: canvas.width,
    height: canvas.height,
    mean: sum / samples,
    dark: dark / samples,
    light: light / samples,
  };
}
type CanvasTone = ReturnType<typeof canvasTone>;
function nestingState() {
  const panel = document.querySelector<HTMLElement>('.layout-plane .nesting-panel');
  // as laid out: a part's name and size, and a table's cells, read apart
  const text = (element: HTMLElement | null | undefined) =>
    element?.innerText.replace(/\s+/g, ' ').trim() ?? '';
  const all = (selector: string) => [...(panel?.querySelectorAll<HTMLElement>(selector) ?? [])];
  return {
    open: !!panel,
    tabs: all('.nesting-thickness-tabs button').map((button) => ({
      label: button.getAttribute('aria-label') ?? '',
      pressed: button.getAttribute('aria-pressed') === 'true',
    })),
    parts: all('.nesting-part-title').map(text),
    formats: all(
      '.nesting-formats .nesting-format:not(.nesting-format-head) [role="cell"]:first-child',
    ).map(text),
    removes: all('.nesting-formats button[aria-label^="Remove "]').map(
      (button) => button.getAttribute('aria-label') ?? '',
    ),
    units: text(
      panel?.querySelector<HTMLElement>('[aria-label="Units"] button[aria-pressed="true"]'),
    ),
    heading: text(panel?.querySelector<HTMLElement>('.nesting-summary h2')),
    status: text(panel?.querySelector<HTMLElement>('.nesting-status')),
    empty: text(panel?.querySelector<HTMLElement>('.nesting-empty')),
    problems: all('.nesting-settings .nesting-problem').map(text),
    selection: text(panel?.querySelector<HTMLElement>('.nesting-selection')),
    picked: all('.nesting-picked').length,
    pickedRow: text(panel?.querySelector<HTMLElement>('.nesting-part-picked .nesting-part-title')),
    placed: all('.nesting-sheets [data-part]').length,
    table: [
      ...(panel?.querySelectorAll<HTMLTableRowElement>('.nesting-thickness-table tr') ?? []),
    ].map((row) => [...row.cells].map(text).join(' ')),
  };
}
type NestingState = ReturnType<typeof nestingState>;
/** Clicks the first part placed on a sheet, as a person picks one; its index, or null. */
function pickPart(): string | null {
  const part = document.querySelector('.layout-plane .nesting-sheets svg [data-part]');
  part?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return part?.getAttribute('data-part') ?? null;
}

// The run.

type Connection = Awaited<ReturnType<Awaited<ReturnType<typeof ownedApp>>['connect']>>;
interface Step {
  name: string;
  passed: boolean;
  milliseconds: number;
  details?: unknown;
  error?: string;
}
const steps: Step[] = [];
const screenshots: string[] = [];
const exceptions: string[] = [];
const consoleProblems: string[] = [];
const tour: { at: number; state: TourState }[] = [];
let current = 'Start';
let page!: Connection;
let actions!: NativeInteractions;
const viewer = await ownedApp(binary, profile, { label: 'native-fabrication' });
const evidence = viewer.evidenceDirectory;

/** A bounded wait whose failure names the step and what it waited for. */
const wait = <T>(
  read: () => Promise<T>,
  accepts: (value: T) => unknown,
  label: string,
  milliseconds?: number,
) => until(read, accepts, `${current}: ${label}`, milliseconds);
async function capture(name: string): Promise<void> {
  const file = path.join(evidence, name + '.png');
  await actions.capture(file);
  screenshots.push(file);
}
async function step<T>(name: string, work: () => Promise<T>): Promise<T> {
  current = name;
  const started = Date.now();
  try {
    const details = await work();
    steps.push({ name, passed: true, milliseconds: Date.now() - started, details });
    console.log('PASS', name);
    return details;
  } catch (error) {
    steps.push({
      name,
      passed: false,
      milliseconds: Date.now() - started,
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
    console.log('FAIL', name);
    await capture('failed-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-')).catch(() => {});
    throw error;
  }
}
const panel = () => page.evaluate(pageCall(panelState));
const nesting = () => page.evaluate(pageCall(nestingState));
/** Opens ⌘K and types `query`; its rows once the palette shows them. */
async function palette(query: string): Promise<PaletteRows> {
  await actions.key('k', 'KeyK', 4);
  await wait(
    () => page.evaluate(pageCall(() => document.activeElement?.getAttribute('aria-label') ?? '')),
    (label) => label === 'Search commands',
    '⌘K opens the palette',
  );
  await page.command('Input.insertText', { text: query });
  await page.evaluate(animationFrames(2));
  return page.evaluate(pageCall(paletteRows));
}
async function closePalette(): Promise<void> {
  if (!(await page.evaluate(exists('[aria-label="Search commands"]')))) return;
  await actions.key('Escape', 'Escape');
  await wait(
    () => page.evaluate(exists('[aria-label="Search commands"]')),
    (open) => !open,
    'the palette closes',
  );
}
/**
 * ⌘K on `query` until its rows are as `accepts` wants: a folder no plane shows is counted after
 * the palette opens, and its command shows at the next ⌘K. The palette stays open on them.
 */
function offered(query: string, accepts: (rows: PaletteRows) => boolean, label: string) {
  return wait(
    async () => {
      await closePalette();
      return palette(query);
    },
    accepts,
    label,
  );
}
/** Runs the palette's selected row with Return. */
async function runSelected(label: string): Promise<void> {
  const { rows } = await page.evaluate(pageCall(paletteRows));
  assert.equal(rows.find((row) => row.selected)?.label, label, `${current}: ${label} is selected`);
  await actions.key('Enter', 'Enter');
  await wait(
    () => page.evaluate(exists('[aria-label="Search commands"]')),
    (open) => !open,
    `${label} runs from the palette`,
  );
}
async function selectFolder(folder: string): Promise<void> {
  await wait(
    () => page.evaluate(pageCall(selectRows, [folder])),
    Boolean,
    path.basename(folder) + ' listed',
  );
  await wait(
    () => page.evaluate(pageCall(selectedRows)),
    (selected) => isDeepStrictEqual(selected, [folder]),
    path.basename(folder) + ' selected',
  );
}
/** Every DXF circle of `radius`, as rounded centres in reading order. */
async function circles(file: string, radius: number): Promise<number[][]> {
  const parsed = new DxfParser().parseSync(await readFile(file, 'utf8'));
  assert.ok(parsed, `${path.basename(file)} reads as DXF`);
  return parsed.entities
    .filter((entity) => entity.type === 'CIRCLE')
    .map((entity) => entity as ICircleEntity)
    .filter((circle) => Math.abs(circle.radius - radius) < 1e-6)
    .map((circle) =>
      [circle.center.x, circle.center.y].map((value) => Math.round(value * 1e6) / 1e6),
    )
    .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
}
async function crashReports(folder: string): Promise<string[]> {
  const found: string[] = [];
  for (const kind of ['new', 'pending', 'completed'])
    for (const name of await readdir(path.join(folder, 'Crashpad', kind)).catch(() => []))
      found.push(path.join(folder, 'Crashpad', kind, name));
  return found;
}

let failure: unknown;
try {
  page = await viewer.connect();
  actions = new NativeInteractions({ evaluate: page.evaluate, command: page.command, until });
  await page.command('Runtime.enable');
  page.onEvent((method, params) => {
    if (method === 'Runtime.exceptionThrown')
      exceptions.push(`${current}: ${JSON.stringify(params).slice(0, 1200)}`);
    if (method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(String(params.type)))
      consoleProblems.push(`${current}: ${JSON.stringify(params.args).slice(0, 800)}`);
  });
  // one window size for every run, so the planes and the panel lie the same way each time
  await page.command('Emulation.setDeviceMetricsOverride', {
    width: 1600,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await wait(
    () =>
      page.evaluate(
        pageCall(() =>
          [...document.querySelectorAll<HTMLElement>('.folder-explorer [data-file-path]')].map(
            (row) => row.dataset.filePath ?? '',
          ),
        ),
      ),
    (rows) => isDeepStrictEqual(rows, [path.join(fabrication, 'Evaluation'), job]),
    'fabrication lists Evaluation and Job 1042',
  );

  await step('A second instance runs in another profile', async () => {
    const second = await ownedApp(binary, secondProfile, { label: 'native-fabrication-second' });
    let other: Connection | undefined;
    try {
      other = await second.connect();
      const listed = await wait(
        () => other!.evaluate(countOf('.folder-explorer [data-file-path]')),
        (count) => count === 7,
        'the second instance lists Job 1042',
      );
      assert.equal(
        await page.evaluate(pageCall(() => document.readyState)),
        'complete',
        'The first instance answers while the second runs',
      );
      return { listed, evidence: second.evidenceDirectory };
    } finally {
      await second.close(other);
    }
  });

  await step('Not offered on a folder of jobs, and ⌘K says why', async () => {
    assert.deepEqual(await page.evaluate(pageCall(selectedRows)), [], 'Nothing is selected');
    const reason = 'fabrication holds Job 1042 and Evaluation: select one to check it.';
    // the folders inside are counted after the first ask
    const shown = await offered(
      'laser',
      ({ rows }) =>
        rows.some(
          (row) =>
            row.unavailable &&
            row.label === 'Check laser job…' &&
            !row.detail.startsWith('Viewer is still counting'),
        ),
      'Check laser job… greyed out with why',
    );
    const greyed = shown.rows.find((row) => row.label === 'Check laser job…')!;
    assert.equal(greyed.detail, reason);
    assert.equal(greyed.selected, false, 'A greyed-out row is never chosen');
    assert.ok(
      shown.rows.every((row) => row.unavailable || row.label !== 'Check laser job…'),
      'Not offered on a folder of jobs: ' + JSON.stringify(shown),
    );
    assert.equal(shown.empty, '', 'Not “No matching actions”');
    await capture('offering-why');
    // a click on it runs nothing: the palette stays, and no check opens
    assert.ok(await page.evaluate(pageCall(clickUnavailable, 'Check laser job…')));
    await page.evaluate(animationFrames(2));
    assert.ok(await page.evaluate(exists('[aria-label="Search commands"]')), 'The palette stays');
    assert.equal((await panel()).open, false, 'No check opens');
    await closePalette();
    return { reason: greyed.detail, palette: shown };
  });

  await step('Offered on Job 1042, with what it compares', async () => {
    await selectFolder(job);
    const rows = await offered(
      'Check laser job',
      ({ rows }) =>
        rows.some((row) => row.selected && !row.unavailable && row.label === 'Check laser job…'),
      'Check laser job… offered for Job 1042',
    );
    const offer = rows.rows.find((row) => row.selected)!;
    assert.equal(offer.detail, 'Check the 5 DXF parts in Job 1042');
    await capture('offering-job');
    await runSelected('Check laser job…');
    return offer;
  });

  await step('The panel lists 7 files, checks them and shows one confirmed pitch', async () => {
    const ready = await wait(
      panel,
      (state) => state.sources.length === 7,
      'the inventory of Job 1042',
    );
    assert.equal(ready.label, 'Check Job 1042');
    assert.deepEqual(ready.sources, [
      { ref: 'S1', name: 'Job 1042 request.eml', sending: checkSendingLabels.text },
      { ref: 'S2', name: 'Job 1042 drawing.pdf', sending: checkSendingLabels.pages },
      ...[
        'g3-CV25-E1-10buc.dxf',
        'g3-GS30-D1-6buc.dxf',
        'g6-FL80-C1-2buc.dxf',
        'g6-MB20-A1-4buc.dxf',
        'g6-PL60-B2-2buc.dxf',
      ].map((name, index) => ({
        ref: `S${index + 3}`,
        name,
        sending: checkSendingLabels.measurement,
      })),
    ]);
    assert.ok(ready.model.includes(`Meta stub · ${model}`), ready.model);
    await wait(
      () => page.evaluate(buttonState('Check 7 files', '.check-panel')),
      (state) => state === 'enabled',
      'Check 7 files is enabled',
    );
    await capture('panel-ready');
    await page.evaluate(pageCall(record, 'check', '.check-panel .check-progress span'));
    await page.evaluate(pressButton('Check 7 files', '.check-panel'));
    const checked = await wait(
      panel,
      (state) => state.findings.length > 0 || !!state.error,
      'the check’s findings',
      60_000,
    );
    assert.equal(checked.error, '', 'The check ran');
    const progress = await page.evaluate(pageCall(recorded, 'check'));
    assert.ok(
      progress.some((text) =>
        text.startsWith('Meta stub is reading the request, 1 drawing page and 5 DXF parts'),
      ),
      'The panel says what the model reads: ' + JSON.stringify(progress),
    );
    assert.ok(
      progress.some((text) => text.startsWith('SAM 3.1 is outlining 1 feature')),
      'The panel says what SAM outlines: ' + JSON.stringify(progress),
    );
    assert.equal(checked.summary, named.summary);
    assert.match(
      checked.reader,
      /^Meta stub · muse-spark-1\.3 · [\d.]+ s · 1 finding, 1 confirmed by Viewer$/,
    );
    assert.equal(checked.findings.length, 1);
    const [finding] = checked.findings;
    assert.equal(finding!.grade, 'Confirmed');
    assert.equal(finding!.summary, named.finding);
    assert.equal(
      finding!.reason,
      'Viewer measured 48.00 mm between holes 4 and 5 along x; the drawing gives 50 mm.',
    );
    assert.deepEqual(finding!.notes, [
      'Job 1042 drawing.pdf, page 1 · g6-PL60-B2-2buc.dxf',
      'Feature: outline from SAM 3.1, confidence 89%',
      '“Holes 4× Ø10.5 at 50 mm pitch” marked on the drawing',
    ]);
    for (const text of [checked.summary, finding!.summary, finding!.reason, ...finding!.notes])
      assert.doesNotMatch(text, proseRef, 'File names, not refs');
    assert.equal(
      checked.tour,
      '3 stops through the job’s files, each finding with Viewer’s grade.',
    );
    // one reading of the job, and SAM asked once, for the drawing's feature
    assert.deepEqual(calls, [
      { route: '/v1/chat/completions', model, images: 1, problems: [] },
      { route: '/v1/responses', model: segmentation, images: 1, problems: [] },
    ]);
    await capture('panel-checked');
    return { progress, finding };
  });

  await step('The title collapses the panel and opens it again', async () => {
    await page.evaluate(click('.check-panel-toggle'));
    const collapsed = await wait(panel, (state) => state.collapsed, 'the panel collapses');
    assert.equal(collapsed.hidden, true, 'Only the title bar shows');
    assert.equal(collapsed.title, 'Check Job 1042 · 1 finding, 1 confirmed');
    await capture('panel-collapsed');
    await page.evaluate(click('.check-panel-toggle'));
    await wait(panel, (state) => !state.collapsed && !state.hidden, 'the panel opens again');
    return { title: collapsed.title };
  });

  await step('The tour shows every stop on the real engine', async () => {
    const stops = [
      { file: request, caption: 'The request asks for two base plates.' },
      { file: drawing, caption: named.caption },
      { file: plate, caption: 'The DXF puts them 48 mm apart.' },
    ];
    const pdf = `[data-plurid-plane]:has(.plane-heading[title=${JSON.stringify(drawing)}]) .pdf-sheet canvas`;
    const shown = new Map<number, unknown>();
    const started = Date.now();
    await page.evaluate(pressButton('Play the tour', '.check-panel'));
    let state: TourState;
    do {
      state = await page.evaluate(pageCall(tourState));
      if (JSON.stringify(state) !== JSON.stringify(tour.at(-1)?.state))
        tour.push({ at: Date.now() - started, state });
      assert.notEqual(
        state.status,
        'skipping',
        `${current}: stop ${state.count} was skipped: ${state.notice}`,
      );
      if (state.status === 'travelling' || state.status === 'showing')
        assert.ok(
          state.collapsed,
          `${current}: the panel is down to its title at stop ${state.count}`,
        );
      const index = Number(state.count.split(' / ')[0]);
      if (state.status === 'showing' && !shown.has(index)) {
        const stop = stops[index - 1]!;
        assert.equal(state.count, `${index} / 3`);
        assert.equal(state.caption, stop.caption);
        const view = await wait(
          () => page.evaluate(pageCall(planeView, stop.file)),
          (value) =>
            value.shown > 0.8 &&
            !value.failure &&
            (stop.file !== drawing ||
              (value.drawn && value.marks.includes('text') && value.marks.includes('feature'))),
          `stop ${index} shows ${path.basename(stop.file)}`,
          5000,
        );
        let tone: CanvasTone | undefined;
        if (stop.file === drawing)
          tone = await wait(
            () => page.evaluate(pageCall(canvasTone, pdf)),
            (value) => value.mean > 200 && value.dark > 0.005,
            'the drawing’s page is drawn',
            5000,
          );
        await capture(`tour-stop-${index}`);
        shown.set(index, { ...view, ...(tone ? { tone } : {}) });
      }
      if (state.status === 'ended') break;
      await new Promise((resolve) => setTimeout(resolve, 60));
    } while (Date.now() - started < 120_000);
    assert.equal(state.status, 'ended', `${current}: the tour ends`);
    assert.equal(state.title, 'End of “Job 1042”');
    assert.equal(state.detail, '3 stops', 'No stop was skipped');
    assert.deepEqual([...shown.keys()], [1, 2, 3]);
    await wait(panel, (value) => !value.collapsed, 'the panel opens again after the tour');
    await capture('tour-ended');
    await page.evaluate(click('.tour-bar [aria-label="Close tour (Esc)"]'));
    await wait(
      () => page.evaluate(exists('.tour-bar')),
      (open) => !open,
      'the end card closes',
    );
    return Object.fromEntries(shown);
  });

  await step('The correction is saved beside the original', async () => {
    await page.evaluate(pressButton('Save g6-PL60-B2-2buc (corrected).dxf', '.check-panel'));
    const saved = await wait(
      panel,
      (state) => state.correction === 'Saved: pitch 48.00 mm → 50.00 mm, measured again.',
      'Saved: pitch 48.00 mm → 50.00 mm, measured again.',
      30_000,
    );
    assert.equal(await sha256(plate), plateHash, 'The original is unchanged');
    await stat(corrected);
    assert.deepEqual(await circles(plate, 5.25), [
      [55, 25],
      [55, 75],
      [103, 25],
      [103, 75],
    ]);
    assert.deepEqual(
      await circles(corrected, 5.25),
      [
        [55, 25],
        [55, 75],
        [105, 25],
        [105, 75],
      ],
      'The right holes moved 2 mm along x',
    );
    assert.ok(
      saved.parts.includes('g6-PL60-B2-2buc.dxf, corrected copy'),
      JSON.stringify(saved.parts),
    );
    await capture('correction-saved');
    return { status: saved.correction, file: corrected };
  });

  await step('Nest and export handoff writes the shop’s folder', async () => {
    await page.evaluate(
      pageCall(record, 'handoff', '.check-panel [aria-label="Handoff"] .check-progress span'),
    );
    await page.evaluate(pressButton('Nest and export handoff', '.check-panel'));
    const done = await wait(
      panel,
      (state) => state.handoff === 'Saved “Job 1042 handoff”.' || !!state.handoffError,
      'Saved “Job 1042 handoff”.',
      180_000,
    );
    assert.equal(done.handoffError, '', 'The handoff was exported');
    const progress = await page.evaluate(pageCall(recorded, 'handoff'));
    for (const nested of ['Nesting 3 mm: 2 parts, 16 pieces…', 'Nesting 6 mm: 3 parts, 8 pieces…'])
      assert.ok(
        progress.some((text) => text.startsWith(nested)),
        `The panel says “${nested}”: ${JSON.stringify(progress)}`,
      );
    await capture('handoff-saved');
    assert.deepEqual((await readdir(handoff)).sort(), [
      'Check record.json',
      'Cut sheets',
      'Evidence',
      'Job.viewer-tour.jsonc',
    ]);
    // every file of the check and the corrected copy, each the same bytes and date
    const copies = (await readdir(path.join(handoff, 'Evidence'))).sort();
    const sources = [
      request,
      drawing,
      corrected,
      ...(await readdir(job))
        .filter((name) => name.endsWith('buc.dxf'))
        .map((name) => path.join(job, name)),
    ];
    assert.deepEqual(copies, sources.map((file) => path.basename(file)).sort());
    for (const source of sources) {
      const copy = path.join(handoff, 'Evidence', path.basename(source));
      assert.equal(
        await sha256(copy),
        await sha256(source),
        `${path.basename(source)} is copied whole`,
      );
      assert.ok(
        Math.abs((await stat(copy)).mtimeMs - (await stat(source)).mtimeMs) < 1,
        `${path.basename(source)} keeps its date`,
      );
    }
    const sheets = path.join(handoff, 'Cut sheets');
    assert.deepEqual((await readdir(sheets)).sort(), [
      'Nesting of 2 parts, 3 mm',
      'Nesting of 3 parts, 6 mm',
    ]);
    for (const nested of await readdir(sheets)) {
      const written = await readdir(path.join(sheets, nested));
      assert.ok(
        written.includes('Parts.csv') && written.includes('Report.pdf'),
        `${nested}: ${written.join(', ')}`,
      );
      const sheetFiles = written.filter((name) => /^Sheet \d+\.dxf$/.test(name));
      assert.ok(sheetFiles.length > 0, `${nested} has its sheets`);
      for (const sheet of sheetFiles) {
        const parsed = new DxfParser().parseSync(
          await readFile(path.join(sheets, nested, sheet), 'utf8'),
        );
        assert.ok(parsed && parsed.entities.length > 0, `${nested}/${sheet} has entities`);
      }
    }
    // the corrected copy is cut in place of its original
    const sixParts = await readFile(
      path.join(sheets, 'Nesting of 3 parts, 6 mm', 'Parts.csv'),
      'utf8',
    );
    assert.ok(sixParts.includes('g6-PL60-B2-2buc (corrected).dxf'), 'The corrected copy is nested');
    const tourFile = parseJSONC(
      await readFile(path.join(handoff, 'Job.viewer-tour.jsonc'), 'utf8'),
    ) as unknown;
    const definition = tourDefinitionSchema.parse(tourFile);
    assert.equal(definition.stops.length, 3);
    assert.equal(definition.stops[1]!.caption, named.caption);
    for (const stop of definition.stops) {
      assert.equal(stop.target.kind, 'file');
      if (stop.target.kind !== 'file') continue;
      assert.match(stop.target.path, /^Evidence\//, 'The tour plays from the Evidence copies');
      assert.equal(
        await sha256(path.join(handoff, stop.target.path)),
        stop.target.version.sha256,
        `${stop.target.path} is the file its stop recorded`,
      );
    }
    const checkRecord = JSON.parse(
      await readFile(path.join(handoff, 'Check record.json'), 'utf8'),
    ) as CheckRecord;
    assert.equal(checkRecord.job, 'Job 1042');
    assert.equal(checkRecord.provider.endpoint, provider.endpoint);
    assert.equal(checkRecord.level, 'images');
    assert.equal(checkRecord.validation.valid, true);
    assert.deepEqual(
      checkRecord.grades.map((grade) => grade.status),
      ['confirmed'],
    );
    assert.deepEqual(checkRecord.tour, { stops: 3, skipped: [] });
    assert.equal(checkRecord.corrections.length, 1);
    assert.deepEqual(
      checkRecord.segmentation.map((outline) => [outline.kind, outline.source]).sort(),
      [
        ['feature', 'segmentation'],
        ['text', 'page-text'],
      ],
    );
    return { progress, copies, sheets: await readdir(sheets) };
  });

  await step('Closed and opened again, the check is kept', async () => {
    await page.evaluate(click('.check-panel [aria-label="Close the check"]'));
    await wait(panel, (state) => !state.open, 'the panel closes');
    await selectFolder(job);
    const rows = await offered(
      'Check laser job',
      ({ rows }) =>
        rows.some((row) => row.selected && row.detail.startsWith('Show the check from')),
      'Check laser job… offers the kept check',
    );
    const offer = rows.rows.find((row) => row.selected)!;
    assert.match(
      offer.detail,
      /^Show the check from \d{2}:\d{2}: 1 finding, 1 confirmed by Viewer$/,
    );
    await runSelected('Check laser job…');
    const shown = await wait(panel, (state) => !!state.since, 'Checked at …');
    assert.match(shown.since, /^Checked at \d{2}:\d{2} · Run again$/);
    assert.equal(shown.stale, '', 'The job has not changed since');
    assert.equal(shown.correction, 'Saved: pitch 48.00 mm → 50.00 mm, measured again.');
    assert.equal(shown.handoff, 'Saved “Job 1042 handoff”.');
    assert.equal(
      calls.filter((call) => call.route === '/v1/chat/completions').length,
      1,
      'The model is not asked again',
    );
    await capture('panel-reopened');
    return { offer: offer.detail, since: shown.since };
  });

  await step('Nesting: no sheet format, units and picking a part', async () => {
    const before = exceptions.length;
    await page.evaluate(pressButton('Prepare cut sheets', '.check-panel'));
    const checked = await wait(
      nesting,
      (state) => state.tabs.length === 2 && state.status.includes('Checked:'),
      'the cut sheets nested and checked',
      120_000,
    );
    assert.deepEqual(checked.tabs, [
      { label: '3 mm, 2 files', pressed: true },
      { label: '6 mm, 3 files', pressed: false },
    ]);
    assert.deepEqual(checked.formats, ['1250 × 2500']);
    assert.match(checked.heading, /^\d+ sheets? · 1250 × 2500 mm$/);
    await capture('nesting-checked');

    assert.notEqual(await page.evaluate(pageCall(pickPart)), null, 'A part is placed');
    const picked = await wait(
      nesting,
      (state) => !!state.selection && state.picked > 0 && !!state.pickedRow,
      'the part picked',
    );
    const name = picked.pickedRow.split(' ')[0]!;
    assert.ok(
      picked.selection.includes(`${name}.dxf`) && /\d+ of \d+ pieces placed/.test(picked.selection),
      picked.selection,
    );
    await capture('nesting-picked');

    await page.evaluate(pressButton('in', '.layout-plane .nesting-panel [aria-label="Units"]'));
    const inches = await wait(
      nesting,
      (state) => state.units === 'in' && isDeepStrictEqual(state.formats, ['48 × 96']),
      'sizes in inches',
    );
    assert.ok(
      inches.parts.every((part) => / in · /.test(part)),
      JSON.stringify(inches.parts),
    );
    assert.ok(inches.heading.includes('48 × 96 in'), inches.heading);
    await capture('nesting-inches');
    await page.evaluate(pressButton('mm', '.layout-plane .nesting-panel [aria-label="Units"]'));
    await wait(
      nesting,
      (state) =>
        state.units === 'mm' &&
        isDeepStrictEqual(state.formats, ['1250 × 2500']) &&
        isDeepStrictEqual(state.parts, checked.parts),
      'sizes in millimetres again',
    );

    let empty: NestingState | undefined;
    for (const tab of checked.tabs) {
      await page.evaluate(
        click(
          `.layout-plane .nesting-thickness-tabs button[aria-label=${JSON.stringify(tab.label)}]`,
        ),
      );
      await wait(
        nesting,
        (state) => state.tabs.some((item) => item.label === tab.label && item.pressed),
        `the ${tab.label} tab`,
      );
      for (let left = (await nesting()).removes.length; left > 0; left--) {
        await page.evaluate(click('.layout-plane .nesting-formats button[aria-label^="Remove "]'));
        await wait(nesting, (state) => state.removes.length === left - 1, 'a sheet format removed');
      }
      empty = await wait(
        nesting,
        (state) => state.empty === 'Choose a sheet format to nest on.',
        `${tab.label} without a sheet format`,
      );
      assert.deepEqual(empty.problems, ['No format chosen.']);
      assert.equal(empty.placed, 0, 'No sheet is drawn');
      assert.equal(
        await page.evaluate(buttonState('Save nesting', '.layout-plane .nesting-panel')),
        'disabled',
      );
    }
    assert.ok(
      empty!.table.includes('3 mm No sheet format') &&
        empty!.table.includes('6 mm No sheet format'),
      JSON.stringify(empty!.table),
    );
    assert.ok(await page.evaluate(exists('.layout-plane')), 'The Layout plane is still open');
    assert.deepEqual(exceptions.slice(before), [], 'Nothing was thrown');
    await capture('nesting-no-format');
    return {
      heading: checked.heading,
      picked: picked.selection,
      inches: inches.parts,
      table: empty!.table,
    };
  });

  await step('Dark pages turn the PDF page dark and back', async () => {
    // the check is left collapsed in its workspace, to find it so on return
    await page.evaluate(click('.check-panel-toggle'));
    await wait(panel, (state) => state.collapsed, 'the panel collapses');
    await offered(
      'Job drawing',
      ({ rows }) => rows.some((row) => row.selected && row.label === 'Job drawing'),
      'the Job drawing workspace in the palette',
    );
    await runSelected('Job drawing');
    // the last workspace's planes leave first: its own PDF plane would answer for this one
    await wait(
      () =>
        Promise.all([
          page.evaluate(countOf('[data-plurid-plane]')),
          page.evaluate(pageCall(planeView, drawing)),
        ]),
      ([planes, view]) => planes === 1 && view.shown > 0.8 && !view.failure,
      'the Job drawing workspace shows its PDF plane alone',
    );
    assert.equal((await panel()).open, false, 'The check stays with the Laser jobs workspace');
    const canvas = '.pdf-viewer .pdf-sheet canvas';
    const button = '[data-plurid-plane] button[aria-label="Dark pages"]';
    const light = await wait(
      () => page.evaluate(pageCall(canvasTone, canvas)),
      (tone) => tone.mean > 200 && tone.dark > 0.005,
      'the drawing’s page in light',
    );
    assert.equal(await page.evaluate(attributeOf(button, 'aria-pressed')), 'false');
    await capture('dark-pages-off');
    await actions.click(button);
    const dark = await wait(
      () => page.evaluate(pageCall(canvasTone, canvas)),
      (tone) => tone.mean < 128 && tone.light > 0.005,
      'the page drawn dark, its lines light',
    );
    assert.ok(await page.evaluate(exists('.pdf-sheet[data-pages="dark"]')), 'The sheet is dark');
    assert.equal(await page.evaluate(attributeOf(button, 'aria-pressed')), 'true');
    await capture('dark-pages-on');
    await actions.click(button);
    const back = await wait(
      () => page.evaluate(pageCall(canvasTone, canvas)),
      (tone) => tone.mean > 200 && tone.dark > 0.005,
      'the page in light again',
    );
    return { light, dark, back };
  });

  await step('The panel waits in its own workspace, as it was left', async () => {
    await offered(
      'Laser jobs',
      ({ rows }) => rows.some((row) => row.selected && row.label === 'Laser jobs'),
      'the Laser jobs workspace in the palette',
    );
    await runSelected('Laser jobs');
    const back = await wait(panel, (state) => state.open, 'the check in its own workspace');
    assert.equal(back.collapsed, true, 'Collapsed, as it was left');
    assert.equal(back.title, 'Check Job 1042 · 1 finding, 1 confirmed');
    await page.evaluate(click('.check-panel-toggle'));
    const opened = await wait(panel, (state) => !state.collapsed, 'the panel opens');
    assert.equal(opened.correction, 'Saved: pitch 48.00 mm → 50.00 mm, measured again.');
    await capture('panel-back');
    return { title: back.title };
  });
} catch (error) {
  failure = error;
} finally {
  try {
    await viewer.close(page);
  } catch (error) {
    failure ??= error;
  }
  server.close();
  // the app's own log, beside the harness's stdout.log and stderr.log
  await copyFile(
    path.join(profile, 'Logs', 'diagnostics.log'),
    path.join(evidence, 'diagnostics.log'),
    constants.COPYFILE_EXCL,
  ).catch(() => {});
  const crashes = [...(await crashReports(profile)), ...(await crashReports(secondProfile))];
  await writeFile(
    path.join(evidence, 'result.json'),
    JSON.stringify(
      {
        version: 1,
        binary,
        root,
        endpoint: provider.endpoint,
        passed:
          !failure && steps.every((item) => item.passed) && !exceptions.length && !crashes.length,
        steps,
        calls,
        tour,
        screenshots,
        exceptions,
        consoleProblems,
        crashes,
        scope:
          'Generated files and a loopback model and SAM server in an owned, hidden packaged app. It does not qualify a live provider, native dialogs or the Mac App Store build.',
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  console.log('Evidence:', evidence);
  console.log('Retained files:', root);
  if (!failure) {
    assert.deepEqual(exceptions, [], 'The window threw nothing');
    assert.deepEqual(crashes, [], 'No process crashed');
  }
}
if (failure) throw failure;
