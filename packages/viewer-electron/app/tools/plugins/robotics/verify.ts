/** Exercise the extracted plugin in the ordinary packaged app, with no provider configured. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { Canvases } from '../../../src/desktop/canvases/service';
import { ChatDocumentStore } from '../../../src/desktop/chat/documents';
import { CURRENT_STATE_VERSION } from '../../../src/domain/contracts';
import type { SavedState } from '../../../src/domain/contracts';
import type { CanvasActionInput } from '../../../src/domain/canvases/actions';
import { defaultSettings } from '../../../src/domain/services';
import { normalizePreferences } from '../../../src/domain/preferences/ui';
import { ownedApp, until } from '../../../tests/owned-app';
import { canvasFrame } from '../../../tests/native/runtime/canvas';
import type { CanvasConnection } from '../../../tests/native/runtime/canvas';
import { pageCall } from '../../../tests/native/runtime/page-function';
import { temporaryRoot } from '../../temporary';
import { saveEvidence } from '../../robotics/rehearsal';
import { reviewStationPlugin } from '../../robotics/station-review';
import { screenshot } from '../../docs/record';
import { loadCanvasLibraries } from '../../canvas-libraries';

const { values } = parseArgs({
  options: { plugin: { type: 'string' }, binary: { type: 'string' } },
});
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.ok(values.plugin && values.binary);
const root = await realpath(await temporaryRoot('viewer-robotics-plugin-review-'));
const profile = path.join(root, 'Profile');
await mkdir(profile);
const service = new Canvases(profile, { changed() {} });
const doc = await service.import(1, path.join(values.plugin, 'canvas.viewer.json'), randomUUID());
await new ChatDocumentStore(
  path.join(profile, 'chat-documents', doc.conversationID + '.json'),
).save({
  version: 4,
  id: doc.conversationID,
  title: doc.title,
  path: root,
  providerID: '',
  scopes: [],
  canvasID: doc.id,
  messages: [],
  draft: '',
  draftRevision: 0,
  revision: 0,
  updated: Date.now(),
  status: 'idle',
  level: 'names',
});
const settings = defaultSettings(root);
settings.providers = [];
settings.hotkey.enabled = false;
await writeFile(
  path.join(profile, 'config.jsonc'),
  JSON.stringify({ version: 1, settings, ui: normalizePreferences() }),
);
const workspace: SavedState = {
  version: CURRENT_STATE_VERSION,
  activeWorkspace: 'plugin',
  favorites: [],
  recents: [],
  look: 'dark',
  workspaces: [
    {
      id: 'plugin',
      name: 'Robotics plugin',
      panes: [{ id: 'robotics', type: 'canvas', canvasID: doc.id, path: root, title: doc.title }],
      roots: ['robotics'],
      activePane: 'robotics',
      arrangement: {},
    },
  ],
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(workspace));
await service.flush();
const xml = await readFile(
  new URL('../../../tests/fixtures/robotics/so101/so101_new_calib.urdf', import.meta.url),
  'utf8',
);
const brief = JSON.parse(
  await readFile(new URL('../../../tests/fixtures/robotics/station.json', import.meta.url), 'utf8'),
);
let app: Awaited<ReturnType<typeof ownedApp>> | undefined;
let main: CanvasConnection | undefined;
const checks: string[] = [];
let saved: Record<string, unknown> | undefined;
try {
  for (const pass of ['first-open', 'restart']) {
    app = await ownedApp(values.binary, profile, {
      mode: 'foreground',
      mockKeychain: true,
      label: 'robotics-plugin',
    });
    main = await app.connect();
    const connection = main;
    await main.command('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 2,
      mobile: false,
    });
    const frame = await canvasFrame(main, doc.id);
    await until(
      () => frame.evaluate(pageCall(() => Number(document.documentElement.dataset.loaded ?? 0))),
      (count) => count > 0,
      'plugin meshes loaded',
    );
    const read = async () =>
      (
        await connection.evaluate(
          pageCall((id) => window.viewer.canvas({ kind: 'read', id }), doc.id),
        )
      ).document;
    const invoke = async (action: string, input: CanvasActionInput) => {
      const current = await read();
      const result = await connection.evaluate(
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
          doc.id,
          current.revision,
          current.stateRevision,
          action,
          input,
        ),
      );
      assert.equal(
        result.actionRun?.status,
        'completed',
        result.actionRun?.error ?? 'Action did not complete.',
      );
      return result.actionRun!.result;
    };
    const before = await read();
    await delay(1200);
    assert.equal(
      (await read()).stateRevision,
      before.stateRevision,
      'Idle rendering must not write state.',
    );
    if (pass === 'first-open') {
      const baseline = await reviewStationPlugin(invoke, xml, brief, false);
      await saveEvidence(path.join(root, 'baseline.json'), baseline);
      await invoke('select', { mount: 'central' });
      checks.push('Existing parser, solver and checker run from the attached plugin module');
      const changed = await reviewStationPlugin(invoke, xml, brief, true);
      await saveEvidence(path.join(root, 'changed-constraint.json'), changed);
      await invoke('select', { mount: 'front' });
      await frame.evaluate(
        pageCall(() => {
          const target = document.querySelector<HTMLSelectElement>('#target')!;
          target.value = '3';
          target.dispatchEvent(new Event('change', { bubbles: true }));
          document.querySelector<HTMLButtonElement>('#fit')!.click();
        }),
      );
      await delay(500);
      saved = (await read()).state;
      assert.equal((saved.ui as { targetIndex: number }).targetIndex, 3);
      assert.ok(saved.camera);
      checks.push('24 candidate poses, changed targets, joint limits and reserved area verified');
      await screenshot(main, path.join(root, 'workbench.png'));
      let current = await read();
      await main.evaluate(
        pageCall(
          (id, revision, title) =>
            window.viewer.canvasLibrary({ kind: 'configure', id, revision, title, enabled: false }),
          doc.id,
          current.revision,
          current.title,
        ),
      );
      await assert.rejects(invoke('selfTest', {}), /Enable|completed|failed/);
      current = await read();
      await main.evaluate(
        pageCall(
          (id, revision, title) =>
            window.viewer.canvasLibrary({ kind: 'configure', id, revision, title, enabled: true }),
          doc.id,
          current.revision,
          current.title,
        ),
      );
      const duplicate = await main.evaluate(
        pageCall((id) => window.viewer.chat({ kind: 'duplicate-canvas', id }), doc.id),
      );
      assert.ok(!Array.isArray(duplicate) && duplicate.canvasID && duplicate.canvasID !== doc.id);
      checks.push('Plugin disables, enables and duplicates through the generic tool library');
    } else {
      assert.deepEqual(before.state, saved, 'Inputs and camera survive restart.');
      assert.deepEqual(await invoke('check', {}), saved!.study);
      await screenshot(main, path.join(root, 'restarted.png'));
      checks.push('Restart restores the selected mount, target, camera and calculated results');
    }
    await app.close(main);
    main = undefined;
    app = undefined;
  }
  const libraries = await loadCanvasLibraries();
  const finalService = new Canvases(profile, { changed() {}, libraries: () => libraries });
  const latest = await finalService.read(1, doc.id);
  const exported = await finalService.export(1, doc.id, root);
  const imported = await finalService.import(
    1,
    path.join(exported, 'canvas.viewer.json'),
    randomUUID(),
  );
  assert.equal(imported.html, latest.html);
  assert.deepEqual(imported.state, latest.state);
  assert.deepEqual(
    imported.assets.map((a) => a.hash),
    latest.assets.map((a) => a.hash),
  );
  await finalService.flush();
  checks.push('Export and import preserve plugin code, calculation library, meshes and inputs');
  await saveEvidence(path.join(root, 'result.json'), {
    status: 'passed',
    checks,
    exported,
    providerRequests: 0,
  });
  console.log(JSON.stringify({ root, status: 'passed', checks, providerRequests: 0 }));
} catch (error) {
  await saveEvidence(path.join(root, 'result.json'), {
    status: 'failed',
    error: String(error),
    checks,
    providerRequests: 0,
  });
  console.error(JSON.stringify({ root, error: String(error) }));
  process.exitCode = 1;
} finally {
  if (app) await app.close(main);
}
