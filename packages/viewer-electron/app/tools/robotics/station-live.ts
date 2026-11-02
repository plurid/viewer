/** Explicit live qualification in the real desktop renderer. All evidence is retained. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { parse } from 'jsonc-parser';
import { Canvases } from '../../src/desktop/canvases/service';
import { attachRobotMeshes } from '../../src/desktop/canvases/robot';
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

const prompts: Record<RobotStage, string> = {
  create:
    "Build a placement tool from this robot and station brief. Test the mounting points and tell me which one needs the smallest move. Use the attached snapshots and meshes. Show the bench, two trays, six labeled targets and the articulated robot. Register actions to evaluate all four mounting points and select one; wire the visible buttons to those same handlers. Invoke the evaluation yourself, request Viewer's independent placement check, then select and recheck the least-movement passing candidate. Keep one stable study state key and preserve camera inputs. Do not add reserved-area controls yet. Explain only results you received from the tools.",
  refine:
    'Reserve the central mounting area: X 140 to 260 mm, Y 120 to 240 mm. Add a control and bench overlay for this mounting-point restriction. Keep the same robot, tray targets and 1 mm endpoint tolerance. Revise the existing tool, run its evaluation, request the independent check, then select and check the least-movement passing candidate. Preserve the camera and other inputs.',
  branch:
    "Compare the rear mounting point with the front mounting point. Use the same robot, targets and reserved area. Select Rear in this alternative through its registered action, check the saved poses in Viewer and explain the measured tradeoff. Do not change the source brief or the original conversation's inputs.",
};
const { values } = parseArgs({
  options: {
    prepare: { type: 'boolean' },
    live: { type: 'boolean' },
    serve: { type: 'boolean' },
    run: { type: 'string' },
    stage: { type: 'string' },
    binary: { type: 'string' },
    corpus: { type: 'string' },
    profile: { type: 'string' },
    resume: { type: 'string' },
    'verify-selection': { type: 'boolean' },
    guidance: { type: 'string' },
    'repair-reason': { type: 'string' },
  },
});
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.equal(
  Number(!!values.prepare) + Number(!!values.live) + Number(!!values.serve),
  1,
  'Choose prepare, live or serve.',
);
const fixture = (name: string) => new URL('../../tests/fixtures/robotics/' + name, import.meta.url);
type Plan = {
  provider: ModelProvider;
  conversationID: string;
  canvasID: string;
  sourceID: string;
  briefSourceID: string;
  project: string;
  prompts: typeof prompts;
  protectedProfile: string;
  protectedHashes: Record<string, string>;
};

async function prepare(): Promise<string> {
  assert.ok(values.corpus);
  const sourceProfile = await realpath(
    values.profile ?? path.join(os.homedir(), 'Library/Application Support/Viewer'),
  );
  const root = await realpath(await temporaryRoot('viewer-station-meta-', '/private/tmp'));
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
  const meshes = await attachRobotMeshes(
    service,
    1,
    canvas.id,
    source.source,
    async (file) => {
      assert.ok((await realpath(file)).startsWith(project + path.sep));
      return file;
    },
    new AbortController().signal,
  );
  const brief = await service.source(
    1,
    canvas.id,
    meshes.revision,
    await inspectFile(briefPath, { content: true }),
  );
  await service.state(1, canvas.id, 0, brief.revision, { robotResources: meshes.resources });
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
    provider,
    conversationID: canvas.conversationID,
    canvasID: canvas.id,
    sourceID: source.source.id,
    briefSourceID: brief.source.id,
    project,
    prompts,
    protectedProfile: sourceProfile,
    protectedHashes,
  };
  await saveEvidence(path.join(root, 'plan.json'), plan);
  await new RobotRehearsalLedger(root).authorize({ sessions: 3, requestsPerSession: 8 });
  await saveEvidence(path.join(root, 'authorization.json'), {
    approval: 'Allow three sessions, up to 24 requests',
    scope:
      'Creation, changed mounting constraint, quoted alternative; eight requests per session. Failed and canceled requests count.',
    at: new Date().toISOString(),
  });
  console.log(
    JSON.stringify({ root, status: 'prepared', provider: provider.model, providerRequests: 0 }),
  );
  return root;
}

async function live(): Promise<void> {
  assert.ok(values.run && values.binary && values.stage);
  assert.ok(['create', 'refine', 'branch'].includes(values.stage));
  const stage = values.stage as RobotStage;
  const root = await realpath(values.run);
  adoptRetainedNativeFixture(root);
  const plan = JSON.parse(await readFile(path.join(root, 'plan.json'), 'utf8')) as Plan;
  assert.deepEqual(plan.prompts, prompts, 'The prepared prompts must be unchanged.');
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
    ['create', 'refine', 'branch'].indexOf(stage) + (values.resume ? 1 : 0),
    'Review each stage before moving on.',
  );
  if (previous.length && !values.resume) {
    const lastResult = (await readRobotSessionResult(previous.at(-1)!)) as { status: string };
    assert.equal(lastResult.status, 'generated', 'The preceding continuation must finish.');
    const review = JSON.parse(
      await readFile(path.join(previous.at(-1)!, 'qualification.json'), 'utf8'),
    );
    assert.equal(review.status, 'passed', 'The prior live stage has not passed native review.');
  }
  const profile = path.join(root, 'Profile');
  const resumed = values.resume
    ? ((await readRobotSessionResult(previous.at(-1)!)) as { conversationID: string })
    : undefined;
  const baseChat = (await new ChatDocumentStore(
    path.join(
      profile,
      'chat-documents',
      (resumed?.conversationID ?? plan.conversationID) + '.json',
    ),
  ).load())!;
  assert.ok(baseChat && (baseChat.status === 'idle' || values.resume));
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
    mode: 'hidden',
    label: 'station-live',
    environment: { VIEWER_STATION_RUN: root },
  });
  let main: Awaited<ReturnType<typeof app.connect>> | undefined;
  let session: Awaited<ReturnType<RobotRehearsalLedger['begin']>> | undefined;
  let conversation: ChatDocument = baseChat;
  let canvas: CanvasDocument | undefined;
  let original: CanvasDocument | undefined;
  let failure: string | undefined;
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
      if (!values.resume) {
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
      const frame = await canvasFrame(main, conversation.canvasID);
      await until(
        () => frame.evaluate(pageCall(() => !!document.querySelector('#bSelect'))),
        Boolean,
        'generated alternative controls',
      );
    }
    assert.ok(conversation.canvasID);
    if (stage === 'refine' && !values.resume) {
      const frame = await canvasFrame(main, conversation.canvasID);
      const viewport = await frame.evaluate(
        pageCall(() => {
          const joint = document.querySelector<HTMLInputElement>('[aria-label="gripper"]');
          if (!joint) throw new Error('The generated joint control is missing.');
          joint.value = '0.1';
          joint.dispatchEvent(new Event('input', { bubbles: true }));
          const canvas = [...document.querySelectorAll('canvas')].sort(
            (a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight,
          )[0];
          if (!canvas) throw new Error('The generated robot viewport is missing.');
          const box = canvas.getBoundingClientRect();
          return {
            x: box.x + box.width / 2,
            y: box.y + box.height / 2,
            gripper: Number(joint.value),
          };
        }),
      );
      await main.command(
        'Input.dispatchMouseEvent',
        {
          type: 'mousePressed',
          x: viewport.x,
          y: viewport.y,
          button: 'left',
          clickCount: 1,
        },
        frame.sessionId,
      );
      for (let step = 1; step <= 12; step++)
        await main.command(
          'Input.dispatchMouseEvent',
          { type: 'mouseMoved', x: viewport.x + step * 4, y: viewport.y + step, buttons: 1 },
          frame.sessionId,
        );
      await main.command(
        'Input.dispatchMouseEvent',
        {
          type: 'mouseReleased',
          x: viewport.x + 48,
          y: viewport.y + 12,
          button: 'left',
          clickCount: 1,
        },
        frame.sessionId,
      );
      await until(
        async () => {
          const { document } = await main!.evaluate(
            pageCall((id) => window.viewer.canvas({ kind: 'read', id }), conversation.canvasID!),
          );
          return (
            !!document.state.camera &&
            (document.state.ui as { joints?: { gripper?: number } })?.joints?.gripper ===
              viewport.gripper
          );
        },
        Boolean,
        'saved camera and joint inputs',
      );
    }
    const before = (
      await main.evaluate(
        pageCall((id) => window.viewer.canvas({ kind: 'read', id }), conversation.canvasID),
      )
    ).document;
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
          prompt: prompts[stage],
          conversationID: conversation.id,
        });
    const sessionNumber = previous.length + (values.resume ? 0 : 1);
    const evidence = values.resume
      ? path.join(
          session.folder,
          'continuations',
          (await readdir(path.join(session.folder, 'continuations'))).sort().at(-1)!,
        )
      : session.folder;
    const prompt = values.resume
      ? await readFile(values.resume, 'utf8')
      : prompts[stage] +
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
    assert.equal(conversation.status, 'idle', conversation.error ?? 'The live turn must finish.');
    if (values['verify-selection']) {
      assert.equal(stage, 'create');
      const frame = await canvasFrame(main, canvas.id);
      await frame.evaluate(
        pageCall(() => {
          const select = document.querySelector<HTMLSelectElement>('#selMount');
          const button = document.querySelector<HTMLButtonElement>('#bSelect');
          if (!select || !button) throw new Error('The reviewed selection control changed.');
          select.value = 'central';
          select.dispatchEvent(new Event('change', { bubbles: true }));
          button.click();
        }),
      );
      await delay(500);
      await frame.evaluate(
        pageCall(() => document.querySelector<HTMLButtonElement>('#bCheck')!.click()),
      );
      await delay(500);
      canvas = (
        await main.evaluate(pageCall((id) => window.viewer.canvas({ kind: 'read', id }), canvas.id))
      ).document;
      await saveEvidence(path.join(evidence, 'operator-selection.json'), {
        actor: 'native UI acceptance',
        control: 'select Central, then Check',
        note: 'This interaction verifies the generated control; it is not attributed to Meta.',
        canvas,
      });
      await screenshot(main, path.join(evidence, 'selected.png'));
    }
    assert.ok(canvas.html.trim(), 'Meta must write an actual interface.');
    const activity = conversation.messages.filter((m) => m.role === 'tool').map((m) => m.text);
    assert.ok(
      activity.some((text) => text.includes('"actorKind":"model"') && text.includes('"completed"')),
      'Meta must successfully invoke a registered action.',
    );
    const checked = await main.evaluate(
      pageCall((id) => window.viewer.canvas({ kind: 'placement-report', id }), canvas.id),
    );
    assert.equal(
      checked.placementReport?.status,
      'checked',
      'Meta must request an independent check.',
    );
    const report = checked.placementReport!;
    assert.ok(report.status === 'checked');
    assert.deepEqual(
      report.candidates.map((c) => c.reached),
      [3, 6, 6, 6],
    );
    assert.equal(report.recommended, stage === 'create' ? 'central' : 'front');
    assert.equal(
      report.input.selected,
      stage === 'create' ? 'central' : stage === 'refine' ? 'front' : 'rear',
    );
    assert.equal(report.input.reserved.length, stage === 'create' ? 0 : 1);
    if (stage !== 'create') {
      assert.ok(before.state.camera, 'A real camera input must exist before the revision.');
      assert.equal(
        JSON.stringify(canvas.state.camera),
        JSON.stringify(before.state.camera),
        'Camera inputs must survive.',
      );
      assert.deepEqual(
        (canvas.state.ui as { joints?: unknown })?.joints,
        (before.state.ui as { joints?: unknown })?.joints,
        'Joint inputs must survive.',
      );
    }
    if (stage === 'refine')
      assert.notEqual(canvas.html, before.html, 'Meta must revise the interface.');
    if (stage === 'branch') {
      const unchanged = (
        await main.evaluate(
          pageCall((id) => window.viewer.canvas({ kind: 'read', id }), plan.canvasID),
        )
      ).document;
      assert.ok(original);
      assert.equal(unchanged.html, original.html, 'The original tool must remain unchanged.');
      assert.deepEqual(
        unchanged.state,
        original.state,
        'The original inputs must remain unchanged.',
      );
      await saveEvidence(path.join(session.folder, 'original.json'), unchanged);
      const comparison = await main.evaluate(
        pageCall((id) => window.viewer.canvas({ kind: 'placement-comparison', id }), canvas.id),
      );
      assert.equal(comparison.placementComparison?.status, 'compared');
      await saveEvidence(
        path.join(session.folder, 'comparison.json'),
        comparison.placementComparison,
      );
    }
    const qualificationFolder = (await readdir(session.folder)).includes('qualification.json')
      ? evidence
      : session.folder;
    await saveEvidence(path.join(qualificationFolder, 'qualification.json'), {
      status: 'passed',
      report,
      checks: [
        'actual Meta HTML',
        'registered action invocation',
        'independent placement check',
        'selected candidate',
      ],
      providerRequests: (await readdir(session.folder)).filter((n) =>
        /^request-\d{2}\.json$/.test(n),
      ).length,
    });
  } catch (error) {
    failure = String(error);
  } finally {
    await app.close(main);
    if (session)
      await session.finish({
        status: failure ? 'failed' : 'generated',
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

if (values.serve) {
  assert.ok(values.binary && values.corpus);
  values.run = await prepare();
  console.log(
    'Ready. Enter create, refine or branch after reviewing the preceding stage; quit exits.',
  );
  for await (const line of createInterface({ input: process.stdin })) {
    const stage = line.trim();
    if (stage === 'quit') break;
    if (!['create', 'refine', 'branch'].includes(stage)) {
      console.log('Expected create, refine, branch or quit.');
      continue;
    }
    values.stage = stage;
    await live();
  }
} else await (values.prepare ? prepare() : live());
