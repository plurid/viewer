/** Isolated desktop speech settings, denied unsolicited media and restart restoration.
 * Audio engine qualification uses generated/public clips separately; this never records a person. */
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import type { SpeechStatus } from '../../src/domain/speech/recognition';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { SpeechModels } from '../../src/desktop/speech/models';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { click, countOf, exists, textOf, valueOf } from './runtime/page';
import { pageCall } from './runtime/page-function';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.ok(process.env.VIEWER_TEST_BINARY);
const binary = path.resolve(process.env.VIEWER_TEST_BINARY);
const root = await realpath(await temporaryRoot('viewer-native-speech-'));
const profile = path.join(root, 'Profile'),
  files = path.join(root, 'Files');
await mkdir(profile);
await mkdir(files);
await writeFile(path.join(files, 'Welcome.txt'), 'Generated speech acceptance folder.\n', {
  flag: 'wx',
});
const settings = defaultSettings(files),
  ui = normalizePreferences();
settings.hotkey.enabled = false;
settings.providers = [];
settings.browsing.restoreSession = true;
ui.space.opening = 'dock';
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
});
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  activeWorkspace: 'speech',
  favorites: [],
  recents: [],
  look: 'dark',
  workspaces: [
    {
      id: 'speech',
      name: 'Generated speech acceptance',
      roots: ['folder'],
      activePane: 'folder',
      arrangement: {},
      panes: [
        {
          id: 'folder',
          type: 'folder',
          path: files,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [files],
          historyIndex: 0,
        },
      ],
    },
  ],
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), { flag: 'wx' });
const captures = path.resolve('../../../.impeccable/review');
await mkdir(captures, { recursive: true });
const checks: string[] = [];
type FixtureWindow = {
  fixtureCaptureCalls: number;
  fixtureEvents: string[];
  fixtureAudioContext: AudioContext;
};

const speechStatus = () => window.viewer.speech({ kind: 'status' }) as Promise<SpeechStatus>;
const dictate = () => window.dispatchEvent(new Event('viewer:dictate'));
const scrollSettings = (top: number) => {
  document.querySelector('.settings-page')!.scrollTop = top;
};
const captureCalls = () => (window as unknown as FixtureWindow).fixtureCaptureCalls;

/** Asks for the microphone without a dictation: the refusal's name, or UNEXPECTED_GRANT. */
const unsolicitedMicrophone = () =>
  navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(
    (stream) => {
      stream.getTracks().forEach((track) => track.stop());
      return 'UNEXPECTED_GRANT';
    },
    (error: Error) => error.name,
  );

function settingsOverflow(): boolean {
  return (
    document.documentElement.scrollWidth > innerWidth ||
    [
      ...document.querySelectorAll('.speech-model, .speech-model-actions, .speech-preferences'),
    ].some((element) => element.scrollWidth > element.clientWidth + 1)
  );
}

function resetInView(): boolean {
  const rect = document.querySelector('.settings-reset')!.getBoundingClientRect();
  return rect.bottom <= innerHeight && rect.top >= 0;
}

/** Replaces the microphone with the clip's PCM, counting captures and recording speech events. */
function installFixtureCapture(clip: string): void {
  const page = window as unknown as FixtureWindow;
  page.fixtureCaptureCalls = 0;
  page.fixtureEvents = [];
  window.viewer.onEvent((event) => {
    if (event.type === 'speech') page.fixtureEvents.push(event.event.state);
  });
  window.addEventListener('blur', () => page.fixtureEvents.push('blur'));
  navigator.mediaDevices.getUserMedia = async () => {
    page.fixtureCaptureCalls++;
    const context = new AudioContext({ sampleRate: 16000 }),
      destination = context.createMediaStreamDestination();
    const bytes = Uint8Array.from(atob(clip), (character) => character.charCodeAt(0)),
      view = new DataView(bytes.buffer);
    const buffer = context.createBuffer(1, bytes.length / 2, 16000),
      channel = buffer.getChannelData(0);
    for (let index = 0; index < channel.length; index++)
      channel[index] = view.getInt16(index * 2, true) / 32768;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(destination);
    page.fixtureAudioContext = context;
    await context.resume();
    source.start();
    return destination.stream;
  };
}

function captureState() {
  return {
    seconds: Number(
      document.querySelector('.speech-level-row span')?.textContent.split(' /')[0] || 0,
    ),
    error: document.querySelector('.speech-dialog [role=alert]')?.textContent || '',
    phase: document.querySelector('.speech-status')?.textContent || '',
    events: (window as unknown as FixtureWindow).fixtureEvents,
  };
}

function pressDialogButton(text: string): void {
  [...document.querySelectorAll<HTMLElement>('.speech-dialog button')]
    .find((button) => button.textContent.includes(text))!
    .click();
}

/** Replaces the transcript through the native setter, so React sees an edit. */
function setTranscript(text: string): void {
  const field = document.querySelector<HTMLTextAreaElement>('textarea[aria-label=Transcript]')!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, text);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

async function inspect(restored: boolean) {
  const app = await ownedApp(binary, profile);
  const connection = await app.connect();
  try {
    const status = await connection.evaluate(pageCall(speechStatus));
    assert.equal(status.models.runtime.recognitionAvailable, true);
    if (restored) {
      assert.equal(status.models.selected, 'whisper-tiny');
      assert.equal(status.preferences.language, 'ro');
      checks.push('verified model and language restored without starting capture');
    } else {
      assert.equal(status.models.selected, undefined);
      await connection.evaluate(pageCall(dictate));
      await until(
        () => connection.evaluate(textOf('.speech-dialog [role=alert]')),
        (value) => value.includes('installed speech model'),
        'missing model recovery',
      );
      await connection.command('Emulation.setDeviceMetricsOverride', {
        width: 900,
        height: 640,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const denied = await connection.command<{ data: string }>('Page.captureScreenshot', {
        format: 'png',
      });
      await writeFile(
        path.join(captures, 'speech-recovery-desktop.png'),
        Buffer.from(denied.data, 'base64'),
      );
      await connection.evaluate(click('.speech-dialog header button'));
      const unsolicited = await connection.evaluate(pageCall(unsolicitedMicrophone));
      assert.notEqual(unsolicited, 'UNEXPECTED_GRANT');
      checks.push('unsolicited microphone denied and missing model recovers without capture');
    }
    await connection.evaluate(pageCall(() => window.viewer.openSettings('settings.speech')));
    const page = await app.connect(true);
    await until(
      () => page.evaluate(textOf('.settings-page h1')),
      (value) => value === 'Speech',
      'speech settings direct destination',
    );
    await until(
      () => page.evaluate(countOf('.speech-model')),
      (value) => value === 3,
      'pinned speech catalog',
    );
    assert.equal(await page.evaluate(countOf('select')), 0);
    if (!restored)
      for (const [name, width, height] of [
        ['desktop', 900, 640],
        ['minimum', 760, 540],
      ] as const) {
        await page.command('Emulation.setDeviceMetricsOverride', {
          width,
          height,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await page.evaluate(pageCall(scrollSettings, 0));
        const shot = await page.command<{ data: string }>('Page.captureScreenshot', {
          format: 'png',
        });
        await writeFile(
          path.join(captures, `speech-settings-${name}.png`),
          Buffer.from(shot.data, 'base64'),
        );
        const overflow = await page.evaluate(pageCall(settingsOverflow));
        assert.equal(overflow, false);
        await page.evaluate(pageCall(scrollSettings, 100000));
        const bottom = await page.command<{ data: string }>('Page.captureScreenshot', {
          format: 'png',
        });
        await writeFile(
          path.join(captures, `speech-recording-${name}.png`),
          Buffer.from(bottom.data, 'base64'),
        );
        assert.ok(await page.evaluate(pageCall(resetInView)));
      }
    await page.evaluate(click('[aria-label="Speech language"]'));
    await until(
      () => page.evaluate(countOf('.choice-menu')),
      (value) => value === 1,
      'searchable language menu',
    );
    await page.command('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
    });
    checks.push(
      restored
        ? 'restored settings and keyboard menu'
        : 'direct Settings navigation, searchable controls, desktop/minimum layout and reachable test action',
    );
  } finally {
    await app.close(connection);
  }
}
async function fixtureDictation(file: string) {
  const wav = await readFile(file);
  let data: Buffer | undefined;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4);
    if (wav.toString('ascii', offset, offset + 4) === 'data') {
      data = wav.subarray(offset + 8, offset + 8 + size);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  assert.ok(data);
  await writeFile(
    path.join(profile, 'speech-preferences-v1.json'),
    JSON.stringify({ language: 'en', microphone: '' }),
  );
  const app = await ownedApp(binary, profile, { mode: 'foreground' });
  const page = await app.connect();
  try {
    const permission = await page.evaluate(pageCall(speechStatus));
    if (permission.microphone !== 'granted') {
      checks.push(
        'public-clip capture skipped: microphone consent must first be granted by the operator',
      );
      return;
    }
    // Generated/public clip only: the real microphone is never acquired in this check.
    await page.evaluate(pageCall(installFixtureCapture, data.toString('base64')));
    await page.command('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: ' ',
      code: 'Space',
      modifiers: 10,
    });
    await page.command('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: ' ',
      code: 'Space',
      modifiers: 0,
    });
    await until(
      () => page.evaluate(textOf('.speech-dialog .speech-status')),
      (value) => value.includes('Record up to'),
      'quick shortcut release cancels pending start',
    );
    assert.equal(await page.evaluate(pageCall(captureCalls)), 0);
    await page.evaluate(click('.speech-dialog header button'));
    await page.evaluate(pageCall(dictate));
    await until(
      () => page.evaluate(textOf('.speech-dialog')),
      (value) =>
        value.includes('Finish recording') ||
        value.includes('cancelled') ||
        value.includes('denied'),
      'fixture capture starts',
    );
    assert.ok((await page.evaluate(textOf('.speech-dialog'))).includes('Finish recording'));
    await until(
      async () => {
        const state = await page.evaluate(pageCall(captureState));
        if (state.error) throw new Error('Fixture capture failed: ' + JSON.stringify(state));
        return state.seconds;
      },
      (value) => value >= Math.floor(data!.length / 32000),
      'public clip passes through AudioWorklet',
      20000,
    );
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await page.evaluate(pageCall(pressDialogButton, 'Finish recording'));
    await until(
      () => page.evaluate(exists('textarea[aria-label=Transcript]')),
      Boolean,
      'native inference transcript',
      15000,
    );
    const transcript = await page.evaluate(valueOf('textarea[aria-label=Transcript]'));
    assert.match(transcript, /country/i);
    for (const [name, width, height] of [
      ['desktop', 900, 640],
      ['minimum', 760, 540],
    ] as const) {
      await page.command('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const shot = await page.command<{ data: string }>('Page.captureScreenshot', {
        format: 'png',
      });
      await writeFile(
        path.join(captures, `speech-transcript-${name}.png`),
        Buffer.from(shot.data, 'base64'),
      );
    }
    await page.evaluate(pageCall(setTranscript, 'Open Documents'));
    await page.evaluate(pageCall(pressDialogButton, 'Insert text'));
    await until(
      () => page.evaluate(valueOf('input[aria-label="Ask in words"]')),
      (value) => value === 'Open Documents',
      'reviewed transcript enters editable Ask field',
    );
    assert.equal(await page.evaluate(pageCall(captureCalls)), 1);
    await page.evaluate(
      pageCall(() => (window as unknown as FixtureWindow).fixtureAudioContext.close()),
    );
    checks.push(
      'public clip → AudioWorklet → window-owned PCM → bundled recognizer → editable transcript → Ask draft; no model request or command executed',
    );
    checks.push(
      'real shortcut press/release cancels pending capture; normal/minimum transcript layout',
    );
  } finally {
    await app.close(page);
  }
}
try {
  await inspect(false);
  const weights = process.env.VIEWER_SPEECH_TEST_WEIGHTS;
  if (weights) {
    const models = new SpeechModels(profile);
    try {
      await models.request(
        { kind: 'import', model: 'whisper-tiny', source: path.resolve(weights) },
        'generated-import',
      );
      await models.request({ kind: 'use', model: 'whisper-tiny' }, 'generated-select');
    } finally {
      await models.close();
    }
    await writeFile(
      path.join(profile, 'speech-preferences-v1.json'),
      JSON.stringify({ language: 'ro', microphone: '' }),
      { flag: 'wx' },
    );
    await inspect(true);
    if (process.env.VIEWER_SPEECH_TEST_CLIP)
      await fixtureDictation(path.resolve(process.env.VIEWER_SPEECH_TEST_CLIP));
  }
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      { checks, microphone: 'No person recorded. Hardware consent is a separate operator check.' },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ root, checks }));
} catch (error) {
  await writeFile(path.join(root, 'failure.txt'), String(error));
  throw error;
}
