import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chatDocumentSchema, chatStepSchema } from '../../src/domain/models/chat';
import type { ChatStep } from '../../src/domain/models/chat';
import { canvasDocumentSchema } from '../../src/domain/canvases/document';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { ModelPermissions } from '../../src/desktop/models/model-permissions';
import { temporaryRoot } from '../temporary';
import { digest, saveEvidence } from './rehearsal';
import { presentInitialStationHTML, presentStationHTML } from './station-presentation';

async function copyTree(source: string, destination: string) {
  const info = await lstat(source);
  assert.ok(!info.isSymbolicLink(), 'Film inputs must not be links.');
  if (info.isDirectory()) {
    await mkdir(destination);
    for (const name of await readdir(source))
      await copyTree(path.join(source, name), path.join(destination, name));
  } else {
    assert.ok(info.isFile() && info.size < 32_000_000);
    await copyFile(source, destination, 1);
  }
}

const json = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
export async function stationFilmSession(runPath: string) {
  assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
  assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
  const run = await realpath(runPath);
  const summary = await json(path.join(run, 'qualification-summary.json'));
  assert.equal(summary.status, 'functionally-qualified-with-operator-selection');
  const root = await realpath(await temporaryRoot('viewer-station-film-', '/private/tmp'));
  const profile = path.join(root, 'Profile');
  const project = path.join(root, 'Six-slot station');
  await mkdir(profile);
  await copyTree(path.join(run, 'Six-slot station'), project);
  await copyTree(path.join(run, 'Profile/canvas-assets'), path.join(profile, 'canvas-assets'));
  await mkdir(path.join(profile, 'canvas-documents'));
  await mkdir(path.join(profile, 'chat-documents'));
  await mkdir(path.join(root, 'Handoff'));
  const creation = canvasDocumentSchema.parse(
    await json(path.join(run, 'sessions/01/continuations/02/canvas.json')),
  );
  const refinement = canvasDocumentSchema.parse(
    await json(path.join(run, 'sessions/02/continuations/01/canvas.json')),
  );
  const creationChat = chatDocumentSchema.parse(
    await json(path.join(run, 'sessions/01/continuations/02/conversation.json')),
  );
  const refinementChat = chatDocumentSchema.parse(
    await json(path.join(run, 'sessions/02/continuations/01/conversation.json')),
  );
  const branchChat = chatDocumentSchema.parse(
    await json(path.join(run, 'sessions/03/continuations/02/conversation.json')),
  );
  const html = {
    create: presentInitialStationHTML(creation.html, refinement.html),
    refine: presentStationHTML(refinement.html),
  };
  for (const stage of ['create', 'refine'] as const) {
    await writeFile(
      path.join(root, stage + '.provider.html'),
      stage === 'create' ? creation.html : refinement.html,
      { flag: 'wx' },
    );
    await writeFile(path.join(root, stage + '.presentation.html'), html[stage], { flag: 'wx' });
  }
  const before = canvasDocumentSchema.parse(await json(path.join(run, 'sessions/01/before.json')));
  const initial = {
    ...before,
    path: project,
    sources: before.sources.map((s) => ({
      ...s,
      path: s.path?.replace(path.join(run, 'Six-slot station'), project),
    })),
  };
  await saveEvidence(path.join(profile, 'canvas-documents', initial.id + '.json'), initial);

  let queue: { file: string; stage: 'create' | 'refine' | 'branch' }[] = [];
  let release: (() => void) | undefined;
  let pending = false;
  let completed = 0;
  let localRequests = 0;
  const events: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><meta charset="utf-8"><title>Station brief</title><style>body{margin:64px;background:#292d34;color:#f2f4f6;font:19px/1.6 system-ui}main{max-width:760px;margin:auto}h1{font-size:36px;font-weight:600}p,td{color:#b1bac6}table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #454b55;padding:12px 0}</style><main><p>SO-101 / Fictional station</p><h1>Where should the arm go?</h1><p>Choose a mounting point that reaches all six tray slots with the smallest move.</p><table><tr><td>Bench</td><td>600 × 400 mm</td></tr><tr><td>Work</td><td>Two trays, six fixed targets</td></tr><tr><td>Choices</td><td>Existing, Central, Front, Rear</td></tr><tr><td>Endpoint tolerance</td><td>1 mm</td></tr></table></main>',
      );
      return;
    }
    try {
      assert.equal(req.method, 'POST');
      assert.equal(req.url, '/v1/chat/completions');
      const item = queue.shift();
      assert.ok(item && !pending, 'No unrecorded steps or concurrent calls in film replay.');
      const parts: Buffer[] = [];
      let length = 0;
      for await (const data of req) {
        length += data.length;
        assert.ok(length < 2_000_000);
        parts.push(data);
      }
      const input = JSON.parse(Buffer.concat(parts).toString());
      const context = JSON.parse(
        input.messages.find((m: { role: string }) => m.role === 'user').content,
      );
      assert.ok(context.canvas && Number.isInteger(context.canvas.revision));
      const envelope = (await json(item.file)).envelope;
      const message = envelope.choices[0].message;
      const raw: ChatStep = chatStepSchema.parse(
        JSON.parse(message.tool_calls?.[0]?.function.arguments ?? message.content),
      );
      const step = structuredClone(raw);
      const adaptations: string[] = [];
      if (step.kind === 'canvas_write') {
        assert.ok(item.stage !== 'branch');
        step.text = html[item.stage];
        step.commandID = String(context.canvas.revision);
        adaptations.push(
          'Qualified final revision with separately retained local presentation edits',
          'Current content revision',
        );
      } else if (step.kind === 'canvas_invoke') {
        const arguments_ = JSON.parse(step.text);
        arguments_.revision = context.canvas.revision;
        arguments_.stateRevision = context.canvas.stateRevision;
        step.text = JSON.stringify(arguments_);
        adaptations.push('Current content and input revisions');
      }
      // The local adapter carries the retained step as JSON. Cloud endpoint validation stays intact.
      message.content = JSON.stringify(step);
      message.tool_calls = undefined;
      envelope.choices[0].finish_reason = 'stop';
      adaptations.push('Local JSON replay envelope, no cloud transport');
      pending = true;
      events.push({
        localRequest: ++localRequests,
        source: path.relative(run, item.file),
        sourceHash: digest(await readFile(item.file, 'utf8')),
        kind: step.kind,
        adaptations,
        responseHash: digest(JSON.stringify(envelope)),
      });
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      if (step.kind === 'canvas_invoke') {
        const latest = canvasDocumentSchema.parse(
          await json(path.join(profile, 'canvas-documents', context.canvas.id + '.json')),
        );
        const current = JSON.parse(step.text);
        current.revision = latest.revision;
        current.stateRevision = latest.stateRevision;
        step.text = JSON.stringify(current);
        message.content = JSON.stringify(step);
        events.at(-1)!.responseHash = digest(JSON.stringify(envelope));
        events.at(-1)!.dispatchRevisions = {
          revision: latest.revision,
          stateRevision: latest.stateRevision,
        };
      }
      pending = false;
      release = undefined;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(envelope));
      completed++;
    } catch (error) {
      events.push({ error: String(error) });
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Saved-response replay failed.' }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const endpoint = 'http://127.0.0.1:' + address.port;
  const provider = {
    id: randomUUID(),
    kind: 'local' as const,
    name: 'Meta',
    endpoint: endpoint + '/v1',
    model: 'muse-spark-1.3',
    allowContent: true,
  };
  const settings = defaultSettings(project);
  settings.providers = [provider];
  settings.prompts.providerID = provider.id;
  settings.hotkey.enabled = false;
  settings.terminals.profiles = [
    { id: 'login', name: 'Login shell', executable: '', args: [], env: {} },
  ];
  settings.terminals.profileID = 'login';
  settings.terminalFont = { ...settings.terminalFont, fontSize: 17 };
  await saveEvidence(path.join(profile, 'config.jsonc'), {
    version: 1,
    settings,
    ui: normalizePreferences(),
  });
  const permissions = new ModelPermissions(profile, () => [provider]);
  await permissions.set(provider, 'images');
  await permissions.allowAgents(provider, true);
  const conversation = chatDocumentSchema.parse({
    ...creationChat,
    path: project,
    providerID: provider.id,
    scopes: [
      path.join(project, 'Simulation/SO101/so101_new_calib.urdf'),
      path.join(project, 'station.json'),
    ].map((path) => ({ path, directory: false })),
    messages: [],
    status: 'idle',
    error: undefined,
    draft: '',
    revision: 0,
    level: 'images',
  });
  await saveEvidence(path.join(profile, 'chat-documents', conversation.id + '.json'), conversation);
  const sequences = {
    create: ['01/06', '01/04', '01/07', '01/08'],
    refine: ['02/07', '02/02', '02/03', '02/04', '02/05', '02/08'],
    branch: ['03/02', '03/03', '03/04'],
  };
  return {
    root,
    profile,
    project,
    endpoint,
    provider,
    initial,
    creation,
    refinement,
    creationChat,
    refinementChat,
    branchChat,
    html,
    events,
    get pending() {
      return pending;
    },
    get completed() {
      return completed;
    },
    get localRequests() {
      return localRequests;
    },
    arm(stage: keyof typeof sequences) {
      assert.equal(queue.length, 0);
      assert.ok(!pending);
      queue = sequences[stage].map((value) => {
        const [session, index] = value.split('/');
        return {
          stage,
          file: path.join(run, 'sessions', session!, 'request-' + index + '-response.json'),
        };
      });
    },
    release() {
      assert.ok(release, 'Wait for the next retained step.');
      release();
    },
    async close() {
      release?.();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
