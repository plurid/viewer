/** Generated task and loopback speech qualification. Synthetic fixture consent is not a
 * human permission test. No real microphone, provider account or removal is used. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import type { AgentTaskBundle } from '../../src/domain/agents/task-workflow';
import type { SpeechStatus } from '../../src/domain/speech/recognition';
import { speechProviderIdentity } from '../../src/domain/speech/providers';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { AgentTaskWorkflows } from '../../src/desktop/agents/task-workflow';
import { Notes } from '../../src/desktop/editing/notes';
import { ownedApp, until } from '../owned-app';
import { temporaryRoot } from '../../tools/temporary';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.ok(process.env.VIEWER_TEST_BINARY);
const binary = path.resolve(process.env.VIEWER_TEST_BINARY);
const root = await realpath(await temporaryRoot('viewer-native-hosted-task-'));
const profile = path.join(root, 'Profile'),
  repo = path.join(root, 'Project');
await Promise.all([profile, repo].map((folder) => mkdir(folder)));
const run = promisify(execFile);
const git = (...args: string[]) =>
  run(
    '/usr/bin/git',
    ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', '-C', repo, ...args],
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
await writeFile(path.join(repo, 'Welcome.txt'), 'Generated task workflow.\n', { flag: 'wx' });
await git('add', '--', 'Welcome.txt');
await git('commit', '--no-verify', '--no-gpg-sign', '-m', 'Generated baseline');
const notes = new Notes(profile);
let bundle: AgentTaskBundle | undefined;
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  activeWorkspace: 'task-fixture',
  favorites: [],
  recents: [],
  look: 'dark',
  workspaces: [
    { id: 'task-fixture', name: 'Generated task workspace', panes: [], roots: [], arrangement: {} },
  ],
};
const catalog = {
  activeWorkspace: state.activeWorkspace,
  workspaces: [
    { id: state.activeWorkspace, name: 'Generated task workspace', panes: [], roots: [] },
  ],
};
const authorize = async (file: string) => {
  assert.ok(file === root || file.startsWith(root + path.sep));
  return file;
};
const tasks = new AgentTaskWorkflows({
  available: () => true,
  authorize,
  workspaceState: () => catalog,
  window: () => ({ id: 1, originID: 'generated-window' }),
  profile: () => 'default',
  note: async (directory) => {
    const reply = await notes.request({ kind: 'create', format: 'note', directory });
    assert.equal(reply.kind, 'document');
    if (reply.kind !== 'document') throw new Error('No note');
    return reply.document;
  },
  present: async (value) => {
    bundle = value;
  },
});
try {
  const setup = await tasks.prepare(
    {
      name: 'Ship a useful workspace',
      repo,
      branch: 'feature/ship',
      path: path.join(root, 'Feature'),
      existing: false,
    },
    {
      clientID: 'generated-client',
      signal: new AbortController().signal,
      authorize,
      require: async () => {},
      catalog: () => undefined,
      workspaceState: async () => catalog,
      own: () => {},
    },
  );
  assert.equal((await tasks.execute(setup, () => {})).stage, 'ready');
} finally {
  tasks.close();
}
assert.ok(bundle);
state.workspaces[0]!.panes = bundle.panes;
state.workspaces[0]!.taskAreas = [bundle.area];
state.workspaces[0]!.roots = [bundle.panes[0]!.id];
state.workspaces[0]!.activePane = bundle.panes[0]!.id;
const settings = defaultSettings(repo),
  ui = normalizePreferences();
settings.hotkey.enabled = false;
settings.providers = [];
settings.git.enabled = false;
settings.browsing.restoreSession = true;
ui.space.opening = 'dock';
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
});
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), { flag: 'wx' });
const screenshots = path.resolve('../../../.impeccable/review');
await mkdir(screenshots, { recursive: true });
const checks: string[] = [],
  captures: string[] = [];
const fakeKey = 'GENERATED_LOOPBACK_KEY';
let uploads = 0;
const server = createServer(async (request, response) => {
  assert.equal(request.url, '/v1/audio/transcriptions');
  assert.equal(request.headers.authorization, 'Bearer ' + fakeKey);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const bytes of request) {
    size += bytes.length;
    assert.ok(size <= 2000000);
    chunks.push(bytes);
  }
  const body = Buffer.concat(chunks).toString('latin1');
  assert.ok(body.includes('recording.wav') && body.includes('RIFF'));
  uploads++;
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ text: 'Generated hosted transcript' }));
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const endpoint = `http://127.0.0.1:${address.port}/v1`;
async function screenshot(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof ownedApp>>['connect']>>,
  name: string,
  width: number,
  height: number,
) {
  await page.command('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.evaluate(
    'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
  );
  const shot = await page.command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  const file = path.join(screenshots, name + '-' + path.basename(root).split('-').at(-1) + '.png');
  await writeFile(file, Buffer.from(shot.data, 'base64'), { flag: 'wx' });
  captures.push(file);
}
let providerID = '';
try {
  for (const restored of [false, true]) {
    const app = await ownedApp(binary, profile, { mode: 'foreground' });
    const page = await app.connect();
    try {
      await until(
        () => page.evaluate<string>('document.body.innerText'),
        (text) => text.includes('Ship a useful workspace'),
        'restored task area',
      );
      const saved = await readFile(path.join(profile, 'viewer-state-v1.json'), 'utf8');
      assert.ok(saved.includes('feature/ship') && saved.includes('manual'));
      checks.push(
        restored
          ? 'task references restored after restart'
          : 'real created checkout, private note and tool views load from the workflow bundle',
      );
      await page.evaluate("window.viewer.openSettings('settings.speech')");
      const preferences = await app.connect(true);
      const evaluate = <T>(expression: string) => preferences.evaluate<T>(expression);
      await until(
        () => evaluate<string>("document.querySelector('.settings-page h1')?.textContent || ''"),
        (value) => value === 'Speech',
        'speech settings',
      );
      if (!restored) {
        await until(
          () => evaluate<boolean>('!!document.querySelector(\'[aria-label="Speech processing"]\')'),
          Boolean,
          'loaded speech controls',
        );
        await evaluate('document.querySelector(\'[aria-label="Speech processing"]\').click()');
        await until(
          () =>
            evaluate<number>(
              "document.querySelectorAll('.choice-menu button.command-result').length",
            ),
          Boolean,
          'processing choices',
        );
        await evaluate(
          "[...document.querySelectorAll('.choice-menu button.command-result')].find(el=>el.textContent.includes('Hosted provider')).click()",
        );
        await until(
          () => evaluate<boolean>("!!document.querySelector('.speech-hosted')"),
          Boolean,
          'hosted section',
        );
        await evaluate(
          "[...document.querySelectorAll('button')].find(el=>el.textContent==='Add speech provider').click()",
        );
        for (const [name, width, height] of [
          ['desktop', 1000, 760],
          ['minimum', 760, 540],
        ] as const) {
          await evaluate("document.querySelector('.settings-page').scrollTop=0");
          await screenshot(preferences, 'hosted-provider-editor-' + name, width, height);
          await evaluate(
            "document.querySelector('.settings-page').scrollTop=document.querySelector('.speech-provider-editor').offsetTop",
          );
          await screenshot(preferences, 'hosted-provider-editor-controls-' + name, width, height);
          assert.equal(
            await evaluate<boolean>(
              "(()=>{const el=[...document.querySelectorAll('.speech-provider-editor button')].find(el=>el.textContent==='Save provider');const r=el.getBoundingClientRect();return r.bottom<=innerHeight&&r.top>=0})()",
            ),
            true,
          );
        }
        // Use the actual Settings IPC and OS-encrypted storage with a generated test credential.
        providerID = randomUUID();
        await evaluate(
          `window.viewer.speech({kind:'provider-save',provider:{id:${JSON.stringify(providerID)},kind:'compatible',name:'Generated loopback speech',endpoint:${JSON.stringify(endpoint)},model:'generated-model'}})`,
        );
        await evaluate(
          `window.viewer.speech({kind:'provider-key',id:${JSON.stringify(providerID)},key:${JSON.stringify(fakeKey)}})`,
        );
        await evaluate(
          `window.viewer.speech({kind:'preferences',preferences:{backend:'hosted',providerID:${JSON.stringify(providerID)},language:'en',microphone:''}})`,
        );
        const denied = await page.evaluate<string>(
          `window.viewer.speech({kind:'begin',id:${JSON.stringify(randomUUID())}}).then(()=> 'UNEXPECTED',error=>error.message)`,
        );
        assert.match(denied, /Allow this endpoint/);
        assert.equal(uploads, 0);
        checks.push(
          'real encrypted key storage, explicit provider selection, audio denied before consent, no upload on setup',
        );
      } else {
        const status = await evaluate<SpeechStatus>("window.viewer.speech({kind:'status'})");
        assert.equal(status.hosted?.providers[0]?.allowed, true);
        assert.equal(status.hosted?.providers[0]?.hasKey, true);
        assert.ok(!JSON.stringify(status).includes(fakeKey));
        for (const [name, width, height] of [
          ['desktop', 1000, 760],
          ['minimum', 760, 540],
        ] as const) {
          await evaluate("document.querySelector('.settings-page').scrollTop=0");
          await screenshot(preferences, 'hosted-provider-saved-' + name, width, height);
          await evaluate("document.querySelector('.settings-page').scrollTop=100000");
          await screenshot(preferences, 'hosted-provider-access-' + name, width, height);
          assert.equal(
            await evaluate<boolean>('document.documentElement.scrollWidth > innerWidth'),
            false,
          );
        }
        if (status.microphone === 'granted') {
          // Synthetic tone travels through the real AudioWorklet; no device is acquired.
          await evaluate(`navigator.mediaDevices.getUserMedia=async()=>{
            const context=new AudioContext({sampleRate:16000}), destination=context.createMediaStreamDestination();
            const source=context.createOscillator();source.frequency.value=440;source.connect(destination);
            window.generatedSpeechContext=context;await context.resume();source.start();return destination.stream;
          }`);
          await evaluate(
            "[...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='Test microphone and transcription').click()",
          );
          await until(
            () => evaluate<string>("document.querySelector('.speech-dialog')?.textContent || ''"),
            (text) => text.includes('Finish and transcribe'),
            'generated recording begins',
          );
          await until(
            async () => {
              const error = await evaluate<string>(
                "document.querySelector('.speech-dialog [role=alert]')?.textContent || ''",
              );
              if (error) throw new Error('Generated recording stopped: ' + error);
              return evaluate<number>(
                "Number(document.querySelector('.speech-level-row span')?.textContent.split(' /')[0] || 0)",
              );
            },
            (seconds) => seconds >= 1,
            'generated audio through worklet',
          );
          await evaluate(
            "[...document.querySelectorAll('.speech-dialog button')].find(el=>el.textContent.trim()==='Finish and transcribe').click()",
          );
          await until(
            () =>
              evaluate<string>(
                "document.querySelector('textarea[aria-label=Transcript]')?.value || ''",
              ),
            (value) => value === 'Generated hosted transcript',
            'loopback transcript reviewed',
          );
          assert.equal(uploads, 1);
          await evaluate(
            "(()=>{const el=document.querySelector('textarea[aria-label=Transcript]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Edited generated words');el.dispatchEvent(new Event('input',{bubbles:true}))})()",
          );
          for (const [name, width, height] of [
            ['desktop', 1000, 760],
            ['minimum', 760, 540],
          ] as const)
            await screenshot(preferences, 'hosted-transcript-' + name, width, height);
          await evaluate(
            "[...document.querySelectorAll('.speech-dialog button')].find(el=>el.textContent.trim()==='Done').click()",
          );
          await evaluate('window.generatedSpeechContext.close()');
          checks.push(
            'synthetic tone captured through real AudioWorklet, one authenticated WAV upload to loopback, editable transcript and explicit Done',
          );
        } else
          checks.push(
            'capture skipped: native microphone permission has not been granted; no prompt was opened',
          );
        await evaluate(
          `window.viewer.speech({kind:'provider-consent',id:${JSON.stringify(providerID)},allow:false})`,
        );
        assert.equal(
          (await evaluate<SpeechStatus>("window.viewer.speech({kind:'status'})")).hosted
            ?.providers[0]?.allowed,
          false,
        );
        checks.push(
          'provider, encrypted key and fixture consent restored; revoke returns to denied without recording',
        );
      }
    } finally {
      await app.close(page);
    }
    if (!restored) {
      const file = path.join(profile, 'speech-providers-v1.json');
      const document = JSON.parse(await readFile(file, 'utf8'));
      document.consents[providerID] = speechProviderIdentity(document.providers[0]);
      await writeFile(file, JSON.stringify(document));
    }
  }
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        checks,
        uploads,
        captures,
        retained: true,
        limitation: 'Synthetic fixture consent; no live microphone or paid provider call.',
      },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  console.log(JSON.stringify({ passed: true, checks, uploads, captures }));
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
