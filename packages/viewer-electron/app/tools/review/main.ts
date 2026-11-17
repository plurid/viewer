/**
 * `pnpm review`: drives the packaged app, in hidden windows with generated profiles and files,
 * through every scene, captures each variant, runs the automatic checks and writes the review
 * sheet to out/review/<run>/index.html.
 */
import assert from 'node:assert/strict';
import { lstat, mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { pageCall } from '../../tests/native/runtime/page-function';
import { screenshot } from '../docs/record';
import { temporaryRoot } from '../temporary';
import { applyAllowances } from './allowlist';
import { acceptRun, compareWithBaseline } from './baseline';
import { checkSelectors, runChecks } from './checks';
import { coverage, readCatalog } from './coverage';
import { launchHidden, quit, readTemplate, RunStop } from './launch';
import type { ReviewConnection } from './launch';
import { ReviewPage } from './page';
import { writeProfile } from './profile';
import type { ProfileTemplate } from './profile';
import { reviewSheet } from './report';
import { createSamples } from './samples';
import { reviewAreas } from './scenes';
import type { Capture, Finding, RunResults, Scene, SceneResult, Variant } from './types';
import { standardVariants } from './variants';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const reviewRoot = path.join(appRoot, 'out/review');

interface Options {
  areas: string[];
  scenes: string[];
  variants: string[];
  binary: string;
  accept: boolean;
  acceptRun?: string;
  list: boolean;
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    areas: [],
    scenes: [],
    variants: [],
    binary:
      process.env.VIEWER_TEST_BINARY ||
      path.join(appRoot, `out/Viewer-darwin-${process.arch}/Viewer.app/Contents/MacOS/Viewer`),
    accept: false,
    list: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index]!;
    const value = () => {
      const next = argv[++index];
      if (!next || next.startsWith('--')) throw new Error(name + ' needs a value.');
      return next;
    };
    const values = () =>
      value()
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    if (name === '--area') options.areas.push(...values());
    else if (name === '--scene') options.scenes.push(...values());
    else if (name === '--variant') options.variants.push(...values());
    else if (name === '--binary') options.binary = path.resolve(value());
    else if (name === '--accept') options.accept = true;
    else if (name === '--accept-run') options.acceptRun = value();
    else if (name === '--list') options.list = true;
    else throw new Error('Unknown option ' + name + '. See docs/development/review.md.');
  }
  return options;
}

/** A sortable, readable run name: the local date and time. */
function runName(date = new Date()): string {
  const two = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-` +
    `${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`
  );
}

interface LockState {
  pid: number;
  run: string;
  started: string;
  state: 'running' | 'finished';
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** One run at a time. The lock is a small state file that is rewritten, never removed. */
async function lock(run: string): Promise<(state: LockState['state']) => Promise<void>> {
  const file = path.join(reviewRoot, 'review.lock');
  await mkdir(reviewRoot, { recursive: true });
  const write = async (state: LockState['state'], flag: 'wx' | 'w') =>
    writeFile(
      file,
      JSON.stringify({ pid: process.pid, run, started: new Date().toISOString(), state }) + '\n',
      { flag },
    );
  try {
    await write('running', 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const held = JSON.parse(await readFile(file, 'utf8')) as LockState;
    if (held.state === 'running' && held.pid !== process.pid && alive(held.pid))
      throw new Error(
        `Another review run (${held.run}, process ${held.pid}) is running. Wait for it to finish.`,
      );
    await write('running', 'w');
  }
  return (state) => write(state, 'w');
}

const allScenes = () =>
  reviewAreas.flatMap((area) => area.scenes.map((scene) => ({ area: area.id, scene })));

function selectScenes(options: Options) {
  const ids = new Set<string>();
  for (const { scene } of allScenes()) {
    assert.ok(
      /^[a-z0-9]+(-[a-z0-9]+)*$/.test(scene.id),
      'Scene ids are lowercase words: ' + scene.id,
    );
    assert.ok(!ids.has(scene.id), 'Two scenes share the id ' + scene.id);
    ids.add(scene.id);
  }
  for (const area of options.areas)
    if (!reviewAreas.some((item) => item.id === area)) throw new Error('No review area ' + area);
  for (const id of options.scenes) if (!ids.has(id)) throw new Error('No scene ' + id);
  return allScenes().filter(
    ({ area, scene }) =>
      (!options.areas.length || options.areas.includes(area)) &&
      (!options.scenes.length || options.scenes.includes(scene.id)),
  );
}

interface RunContext {
  root: string;
  home: string;
  binary: string;
  runFolder: string;
  template: ProfileTemplate;
}

const homeSpellings = (home: string) => [home, home.replace(/^\/private\//, '/')];

async function captureVariant(
  context: RunContext,
  scene: Scene,
  variant: Variant,
): Promise<Capture> {
  const started = Date.now();
  const capture: Capture = { variant, findings: [], milliseconds: 0, commands: [], dialogs: [] };
  const profile = path.join(context.root, 'Profiles', scene.id, variant.id);
  await writeProfile(profile, context.home, scene.setup, variant, context.template);
  const app = await launchHidden(context.binary, profile, context.home);
  let page: ReviewPage | undefined;
  let main: ReviewConnection | undefined;
  try {
    main = await app.connect();
    page = new ReviewPage(app, main, context.home, variant);
    await page.applyViewport();
    await page.waitFor('[data-file-path]', 1, 30000);
    await page.settle(600);
    const timer = new AbortController();
    try {
      await Promise.race([
        scene.steps(page, variant),
        delay(120000, undefined, { signal: timer.signal }).then(() => {
          throw new Error('The steps took more than two minutes.');
        }),
      ]);
    } finally {
      timer.abort();
    }
    await page.settle(400);
  } catch (error) {
    if (app.child.exitCode !== null || app.child.signalCode !== null)
      throw new RunStop(
        `The app exited during ${scene.id} (${app.child.exitCode ?? app.child.signalCode}).`,
      );
    capture.error = (error as Error).message.slice(0, 2000);
  }
  try {
    if (page) {
      const image = path.join(scene.id, variant.id + '.png');
      await mkdir(path.join(context.runFolder, scene.id), { recursive: true });
      await screenshot(page.connection, path.join(context.runFolder, image));
      capture.image = image;
      const state = await page.evaluate(
        pageCall(() => ({
          width: innerWidth,
          height: innerHeight,
          dialogs: [...document.querySelectorAll('dialog[open], [role="dialog"]')].map(
            (dialog) => dialog.getAttribute('aria-label') ?? '',
          ),
        })),
      );
      capture.viewport = { width: state.width, height: state.height };
      capture.dialogs = state.dialogs.filter(Boolean);
      const findings: Finding[] = [
        ...(await page.evaluate(
          runChecks({
            homes: homeSpellings(context.home),
            nameCells: [...checkSelectors.nameCells, ...(scene.nameCells ?? [])],
            nameFields: checkSelectors.nameFields,
            content: checkSelectors.content,
            horizontalScrollers: checkSelectors.horizontalScrollers,
            focus: [...(scene.focus ?? [])],
          }),
        )),
        ...page.findings,
      ];
      capture.findings = applyAllowances(findings, scene.id, variant.id);
      capture.commands = [...page.commands];
    }
  } catch (error) {
    capture.error = [capture.error, 'Capture: ' + (error as Error).message]
      .filter(Boolean)
      .join('\n');
  }
  await quit(app, main);
  capture.milliseconds = Date.now() - started;
  return capture;
}

async function writeSheet(runFolder: string, results: RunResults): Promise<void> {
  const hasBaseline = await lstat(path.join(reviewRoot, 'baseline', 'index.json')).then(
    () => true,
    () => false,
  );
  await writeFile(path.join(runFolder, 'results.json'), JSON.stringify(results, null, 2) + '\n', {
    flag: 'wx',
  });
  await writeFile(path.join(runFolder, 'index.html'), await reviewSheet(results, hasBaseline), {
    flag: 'wx',
  });
}

async function acceptExisting(run: string): Promise<void> {
  const runFolder = path.join(reviewRoot, run);
  const results = JSON.parse(await readFile(path.join(runFolder, 'results.json'), 'utf8'));
  const retired = await acceptRun(reviewRoot, runFolder, results as RunResults);
  console.log('Accepted ' + run + ' as the baseline.');
  if (retired) console.log('The replaced baselines are in ' + retired + '.');
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.list) {
    for (const area of reviewAreas) {
      console.log(area.id + ': ' + area.title);
      for (const scene of area.scenes) console.log('  ' + scene.id + ': ' + scene.title);
    }
    return;
  }
  if (options.acceptRun) return acceptExisting(options.acceptRun);
  assert.equal(process.platform, 'darwin', 'Review runs drive the macOS app.');
  // the run's samples and profiles are kept for the owner to review and move to the Trash
  process.env.VIEWER_TEST_PRESERVE = '1';
  process.env.VIEWER_TEST_NO_REMOVAL = '1';
  const binary = options.binary;
  const info = await lstat(binary).catch(() => undefined);
  if (!info?.isFile()) throw new Error('No packaged app at ' + binary + '. Package it first.');
  const selected = selectScenes(options);
  const run = runName();
  const release = await lock(run);
  const started = Date.now();
  const runFolder = path.join(reviewRoot, run);
  await mkdir(runFolder);
  // In /tmp, like the documentation captures: Columns lists every folder above the sample home,
  // and above /tmp there are only system folders.
  const root = await realpath(await temporaryRoot('viewer-review-', '/tmp'));
  const home = path.join(root, 'Home');
  await createSamples(home, appRoot);
  const results: RunResults = {
    version: 1,
    run,
    binary,
    started: new Date(started).toISOString(),
    milliseconds: 0,
    samples: root,
    areas: reviewAreas.map((area) => ({ id: area.id, title: area.title })),
    scenes: [],
    coverage: { commands: [], dialogs: [], settings: [], previews: [] },
  };
  const log = await open(path.join(runFolder, 'progress.log'), 'wx');
  try {
    const template = await readTemplate(root, home, binary);
    const context: RunContext = { root, home, binary, runFolder, template };
    for (const { area, scene } of selected) {
      const variants = (scene.variants ?? standardVariants).filter(
        (item) => !options.variants.length || options.variants.includes(item.id),
      );
      const result: SceneResult = {
        id: scene.id,
        area,
        title: scene.title,
        mustBeTrue: scene.mustBeTrue,
        captures: [],
        covers: scene.covers ?? {},
        ...(scene.blocked ? { blocked: scene.blocked } : {}),
      };
      results.scenes.push(result);
      if (scene.blocked) {
        console.log(`${scene.id}: not captured. ${scene.blocked}`);
        continue;
      }
      for (const variant of variants) {
        const capture = await captureVariant(context, scene, variant);
        result.captures.push(capture);
        const open = capture.findings.filter((finding) => !finding.allowed).length;
        const line =
          `${scene.id} ${variant.id}: ${open} problems` +
          (capture.error ? ', failed: ' + capture.error.split('\n')[0] : '') +
          ` (${(capture.milliseconds / 1000).toFixed(1)} s)`;
        console.log(line);
        await log.write(line + '\n');
      }
    }
  } catch (error) {
    if (!(error instanceof RunStop)) throw error;
    results.stopped = error.message;
    console.error('Stopped: ' + error.message);
  } finally {
    await log.close();
    results.milliseconds = Date.now() - started;
    results.coverage = coverage(await readCatalog(appRoot), results.scenes);
    await compareWithBaseline(reviewRoot, runFolder, results);
    await writeSheet(runFolder, results);
    await release('finished');
  }
  if (options.accept && !results.stopped) {
    const retired = await acceptRun(reviewRoot, runFolder, results);
    console.log('Accepted this run as the baseline.');
    if (retired) console.log('The replaced baselines are in ' + retired + '.');
  }
  const problems = results.scenes
    .flatMap((scene) => scene.captures)
    .reduce((total, capture) => total + capture.findings.filter((item) => !item.allowed).length, 0);
  console.log(
    `Review sheet: ${path.join(runFolder, 'index.html')}\n` +
      `${results.scenes.length} scenes, ${problems} open problems, ` +
      `${Math.round(results.milliseconds / 1000)} s. Samples and profiles kept in ${root}.`,
  );
  if (results.stopped) process.exitCode = 1;
}

await main();
