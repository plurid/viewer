import type { ExperimentAPI } from '../../src/domain/robotics/experiment-canvases';
/** Reopen actual qualified Meta artifacts without a configured provider or another model request. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { ExperimentCanvases as Canvases } from './experiment-canvases';
import { CURRENT_STATE_VERSION } from '../../src/domain/contracts';
import type { SavedState } from '../../src/domain/contracts';
import type {
  ExperimentDocument as CanvasDocument,
  ExperimentReply as CanvasReply,
} from '../../src/domain/robotics/experiment-canvases';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { ownedApp, until } from '../../tests/owned-app';
import { canvasFrame } from '../../tests/native/runtime/canvas';
import type { CanvasConnection } from '../../tests/native/runtime/canvas';
import { pageCall } from '../../tests/native/runtime/page-function';
import { screenshot } from '../docs/record';
import { temporaryRoot } from '../temporary';
import { digest, saveEvidence, readRobotSessionResult } from './rehearsal';
import { presentStationHTML } from './station-presentation';

function equalMeasurements(actual: unknown, expected: unknown): void {
  // Node and packaged Electron can differ in the final floating-point bit of trig results.
  if (typeof actual === 'number' && typeof expected === 'number') {
    assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-12);
  } else if (Array.isArray(actual) && Array.isArray(expected)) {
    assert.equal(actual.length, expected.length);
    actual.forEach((value, index) => equalMeasurements(value, expected[index]));
  } else if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    assert.deepEqual(Object.keys(actual), Object.keys(expected));
    for (const key of Object.keys(actual))
      equalMeasurements(
        (actual as Record<string, unknown>)[key],
        (expected as Record<string, unknown>)[key],
      );
  } else assert.deepEqual(actual, expected);
}

const { values } = parseArgs({
  options: {
    run: { type: 'string' },
    binary: { type: 'string' },
    presentation: { type: 'boolean' },
  },
});
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.ok(values.run && values.binary);
const live = await realpath(values.run);
const plan = JSON.parse(await readFile(path.join(live, 'plan.json'), 'utf8')) as {
  canvasID: string;
};
for (const stage of ['01', '02', '03']) {
  const result = (await readRobotSessionResult(path.join(live, 'sessions', stage))) as {
    status: string;
  };
  assert.equal(result.status, 'generated', 'The latest continuation must finish qualification.');
  const qualification = JSON.parse(
    await readFile(path.join(live, 'sessions', stage, 'qualification.json'), 'utf8'),
  );
  assert.equal(qualification.status, 'passed', 'Finish native qualification of every live stage.');
}
const branch = (await readRobotSessionResult(path.join(live, 'sessions/03'))) as {
  canvasID: string;
};
assert.ok(branch.canvasID);
const root = await realpath(await temporaryRoot('viewer-station-handoff-'));
const profile = path.join(root, 'Profile');
await mkdir(profile);
const source = new Canvases(path.join(live, 'Profile'), { changed() {} });
const destination = new Canvases(profile, { changed() {} });
const settings = defaultSettings(root);
settings.providers = [];
settings.hotkey.enabled = false;
await writeFile(
  path.join(profile, 'config.jsonc'),
  JSON.stringify({ version: 1, settings, ui: normalizePreferences() }),
);
const artifacts: {
  name: string;
  source: CanvasDocument;
  expected: CanvasDocument;
  imported: CanvasDocument;
  exported: string;
  savedCheck: string;
}[] = [];
for (const [name, id] of [
  ['Front', plan.canvasID],
  ['Rear', branch.canvasID],
] as const) {
  const document = await source.read(1, id);
  assert.ok(document.placementCheck);
  const folder = path.join(root, name);
  await mkdir(folder);
  const savedCheck = path.join(folder, 'station-check.json');
  await source.savePlacementCheck(
    1,
    id,
    document.revision,
    document.stateRevision,
    async () => savedCheck,
  );
  const exported = await source.export(1, id, folder);
  let imported = await destination.import(
    1,
    path.join(exported, 'canvas.viewer.json'),
    randomUUID(),
  );
  assert.equal(imported.html, document.html, 'Reopening must preserve actual generated HTML.');
  assert.deepEqual(imported.state, document.state, 'Reopening must preserve all saved inputs.');
  assert.equal(imported.assets.length, document.assets.length);
  assert.ok(imported.sources.every((s) => s.path === undefined));
  if (values.presentation) {
    const html = presentStationHTML(imported.html);
    imported = await destination.write(
      1,
      imported.id,
      imported.revision,
      imported.title,
      html,
      imported.defaults,
    );
    const binding = document.placementCheck;
    imported = await destination.checkPlacements(
      1,
      imported.id,
      imported.revision,
      imported.stateRevision,
      binding.sourceID,
      binding.briefSourceID,
      binding.stateKey,
    );
    assert.deepEqual(
      imported.state,
      document.state,
      'Presentation edits cannot change saved inputs.',
    );
    await writeFile(path.join(folder, 'provider.html'), document.html, { flag: 'wx' });
    await writeFile(path.join(folder, 'presentation.html'), html, { flag: 'wx' });
    await saveEvidence(path.join(folder, 'presentation-edits.json'), {
      originalHTMLHash: digest(document.html),
      presentationHTMLHash: digest(html),
      changes: [
        'Readable scene annotations',
        'Fictional station designation',
        'Restored-state wording',
        'Selector label and live status semantics',
      ],
      computations:
        'Original evaluation and action code retained byte for byte; saved inputs unchanged',
    });
    const presentationFolder = path.join(folder, 'Presentation');
    await mkdir(presentationFolder);
    await destination.export(1, imported.id, presentationFolder);
  }
  artifacts.push({ name, source: document, expected: imported, imported, exported, savedCheck });
}
await destination.flush();
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  activeWorkspace: 'station-handoff',
  favorites: [],
  recents: [],
  look: 'dark',
  workspaces: [
    {
      id: 'station-handoff',
      name: 'Station decision',
      panes: artifacts.map(({ name, imported }) => ({
        id: name.toLowerCase(),
        type: 'canvas',
        canvasID: imported.id,
        path: root,
        title: name + ' mounting point',
      })),
      roots: ['front', 'rear'],
      activePane: 'front',
      arrangement: {},
    },
  ],
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));
const evidence: Record<string, unknown>[] = [];
let app: Awaited<ReturnType<typeof ownedApp>> | undefined;
let main: CanvasConnection | undefined;
try {
  for (const pass of ['reopen', 'cold-restart']) {
    app = await ownedApp(values.binary, profile, {
      label: 'station-handoff',
      mode: 'hidden',
      mockKeychain: true,
    });
    main = await app.connect();
    await main.command('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 2,
      mobile: false,
    });
    for (const artifact of artifacts) {
      const id = artifact.imported.id;
      await main.evaluate(
        pageCall((pane) => {
          document
            .querySelector<HTMLButtonElement>(
              `[data-viewer-plane="${pane}"] [aria-label="Frame plane"]`,
            )
            ?.click();
        }, artifact.name.toLowerCase()),
      );
      // The framing command starts after its React event; observing no motion immediately
      // after dispatch can otherwise capture the previous plane or a fading transition.
      await delay(900);
      const frame = await canvasFrame(main, id);
      await until(
        () =>
          frame.evaluate(
            pageCall(() =>
              [...document.querySelectorAll('canvas')].some(
                (canvas) => canvas.clientWidth > 300 && canvas.clientHeight > 250,
              ),
            ),
          ),
        Boolean,
        'generated robot viewport',
      );
      await until(
        () =>
          main!.evaluate(
            pageCall((id) => {
              const element = document.querySelector(`[data-canvas-id="${id}"]`);
              if (!element || document.querySelector('[data-plurid-motion]')) return false;
              const r = element.getBoundingClientRect();
              let opacity = 1;
              for (let parent: Element | null = element; parent; parent = parent.parentElement)
                opacity *= Number(getComputedStyle(parent).opacity);
              return (
                r.width > innerWidth * 0.65 &&
                r.left >= -1 &&
                r.right <= innerWidth + 1 &&
                opacity > 0.999
              );
            }, id),
          ),
        Boolean,
        'framed plane',
      );
      const response: CanvasReply = await main.evaluate(
        pageCall(
          (id) =>
            (window.viewer as unknown as ExperimentAPI).canvas({ kind: 'placement-report', id }),
          id,
        ),
      );
      const report = response.placementReport;
      assert.equal(report?.status, 'checked');
      if (report?.status !== 'checked') throw new Error('The portable check did not recompute.');
      assert.equal(report.input.selected, artifact.name.toLowerCase());
      assert.equal(report.recommended, 'front');
      assert.deepEqual(
        report.candidates.map((c) => c.reached),
        [3, 6, 6, 6],
      );
      const reopened = response.document;
      assert.equal(reopened.html, artifact.expected.html);
      assert.deepEqual(reopened.state.camera, artifact.source.state.camera);
      assert.deepEqual(reopened.state.study, artifact.source.state.study);
      assert.deepEqual(
        (reopened.state.ui as { joints?: unknown })?.joints,
        (artifact.source.state.ui as { joints?: unknown })?.joints,
      );
      assert.ok(reopened.sources.every((s) => s.path === undefined));
      const savedCheck = JSON.parse(await readFile(artifact.savedCheck, 'utf8'));
      assert.equal(savedCheck.recommended, report.recommended);
      assert.deepEqual(savedCheck.input, report.input);
      equalMeasurements(savedCheck.candidates, report.candidates);
      await screenshot(main, path.join(root, `${pass}-${artifact.name.toLowerCase()}.png`));
      evidence.push({ pass, name: artifact.name, report });
    }
    await app.close(main);
    app = undefined;
    main = undefined;
  }
  await saveEvidence(path.join(root, 'summary.json'), {
    status: 'passed',
    providerRequests: 0,
    live,
    binary: values.binary,
    presentation: !!values.presentation,
    artifacts: artifacts.map(
      ({ name, source: document, expected, imported, exported, savedCheck }) => ({
        name,
        sourceCanvasID: document.id,
        canvasID: imported.id,
        htmlHash: digest(document.html),
        presentationHTMLHash: values.presentation ? digest(expected.html) : undefined,
        exported,
        savedCheck,
      }),
    ),
    evidence,
  });
  console.log(JSON.stringify({ status: 'passed', root, providerRequests: 0 }));
} finally {
  if (app) await app.close(main);
}
