/** Verify the real native shadow policy across application and window hiding. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { backdropWindowOptions } from '../../src/desktop/windows/backdrop';
import { temporaryRoot } from '../../tools/temporary';
import { ensureElectronRuntime } from '../../tools/native-build/runtime';

assert.equal(process.platform, 'darwin');
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const root = await realpath(await temporaryRoot('viewer-native-clear-backdrop-'));
const profile = path.join(root, 'Profile');
await mkdir(profile, { mode: 0o700 });
const source = await readFile(path.join(appRoot, 'src/desktop/windows/backdrop.ts'));
const options = backdropWindowOptions('clear', 'dark');
const resultFile = path.join(root, 'result.json');
const fixture = path.join(root, 'clear-backdrop.cjs');
const visibilityProbe = path.join(root, 'application-visibility');
await promisify(execFile)('/usr/bin/xcrun', [
  'swiftc',
  path.join(appRoot, 'tests/native/fixtures/application-visibility.swift'),
  '-o',
  visibilityProbe,
]);
const fixturePage = `
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
  body { margin: 0; background: #272a3099; height: 100vh; overflow: hidden; }
  #plane { position: absolute; left: 80px; top: 80px; width: 480px; height: 320px; background: #31353d; }
</style>
<div id="plane"></div>`;

// Keep the native fixture isolated from the packaged app, its profiles and its credentials.
await writeFile(
  fixture,
  `
const assert = require('node:assert/strict');
const { writeFile } = require('node:fs/promises');
const { setTimeout: delay } = require('node:timers/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(profile)});
app.setName('Viewer clear-backdrop regression');
const result = {
  options: ${JSON.stringify(options)},
  sourceSha256: ${JSON.stringify(createHash('sha256').update(source).digest('hex'))},
  observations: [],
};
let window;
const snapshot = async phase => {
  const { stdout } = await promisify(execFile)(
    ${JSON.stringify(visibilityProbe)}, [String(process.pid)]
  );
  result.observations.push({
    phase,
    shadow: window.hasShadow(),
    applicationHidden: app.isHidden(),
    windowVisible: window.isVisible(),
    native: JSON.parse(stdout),
  });
};
app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({
      width: 800,
      height: 600,
      ...result.options,
      titleBarStyle: 'hiddenInset',
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    await window.loadURL('data:text/html,' + encodeURIComponent(${JSON.stringify(fixturePage)}));
    await snapshot('created');
    app.hide();
    await delay(100);
    await snapshot('application-hidden');
    app.show();
    window.show();
    await delay(100);
    await snapshot('application-restored');
    await window.webContents.executeJavaScript(
      "document.querySelector('#plane').style.transform = 'translate(140px, 70px)'"
    );
    await snapshot('plane-moved');
    window.hide();
    await delay(50);
    await snapshot('window-hidden');
    window.show();
    await delay(50);
    await snapshot('window-restored');
    assert.equal(result.observations[1].applicationHidden, true);
    assert.equal(result.observations[2].applicationHidden, false);
    assert.equal(result.observations[4].windowVisible, false);
    assert.equal(result.observations[5].windowVisible, true);
    assert.equal(result.observations[1].native.onScreenWindows, 0);
    assert.ok(result.observations[2].native.onScreenWindows > 0);
    assert.equal(result.observations[4].native.onScreenWindows, 0);
    assert.ok(result.observations[5].native.onScreenWindows > 0);
    for (const observation of result.observations) {
      assert.equal(observation.shadow, false,
        'Clear windows must not retain an alpha-derived native shadow: ' + observation.phase);
    }
    result.passed = true;
  } catch (error) {
    result.error = error.stack || String(error);
    process.exitCode = 1;
  } finally {
    await writeFile(${JSON.stringify(resultFile)}, JSON.stringify(result, null, 2));
    app.quit();
  }
});
`,
  { flag: 'wx', mode: 0o600 },
);

try {
  const runtime = await ensureElectronRuntime({ appRoot });
  const output = await promisify(execFile)(runtime.executable, [fixture], {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
  });
  await writeFile(path.join(root, 'stdout.log'), output.stdout, { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(root, 'stderr.log'), output.stderr, { flag: 'wx', mode: 0o600 });
  const result = JSON.parse(await readFile(resultFile, 'utf8')) as {
    passed?: boolean;
    error?: string;
  };
  assert.equal(result.passed, true, result.error ?? 'The native shadow regression did not pass.');
  console.log('PASS native clear-window shadow policy across application/window hide and restore.');
} finally {
  console.log('Retained native clear-backdrop evidence: ' + resultFile);
}
