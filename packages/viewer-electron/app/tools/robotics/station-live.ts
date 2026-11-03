/** Explicit live qualification in the real desktop renderer. All evidence is retained. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { parse } from 'jsonc-parser';
import { Canvases } from '../../src/desktop/canvases/service';
import { ChatDocumentStore } from '../../src/desktop/chat/documents';
import { inspectFile } from '../../src/desktop/files/inspection';
import { CURRENT_STATE_VERSION } from '../../src/domain/contracts';
import type { SavedState } from '../../src/domain/contracts';
import type { CanvasDocument } from '../../src/domain/canvases/document';
import type { ChatDocument, ChatReply } from '../../src/domain/models/chat';
import { defaultSettings } from '../../src/domain/services';
import type { ApplicationSettings, ModelProvider } from '../../src/domain/services';
import { modelPermissionCovers } from '../../src/domain/models/permissions';
import type { ModelDataPermission } from '../../src/domain/models/permissions';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { ownedApp, until } from '../../tests/owned-app';
import { pageCall } from '../../tests/native/runtime/page-function';
import { canvasFrame } from '../../tests/native/runtime/canvas';
import { buildRoboticsPlugin } from '../plugins/robotics/build';
import { screenshot } from '../docs/record';
import { temporaryRoot, adoptRetainedNativeFixture } from '../temporary';
import { hashFile } from '../qualification/source';
import {
  RobotRehearsalLedger,
  digest,
  readEvidence,
  saveEvidence,
  robotBranchRequest,
  readRobotSessionResult,
} from './rehearsal';
import type { RobotStage } from './rehearsal';
import { stationPrompts as prompts, stationStudySchema } from './station-contract';
import { reviewStationPlugin } from './station-review';
import type { CanvasActionInput } from '../../src/domain/canvases/actions';
import { authorizeStationRun, stationAuthorization } from './station-authorization';
import { readQualifiedStation } from './station-evidence';

const { values } = parseArgs({
  options: {
    prepare: { type: 'boolean' },
    live: { type: 'boolean' },
    authorize: { type: 'string' },
    qualify: { type: 'boolean' },
    preflight: { type: 'boolean' },
    run: { type: 'string' },
    stage: { type: 'string' },
    binary: { type: 'string' },
    corpus: { type: 'string' },
    profile: { type: 'string' },
    resume: { type: 'string' },
    guidance: { type: 'string' },
    'repair-reason': { type: 'string' },
  },
});
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.equal(
  Number(!!values.prepare) +
    Number(!!values.live) +
    Number(!!values.authorize) +
    Number(!!values.qualify) +
    Number(!!values.preflight),
  1,
  'Choose prepare, preflight, authorize, live or qualify.',
);
const fixture = (name: string) => new URL('../../tests/fixtures/robotics/' + name, import.meta.url);
type Plan = {
  contract: 'generated-domain-v1';
  provider: ModelProvider;
  conversationID: string;
  canvasID: string;
  sourceID: string;
  briefSourceID: string;
  project: string;
  prompts: typeof prompts;
  protectedProfile: string;
  protectedHashes: Record<string, string>;
  starter?: { htmlHash: string; libraryHash: string; origin: string };
};

async function prepare(): Promise<string> {
  assert.ok(values.corpus);
  const sourceProfile = await realpath(
    values.profile ?? path.join(os.homedir(), 'Library/Application Support/Viewer'),
  );
  const root = await realpath(await temporaryRoot('viewer-generated-station-', '/private/tmp'));
  const profile = path.join(root, 'Profile');
  const project = path.join(root, 'Six-slot station');
  await mkdir(profile, { mode: 0o700 });
  await mkdir(path.join(root, 'sessions'), { mode: 0o700 });
  const manifest = JSON.parse(await readFile(fixture('so101/manifest.json'), 'utf8')) as {
    files: { path: string; sha256: string; bytes: number }[];
  };
  const corpus = await realpath(values.corpus);
  for (const file of manifest.files) {
    const source = await realpath(path.join(corpus, file.path));
    assert.ok(source.startsWith(corpus + path.sep));
    const bytes = await readEvidence(source, file.bytes);
    assert.equal(bytes.length, file.bytes);
    assert.equal(digest(bytes), file.sha256);
    const target = path.join(project, file.path);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
  }
  const briefPath = path.join(project, 'station.json');
  await writeFile(briefPath, await readFile(fixture('station.json')), { flag: 'wx', mode: 0o600 });
  const protectedHashes: Record<string, string> = {};
  for (const file of [
    'config.jsonc',
    'credentials-v1.json',
    'credential-bindings-v1.json',
    'model-permissions-v1.json',
  ])
    protectedHashes[file] = await hashFile(path.join(sourceProfile, file));
  const config = parse(await readFile(path.join(sourceProfile, 'config.jsonc'), 'utf8')) as {
    settings: ApplicationSettings;
  };
  const providers = config.settings.providers.filter((p) => p.kind === 'meta');
  assert.equal(providers.length, 1, 'Choose one configured Meta provider.');
  const provider = providers[0]!;
  const permissions = JSON.parse(
    await readFile(path.join(sourceProfile, 'model-permissions-v1.json'), 'utf8'),
  ) as {
    permissions: ModelDataPermission[];
  };
  const permission = permissions.permissions.find((p) => p.providerID === provider.id);
  assert.ok(
    modelPermissionCovers(permission ?? null, provider, 'images'),
    'Meta needs the existing locally approved data permission.',
  );
  for (const file of ['credentials-v1.json', 'credential-bindings-v1.json']) {
    const saved = JSON.parse(await readFile(path.join(sourceProfile, file), 'utf8')) as Record<
      string,
      string
    >;
    assert.ok(saved[provider.id], 'The Meta credential and endpoint binding must already exist.');
    await saveEvidence(path.join(profile, file), { [provider.id]: saved[provider.id] });
  }
  await saveEvidence(path.join(profile, 'model-permissions-v1.json'), {
    version: 1,
    permissions: [permission],
  });
  const service = new Canvases(profile, { changed() {} });
  const canvas = await service.create(1, randomUUID(), project);
  const source = await service.source(
    1,
    canvas.id,
    0,
    await inspectFile(path.join(project, 'Simulation/SO101/so101_new_calib.urdf'), {
      content: true,
    }),
  );
  // Attach only the manifest's explicit files. The model interprets mesh dependencies from raw XML.
  for (const file of manifest.files.filter((item) => item.path.endsWith('.stl'))) {
    const source = path.join(project, file.path);
    await service.attach(1, canvas.id, path.basename(source), await readFile(source), source);
  }
  const current = await service.read(1, canvas.id);
  const brief = await service.source(
    1,
    canvas.id,
    current.revision,
    await inspectFile(briefPath, { content: true }),
  );
  assert.equal(source.source.data.coverage.content, 'complete');
  assert.equal(brief.source.data.coverage.content, 'complete');
  const built = await buildRoboticsPlugin();
  await service.attach(
    1,
    canvas.id,
    'robotics.js',
    Buffer.from(built.library),
    undefined,
    'Existing robotics plugin implementation. Reuse and extend it.',
  );
  const attached = await service.read(1, canvas.id);
  const starter = await service.write(
    1,
    canvas.id,
    attached.revision,
    'Robotics workbench',
    built.html,
    { reserved: false, targetOffsetX: 0, ui: { targetIndex: 0 } },
  );
  await saveEvidence(path.join(root, 'starter.json'), starter);
  await service.flush();
  await new ChatDocumentStore(
    path.join(profile, 'chat-documents', canvas.conversationID + '.json'),
  ).save({
    version: 4,
    id: canvas.conversationID,
    title: 'Reach every tray slot',
    path: project,
    providerID: provider.id,
    scopes: [],
    canvasID: canvas.id,
    messages: [],
    draft: '',
    draftRevision: 0,
    revision: 0,
    updated: Date.now(),
    status: 'idle',
    level: 'images',
  });
  const settings = defaultSettings(project);
  settings.providers = [provider];
  settings.prompts.providerID = provider.id;
  settings.hotkey.enabled = false;
  await saveEvidence(path.join(profile, 'config.jsonc'), {
    version: 1,
    settings,
    ui: normalizePreferences(),
  });
  const plan: Plan = {
    contract: 'generated-domain-v1',
    provider,
    conversationID: canvas.conversationID,
    canvasID: canvas.id,
    sourceID: source.source.id,
    briefSourceID: brief.source.id,
    project,
    prompts,
    protectedProfile: sourceProfile,
    protectedHashes,
    starter: {
      htmlHash: digest(built.html),
      libraryHash: digest(built.library),
      origin: 'existing robotics plugin',
    },
  };
  await saveEvidence(path.join(root, 'plan.json'), plan);
  await writeFile(
    path.join(root, 'prompts.txt'),
    Object.entries(prompts)
      .map(([stage, prompt]) => stage.toUpperCase() + '\n\n' + prompt)
      .join('\n\n'),
    { flag: 'wx', mode: 0o600 },
  );
  // Preparation never creates a paid-call allowance. Authorization is a separate explicit command.
  console.log(
    JSON.stringify({ root, status: 'prepared', provider: provider.model, providerRequests: 0 }),
  );
  return root;
}

async function live(): Promise<void> {
  if (values.preflight) values.stage = 'create';
  assert.ok(values.run && values.binary && values.stage);
  assert.ok(['create', 'refine', 'branch'].includes(values.stage));
  const stage = values.stage as RobotStage;
  const root = await realpath(values.run);
  adoptRetainedNativeFixture(root);
  const plan = JSON.parse(await readFile(path.join(root, 'plan.json'), 'utf8')) as Plan;
  assert.equal(plan.contract, 'generated-domain-v1', 'Prepare a fresh generic-host run.');
  // Authorization binds the actual prepared plan; changing source defaults must not rewrite history.
  assert.ok(plan.prompts.create && plan.prompts.refine && plan.prompts.branch);
  if (!values.qualify && !values.preflight) await stationAuthorization(root);
  for (const [name, hash] of Object.entries(plan.protectedHashes))
    assert.equal(
      await hashFile(path.join(plan.protectedProfile, name)),
      hash,
      'The source credential profile changed.',
    );
  const ledger = new RobotRehearsalLedger(root);
  const previous = await ledger.sessions();
  assert.equal(
    previous.length,
    ['create', 'refine', 'branch'].indexOf(stage) + (values.resume || values.qualify ? 1 : 0),
    'Review each stage before moving on.',
  );
  if (previous.length && !values.resume && !values.qualify) {
    await readQualifiedStation(previous.at(-1)!);
  }
  let launchRoot = root;
  let profile = path.join(root, 'Profile');
  if (values.preflight) {
    // The no-call preflight needs files and runtime, never a real credential or keychain grant.
    launchRoot = await realpath(await temporaryRoot('viewer-station-preflight-', '/private/tmp'));
    profile = path.join(launchRoot, 'Profile');
    await mkdir(profile, { mode: 0o700 });
    for (const folder of ['canvas-documents', 'canvas-assets', 'chat-documents'])
      await cp(path.join(root, 'Profile', folder), path.join(profile, folder), { recursive: true });
    const settings = defaultSettings(plan.project);
    settings.providers = [];
    settings.hotkey.enabled = false;
    await saveEvidence(path.join(profile, 'config.jsonc'), {
      version: 1,
      settings,
      ui: normalizePreferences(),
    });
  }
  const resumed =
    values.resume || values.qualify
      ? ((await readRobotSessionResult(previous.at(-1)!)) as { conversationID: string })
      : undefined;
  const baseChat = (await new ChatDocumentStore(
    path.join(
      profile,
      'chat-documents',
      (resumed?.conversationID ?? plan.conversationID) + '.json',
    ),
  ).load())!;
  assert.ok(baseChat && (baseChat.status !== 'running' || values.resume || values.qualify));
  const workspace: SavedState = {
    version: CURRENT_STATE_VERSION,
    look: 'dark',
    activeWorkspace: 'station',
    favorites: [],
    recents: [],
    workspaces: [
      {
        id: 'station',
        name: 'Six-slot station',
        panes: [
          {
            id: 'station-canvas',
            type: 'canvas',
            canvasID: baseChat.canvasID ?? plan.canvasID,
            path: plan.project,
            title: 'Reach every tray slot',
          },
          {
            id: 'station-chat',
            type: 'chat',
            conversationID: baseChat.id,
            path: plan.project,
          },
        ],
        roots: ['station-canvas', 'station-chat'],
        activePane: 'station-canvas',
        arrangement: {},
      },
    ],
  };
  await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(workspace), {
    mode: 0o600,
  });
  const app = await ownedApp(values.binary, profile, {
    mode: 'foreground',
    label: 'station-live',
    mockKeychain: !!values.preflight,
    environment: { VIEWER_STATION_RUN: launchRoot },
  });
  let main: Awaited<ReturnType<typeof app.connect>> | undefined;
  let session: Awaited<ReturnType<RobotRehearsalLedger['begin']>> | undefined;
  let conversation: ChatDocument = baseChat;
  let canvas: CanvasDocument | undefined;
  let original: CanvasDocument | undefined;
  let failure: string | undefined;
  let generated = false;
  try {
    main = await app.connect();
    await main.command('Emulation.setDeviceMetricsOverride', {
      width: 1600,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await main.evaluate(
      pageCall(() =>
        document
          .querySelector<HTMLButtonElement>(
            '[data-viewer-plane="station-canvas"] [aria-label="Frame plane"]',
          )
          ?.click(),
      ),
    );
    await delay(900);
    await main.evaluate(
      pageCall((id) => window.viewer.chat({ kind: 'open', id }), conversation.id),
    );
    if (stage === 'branch') {
      original = (
        await main.evaluate(
          pageCall((id) => window.viewer.canvas({ kind: 'read', id }), plan.canvasID),
        )
      ).document;
      if (!values.resume && !values.qualify) {
        const reply = [...conversation.messages]
          .reverse()
          .find((m) => m.role === 'assistant' && /front/i.test(m.text));
        assert.ok(reply, 'Quote a real Front recommendation.');
        const match = [...reply.text.matchAll(/[^.!?\n]+[.!?]?/g)].find((m) => /front/i.test(m[0]));
        assert.ok(match && match.index !== undefined);
        const request = robotBranchRequest(
          conversation,
          reply.id,
          match.index,
          match.index + match[0].length,
        );
        await main.evaluate(
          pageCall((request) => {
            const node = document.querySelector(`[data-chat-text="${request.messageID}"]`);
            const text = node?.firstChild;
            if (!node || !text) throw new Error('The quoted message is not rendered.');
            node.scrollIntoView({ block: 'center' });
            const range = document.createRange();
            range.setStart(text, request.start);
            range.setEnd(text, request.end);
            window.getSelection()?.removeAllRanges();
            window.getSelection()?.addRange(range);
            node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          }, request),
        );
        await until(
          () => main!.evaluate(pageCall(() => !!document.querySelector('.chat-quote-action'))),
          Boolean,
          'quote action',
        );
        await main.evaluate(
          pageCall(() => document.querySelector<HTMLButtonElement>('.chat-quote-action')!.click()),
        );
        const id = await until(
          () =>
            main!.evaluate(
              pageCall(
                (original) =>
                  [...document.querySelectorAll<HTMLElement>('[data-conversation-id]')]
                    .map((node) => node.dataset.conversationId)
                    .find((id) => id && id !== original),
                conversation.id,
              ),
            ),
          Boolean,
          'linked quote conversation',
        );
        const fork = await main.evaluate(
          pageCall((id) => window.viewer.chat({ kind: 'open', id }), id!),
        );
        assert.ok(!Array.isArray(fork) && fork.canvasID);
        assert.equal(fork.branch?.quote, reply.text.slice(request.start, request.end));
        conversation = fork;
        await main.evaluate(
          pageCall((id) => {
            const chat = document.querySelector(`[data-conversation-id="${id}"]`);
            const button = [
              ...(chat?.querySelectorAll<HTMLButtonElement>('.chat-toolbar button') ?? []),
            ].find((button) => button.textContent?.trim() === 'Canvas');
            if (!button) throw new Error('The linked conversation has no Canvas control.');
            button.click();
          }, fork.id),
        );
      }
      assert.ok(conversation.canvasID);
    }
    assert.ok(conversation.canvasID);
    const before = (
      await main.evaluate(
        pageCall((id) => window.viewer.canvas({ kind: 'read', id }), conversation.canvasID),
      )
    ).document;
    const beforeModel = before;
    if (values.preflight) {
      assert.ok(plan.starter, 'Prepare a run with the reusable plugin.');
      assert.equal(digest(before.html), plan.starter.htmlHash);
      assert.equal(
        before.assets.find((asset) => asset.name === 'robotics.js')?.hash,
        plan.starter.libraryHash,
      );
      assert.equal(before.sources.length, 2);
      assert.equal(before.assets.length, 14);
      assert.ok(before.sources.every((source) => source.data.coverage.content === 'complete'));
      assert.ok(before.sources.every((source) => !('robot' in source.data)));
      const frame = await canvasFrame(main, before.id);
      const imports = await frame.evaluate(
        pageCall(
          () =>
            JSON.parse(
              document.querySelector<HTMLScriptElement>('script[type="importmap"]')!.textContent!,
            ).imports as Record<string, string>,
        ),
      );
      assert.deepEqual(Object.keys(imports).sort(), ['three', 'three/addons/']);
      assert.equal((await ledger.sessions()).length, 0);
      await saveEvidence(path.join(root, 'preflight.json'), {
        status: 'passed',
        providerRequests: 0,
        profile,
        sourceSnapshots: before.sources.length,
        assets: before.assets.length,
        imports,
        checks: [
          'Existing robotics plugin opened in the packaged generic host',
          'Domain library attached as an explicit plugin asset',
          'Raw sources retained without robotics interpretation',
          'Only generic graphics imports exposed',
          'No provider request or session started',
        ],
      });
      console.log(JSON.stringify({ root, status: 'preflight-passed', providerRequests: 0 }));
      return;
    }
    if (values.qualify) {
      const saved = (await readRobotSessionResult(previous.at(-1)!)) as { canvas: CanvasDocument };
      assert.equal(
        before.html,
        saved.canvas.html,
        'Offline review cannot substitute local code for Meta output.',
      );
      assert.equal(before.revision, saved.canvas.revision);
      assert.deepEqual(before.assets, saved.canvas.assets);
      assert.deepEqual(before.sources, saved.canvas.sources);
    }
    let evidence: string;
    let stageStarted: number;
    if (!values.qualify) {
      session = values.resume
        ? await ledger.resume(
            stage,
            values['repair-reason']
              ? {
                  canvasID: before.id,
                  revision: before.revision,
                  htmlHash: digest(before.html),
                  message: values['repair-reason'],
                }
              : undefined,
          )
        : await ledger.begin(stage, {
            execution: 'live-meta-native',
            model: plan.provider.model,
            prompt: plan.prompts[stage],
            conversationID: conversation.id,
          });
      const sessionNumber = previous.length + (values.resume ? 0 : 1);
      stageStarted = JSON.parse(
        await readFile(path.join(session.folder, 'started.json'), 'utf8'),
      ).at;
      evidence = values.resume
        ? path.join(
            session.folder,
            'continuations',
            (await readdir(path.join(session.folder, 'continuations'))).sort().at(-1)!,
          )
        : session.folder;
      const prompt = values.resume
        ? await readFile(values.resume, 'utf8')
        : plan.prompts[stage] +
          (values.guidance ? '\n\n' + (await readFile(values.guidance, 'utf8')) : '');
      await saveEvidence(path.join(evidence, 'prompt.json'), { text: prompt });
      await writeFile(
        path.join(root, 'active-session.json'),
        JSON.stringify({ session: sessionNumber }),
        { mode: 0o600 },
      );
      const response = await main.evaluate(
        pageCall(
          (id, providerID, text) => window.viewer.chat({ kind: 'send', id, providerID, text }),
          conversation.id,
          plan.provider.id,
          prompt,
        ),
      );
      assert.ok(!Array.isArray(response));
      conversation = response;
      const deadline = Date.now() + 9 * 60_000;
      let lastCount = 0;
      while (conversation.status === 'running' && Date.now() < deadline) {
        await delay(800);
        const next: ChatReply = await main.evaluate(
          pageCall((id) => window.viewer.chat({ kind: 'open', id }), conversation.id),
        );
        assert.ok(!Array.isArray(next));
        conversation = next;
        const count = (await readdir(session.folder)).filter((n) =>
          /^request-\d{2}\.json$/.test(n),
        ).length;
        if (count !== lastCount)
          console.log(JSON.stringify({ stage, requests: count, status: conversation.status }));
        lastCount = count;
      }
      if (conversation.status === 'running') {
        const stopped = await main.evaluate(
          pageCall((id) => window.viewer.chat({ kind: 'stop', id }), conversation.id),
        );
        assert.ok(!Array.isArray(stopped));
        conversation = stopped;
      }
    } else {
      evidence = await temporaryRoot('viewer-review-', previous.at(-1)!);
      stageStarted = JSON.parse(
        await readFile(path.join(previous.at(-1)!, 'started.json'), 'utf8'),
      ).at;
    }
    canvas = (
      await main.evaluate(
        pageCall((id) => window.viewer.canvas({ kind: 'read', id }), conversation.canvasID!),
      )
    ).document;
    await saveEvidence(path.join(evidence, 'before.json'), before);
    await saveEvidence(path.join(evidence, 'conversation.json'), conversation);
    await saveEvidence(path.join(evidence, 'canvas.json'), canvas);
    await delay(1000);
    await screenshot(main, path.join(evidence, 'native.png'));
    if (!values.qualify)
      assert.equal(conversation.status, 'idle', conversation.error ?? 'The live turn must finish.');
    else
      assert.notEqual(conversation.status, 'running', 'Finish or stop the turn before reviewing.');
    assert.ok(canvas.html.trim(), 'Meta must write an actual interface.');
    if (!values.qualify && stage !== 'branch')
      assert.notEqual(canvas.html, beforeModel.html, 'Meta must produce a new revision.');
    const activity = conversation.messages
      .filter((message) => message.role === 'tool' && message.at >= stageStarted)
      .map((message) => message.text);
    assert.ok(
      activity.some((text) => text.includes('"actorKind":"model"') && text.includes('"completed"')),
      'Meta must successfully invoke a registered action.',
    );
    assert.doesNotMatch(canvas.html, /viewer\/robotics|requestRobotCheck|requestPlacementCheck/);
    generated = true;
    const selected = stage === 'create' ? 'central' : stage === 'refine' ? 'front' : 'rear';
    const modelActions = activity
      .map((text) => JSON.parse(text))
      .filter(
        (event) =>
          event.actorKind === 'model' &&
          event.status === 'completed' &&
          event.canvasID === canvas!.id &&
          event.revision === canvas!.revision,
      );
    assert.ok(
      modelActions.some(
        (event) => event.action === 'select' && event.result?.selected === selected,
      ),
      'Meta must select this mount through the current revision, not an earlier tool.',
    );
    if (stage !== 'branch')
      assert.ok(
        modelActions.some((event) => event.action === 'evaluate'),
        'Meta must evaluate the current revision.',
      );
    assert.equal(
      canvas.state.selected,
      selected,
      'The model must select through its generated handler.',
    );
    const generatedStudy = stationStudySchema.parse(canvas.state.study);
    assert.equal(generatedStudy.recommended, stage === 'create' ? 'central' : 'front');
    const invoke = async (action: string, input: CanvasActionInput) => {
      const current = await main!.evaluate(
        pageCall((id) => window.viewer.canvas({ kind: 'read', id }), canvas!.id),
      );
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
          current.document.id,
          current.document.revision,
          current.document.stateRevision,
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
    const report = await reviewStationPlugin(
      invoke,
      await readFile(path.join(plan.project, 'Simulation/SO101/so101_new_calib.urdf'), 'utf8'),
      JSON.parse(await readFile(path.join(plan.project, 'station.json'), 'utf8')),
      stage !== 'create',
    );
    const after = (
      await main.evaluate(pageCall((id) => window.viewer.canvas({ kind: 'read', id }), canvas.id))
    ).document;
    assert.equal(after.state.selected, selected, 'External probes must preserve the selection.');
    if (stage !== 'create' && !values.qualify) {
      assert.deepEqual(
        after.state.camera,
        beforeModel.state.camera,
        'Camera inputs must survive the revision.',
      );
      assert.deepEqual(
        after.state.ui,
        beforeModel.state.ui,
        'Joint inputs must survive the revision.',
      );
    }
    if (stage === 'branch') {
      const unchanged = (
        await main.evaluate(
          pageCall((id) => window.viewer.canvas({ kind: 'read', id }), plan.canvasID),
        )
      ).document;
      assert.ok(original);
      assert.equal(unchanged.html, original.html);
      assert.deepEqual(unchanged.state, original.state);
      await saveEvidence(path.join(evidence, 'original.json'), unchanged);
    }
    const qualification = {
      ...report,
      actor: 'external acceptance harness, not Viewer or Meta',
      canvasID: canvas.id,
      revision: canvas.revision,
      htmlHash: digest(canvas.html),
      conversationStatus: conversation.status,
      conversationError: conversation.error,
      finalReply: conversation.messages.some(
        (message) => message.role === 'assistant' && message.at >= stageStarted,
      ),
      providerRequests: (await readdir(session?.folder ?? previous.at(-1)!)).filter((name) =>
        /^request-\d{2}\.json$/.test(name),
      ).length,
    };
    await saveEvidence(path.join(evidence, 'qualification.json'), qualification);
    const stageFolder = session?.folder ?? previous.at(-1)!;
    if (stageFolder !== evidence && !(await readdir(stageFolder)).includes('qualification.json'))
      await saveEvidence(path.join(stageFolder, 'qualification.json'), qualification);
    await screenshot(main, path.join(evidence, 'reviewed.png'));
  } catch (error) {
    failure = String(error);
    console.error(JSON.stringify({ stage, failure }));
  } finally {
    try {
      await app.close(main);
    } catch (error) {
      failure = [failure, String(error)].filter(Boolean).join('\n');
    }
    if (session)
      await session.finish({
        status: generated ? 'generated' : 'failed',
        stage,
        failure,
        conversationID: conversation.id,
        canvasID: canvas?.id,
        canvas,
      });
    for (const [name, hash] of Object.entries(plan.protectedHashes))
      assert.equal(
        await hashFile(path.join(plan.protectedProfile, name)),
        hash,
        'The source credential profile was modified.',
      );
  }
  console.log(
    JSON.stringify({
      root,
      stage,
      folder: session?.folder,
      status: failure ? 'failed' : 'passed',
      failure,
    }),
  );
  if (failure) process.exitCode = 1;
}

if (values.authorize) {
  assert.ok(values.run, 'Choose the prepared run.');
  const root = await realpath(values.run);
  const grant = JSON.parse(await readFile(values.authorize, 'utf8'));
  await authorizeStationRun(root, grant);
  console.log(JSON.stringify({ root, status: 'authorized', providerRequests: 0 }));
} else if (values.prepare) await prepare();
else await live();
