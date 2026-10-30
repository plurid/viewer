/** Native operator consent and real packaged MCP reads, using only generated fixtures. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import type { AgentAccessRequest, AgentAccessState } from '../../src/domain/agents/clients';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { defaultSettings } from '../../src/domain/services';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { packagedAgentClient } from './runtime/agent-client';
import { buttonState, patchSettings, pressButton } from './runtime/page';
import { pageCall } from './runtime/page-function';

assert.equal(process.platform, 'darwin');
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.ok(process.env.VIEWER_TEST_BINARY);
const interactive = process.argv.includes('--interactive');
const denialOnly = process.argv.includes('--deny-only');
if (denialOnly && !interactive)
  throw new Error('Denial acceptance requires an interactive operator session.');
if (interactive)
  assert.ok(process.stdin.isTTY, 'Operator acceptance requires a supervised terminal.');
const binary = path.resolve(process.env.VIEWER_TEST_BINARY);
const root = await realpath(await temporaryRoot('viewer-native-agent-consent-'));
const profile = path.join(root, 'Profile');
const allowed = path.join(root, 'Generated allowed folder');
const outside = path.join(root, 'Generated outside folder');
await Promise.all([profile, allowed, outside].map((file) => mkdir(file, { mode: 0o700 })));
const file = path.join(allowed, 'Résumé.txt');
const deniedFile = path.join(outside, 'Outside.txt');
const link = path.join(allowed, 'Outside link.txt');
const contents = 'Generated agent acceptance fixture ' + randomUUID() + '\n';
await writeFile(file, contents, { flag: 'wx', mode: 0o600 });
await writeFile(deniedFile, 'Generated out-of-scope fixture.\n', { flag: 'wx', mode: 0o600 });
await symlink(deniedFile, link);
const settings = defaultSettings(allowed);
settings.providers = [];
settings.hotkey.enabled = false;
// Editable configuration requests access. It must not manufacture native approval.
settings.agents.enabled = true;
settings.agents.roots = [allowed];
settings.customActions = [
  {
    id: 'agent-executable-fixture',
    name: 'Blocked agent executable fixture',
    aliases: [],
    icon: 'command',
    shortcut: '',
    order: 0,
    pinned: false,
    when: { target: 'any', extensions: [], min: 0, max: 10000 },
    executor: { kind: 'executable', executable: '/usr/bin/true', args: [], perItem: false },
  },
];
await writeFile(
  path.join(profile, 'config.jsonc'),
  JSON.stringify({ version: 1, settings, ui: normalizePreferences() }),
  {
    flag: 'wx',
    mode: 0o600,
  },
);
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  activeWorkspace: 'agent-consent',
  look: 'dark',
  favorites: [],
  recents: [],
  workspaces: [
    {
      id: 'agent-consent',
      name: 'Isolated agent consent acceptance',
      roots: ['folder'],
      activePane: 'folder',
      arrangement: {},
      panes: [
        {
          id: 'folder',
          type: 'folder',
          path: allowed,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [allowed],
          historyIndex: 0,
        },
      ],
    },
  ],
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), {
  flag: 'wx',
  mode: 0o600,
});
const sha = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const original = { allowed: await sha(file), outside: await sha(deniedFile) };
const checks: { id: string; detail: unknown }[] = [];
const evidenceDirectories: string[] = [];
const result: Record<string, unknown> = {
  binary,
  executableSha256: await sha(binary),
  archiveSha256: await sha(path.resolve(binary, '../../Resources/app.asar')),
  root,
  profile,
  allowed,
  outside,
  original,
  checks,
  evidenceDirectories,
  interactive,
  retained: true,
  authoritySource:
    'Real Settings-origin native dialogs; stdin only starts a scenario and never supplies approval.',
};
const resultFile = path.join(root, 'result.json');
const save = () => writeFile(resultFile, JSON.stringify(result, null, 2));
const input = interactive
  ? createInterface({ input: process.stdin, output: process.stdout })
  : undefined;
type Application = Awaited<ReturnType<typeof ownedApp>>;
type Connection = Awaited<ReturnType<Application['connect']>>;
type ReviewOutcome = { pending: boolean; state?: AgentAccessState; error?: string };
type ReviewWindow = { __agentConsentAcceptance: ReviewOutcome };
let app: Application | undefined;
let main: Connection | undefined;
let preferences: Connection | undefined;
let client: ReturnType<typeof packagedAgentClient> | undefined;
let credential = '';

const disableAgents = () => window.viewer.agentAccess({ kind: 'enable', enabled: false });

/** Opens a native review without waiting for it; the outcome lands on the window for `until`. */
function startReview(request: AgentAccessRequest): void {
  const page = window as unknown as ReviewWindow;
  page.__agentConsentAcceptance = { pending: true };
  void window.viewer.agentAccess(request).then(
    (state) => {
      page.__agentConsentAcceptance = { pending: false, state };
    },
    (error: Error) => {
      page.__agentConsentAcceptance = { pending: false, error: error.message };
    },
  );
}

async function access(): Promise<AgentAccessState> {
  assert.ok(preferences);
  return preferences.evaluate(pageCall(() => window.viewer.agentAccess({ kind: 'state' })));
}

async function passed(id: string, detail: unknown) {
  checks.push({ id, detail });
  await save();
  console.log('PASS ' + id);
}

async function connect() {
  app = await ownedApp(binary, profile, { mode: interactive ? 'foreground' : 'hidden' });
  main = await app.connect();
  await main.evaluate(pageCall(() => window.viewer.openSettings()));
  preferences = await app.connect(true);
  await until(
    () => preferences!.evaluate(buttonState('Agents', '.settings-navigation')),
    (state) => state !== 'missing',
    'agent Settings category',
  );
  await preferences.evaluate(pressButton('Agents', '.settings-navigation'));
  evidenceDirectories.push(app.evidenceDirectory);
}

async function nativeReview(stage: string, instruction: string, request: AgentAccessRequest) {
  assert.ok(input && preferences);
  result.stage = stage;
  result.instruction = instruction;
  await save();
  console.log('READY ' + stage + ': ' + instruction);
  // The supervisor starts the scenario only after telling the operator what to review.
  assert.equal((await input.question('Type run to show this native dialog: ')).trim(), 'run');
  await preferences.evaluate(pageCall(startReview, request));
  const outcome = await until(
    () =>
      preferences!.evaluate(
        pageCall(() => (window as unknown as ReviewWindow).__agentConsentAcceptance),
      ),
    (value) => !value.pending,
    stage + ' native result',
    600_000,
  );
  assert.equal(outcome.error, undefined, outcome.error ?? 'Native review completes successfully.');
  assert.ok(outcome.state);
  result.lastNativeOutcome = { stage, state: outcome.state };
  await save();
  return outcome.state;
}

async function initializeClient(token = credential) {
  const connection = packagedAgentClient(binary, profile, token);
  try {
    await connection.request('initialize', {
      protocolVersion: '2026-07-28',
      capabilities: {},
      clientInfo: { name: 'Viewer acceptance', version: '1' },
    });
    return connection;
  } catch (error) {
    await connection.close();
    throw error;
  }
}

async function metadata(connection: ReturnType<typeof packagedAgentClient>, target: string) {
  const reply = await connection.request<{ content: { text: string }[] }>('tools/call', {
    name: 'read_metadata',
    arguments: { path: target },
  });
  return JSON.parse(reply.content[0]!.text) as { path: string; size: number };
}

async function agentTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  assert.ok(client);
  const reply = await client.request<{ content: { text: string }[] }>('tools/call', {
    name,
    arguments: args,
  });
  return JSON.parse(reply.content[0]!.text) as T;
}

async function reviewedCommandBoundary() {
  assert.ok(main);
  await main.evaluate(
    pageCall(() =>
      document.querySelector<HTMLElement>('.folder-explorer')!.focus({ preventScroll: true }),
    ),
  );
  const catalog = await until(
    () => agentTool<{ commands: { id: string }[] }>('list_commands'),
    (value) => value.commands.some((command) => command.id === 'refresh'),
    'authorized agent command catalog',
  );
  for (const id of ['open-terminal-plane', 'custom.agent-executable-fixture'])
    assert.ok(!catalog.commands.some((command) => command.id === id));
  await assert.rejects(
    agentTool('propose_command', { commandID: 'custom.agent-executable-fixture' }),
    /Agents cannot run shell scripts, executables or terminal profiles/,
  );
  await assert.rejects(
    agentTool('propose_command', { commandID: 'open-terminal-plane' }),
    /terminal execution is unavailable/,
  );
  const proposal = await agentTool<{ id: string; requiresUserReview: boolean }>('propose_command', {
    commandID: 'refresh',
  });
  assert.equal(proposal.requiresUserReview, true);
  await until(
    () => main!.evaluate(buttonState('Reject', 'dialog[open]')),
    (state) => state !== 'missing',
    'agent proposal review before execution',
  );
  // Rejecting this read-only proposal grants no authority and never starts its command.
  await main.evaluate(pressButton('Reject', 'dialog[open]'));
  await until(
    () => agentTool<{ status: string }>('get_proposal', { id: proposal.id }),
    (value) => value.status === 'rejected',
    'rejected proposal outcome',
  );
  await assert.rejects(
    agentTool('propose_config', { patches: [{ path: 'executionApprovals', value: [] }] }),
    /Agents cannot change/,
  );
  await passed('review-and-immutable-command-policy', {
    proposalRejected: true,
    executableDenied: true,
    terminalDenied: true,
    privateApprovalConfigDenied: true,
  });
}

async function patchRequested(enabled: boolean, roots: string[]) {
  assert.ok(preferences);
  await preferences.evaluate(
    patchSettings(
      { path: 'settings.agents.enabled', value: enabled },
      { path: 'settings.agents.roots', value: roots },
    ),
  );
}

try {
  await connect();
  const initial = await access();
  assert.equal(initial.enabled, false);
  assert.deepEqual(initial.roots, []);
  assert.equal(initial.pending.enable, true);
  assert.deepEqual(initial.pending.roots, [allowed]);
  await assert.rejects(lstat(path.join(profile, 'agent-connection-v1.json')), { code: 'ENOENT' });
  assert.ok(main);
  const refused = await main.evaluate(
    pageCall(() =>
      window.viewer.agentAccess({ kind: 'enable', enabled: true }).then(
        () => '',
        (error: Error) => error.message,
      ),
    ),
  );
  assert.match(refused, /settings|window|available/i);
  await passed('configuration-does-not-authorize', {
    requested: true,
    effective: false,
    workspaceGrantRefused: true,
  });
  if (interactive) {
    const cancelled = await nativeReview(
      'cancel-enable',
      'Click Cancel in “Allow local agent clients to use Viewer?”',
      { kind: 'enable', enabled: true },
    );
    assert.equal(
      cancelled.enabled,
      false,
      'Cancelling native consent must leave agent access disabled.',
    );
    assert.deepEqual(cancelled.roots, []);
    await assert.rejects(lstat(path.join(profile, 'agent-connection-v1.json')), { code: 'ENOENT' });
    await passed('native-cancel', { enabled: false, brokerStarted: false });
    result.nativeDenialComplete = true;

    if (!denialOnly) {
      const enabled = await nativeReview(
        'allow-enable',
        'Allow the shared client; no folder is authorized by this dialog.',
        { kind: 'enable', enabled: true },
      );
      assert.equal(enabled.enabled, true);
      assert.deepEqual(enabled.roots, []);
      assert.deepEqual([...enabled.capabilities].sort(), ['metadata', 'navigation', 'propose']);
      const configuration = JSON.parse(
        await preferences!.evaluate(pageCall(() => window.viewer.agentToken())),
      ) as {
        mcpServers: { viewer: { env: { VIEWER_AGENT_TOKEN: string } } };
      };
      credential = configuration.mcpServers.viewer.env.VIEWER_AGENT_TOKEN;
      assert.match(credential, /^[a-f0-9]{64}$/);
      client = await initializeClient();
      await assert.rejects(metadata(client, file), /outside|authorized folders/i);
      await passed('enabled-without-folder-cannot-read', { capabilities: enabled.capabilities });

      const granted = await nativeReview(
        'allow-folder',
        'Allow only this generated folder: ' + allowed,
        { kind: 'allow', roots: [allowed] },
      );
      assert.deepEqual(granted.roots, [allowed]);
      const info = await metadata(client, file);
      assert.equal(info.path, file);
      assert.equal(info.size, Buffer.byteLength(contents));
      await assert.rejects(metadata(client, deniedFile), /outside|authorized folders/i);
      await assert.rejects(metadata(client, link), /outside|authorized folders/i);
      await assert.rejects(
        metadata(client, path.join(profile, 'config.jsonc')),
        /private Viewer|private.*data/i,
      );
      const invalid = (credential[0] === '0' ? '1' : '0') + credential.slice(1);
      await assert.rejects(initializeClient(invalid), /token|invalid|disabled/i);
      await passed('authenticated-scoped-read', {
        metadataPath: info.path,
        outsideDenied: true,
        symlinkDenied: true,
        privateDataDenied: true,
        invalidTokenDenied: true,
      });
      await reviewedCommandBoundary();

      await preferences!.evaluate(
        pageCall(
          (root: string) => window.viewer.agentAccess({ kind: 'remove-folder', root }),
          allowed,
        ),
      );
      await assert.rejects(metadata(client, file), /outside|authorized folders/i);
      await passed('folder-revocation-live-client', { roots: (await access()).roots });
      await preferences!.evaluate(pageCall(disableAgents));
      assert.equal((await access()).enabled, false);
      await assert.rejects(metadata(client, file), /disconnected|disabled|invalid|outside/i);
      await client.close();
      client = undefined;
      const connection = JSON.parse(
        await readFile(path.join(profile, 'agent-connection-v1.json'), 'utf8'),
      ) as { socket: string };
      const retainedSocketDirectory = path.dirname(connection.socket);
      assert.ok(
        (await lstat(retainedSocketDirectory)).isDirectory(),
        'The generated socket directory is retained.',
      );
      await passed('disabled-broker-and-retained-fixture', {
        enabled: false,
        retainedSocketDirectory,
      });

      await patchRequested(true, [allowed]);
      assert.equal((await access()).enabled, false);
      await app!.close(main);
      app = undefined;
      main = undefined;
      preferences = undefined;
      await connect();
      const cold = await access();
      assert.equal(cold.enabled, false);
      assert.deepEqual(cold.roots, []);
      assert.equal(cold.pending.enable, true);
      assert.deepEqual(cold.pending.roots, [allowed]);
      await assert.rejects(initializeClient(), /disconnected|disabled|invalid|start/i);
      await patchRequested(false, []);
      assert.equal((await access()).enabled, false);
      await passed('cold-restart-configuration-cannot-regrant', { enabled: false, roots: [] });
      result.nativeConsentComplete = true;
    } else {
      result.nativeConsentComplete = false;
      result.unverified = ['native-allow', 'scoped-read', 'revocation', 'cold-restart'];
    }
  } else {
    result.nativeConsentComplete = false;
    result.unverified = [
      'native-cancel',
      'native-allow',
      'scoped-read',
      'revocation',
      'cold-restart',
    ];
  }
  assert.equal(await sha(file), original.allowed);
  assert.equal(await sha(deniedFile), original.outside);
  assert.ok((await lstat(link)).isSymbolicLink());
  result.generatedFilesUnchanged = true;
  result.stage = 'complete';
  await save();
  console.log(
    denialOnly
      ? 'PASS native agent denial; grant checks were not run.'
      : interactive
        ? 'PASS native agent consent and packaged authenticated reads.'
        : 'PASS agent consent preflight only; native operator acceptance remains unverified.',
  );
} catch (error) {
  result.error = error instanceof Error ? error.stack : String(error);
  result.stage = 'failed';
  // Revoke a partially completed test grant without granting or approving anything new.
  await preferences?.evaluate(pageCall(disableAgents)).catch(() => {});
  await save();
  throw error;
} finally {
  input?.close();
  await client?.close();
  if (app) await app.close(main);
  console.log('Retained agent-consent acceptance evidence: ' + resultFile);
}
