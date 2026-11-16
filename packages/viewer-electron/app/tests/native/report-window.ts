import { app, clipboard } from 'electron';
import type { WebContents } from 'electron';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ReportWindow, reportDisclosure } from '../../src/desktop/windows/report-window';
import type { ReportLook } from '../../src/desktop/windows/report-window';
import { pageCall } from './runtime/page-function';
import type { PageExpression } from './runtime/page-function';

const output = process.argv[2];
if (
  !output ||
  process.env.VIEWER_TEST_PRESERVE !== '1' ||
  process.env.VIEWER_TEST_NO_REMOVAL !== '1'
)
  throw new Error('Supply a retained evidence folder with preservation and removal guards.');
app.setPath('userData', path.join(output, 'Profile'));
app.setActivationPolicy('accessory');
app.on('window-all-closed', () => {});

const report = [
  '# Viewer report',
  '',
  '- Viewer: 1.0.0',
  '- Build: 123',
  '- Edition: direct',
  '- License: trial',
  '- macOS: 15.1',
  '- Model: Mac16,1',
  '- Chip: Apple M4',
  '- Memory: 16 GiB',
  '- Displays: 2 (2×, 1×)',
  '- Language: en-GB',
  '- Region: GB',
  '',
  '## Recent failures (newest first)',
  '',
  ...Array.from(
    { length: 20 },
    () => '### 2026-11-01T12:00:00.000Z (renderer-error)\n\n> Read failed: ~/…/….pdf\n',
  ),
].join('\n');
let copied: string | undefined;
// Exercise the native button route without replacing another application's clipboard contents.
clipboard.writeText = async (text: string) => {
  copied = text;
};

async function inspect<R>(contents: WebContents, expression: PageExpression<R>): Promise<R> {
  const result = await contents.debugger.sendCommand('Runtime.evaluate', {
    expression,
    returnByValue: true,
  });
  assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  return result.result.value as R;
}

async function verify(): Promise<void> {
  await app.whenReady();
  app.dock?.hide();
  const captures = path.join(output!, 'screenshots');
  await mkdir(captures, { recursive: true });
  const evidence: unknown[] = [];
  for (const look of ['dark', 'light'] as const satisfies readonly ReportLook[]) {
    const owner = new ReportWindow(
      async () => report,
      () => look,
      false,
    );
    await owner.open();
    const window = owner.window!;
    window.webContents.debugger.attach('1.3');
    window.webContents.on('will-navigate', (_event, url) => {
      process.stdout.write('Report navigation: ' + url + '\n');
    });
    window.webContents.debugger.on('message', (_event, method, parameters) => {
      if (method === 'Log.entryAdded') process.stdout.write(JSON.stringify(parameters) + '\n');
    });
    await window.webContents.debugger.sendCommand('Log.enable');
    await window.webContents.debugger.sendCommand('Accessibility.enable');
    const accessibility = await window.webContents.debugger.sendCommand(
      'Accessibility.getFullAXTree',
    );
    const names = accessibility.nodes.map(
      (node: { name?: { value?: string } }) => node.name?.value ?? '',
    );
    assert(names.some((name: string) => name.includes(reportDisclosure)));
    assert(names.some((name: string) => name === 'Copy'));
    for (const [width, height] of [
      [600, 560],
      [440, 360],
    ]) {
      window.setSize(width!, height!);
      const state = await inspect(
        window.webContents,
        pageCall(() => {
          const preview = document.querySelector('pre')!;
          const button = document.querySelector('button')!;
          const box = button.getBoundingClientRect();
          return {
            text: preview.textContent,
            sentence: document.getElementById('privacy')?.textContent,
            buttons: document.querySelectorAll('button').length,
            scripts: document.querySelectorAll('script').length,
            viewer: typeof Reflect.get(globalThis, 'viewer'),
            copy: { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) },
            fits: box.bottom <= innerHeight && box.right <= innerWidth,
            scrolls: preview.scrollHeight > preview.clientHeight,
            pageFits: document.documentElement.scrollWidth <= innerWidth,
          };
        }),
      );
      assert.equal(state.text, report);
      assert.equal(state.sentence, reportDisclosure);
      assert.equal(state.buttons, 1);
      assert.equal(state.scripts, 0);
      assert.equal(state.viewer, 'undefined');
      assert(state.fits && state.scrolls && state.pageFits);
      await writeFile(
        path.join(captures, `${look}-${width}.png`),
        (await window.webContents.capturePage()).toPNG(),
        { flag: 'wx' },
      );
      evidence.push({ look, width, height, ...state });
    }
    const button = await inspect(
      window.webContents,
      pageCall(() => {
        const box = document.querySelector('button')!.getBoundingClientRect();
        return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
      }),
    );
    if (look === 'light') {
      await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        ...button,
      });
      const filter = await inspect(
        window.webContents,
        pageCall(() => getComputedStyle(document.querySelector('button')!).filter),
      );
      assert.equal(filter, 'brightness(0.94)');
      await writeFile(
        path.join(captures, 'light-hover-440.png'),
        (await window.webContents.capturePage()).toPNG(),
        { flag: 'wx' },
      );
    }
    const closed = new Promise<void>((resolve) => window.once('closed', () => resolve()));
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...button,
      button: 'left',
      clickCount: 1,
    });
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...button,
      button: 'left',
      clickCount: 1,
    });
    await closed;
    assert.equal(copied, report);
    copied = undefined;
  }
  for (const keyCode of ['Escape', 'Enter']) {
    process.stdout.write('Checking report key: ' + keyCode + '\n');
    const owner = new ReportWindow(
      async () => report,
      () => 'dark',
      false,
    );
    await owner.open();
    process.stdout.write('Report key window loaded.\n');
    const window = owner.window!;
    window.webContents.debugger.attach('1.3');
    const closed = new Promise<void>((resolve) => window.once('closed', () => resolve()));
    await window.webContents.debugger
      .sendCommand('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: keyCode,
        code: keyCode,
        windowsVirtualKeyCode: keyCode === 'Escape' ? 27 : 13,
      })
      .catch(() => {});
    await closed;
    assert.equal(copied, keyCode === 'Escape' ? undefined : report);
  }
  await writeFile(
    path.join(output!, 'result.json'),
    JSON.stringify({ passed: true, clipboard: 'intercepted', evidence }, null, 2),
    { flag: 'wx' },
  );
  process.stdout.write(
    'Report window: native Copy, Return, Escape, accessibility tree and four captures passed.\n',
  );
  app.quit();
}

const timeout = setTimeout(() => {
  process.stderr.write('Report window verification timed out.\n');
  app.exit(1);
}, 90000);
void verify()
  .then(() => clearTimeout(timeout))
  .catch((error: unknown) => {
    process.stderr.write(String(error) + '\n');
    app.exit(1);
  });
