/** Export and restart qualified generated tools in a profile with no configured provider. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { Canvases } from '../../src/desktop/canvases/service';
import { CURRENT_STATE_VERSION } from '../../src/domain/contracts';
import type { SavedState } from '../../src/domain/contracts';
import type { CanvasDocument } from '../../src/domain/canvases/document';
import type { CanvasActionInput } from '../../src/domain/canvases/actions';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { ownedApp, until } from '../../tests/owned-app';
import { canvasFrame } from '../../tests/native/runtime/canvas';
import type { CanvasConnection } from '../../tests/native/runtime/canvas';
import { pageCall } from '../../tests/native/runtime/page-function';
import { screenshot } from '../docs/record';
import { temporaryRoot } from '../temporary';
import { digest, saveEvidence } from './rehearsal';
import { reviewStationPlugin } from './station-review';
import { loadCanvasLibraries } from '../canvas-libraries';
import { readQualifiedStation } from './station-evidence';

const { values } = parseArgs({ options: { run: { type: 'string' }, binary: { type: 'string' } } });
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.ok(values.run && values.binary);
const live = await realpath(values.run);
const plan = JSON.parse(await readFile(path.join(live, 'plan.json'), 'utf8')) as {
  contract: string;
  canvasID: string;
  project: string;
};
assert.equal(plan.contract, 'generated-domain-v1', 'Use a fresh generic-host qualification.');
const stages: { canvasID: string; revision: number; htmlHash: string }[] = [];
for (const stage of ['01', '02', '03']) {
  const folder = path.join(live, 'sessions', stage);
  stages.push(await readQualifiedStation(folder));
}
const branch = stages[2]!;
const root = await realpath(await temporaryRoot('viewer-generated-handoff-'));
const profile = path.join(root, 'Profile');
await mkdir(profile, { mode: 0o700 });
const libraries = await loadCanvasLibraries();
const source = new Canvases(path.join(live, 'Profile'), {
  changed() {},
  libraries: () => libraries,
});
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
  imported: CanvasDocument;
  exported: string;
  savedResult: string;
  folder: string;
}[] = [];
for (const [name, id, qualification] of [
  ['Front', plan.canvasID, stages[1]!],
  ['Rear', branch.canvasID, branch],
] as const) {
  const document = await source.read(1, id);
  assert.equal(document.revision, qualification.revision);
  assert.equal(digest(document.html), qualification.htmlHash, 'Export the exact reviewed code.');
  assert.equal(document.state.selected, name.toLowerCase());
  const folder = path.join(root, name);
  await mkdir(folder);
  const savedResult = path.join(folder, 'placement-result.json');
  await source.saveResult(
    1,
    id,
    document.revision,
    document.stateRevision,
    {
      format: 'json',
      name: 'placement-result',
      content: JSON.stringify({
        selected: document.state.selected,
        reserved: document.state.reserved,
        study: document.state.study,
      }),
    },
    async () => savedResult,
  );
  const saved = JSON.parse(await readFile(savedResult, 'utf8'));
  assert.deepEqual(saved.study, document.state.study);
  const exported = await source.export(1, id, folder);
  const imported = await destination.import(
    1,
    path.join(exported, 'canvas.viewer.json'),
    randomUUID(),
  );
  assert.equal(
    imported.html,
    document.html,
    'Reopening must preserve the generated implementation.',
  );
  assert.deepEqual(imported.state, document.state, 'Reopening must preserve saved inputs.');
  assert.deepEqual(
    imported.assets.map((asset) => asset.hash),
    document.assets.map((asset) => asset.hash),
  );
  assert.ok(imported.sources.every((item) => item.path === undefined));
  artifacts.push({ name, imported, exported, savedResult, folder });
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
      name: 'Generated project tools',
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
const originals = new Map<string, Record<string, unknown>>();
let app: Awaited<ReturnType<typeof ownedApp>> | undefined;
let main: CanvasConnection | undefined;
let failure: string | undefined;
try {
  for (const pass of ['reopen', 'cold-restart']) {
    app = await ownedApp(values.binary, profile, {
      label: 'generated-handoff',
      mode: 'foreground',
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
        pageCall(
          (pane) =>
            document
              .querySelector<HTMLButtonElement>(
                `[data-viewer-plane="${pane}"] [aria-label="Frame plane"]`,
              )
              ?.click(),
          artifact.name.toLowerCase(),
        ),
      );
      await delay(900);
      const frame = await canvasFrame(main, id);
      await until(
        () =>
          frame.evaluate(
            pageCall(() =>
              [...document.querySelectorAll('canvas')].some(
                (node) => node.clientWidth > 300 && node.clientHeight > 250,
              ),
            ),
          ),
        Boolean,
        'generated viewport',
      );
      await until(
        () =>
          main!.evaluate(
            pageCall((id) => {
              const element = document.querySelector(`[data-canvas-id="${id}"]`);
              if (!element || document.querySelector('[data-plurid-motion]')) return false;
              const box = element.getBoundingClientRect();
              let opacity = 1;
              for (let node: Element | null = element; node; node = node.parentElement)
                opacity *= Number(getComputedStyle(node).opacity);
              return (
                opacity > 0.99 &&
                box.left >= -1 &&
                box.right <= innerWidth + 1 &&
                box.top >= 50 &&
                box.bottom <= innerHeight + 1
              );
            }, id),
          ),
        Boolean,
        'fully framed generated tool',
      );
      const before: CanvasDocument = (
        await main.evaluate(pageCall((id) => window.viewer.canvas({ kind: 'read', id }), id))
      ).document;
      if (pass === 'reopen') assert.deepEqual(before.state, artifact.imported.state);
      else
        assert.deepEqual(
          before.state,
          originals.get(id),
          'Cold restart must retain the full plugin state.',
        );
      const rows = await frame.evaluate(
        pageCall(() =>
          [...document.querySelectorAll('#perTarget tr')].map((row) =>
            [...row.querySelectorAll('td')].map((cell) => cell.textContent?.trim() ?? ''),
          ),
        ),
      );
      const study = before.state.study as {
        candidates: {
          id: string;
          poses: {
            targetID: string;
            residual: number;
            withinTolerance: boolean;
            violations: string[];
          }[];
        }[];
      };
      const poses = study.candidates.find(
        (candidate) => candidate.id === before.state.selected,
      )!.poses;
      assert.deepEqual(
        rows,
        poses.map((pose) => [
          pose.targetID,
          (pose.residual * 1000).toFixed(2) + ' mm',
          pose.withinTolerance && !pose.violations.length ? 'Yes' : 'No',
        ]),
        'The generated table must display the current measured results.',
      );
      if (pass === 'reopen') {
        const originalIndex = (before.state.ui as { targetIndex: number }).targetIndex;
        const targetIndex = (originalIndex + 1) % poses.length;
        for (const index of [targetIndex, originalIndex]) {
          await frame.evaluate(
            pageCall((index) => {
              const button =
                document.querySelectorAll<HTMLButtonElement>('#perTarget button')[index]!;
              button.scrollIntoView({ block: 'center' });
              button.click();
            }, index),
          );
          await until(
            async () =>
              (
                await main!.evaluate(
                  pageCall((id) => window.viewer.canvas({ kind: 'read', id }), id),
                )
              ).document.state.ui,
            (ui) =>
              !!ui && typeof ui === 'object' && !Array.isArray(ui) && ui.targetIndex === index,
            'target table selects the matching robot pose',
          );
          assert.equal(
            await frame.evaluate(
              pageCall(() => Number(document.querySelector<HTMLSelectElement>('#target')!.value)),
            ),
            index,
          );
          if (index === targetIndex)
            await screenshot(main, path.join(artifact.folder, 'target-results.png'));
        }
      }
      const invoke = async (action: string, input: CanvasActionInput) => {
        const current = (
          await main!.evaluate(pageCall((id) => window.viewer.canvas({ kind: 'read', id }), id))
        ).document;
        const reply = await main!.evaluate(
          pageCall(
            (id, revision, stateRevision, action, input) =>
              window.viewer.canvas({
                kind: 'invoke-action',
                id,
                revision,
                stateRevision,
                action,
                input,
              }),
            id,
            current.revision,
            current.stateRevision,
            action,
            input,
          ),
        );
        assert.equal(
          reply.actionRun?.status,
          'completed',
          reply.actionRun?.error ?? action + ' failed',
        );
        return reply.actionRun!.result;
      };
      const urdf = before.sources
        .find((item) => item.name.endsWith('.urdf'))
        ?.data.evidence.find((item) => item.source === 'text')?.text;
      const brief = before.sources
        .find((item) => item.name === 'station.json')
        ?.data.evidence.find((item) => item.source === 'text')?.text;
      assert.ok(urdf && brief, 'Reopened tool must retain its source snapshots.');
      const report = await reviewStationPlugin(invoke, urdf, JSON.parse(brief), true);
      const after: CanvasDocument = (
        await main.evaluate(pageCall((id) => window.viewer.canvas({ kind: 'read', id }), id))
      ).document;
      assert.equal(after.state.selected, artifact.name.toLowerCase());
      assert.deepEqual(after.state.camera, before.state.camera);
      assert.deepEqual(after.state.ui, before.state.ui);
      originals.set(id, after.state);
      await saveEvidence(path.join(artifact.folder, pass + '-external-review.json'), report);
      await screenshot(main, path.join(artifact.folder, pass + '.png'));
      evidence.push({
        pass,
        tool: artifact.name,
        selected: after.state.selected,
        htmlHash: digest(after.html),
        report,
      });
    }
    await app.close(main);
    app = undefined;
    main = undefined;
  }
} catch (error) {
  failure = String(error);
} finally {
  if (app) await app.close(main);
  await saveEvidence(path.join(root, 'summary.json'), {
    status: failure ? 'failed' : 'passed',
    failure,
    providerRequests: 0,
    scope:
      'Agent-edited plugin export, interactive results, external acceptance and native cold restart',
    stages,
    evidence,
    artifacts: artifacts.map(({ name, exported, savedResult }) => ({
      name,
      exported,
      savedResult,
    })),
  });
}
console.log(
  JSON.stringify({ root, status: failure ? 'failed' : 'passed', failure, providerRequests: 0 }),
);
if (failure) process.exitCode = 1;
