/**
 * Records the laser-job check live in a packaged app, for the film: Job 1042 checked with Meta's
 * Muse Spark and SAM 3.1, then its tour, the reviewed correction and the cut sheets. Each run makes
 * one paid check. The key comes from META_API_KEY and is entered in the owned app's Settings
 * window, never written to a file or the log. Native 2880 × 1800 frames, the check record and
 * capture.json stay in the run's folder.
 *
 *   VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 META_API_KEY=… \
 *     node --import tsx tools/fabrication/record.ts --binary <Viewer executable> [--effort minimal]
 *     [--jobs <new folder for the job, shown in the film>]
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs, promisify } from 'node:util';
import type { FolderPane, SavedState } from '../../src/domain/contracts';
import type { ReasoningEffort } from '../../src/domain/models/providers';
import type { ModelProvider } from '../../src/domain/services';
import { CURRENT_STATE_VERSION } from '../../src/domain/contracts';
import { modelEndpoint } from '../../src/domain/models/permissions';
import { reasoningEfforts } from '../../src/domain/models/providers';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { defaultSettings } from '../../src/domain/services';
import { ownedApp, until } from '../../tests/owned-app';
import { pageCall } from '../../tests/native/runtime/page-function';
import { filmControls } from '../docs/film-controls';
import { fabricationSamples } from '../playground/samples/fabrication';
import { temporaryRoot } from '../temporary';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1', 'Run with VIEWER_TEST_PRESERVE=1.');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1', 'Run with VIEWER_TEST_NO_REMOVAL=1.');
const { values } = parseArgs({
  options: {
    binary: { type: 'string' },
    effort: { type: 'string' },
    ffmpeg: { type: 'string' },
    jobs: { type: 'string' },
  },
});
assert.ok(values.binary, 'Pass --binary with the packaged Viewer executable.');
const effort = values.effort as ReasoningEffort | undefined;
assert.ok(!effort || reasoningEfforts.includes(effort), 'Unknown --effort.');
const key = process.env.META_API_KEY ?? '';
assert.ok(key.length > 8, 'Set META_API_KEY to the Meta Model API key.');
const binary = path.resolve(values.binary);
const ffmpeg = values.ffmpeg ?? '/opt/homebrew/bin/ffmpeg';
const execute = promisify(execFile);

// The run's folder: the job as the playground writes it, and a generated profile.
const root = await temporaryRoot('viewer-laser-film-', '/private/tmp');
// The palette and the plane show the job's path: --jobs gives it a readable one.
const jobs = values.jobs ? path.resolve(values.jobs) : path.join(root, 'Laser jobs');
assert.ok(!existsSync(path.join(jobs, 'Job 1042')), 'Choose a --jobs folder without a Job 1042.');
const job = path.join(jobs, 'Job 1042');
const profile = path.join(root, 'Profile');
await mkdir(profile);
for (const sample of fabricationSamples().filter((item) =>
  item.path.startsWith('fabrication/Job 1042/'),
)) {
  const file = path.join(jobs, sample.path.slice('fabrication/'.length));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, sample.bytes, { flag: 'wx' });
}
const provider: ModelProvider = {
  id: 'meta',
  name: 'Meta',
  kind: 'meta',
  endpoint: 'https://api.meta.ai/v1',
  model: 'muse-spark-1.3',
  allowContent: false,
  ...(effort ? { effort } : {}),
};
const settings = defaultSettings(jobs);
settings.hotkey.enabled = false;
settings.providers = [provider];
settings.prompts.providerID = provider.id;
// the tour ends after its last stop, so the take ends with it
settings.tour = { ...settings.tour, loop: false };
settings.previews = { ...settings.previews, darkPages: 'off' };
const ui = normalizePreferences();
ui.sidebar.inNewPlanes = false;
const pane: FolderPane = {
  id: 'job',
  type: 'folder',
  path: job,
  mode: 'list',
  sort: 'name',
  descending: false,
  showHidden: false,
  history: [job],
  historyIndex: 0,
};
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'jobs',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'jobs',
      name: 'Laser jobs',
      roots: [pane.id],
      activePane: pane.id,
      arrangement: {},
      panes: [pane],
    },
  ],
};
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
});
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), { flag: 'wx' });
// What Settings → Models keeps once the person allows pictures for Meta: the run answers no dialog.
await writeFile(
  path.join(profile, 'model-permissions-v1.json'),
  JSON.stringify({
    version: 1,
    permissions: [
      {
        providerID: provider.id,
        kind: provider.kind,
        endpoint: modelEndpoint(provider),
        level: 'images',
      },
    ],
  }),
  { flag: 'wx' },
);

// Page functions: each uses only its own body and arguments.

function panelState() {
  const panel = document.querySelector<HTMLElement>('.check-panel');
  const text = (element: Element | null | undefined) =>
    element?.textContent.replace(/\s+/g, ' ').trim() ?? '';
  return {
    open: !!panel,
    sources: panel?.querySelectorAll('.check-files li').length ?? 0,
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
    buttons: [...(panel?.querySelectorAll('button') ?? [])].map((button) =>
      button.textContent.trim(),
    ),
    error: text(panel?.querySelector('.check-panel-body > .error')),
  };
}
function tourStatus() {
  const bar = document.querySelector<HTMLElement>('.tour-bar');
  return {
    status: bar?.dataset.status ?? '',
    count: bar?.querySelector('.tour-bar-count')?.textContent.trim() ?? '',
    caption: bar?.querySelector('.tour-bar-caption')?.textContent.trim() ?? '',
  };
}
function nestingStatus() {
  const panel = document.querySelector<HTMLElement>('.layout-plane .nesting-panel');
  return {
    open: !!panel,
    placed: panel?.querySelectorAll('.nesting-sheets [data-part]').length ?? 0,
    heading: panel?.querySelector('.nesting-summary h2')?.textContent.trim() ?? '',
    status: panel?.querySelector('.nesting-status')?.textContent.trim() ?? '',
  };
}
/** Keeps each progress line the panel shows from now on: a line can come and go between reads. */
function watchProgress(): void {
  const store = window as unknown as { filmProgress?: string[] };
  const lines: string[] = (store.filmProgress = []);
  const read = () => {
    for (const element of document.querySelectorAll('.check-panel .check-progress span')) {
      const text = element.textContent.replace(/\s+/g, ' ').trim();
      if (text && lines.at(-1) !== text) lines.push(text);
    }
  };
  new MutationObserver(read).observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
  });
  read();
}
function progressLines(): string[] {
  return (window as unknown as { filmProgress?: string[] }).filmProgress ?? [];
}

// The run.

const evidence: Record<string, unknown> = {};
const save = () =>
  writeFile(
    path.join(root, 'capture.json'),
    JSON.stringify(
      {
        root,
        binary,
        job,
        provider: { ...provider },
        recording:
          'Live: one check of Job 1042 against the Meta Model API. The model wait between takes is not recorded.',
        clips: controls?.clips ?? [],
        evidence,
      },
      null,
      2,
    ),
  );
let controls: Awaited<ReturnType<typeof filmControls>> | undefined;
const app = await ownedApp(binary, profile, {
  mode: 'hidden',
  mockKeychain: true,
  label: 'laser-film',
});
let main: Awaited<ReturnType<typeof app.connect>> | undefined;
try {
  const raw = await app.connect();
  main = raw;
  await raw.command('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false,
    viewport: { x: 0, y: 0, width: 1440, height: 900, scale: 1 },
  });
  // The key goes where a person types it: the owned app's Settings window.
  await raw.evaluate(pageCall(() => window.viewer.openSettings()));
  const settingsWindow = await app.connect(true);
  await settingsWindow.evaluate(
    pageCall(
      (id: string, value: string) => window.viewer.providerCredential(id, value),
      provider.id,
      key,
    ),
  );
  await settingsWindow.evaluate(pageCall(() => window.close())).catch(() => undefined);
  await until(
    () =>
      raw.evaluate(
        pageCall(() => document.querySelectorAll('.folder-explorer [data-file-path]').length),
      ),
    (count) => count >= 7,
    'Job 1042 listed',
  );
  controls = await filmControls(raw, root, {
    ready: 'body',
    readyText: '',
    scroll: '.check-panel',
  });
  const film = controls;
  main = film.main;
  const page = film.main;
  const panel = () => page.evaluate(pageCall(panelState));
  await delay(1200);
  console.log(JSON.stringify({ root, status: 'ready' }));

  await film.take('laser-01-check', async () => {
    await film.beat('job', '', 1.8);
    await film.beat('palette', '', 0, () => film.key('Commands', 'k', 'KeyK', 75, 4));
    await page.command('Input.insertText', { text: 'Check laser job' });
    await until(
      () =>
        page.evaluate(
          pageCall(() => {
            const selected = document.querySelector(
              '.command-result[aria-selected="true"]:not(.is-unavailable)',
            );
            return selected?.textContent.includes('Check laser job') ?? false;
          }),
        ),
      Boolean,
      'Check laser job… offered for Job 1042',
    );
    await delay(1500);
    await film.key('Check laser job…', 'Enter', 'Enter', 13);
    await until(panel, (value) => value.sources === 7, 'the inventory of Job 1042', 30_000);
    await film.beat('panel', '', 1.8);
    await page.evaluate(pageCall(watchProgress));
    await film.click('.check-panel button', 'Check 7 files', 'Check 7 files');
    await film.beat('reading', '', 4.5);
  });

  const started = performance.now();
  const checked = await until(
    panel,
    (value) => value.findings.length > 0 || !!value.error,
    'the check’s findings',
    300_000,
  );
  evidence.checked = checked;
  evidence.modelSeconds = (performance.now() - started) / 1000;
  evidence.progress = await page.evaluate(pageCall(progressLines));
  await save();
  assert.equal(checked.error, '', 'The check ran: ' + checked.error);
  console.log(JSON.stringify({ reader: checked.reader, findings: checked.findings.length }));

  await film.take('laser-02-tour', async () => {
    await film.beat('findings', '', 3.5);
    await film.click('.check-panel button', 'Play the tour', 'Play the tour');
    const stops: unknown[] = [];
    let tour = await page.evaluate(pageCall(tourStatus));
    for (let i = 0; i < 1200 && tour.status !== 'ended'; i++) {
      await delay(100);
      tour = await page.evaluate(pageCall(tourStatus));
      if (JSON.stringify(stops.at(-1)) !== JSON.stringify(tour)) {
        stops.push(tour);
        // a mark per stop and status, so the edit finds each stop in the take
        await film.beat(`tour ${tour.count} ${tour.status}`.trim(), '', 0);
      }
    }
    evidence.tour = stops;
    assert.equal(tour.status, 'ended', 'The tour ends');
    await film.beat('tour-end', '', 1.2);
    await film.click('.tour-bar [aria-label="Close tour (Esc)"]', undefined, 'Close the tour');
  });

  await film.take('laser-03-correction', async () => {
    await film.beat('panel', '', 1.2);
    const label = (await panel()).buttons.find((text) => /^Save .*\(corrected\)\.dxf$/.test(text));
    assert.ok(label, 'A correction is offered');
    await film.click('.check-panel button', label, 'Save the corrected copy');
    const corrected = await until(
      panel,
      (value) => value.correction.startsWith('Saved:'),
      'the correction is saved',
      30_000,
    );
    evidence.correction = corrected.correction;
    await film.beat('saved', '', 2.5);
    await film.click('.check-panel button', 'Prepare cut sheets', 'Prepare cut sheets');
    evidence.nesting = await until(
      () => page.evaluate(pageCall(nestingStatus)),
      (value) => value.open && value.placed > 0,
      'the cut sheets',
      60_000,
    );
    await film.beat('sheets', '', 1.5);
    // The check folds to its title bar and the sheet comes into view, as a person looks at it.
    await film.click('[data-plurid-control="pinned-collapse"]', undefined, '');
    await page.evaluate(
      pageCall(() =>
        document
          .querySelector('.layout-plane .nesting-sheets')
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
      ),
    );
    await film.beat('sheet', '', 3.5);
  });
  evidence.jobFiles = await readdir(job);
  await save();

  // Each take as a near-lossless intermediate at its recorded timing, for the edit.
  for (const clip of film.clips as { name: string; timeline: string }[]) {
    await execute(
      ffmpeg,
      [
        '-n',
        '-hide_banner',
        '-loglevel',
        'error',
        '-reinit_filter',
        '0',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        clip.timeline,
        '-vf',
        'fps=30,format=yuv420p',
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        '12',
        '-movflags',
        '+faststart',
        path.join(root, clip.name + '.mp4'),
      ],
      { timeout: 600_000, maxBuffer: 1024 * 1024 },
    );
  }
  await writeFile(
    path.join(root, 'completed.json'),
    JSON.stringify({ status: 'passed', root, providerRequests: 'one check' }),
    { flag: 'wx' },
  );
  console.log(JSON.stringify({ status: 'passed', root }));
} finally {
  await save().catch(() => undefined);
  controls?.dispose();
  await app.close(main).catch((error: unknown) => console.error(error));
}
