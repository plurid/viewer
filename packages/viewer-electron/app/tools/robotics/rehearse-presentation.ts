import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { ownedApp, until } from '../../tests/owned-app';
import { pageCall } from '../../tests/native/runtime/page-function';
import { record, screenshot } from '../docs/record';
import type { Connection } from '../docs/record';
import { prepareRobotPresentation } from './prepare-presentation';
import { presentationControls } from './presentation-controls';

const { values } = parseArgs({
  options: { run: { type: 'string' }, binary: { type: 'string' }, record: { type: 'boolean' } },
});
assert.ok(values.run && values.binary, 'Pass --run and --binary. No provider is contacted.');
const binary = path.resolve(values.binary);
const presentation = await prepareRobotPresentation(values.run);
const { root, profile } = presentation;
const handoff = path.join(root, 'Handoff');
await mkdir(handoff);
console.log(JSON.stringify({ root, profile, providerRequests: 0 }));
const ffmpeg = path.resolve(
  binary,
  '../../Resources',
  `viewer-processors-darwin-${process.arch}`,
  'ffmpeg',
);
const evidence: unknown[] = [];
const clips: unknown[] = [];
let app: Awaited<ReturnType<typeof ownedApp>> | undefined;
let main!: Connection;
const idFor = (stage: string) => presentation.edits.find((edit) => edit.stage === stage)!.id;
async function start(workspace: string, id: string) {
  const file = path.join(profile, 'viewer-state-v1.json');
  const state = JSON.parse(await readFile(file, 'utf8'));
  state.activeWorkspace = workspace;
  state.openWindows = [workspace];
  await writeFile(file, JSON.stringify(state));
  app = await ownedApp(binary, profile, {
    mode: 'foreground',
    mockKeychain: true,
    label: 'robot-foreground-rehearsal',
  });
  main = await app.connect();
  await main.command('Page.bringToFront');
  await main.command('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const ui = presentationControls(main);
  const canvas = await ui.canvas(id);
  await ui.dock(id);
  return { ui, canvas };
}
const read = (id: string) =>
  main.evaluate(
    pageCall(async (id) => {
      const result = await window.viewer.canvas({ kind: 'read', id });
      if (!result.document) throw Error('Missing saved canvas.');
      return result.document;
    }, id),
  );
async function take(name: string, action: () => Promise<void>) {
  if (values.record) {
    const result = await record(main, path.join(root, name), ffmpeg, action, {
      width: 1440,
      height: 900,
      fps: 30,
      bitrate: '6000k',
      gif: false,
    });
    clips.push({
      name,
      ...result,
      source: 'Saved Meta session; layout refined locally',
      audio: false,
    });
  } else await action();
}
async function close() {
  await app!.close(main);
  app = undefined;
}
async function save() {
  await writeFile(
    path.join(root, 'foreground-review.json'),
    JSON.stringify({ binary, providerRequests: 0, evidence, clips }, null, 2),
  );
}
try {
  const createID = idFor('create');
  {
    const { ui, canvas } = await start('explore', createID);
    const before = await read(createID);
    const controls = await canvas.frame.evaluate(
      pageCall(() =>
        [...document.querySelectorAll<HTMLInputElement>('#joints input[type="range"]')].map(
          (el) => ({
            key: el.dataset.jkey!,
            label: el.getAttribute('aria-label')!,
            value: Number(el.value),
            min: Number(el.min),
            max: Number(el.max),
          }),
        ),
      ),
    );
    assert.equal(controls.length, 6);
    await take('01-joints-and-source', async () => {
      await delay(1200);
      for (const control of controls) {
        const selector = `[data-jkey="${control.key}"]`;
        const startFraction = (control.value - control.min) / (control.max - control.min);
        await canvas.drag(selector, startFraction, startFraction > 0.6 ? 0.35 : 0.65);
        await until(
          async () => Number((await read(createID)).state[control.key]),
          (value) => Math.abs(value - control.value) > 0.01,
          control.label + ' persists',
        );
        const index = controls.indexOf(control) + 1;
        await canvas.input(
          `.joint:nth-child(${index}) input[type="number"]`,
          String(before.state[control.key]),
        );
        await until(
          async () => Number((await read(createID)).state[control.key]),
          (value) => value === Number(before.state[control.key]),
          control.label + ' restores',
        );
      }
      const camera = (await read(createID)).state;
      await canvas.drag('#c3d', 0.42, 0.53, 35);
      await until(
        async () => (await read(createID)).state.cam_px,
        (value) => value !== camera.cam_px,
        'orbit persists',
      );
      await canvas.press('.joint:first-child button');
      await until(
        () =>
          main.evaluate(
            pageCall(
              () =>
                document.querySelector('pre[aria-label="shoulder_pan definition"]')?.textContent,
            ),
          ),
        (text) => text?.includes('shoulder_pan'),
        'joint source opens',
      );
      await screenshot(main, path.join(root, 'joint-source.png'));
      await delay(2000);
    });
    assert.equal((await read(createID)).html, before.html);
    evidence.push({
      stage: 'create',
      joints: controls.map((c) => c.label),
      source: 'shoulder_pan',
      cameraPersisted: true,
      scriptsUnchanged: true,
    });
    await writeFile(path.join(root, 'create-actions.json'), JSON.stringify(ui.events, null, 2));
    await close();
    await save();
  }
  const originalID = idFor('refine'),
    branchID = idFor('branch');
  {
    const { ui, canvas } = await start('targets', originalID);
    const before = await read(originalID);
    const selector = '#targetBox input[type="number"]';
    const coordinate = await canvas.frame.evaluate(
      pageCall((selector) => document.querySelector<HTMLInputElement>(selector)!.value, selector),
    );
    await take('02-original-targets', async () => {
      await delay(1000);
      await canvas.input(selector, String(Number(coordinate) + 0.02));
      await until(
        async () => JSON.stringify((await read(originalID)).state.robotTask),
        (value) => value !== JSON.stringify(before.state.robotTask),
        'target coordinate persists',
      );
      await delay(1200);
      await canvas.input(selector, coordinate);
      await until(
        async () => JSON.stringify((await read(originalID)).state.robotTask),
        (value) => value === JSON.stringify(before.state.robotTask),
        'target restored',
      );
      await canvas.press('#checkBtn');
      await until(
        () =>
          main.evaluate(
            pageCall((id) => window.viewer.canvas({ kind: 'robot-report', id }), originalID),
          ),
        (r) => r.robotReport?.status === 'checked',
        'original checked',
      );
      const summary = await main.evaluate(
        pageCall(
          (scope) =>
            [...document.querySelectorAll(`${scope} .canvas-inspector > summary`)]
              .find((el) => el.textContent?.startsWith('Robot check'))!
              .textContent!.trim(),
          canvas.scope,
        ),
      );
      await ui.click(`${canvas.scope} .canvas-inspector > summary`, summary);
      await delay(2500);
      await screenshot(main, path.join(root, 'original-targets.png'));
    });
    assert.equal((await read(originalID)).html, before.html);
    evidence.push({
      stage: 'refine',
      coordinateEdited: true,
      taskRestored: true,
      scriptsUnchanged: true,
    });
    await writeFile(path.join(root, 'refine-actions.json'), JSON.stringify(ui.events, null, 2));
    await close();
    await save();
  }
  let expectedTask: unknown;
  let replayCursor = 0;
  let exported = '';
  {
    const { ui, canvas } = await start('compare', branchID);
    const before = await read(branchID),
      original = await read(originalID);
    expectedTask = before.state.robotTask;
    await take('03-check-and-compare', async () => {
      await delay(1500);
      await canvas.press('#checkBtn');
      await until(
        () =>
          main.evaluate(
            pageCall((id) => window.viewer.canvas({ kind: 'robot-report', id }), branchID),
          ),
        (r) => r.robotReport?.status === 'checked',
        'independent check',
      );
      await ui.click(`${canvas.scope} .canvas-inspector > summary`, 'Compare base placements');
      await until(
        () =>
          main.evaluate(
            pageCall((id) => window.viewer.canvas({ kind: 'robot-comparison', id }), branchID),
          ),
        (r) => r.robotComparison?.status === 'compared',
        'same-target comparison',
      );
      await screenshot(main, path.join(root, 'comparison.png'));
      await delay(4500);
      await ui.click(`${canvas.scope} .canvas-inspector > summary`, 'Compare base placements');
      await canvas.drag('#scrub', 0.4, 0.05);
      await canvas.press('#playBtn');
      await delay(2200);
      await canvas.press('#pauseBtn');
      await canvas.drag('#scrub', 0.5, 0.4);
      await delay(1000);
    });
    replayCursor = Number(
      await canvas.frame.evaluate(
        pageCall(() => document.querySelector<HTMLInputElement>('#scrub')!.value),
      ),
    );
    assert.deepEqual((await read(branchID)).state.robotTask, expectedTask);
    assert.deepEqual((await read(originalID)).state.robotTask, original.state.robotTask);
    assert.equal((await read(branchID)).html, before.html);
    await take('04-save-and-export', async () => {
      await ui.click(`${canvas.scope} .canvas-inspector > summary`, 'Compare base placements');
      await ui.click(`${canvas.scope} button`, 'Save comparison JSON…');
      await ui.folder(handoff);
      await delay(1000);
      await ui.click('.viewer-file-picker footer .primary');
      await until(
        () => readdir(handoff),
        (files) => files.includes('robot-comparison.json'),
        'comparison saved',
      );
      await ui.click(`${canvas.scope} .canvas-inspector > summary`, 'Compare base placements');
      await ui.click(`${canvas.scope} button`, 'Export canvas…');
      await ui.folder(handoff);
      await ui.click('.viewer-file-picker footer .primary');
      exported = await until(
        () => readdir(handoff),
        (files) => files.some((file) => file.startsWith('Viewer canvas ')),
        'portable canvas exported',
      ).then((files) =>
        path.join(
          handoff,
          files.find((file) => file.startsWith('Viewer canvas '))!,
        ),
      );
      await delay(2000);
      await screenshot(main, path.join(root, 'exported.png'));
    });
    const comparison = JSON.parse(
      await readFile(path.join(handoff, 'robot-comparison.json'), 'utf8'),
    );
    assert.equal(comparison.status, 'compared');
    assert.deepEqual(comparison.original.report.input, original.state.robotTask);
    assert.deepEqual(comparison.alternative.report.input, expectedTask);
    assert.equal(comparison.original.report.passed, false);
    assert.equal(comparison.alternative.report.passed, true);
    evidence.push({
      stage: 'branch',
      comparison,
      replayCursor,
      expectedTask,
      exported,
      originalTaskUnchanged: true,
      scriptsUnchanged: true,
    });
    await writeFile(path.join(root, 'branch-actions.json'), JSON.stringify(ui.events, null, 2));
    await close();
    await save();
  }
  {
    const { ui, canvas } = await start('compare', branchID);
    assert.deepEqual((await read(branchID)).state.robotTask, expectedTask);
    const restored = Number(
      await canvas.frame.evaluate(
        pageCall(() => document.querySelector<HTMLInputElement>('#scrub')!.value),
      ),
    );
    assert.equal(restored, replayCursor);
    await delay(600);
    assert.equal(
      Number(
        await canvas.frame.evaluate(
          pageCall(() => document.querySelector<HTMLInputElement>('#scrub')!.value),
        ),
      ),
      replayCursor,
      'Replay restores paused.',
    );
    const result = await main.evaluate(
      pageCall((id) => window.viewer.canvas({ kind: 'robot-comparison', id }), branchID),
    );
    assert.equal(result.robotComparison?.status, 'compared');
    await screenshot(main, path.join(root, 'restarted.png'));
    evidence.push({
      stage: 'restart',
      taskPreserved: true,
      pausedReplayPreserved: true,
      comparisonRecomputed: true,
    });
    await ui.click(`${canvas.scope} button`, 'Conversation');
    await until(
      () => main.evaluate(pageCall(() => !!document.querySelector('.chat-branch blockquote'))),
      Boolean,
      'quoted branch opens',
    );
    await ui.dock((await read(branchID)).conversationID, 'conversation');
    await screenshot(main, path.join(root, 'quoted-conversation.png'));
    const quote = await main.evaluate(
      pageCall(() => document.querySelector('.chat-branch blockquote')!.textContent),
    );
    assert.ok(quote?.includes('Solve both attempts A and B'));
    await save();
    // Continue the import through the app's folder chooser, preserving the source conversation.
    await ui.click('.chat-toolbar button', 'Open canvas…');
    await ui.folder(exported);
    await ui.click('.viewer-file-picker footer .primary');
    const importedID = await until(
      () =>
        main.evaluate(
          pageCall(
            (branchID) =>
              [...document.querySelectorAll<HTMLElement>('[data-canvas-id]')]
                .map((el) => el.dataset.canvasId!)
                .filter((id) => id !== branchID),
            branchID,
          ),
        ),
      (ids) => ids.length > 1,
      'imported canvas opens',
    ).then((ids) => ids.find((id) => id !== originalID)!);
    const imported = await ui.canvas(importedID);
    await ui.dock(importedID);
    assert.deepEqual((await read(importedID)).state.robotTask, expectedTask);
    await take('05-reopened-handoff', async () => {
      await imported.press('#checkBtn');
      await until(
        () =>
          main.evaluate(
            pageCall((id) => window.viewer.canvas({ kind: 'robot-report', id }), importedID),
          ),
        (r) => r.robotReport?.status === 'checked',
        'imported check recomputes',
      );
      await imported.drag('#scrub', replayCursor, 0.05);
      await imported.press('#playBtn');
      await delay(2300);
      await imported.press('#pauseBtn');
      await delay(1500);
      await screenshot(main, path.join(root, 'reopened.png'));
    });
    assert.deepEqual((await read(importedID)).state.robotTask, expectedTask);
    evidence.push({
      stage: 'import',
      importedID,
      quote,
      taskPreserved: true,
      checkRecomputed: true,
      visualReplay: true,
    });
    await writeFile(path.join(root, 'reopen-actions.json'), JSON.stringify(ui.events, null, 2));
    await close();
    await save();
  }
  await writeFile(
    path.join(root, 'completed.json'),
    JSON.stringify({ status: 'passed', providerRequests: 0, root }, null, 2),
    { flag: 'wx' },
  );
  console.log(JSON.stringify({ status: 'passed', root, clips }));
} catch (error) {
  await save();
  if (app && main) await screenshot(main, path.join(root, 'failure.png')).catch(() => {});
  await writeFile(
    path.join(root, 'failure.json'),
    JSON.stringify(
      { error: String(error), stack: error instanceof Error ? error.stack : undefined },
      null,
      2,
    ),
  );
  throw error;
} finally {
  if (app) await close();
}
