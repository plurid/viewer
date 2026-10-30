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
import {
  animationFrames,
  click,
  countOf,
  exists,
  pressButton,
  textOf,
  valueOf,
} from './runtime/page';
import type { PageExpression } from './runtime/page-function';
import { pageCall } from './runtime/page-function';

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
      signal: new AbortController().signal,
      authorize,
      require: async () => {},
      workspaceState: async () => catalog,
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
type ToneWindow = { generatedSpeechContext: AudioContext };

const speechStatus = () => window.viewer.speech({ kind: 'status' }) as Promise<SpeechStatus>;
const scrollSettings = (top: number) => {
  document.querySelector('.settings-page')!.scrollTop = top;
};
const recordedSeconds = () =>
  Number(document.querySelector('.speech-level-row span')?.textContent.split(' /')[0] || 0);

function pressIncluding(selector: string, text: string): void {
  [...document.querySelectorAll<HTMLElement>(selector)]
    .find((element) => element.textContent.includes(text))!
    .click();
}

function scrollToEditor(): void {
  document.querySelector('.settings-page')!.scrollTop =
    document.querySelector<HTMLElement>('.speech-provider-editor')!.offsetTop;
}

function saveProviderInView(): boolean {
  const rect = [...document.querySelectorAll('.speech-provider-editor button')]
    .find((button) => button.textContent === 'Save provider')!
    .getBoundingClientRect();
  return rect.bottom <= innerHeight && rect.top >= 0;
}

/** Replaces the microphone with a 440 Hz tone, so no device is acquired. */
function installGeneratedTone(): void {
  navigator.mediaDevices.getUserMedia = async () => {
    const context = new AudioContext({ sampleRate: 16000 }),
      destination = context.createMediaStreamDestination();
    const source = context.createOscillator();
    source.frequency.value = 440;
    source.connect(destination);
    (window as unknown as ToneWindow).generatedSpeechContext = context;
    await context.resume();
    source.start();
    return destination.stream;
  };
}

/** Replaces the transcript through the native setter, so React sees an edit. */
function setTranscript(text: string): void {
  const field = document.querySelector<HTMLTextAreaElement>('textarea[aria-label=Transcript]')!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, text);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

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
  await page.evaluate(animationFrames(2));
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
        () => page.evaluate(pageCall(() => document.body.innerText)),
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
      await page.evaluate(pageCall(() => window.viewer.openSettings('settings.speech')));
      const preferences = await app.connect(true);
      const evaluate = <R>(expression: PageExpression<R>) => preferences.evaluate(expression);
      await until(
        () => evaluate(textOf('.settings-page h1')),
        (value) => value === 'Speech',
        'speech settings',
      );
      if (!restored) {
        await until(
          () => evaluate(exists('[aria-label="Speech processing"]')),
          Boolean,
          'loaded speech controls',
        );
        await evaluate(click('[aria-label="Speech processing"]'));
        await until(
          () => evaluate(countOf('.choice-menu button.command-result')),
          Boolean,
          'processing choices',
        );
        await evaluate(
          pageCall(pressIncluding, '.choice-menu button.command-result', 'Hosted provider'),
        );
        await until(() => evaluate(exists('.speech-hosted')), Boolean, 'hosted section');
        await evaluate(pressButton('Add speech provider'));
        for (const [name, width, height] of [
          ['desktop', 1000, 760],
          ['minimum', 760, 540],
        ] as const) {
          await evaluate(pageCall(scrollSettings, 0));
          await screenshot(preferences, 'hosted-provider-editor-' + name, width, height);
          await evaluate(pageCall(scrollToEditor));
          await screenshot(preferences, 'hosted-provider-editor-controls-' + name, width, height);
          assert.equal(await evaluate(pageCall(saveProviderInView)), true);
        }
        // Use the actual Settings IPC and OS-encrypted storage with a generated test credential.
        providerID = randomUUID();
        await evaluate(
          pageCall(
            (id: string, endpoint: string) =>
              window.viewer.speech({
                kind: 'provider-save',
                provider: {
                  id,
                  kind: 'compatible',
                  name: 'Generated loopback speech',
                  endpoint,
                  model: 'generated-model',
                },
              }),
            providerID,
            endpoint,
          ),
        );
        await evaluate(
          pageCall(
            (id: string, key: string) => window.viewer.speech({ kind: 'provider-key', id, key }),
            providerID,
            fakeKey,
          ),
        );
        await evaluate(
          pageCall(
            (providerID: string) =>
              window.viewer.speech({
                kind: 'preferences',
                preferences: { backend: 'hosted', providerID, language: 'en', microphone: '' },
              }),
            providerID,
          ),
        );
        const denied = await page.evaluate(
          pageCall(
            (id: string) =>
              window.viewer.speech({ kind: 'begin', id }).then(
                () => 'UNEXPECTED',
                (error: Error) => error.message,
              ),
            randomUUID(),
          ),
        );
        assert.match(denied, /Allow this endpoint/);
        assert.equal(uploads, 0);
        checks.push(
          'real encrypted key storage, explicit provider selection, audio denied before consent, no upload on setup',
        );
      } else {
        const status = await evaluate(pageCall(speechStatus));
        assert.equal(status.hosted?.providers[0]?.allowed, true);
        assert.equal(status.hosted?.providers[0]?.hasKey, true);
        assert.ok(!JSON.stringify(status).includes(fakeKey));
        for (const [name, width, height] of [
          ['desktop', 1000, 760],
          ['minimum', 760, 540],
        ] as const) {
          await evaluate(pageCall(scrollSettings, 0));
          await screenshot(preferences, 'hosted-provider-saved-' + name, width, height);
          await evaluate(pageCall(scrollSettings, 100000));
          await screenshot(preferences, 'hosted-provider-access-' + name, width, height);
          assert.equal(
            await evaluate(pageCall(() => document.documentElement.scrollWidth > innerWidth)),
            false,
          );
        }
        if (status.microphone === 'granted') {
          // Synthetic tone travels through the real AudioWorklet; no device is acquired.
          await evaluate(pageCall(installGeneratedTone));
          await evaluate(pressButton('Test microphone and transcription'));
          await until(
            () => evaluate(textOf('.speech-dialog')),
            (text) => text.includes('Finish and transcribe'),
            'generated recording begins',
          );
          await until(
            async () => {
              const error = await evaluate(textOf('.speech-dialog [role=alert]'));
              if (error) throw new Error('Generated recording stopped: ' + error);
              return evaluate(pageCall(recordedSeconds));
            },
            (seconds) => seconds >= 1,
            'generated audio through worklet',
          );
          await evaluate(pressButton('Finish and transcribe', '.speech-dialog'));
          await until(
            () => evaluate(valueOf('textarea[aria-label=Transcript]')),
            (value) => value === 'Generated hosted transcript',
            'loopback transcript reviewed',
          );
          assert.equal(uploads, 1);
          await evaluate(pageCall(setTranscript, 'Edited generated words'));
          for (const [name, width, height] of [
            ['desktop', 1000, 760],
            ['minimum', 760, 540],
          ] as const)
            await screenshot(preferences, 'hosted-transcript-' + name, width, height);
          await evaluate(pressButton('Done', '.speech-dialog'));
          await evaluate(
            pageCall(() => (window as unknown as ToneWindow).generatedSpeechContext.close()),
          );
          checks.push(
            'synthetic tone captured through real AudioWorklet, one authenticated WAV upload to loopback, editable transcript and explicit Done',
          );
        } else
          checks.push(
            'capture skipped: native microphone permission has not been granted; no prompt was opened',
          );
        await evaluate(
          pageCall(
            (id: string) => window.viewer.speech({ kind: 'provider-consent', id, allow: false }),
            providerID,
          ),
        );
        assert.equal((await evaluate(pageCall(speechStatus))).hosted?.providers[0]?.allowed, false);
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
