/** Packaged headless CLI and rendered reviews in an isolated, retained fixture.
 * Synthetic fixture authority exercises transport/scopes, not human consent. */
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { AgentAccess } from '../../src/desktop/agents/agent-access';
import { AgentClients } from '../../src/desktop/agents/agent-clients';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { defaultSettings } from '../../src/domain/services';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.ok(process.env.VIEWER_TEST_BINARY);
const binary = path.resolve(process.env.VIEWER_TEST_BINARY);
const root = await realpath(await temporaryRoot('viewer-native-cli-'));
const profile = path.join(root, 'Profile'),
  shared = path.join(root, 'Shared'),
  outside = path.join(root, 'Outside');
await Promise.all([profile, shared, outside].map((file) => mkdir(file, { mode: 0o700 })));
const document = path.join(shared, 'Résumé.txt'),
  privateFile = path.join(outside, 'Private.txt');
await writeFile(document, 'Generated original content with a unique quartzmatch phrase.\n', {
  flag: 'wx',
});
await writeFile(privateFile, 'Generated private fixture.\n', { flag: 'wx' });
const execute = promisify(execFile);
const git = (...args: string[]) =>
  execute(
    '/usr/bin/git',
    ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-C', shared, ...args],
    {
      env: {
        PATH: '/usr/bin:/bin',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_AUTHOR_NAME: 'Generated fixture',
        GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_NAME: 'Generated fixture',
        GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
      },
    },
  );
await git('init', '--initial-branch=main', '--template=');
await git('add', '--', 'Résumé.txt');
await git('commit', '--no-verify', '--no-gpg-sign', '-m', 'Generated baseline');
await writeFile(document, 'Generated changed content with a unique quartzmatch phrase.\n');
const indexBefore = await readFile(path.join(shared, '.git/index'));
const workflow = path.join(shared, 'viewer.workflow.jsonc');
await writeFile(
  workflow,
  JSON.stringify({
    version: 1,
    id: 'inspect',
    name: 'Generated CLI inspection',
    inputs: { source: { path: 'Résumé.txt' } },
    steps: [
      {
        id: 'inspect',
        kind: 'inspect',
        content: true,
        sources: [{ kind: 'input', name: 'source' }],
      },
    ],
  }),
  { flag: 'wx' },
);
const settings = defaultSettings(shared),
  ui = normalizePreferences();
settings.hotkey.enabled = false;
settings.providers = [];
settings.git.enabled = true;
settings.search.roots = [shared];
settings.search.contentRoots = [shared];
settings.agents.enabled = true;
settings.agents.roots = [shared];
ui.space.opening = 'dock';
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
  mode: 0o600,
});
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  activeWorkspace: 'generated-cli',
  favorites: [],
  recents: [],
  look: 'dark',
  workspaces: [
    {
      id: 'generated-cli',
      name: 'Generated CLI workspace',
      roots: ['folder'],
      activePane: 'folder',
      arrangement: {},
      panes: [
        {
          id: 'folder',
          type: 'folder',
          path: shared,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [shared],
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
const authority = new AgentAccess(profile, () => settings.agents);
const change = {
  enabled: true,
  add: [shared],
  capabilities: ['metadata', 'content', 'navigation', 'propose'] as const,
};
await authority.approve(change, await authority.captureReview(change));
const clients = new AgentClients(profile, async (files) => {
  for (const file of files) assert.ok(file === shared || file.startsWith(shared + path.sep));
});
const generated = await clients.create({
  name: 'Generated CLI client',
  roots: [shared],
  capabilities: [...change.capabilities],
  budgets: { maxReadBytes: 1048576, maxTasks: 4 },
});
await clients.close();
const token = generated.token;
const calls: {
  args: string[];
  code: number | null;
  stdout: string;
  stderr: string;
  milliseconds: number;
}[] = [];
const checks: string[] = [];
const captures: string[] = [];
const result: Record<string, unknown> = {
  binary,
  profile,
  root,
  authoritySource:
    'Synthetic private authority in generated profile; human consent is not qualified here.',
  checks,
  calls,
  captures,
  retained: true,
};
async function cli(
  args: string[],
  options: { unauthenticated?: boolean; raw?: boolean; stdin?: string } = {},
) {
  const start = Date.now();
  const child = spawn(binary, options.raw ? args : [...args, '--json'], {
    env: {
      ...process.env,
      VIEWER_DATA_DIRECTORY: profile,
      VIEWER_AGENT_TOKEN: options.unauthenticated ? undefined : token,
      VIEWER_RENDER_TEST: '1',
      VIEWER_BACKGROUND_TEST: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '',
    stderr = '';
  const consume = (text: string) => {
    assert.ok(!text.includes(token), 'CLI never prints its credential');
    if (stdout.length + stderr.length > 2 * 1024 ** 2) child.kill('SIGTERM');
  };
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
    consume(stdout);
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
    consume(stderr);
  });
  child.stdin.end(options.stdin ?? '');
  const timer = setTimeout(() => child.kill('SIGTERM'), 20000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    calls.push({ args, code, stdout, stderr, milliseconds: Date.now() - start });
    return {
      code,
      stdout,
      stderr,
      value: options.raw
        ? undefined
        : (JSON.parse(stdout) as {
            ok: boolean;
            result: unknown;
            error?: unknown;
            operationID?: string;
          }),
    };
  } finally {
    clearTimeout(timer);
  }
}
const successful = async <T>(args: string[]): Promise<T> => {
  const response = await cli(args);
  assert.equal(response.code, 0, JSON.stringify(response));
  assert.equal(response.value!.ok, true);
  return response.value!.result as T;
};
const sha = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
result.archiveSha256 = await sha(path.resolve(binary, '../../Resources/app.asar'));
let app: Awaited<ReturnType<typeof ownedApp>> | undefined;
let connection: Awaited<ReturnType<NonNullable<typeof app>['connect']>> | undefined;
try {
  assert.equal((await cli(['--help'], { raw: true, unauthenticated: true })).code, 0);
  assert.equal((await cli(['--version'], { unauthenticated: true })).code, 0);
  assert.equal((await cli(['workspace', 'list'], { unauthenticated: true })).code, 4);
  assert.equal((await cli(['search', 'x', '--unknown'])).code, 2);
  for (const shell of ['bash', 'zsh']) {
    const completion = await cli(['completion', shell], { raw: true, unauthenticated: true });
    assert.equal(completion.code, 0);
    const file = path.join(root, 'completion.' + shell);
    await writeFile(file, completion.stdout, { flag: 'wx' });
    await execute('/bin/' + shell, ['-n', file]);
  }
  checks.push('Offline help, version, shell syntax, missing-token and usage exit codes');
  app = await ownedApp(binary, profile);
  connection = await app.connect();
  const evaluate = <T>(expression: string) => connection!.evaluate<T>(expression);
  await until(
    () => evaluate<number>("document.querySelectorAll('.folder-explorer').length"),
    Boolean,
    'Generated folder',
  );
  await until(
    () => readFile(path.join(profile, 'agent-connection-v1.json'), 'utf8').catch(() => ''),
    Boolean,
    'Generated agent socket',
  );
  await successful(['status']);
  const workspaces = await successful<{ id: string }[]>(['workspace', 'list']);
  assert.ok(JSON.stringify(workspaces).includes('Generated CLI workspace'));
  await successful(['plane', 'list']);
  const denied = await cli(['read', privateFile]);
  assert.equal(denied.code, 1);
  assert.ok(!denied.stdout.includes('Generated private fixture.'));
  assert.ok(JSON.stringify(await successful(['read', document])).includes('quartzmatch'));
  const found = await until(
    () =>
      successful<{ entries: { path: string }[]; evidence?: { quote: string }[] }>([
        'search',
        'quartzmatch',
        '--root',
        shared,
        '--content',
      ]),
    (value) => value.entries.some((file) => file.path === document),
    'Indexed original-content search',
    20000,
  );
  assert.ok(found.evidence?.some((item) => item.quote.includes('quartzmatch')));
  checks.push('Authenticated discovery, granted content search/evidence, out-of-scope rejection');
  const status = await successful<{ kind: string }>(['git', 'status', shared]);
  assert.equal(status.kind, 'ready');
  const diff = await successful<{ patch: string }>(['git', 'diff', shared, '--base', 'main']);
  assert.ok(diff.patch.includes('+Generated changed'));
  assert.deepEqual(await readFile(path.join(shared, '.git/index')), indexBefore);
  await successful(['task', 'list']);
  checks.push('Read-only Git status/diff preserves the index; task discovery');
  await successful(['workflow', 'read', workflow]);
  const run = await successful<{ id: string; status: string }>([
    'workflow',
    'run',
    workflow,
    '--wait',
  ]);
  assert.equal(run.status, 'completed');
  await successful(['workflow', 'status', run.id]);
  checks.push('Real inspection workflow starts, waits and returns client-owned state');
  const invalidAsk = await cli(['ask', 'Frame the planes']);
  assert.equal(invalidAsk.code, 1);
  assert.ok(JSON.stringify(invalidAsk.value).includes('Settings'));
  const speech = await successful<{ runtime: { recognitionAvailable: boolean } }>([
    'speech',
    'status',
  ]);
  assert.equal(speech.runtime.recognitionAvailable, false);
  const pending = await successful<{ id: string }>(['speech', 'install', 'whisper-tiny']);
  await until(
    () => evaluate<string>("document.querySelector('.agent-review-dialog')?.textContent || ''"),
    (text) => text.includes('Download model'),
    'Speech setup review',
  );
  for (const [name, width, height] of [
    ['desktop', 1280, 800],
    ['minimum', 780, 560],
  ] as const) {
    await connection.command('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    const screenshot = await connection.command<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
    });
    const file = path.join(root, 'speech-review-' + name + '.png');
    await writeFile(file, Buffer.from(screenshot.data, 'base64'), { flag: 'wx' });
    captures.push(file);
    const controls = await evaluate<boolean>(
      `(() => {const buttons=[...document.querySelectorAll('.agent-review-dialog footer button')];return buttons.length===2&&buttons.every(b=>{const r=b.getBoundingClientRect();return r.width>40&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth})})()`,
    );
    assert.equal(controls, true, 'Review controls remain within the window');
  }
  await evaluate("document.querySelector('.agent-review-dialog footer button').focus()");
  for (const type of ['keyDown', 'keyUp'])
    await connection.command('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab' });
  assert.equal(
    await evaluate<string>('document.activeElement.textContent.trim()'),
    'Download model',
  );
  await successful(['review', 'cancel', pending.id]);
  await until(
    () => evaluate<boolean>("!document.querySelector('.agent-review-dialog')"),
    Boolean,
    'Cancelled proposal dismissed',
  );
  assert.equal(
    (await successful<{ status: string }>(['review', 'status', pending.id])).status,
    'cancelled',
  );
  const waited = await cli(['command', 'run', 'frame-all', '--wait', '--timeout', '100']);
  assert.equal(waited.code, 124);
  assert.ok(waited.value!.operationID);
  await successful(['review', 'cancel', waited.value!.operationID!]);
  checks.push(
    'Honest unavailable speech runtime, real review at both sizes, exact proposal cancellation and wait timeout',
  );
  assert.ok(!calls.some((call) => call.stdout.includes(token) || call.stderr.includes(token)));
  result.passed = true;
} catch (error) {
  result.passed = false;
  result.error = String(error);
  throw error;
} finally {
  try {
    if (app) await app.close(connection);
  } catch (error) {
    result.passed = false;
    result.closeError = String(error);
    throw error;
  } finally {
    await writeFile(path.join(root, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ root, passed: result.passed, checks, captures }));
  }
}
