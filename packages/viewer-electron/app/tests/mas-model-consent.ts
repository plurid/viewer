// Signed sandbox model-consent regression with a generated loopback endpoint, never a paid provider.
import type { Socket, AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createFixtures } from './fixtures';
import { defaultSettings } from '../src/domain/services';
import { normalizePreferences } from '../src/domain/preferences/ui';
import { ownedApp, until } from './owned-app';
import { trashTemporary } from '../tools/temporary';

const bundle = process.env.VIEWER_TEST_MAS_BUNDLE!,
  evidence = process.env.VIEWER_MODEL_EVIDENCE!;
assert.ok(bundle && evidence);
const fixture = await createFixtures(),
  id = randomUUID();
const profile = path.join(
  os.homedir(),
  'Library/Containers/com.pluridviewer.app/Data/Library/Application Support/Viewer',
  'mas-model-qualification-' + id,
);
const documents = path.join(profile, 'generated-documents'),
  file = path.join(documents, 'Generated model consent.txt');
await mkdir(documents, { recursive: true, mode: 0o700 });
const marker = 'VIEWER_GENERATED_PRIVATE_TEXT_' + id;
await writeFile(file, marker + '\nGenerated model-consent qualification text.\n', { mode: 0o600 });
const original = createHash('sha256')
  .update(await readFile(file))
  .digest('hex');
const folder = fixture.state.workspaces[0].panes[0];
assert.ok(folder.type === 'folder');
folder.path = documents;
folder.history = [documents];
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(fixture.state), {
  mode: 0o600,
});
await writeFile(
  path.join(profile, 'settings-v1.json'),
  JSON.stringify({
    version: 1,
    revision: 0,
    settings: defaultSettings(documents),
    ui: normalizePreferences(fixture.state.ui),
  }),
  { mode: 0o600 },
);
type ObservedPlan = { status: string; error?: string };
const requests: { url: string; body: unknown; mode: string; aborted?: boolean }[] = [];
let mode = 'success';
const sockets = new Set<Socket>();
const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) {
    body += String(chunk);
    if (body.length > 1000000) {
      req.destroy();
      return;
    }
  }
  const recorded = { url: req.url!, body: JSON.parse(body || '{}'), mode, aborted: false };
  requests.push(recorded);
  if (mode === 'slow') {
    res.on('close', () => {
      recorded.aborted = true;
    });
    return;
  }
  if (mode === 'rate-limit') {
    res.writeHead(429, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Generated rate limit' }));
    return;
  }
  if (mode === 'invalid') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('Generated invalid JSON');
    return;
  }
  const proposal = {
    rows: [
      {
        sourceID: '0',
        destination: 'Reviewed model consent.txt',
        summary: '',
        fields: { year: null, authors: null, title: null, publisher: null },
        evidence: [],
      },
    ],
  };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(proposal) } }],
    }),
  );
});
server.on('connection', (socket) => {
  sockets.add(socket);
  socket.once('close', () => sockets.delete(socket));
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const endpoint = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/v1';
const provider = {
  id: 'generated-native-model',
  name: 'Generated local endpoint',
  kind: 'local',
  endpoint,
  model: 'qualification',
  allowContent: true,
};
const recipe = (data: string) => ({
  id: 'generated-native-recipe',
  name: 'Generated rename',
  kind: 'rename',
  formats: ['txt'],
  recursive: false,
  instructions: 'Rename only this generated fixture.',
  template: '{name}{extension}',
  providerID: provider.id,
  data,
});
const results: { scenario: string; result: string; details?: unknown }[] = [];
let app: Awaited<ReturnType<typeof ownedApp>> | undefined;
let main: Awaited<ReturnType<Awaited<ReturnType<typeof ownedApp>>['connect']>> | undefined;
let quit = false;
try {
  app = await ownedApp(path.join(bundle, 'Contents/MacOS/Viewer'), profile);
  main = await app.connect();
  const { evaluate } = main;
  await until(
    () => evaluate('!!window.viewer && !!document.querySelector(".folder-explorer")'),
    Boolean,
    'Signed model workspace',
  );
  const patch = async (patches: unknown[]) =>
    evaluate(
      `window.viewer.settingsGet().then(s=>window.viewer.settingsPatch(${JSON.stringify(patches)},s.revision))`,
    );
  await patch([
    { path: 'settings.providers', value: [provider] },
    { path: 'settings.recipes', value: [recipe('names')] },
  ]);
  const begin = () =>
    evaluate<string>(
      `window.viewer.actionStart(${JSON.stringify({ recipeID: 'generated-native-recipe', context: { workspaceID: 'fixture-workspace', rootID: 'fixture-folder', paneID: 'fixture-folder', sources: [file], actor: 'user' } })})`,
    );
  const plan = async (id: string) =>
    until(
      () => evaluate<ObservedPlan>(`window.viewer.actionGet(${JSON.stringify(id)})`),
      (p) => ['review', 'failed', 'cancelled'].includes(p.status),
      'Finished generated model plan',
    );
  const permission = async (level: string | null) =>
    evaluate(
      `window.viewer.providerPermissionSet(${JSON.stringify(provider.id)},${JSON.stringify(provider.endpoint)},${JSON.stringify(level)})`,
    );
  async function check(scenario: string, run: () => Promise<unknown>) {
    const details = await run();
    results.push({ scenario, result: 'passed', details });
    console.log(scenario + ': passed');
  }
  await check('No private approval: zero file-data requests', async () => {
    const p = await plan(await begin());
    assert.equal(p.status, 'failed');
    assert.match(p.error || '', /Allow this provider/);
    assert.equal(requests.length, 0);
  });
  await permission('names');
  await check('Filenames only: signed outgoing HTTP and reviewed proposal', async () => {
    const p = await plan(await begin());
    assert.equal(p.status, 'review');
    assert.equal(requests.length, 1);
    const payload = JSON.stringify(requests[0].body);
    assert.ok(payload.includes(path.basename(file)));
    assert.ok(!payload.includes(marker));
    return { status: p.status };
  });
  await patch([{ path: 'settings.recipes', value: [recipe('excerpts')] }]);
  await check('Excerpts denied by filenames-only approval', async () => {
    const p = await plan(await begin());
    assert.equal(p.status, 'failed');
    assert.equal(requests.length, 1);
  });
  await permission('excerpts');
  await check('Explicit excerpt approval permits generated evidence', async () => {
    const p = await plan(await begin());
    assert.equal(p.status, 'review');
    assert.equal(requests.length, 2);
    assert.ok(JSON.stringify(requests.at(-1)!.body).includes(marker));
  });
  mode = 'slow';
  await check('Revocation aborts the actual in-flight native connection', async () => {
    const next = requests.length + 1,
      action = await begin();
    await until(
      async () => requests.length,
      (v) => v === next,
      'Slow request received',
    );
    await permission(null);
    const p = await plan(action);
    assert.equal(p.status, 'failed');
    await until(async () => requests.at(-1)!.aborted, Boolean, 'Loopback connection aborted');
    const count = requests.length;
    const denied = await plan(await begin());
    assert.equal(denied.status, 'failed');
    assert.equal(requests.length, count);
    return { aborted: true };
  });
  mode = 'success';
  await permission('excerpts');
  provider.endpoint = endpoint.replace('/v1', '/changed/v1');
  await check('Endpoint edit invalidates private consent before transmission', async () => {
    const count = requests.length;
    await patch([{ path: 'settings.providers', value: [provider] }]);
    assert.equal(
      await evaluate(`window.viewer.providerPermissionGet(${JSON.stringify(provider.id)})`),
      null,
    );
    const p = await plan(await begin());
    assert.equal(p.status, 'failed');
    assert.equal(requests.length, count);
  });
  await permission('excerpts');
  mode = 'rate-limit';
  await check('429 produces visible failed proposal without a mutation', async () => {
    const p = await plan(await begin());
    assert.equal(p.status, 'failed');
    assert.match(p.error || '', /429/);
  });
  mode = 'invalid';
  await check('Malformed response produces visible failed proposal', async () => {
    const p = await plan(await begin());
    assert.equal(p.status, 'failed');
  });
  mode = 'success';
  await check('Clearing a key invalidates approval through the Settings-only API', async () => {
    await evaluate('window.viewer.openSettings()');
    const settings = await app!.connect(true);
    await until(() => settings.evaluate('!!window.viewer'), Boolean, 'Signed model Settings');
    await settings.evaluate(`window.viewer.providerCredential(${JSON.stringify(provider.id)},'')`);
    assert.equal(
      await evaluate(`window.viewer.providerPermissionGet(${JSON.stringify(provider.id)})`),
      null,
    );
    const count = requests.length;
    const p = await plan(await begin());
    assert.equal(p.status, 'failed');
    assert.equal(requests.length, count);
  });
  assert.equal(
    createHash('sha256')
      .update(await readFile(file))
      .digest('hex'),
    original,
  );
  assert.equal((await stat(path.join(profile, 'model-permissions-v1.json'))).mode & 0o777, 0o600);
  await app.close(main);
  quit = true;
  await writeFile(
    evidence,
    JSON.stringify(
      {
        version: 1,
        candidate: bundle,
        channel: 'mas-dev',
        completed: true,
        endpoint: 'generated loopback server',
        limitations: [
          'Responses generated locally: not paid-provider acceptance',
          'API-boundary consent: genuine physical consent-dialog/VoiceOver acceptance remains pending',
        ],
        results,
        requests,
        fixtureSHA256: original,
      },
      null,
      2,
    ) + '\n',
  );
} catch (error) {
  await writeFile(
    evidence,
    JSON.stringify(
      { version: 1, candidate: bundle, completed: false, results, error: String(error), requests },
      null,
      2,
    ) + '\n',
  );
  throw error;
} finally {
  try {
    if (app && !quit) await app.close(main);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await trashTemporary(profile);
    await trashTemporary(fixture.root);
  }
}
