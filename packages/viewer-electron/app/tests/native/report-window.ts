import { app, clipboard } from 'electron';
import type { WebContents } from 'electron';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ReportWindow,
  reportDisclosure,
  reportMessageWarning,
} from '../../src/desktop/windows/report-window';
import { diagnosticReport } from '../../src/desktop/diagnostics/report';
import { hostileMessages, reportFixture } from '../support/report-fixtures';
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

const input = reportFixture(
  Array.from({ length: 20 }, (_, index) => hostileMessages[index % hostileMessages.length]!),
);
const report = diagnosticReport(input);
const optional = diagnosticReport({ ...input, includeMessageText: true });
let copied: string | undefined;
// Exercise the native controls without replacing another application's clipboard contents.
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
async function click(contents: WebContents, selector: string): Promise<void> {
  const point = await inspect(
    contents,
    pageCall((target) => {
      const box = document.querySelector(target)!.getBoundingClientRect();
      return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    }, selector),
  );
  for (const type of ['mousePressed', 'mouseReleased'])
    await contents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type,
      ...point,
      button: 'left',
      clickCount: 1,
    });
}
async function shown(contents: WebContents, text: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const ready = await inspect(
      contents,
      pageCall(
        (expected) =>
          document.querySelector('pre')?.textContent === expected &&
          !document.querySelector('button')!.disabled,
        text,
      ),
    );
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('The report did not finish updating.');
}

async function verify(): Promise<void> {
  await app.whenReady();
  app.dock?.hide();
  const captures = path.join(output!, 'screenshots');
  await mkdir(captures, { recursive: true });
  const evidence: unknown[] = [];
  for (const look of ['dark', 'light'] as const) {
    const requests: boolean[] = [];
    const owner = new ReportWindow(
      async () => {
        requests.push(false);
        return { report, withMessageText: async () => {
          requests.push(true);
          return optional;
        } };
      },
      () => look,
      false,
    );
    await owner.open();
    assert.deepEqual(requests, [false]);
    const window = owner.window!;
    const contents = window.webContents;
    contents.debugger.attach('1.3');
    await contents.debugger.sendCommand('Accessibility.enable');
    const accessibility = await contents.debugger.sendCommand('Accessibility.getFullAXTree');
    const names = accessibility.nodes.map(
      (node: { name?: { value?: string } }) => node.name?.value ?? '',
    );
    assert(names.includes(reportDisclosure));
    assert(names.includes('Include message text'));
    assert(names.includes('Copy'));
    for (const [width, height] of [
      [600, 640],
      [440, 480],
    ]) {
      window.setSize(width!, height!);
      const state = await inspect(
        contents,
        pageCall(() => {
          const preview = document.querySelector('pre')!;
          const box = document.querySelector('button')!.getBoundingClientRect();
          return {
            text: preview.textContent,
            sentence: document.getElementById('privacy')?.textContent,
            checked: document.querySelector<HTMLInputElement>('input')!.checked,
            warningHidden: document.getElementById('message-warning')!.hidden,
            viewer: typeof Reflect.get(globalThis, 'viewer'),
            scripts: document.querySelectorAll('script').length,
            fits: box.bottom <= innerHeight && box.right <= innerWidth,
            scrolls: preview.scrollHeight > preview.clientHeight,
          };
        }),
      );
      assert.equal(state.text, report);
      assert.equal(state.sentence, reportDisclosure);
      assert.equal(state.checked, false);
      assert.equal(state.warningHidden, true);
      assert.equal(state.viewer, 'undefined');
      assert.equal(state.scripts, 0);
      assert(state.fits && state.scrolls);
      await writeFile(
        path.join(captures, look + '-' + width + '.png'),
        (await contents.capturePage()).toPNG(),
        { flag: 'wx' },
      );
      evidence.push({ look, width, height, ...state });
    }
    await click(contents, 'input');
    await shown(contents, optional);
    assert.deepEqual(requests, [false, true]);
    const warning = await inspect(
      contents,
      pageCall(() => {
        document.querySelector('pre')!.scrollTop = document.querySelector('pre')!.scrollHeight;
        const element = document.getElementById('message-warning')!;
        const box = element.getBoundingClientRect();
        return {
          text: element.textContent,
          visible: !element.hidden && box.bottom <= innerHeight && box.top >= 0,
        };
      }),
    );
    assert.equal(warning.text, reportMessageWarning);
    assert(warning.visible);
    await writeFile(
      path.join(captures, look + '-messages-440.png'),
      (await contents.capturePage()).toPNG(),
      { flag: 'wx' },
    );
    if (look === 'light') {
      await click(contents, 'input');
      await shown(contents, report);
      assert.deepEqual(requests, [false, true]);
    } else {
      const loaded = new Promise<void>((resolve) => contents.once('did-finish-load', () => resolve()));
      contents.reload();
      await loaded;
      await shown(contents, report);
      assert.equal(await inspect(contents, pageCall(() => document.querySelector<HTMLInputElement>('input')!.checked)), false);
      assert.deepEqual(requests, [false, true]);
    }
    const expected = await inspect(
      contents,
      pageCall(() => document.querySelector('pre')!.textContent),
    );
    const closed = new Promise<void>((resolve) => window.once('closed', () => resolve()));
    await click(contents, 'button');
    await closed;
    assert.equal(copied, expected);
    copied = undefined;
  }
  for (const [keyCode, include] of [
    ['Escape', true],
    ['Enter', false],
    ['Enter', true],
  ] as const) {
    const owner = new ReportWindow(
      async () => ({ report, withMessageText: async () => optional }),
      () => 'dark',
      false,
    );
    await owner.open();
    const window = owner.window!;
    const contents = window.webContents;
    contents.debugger.attach('1.3');
    if (include) {
      await click(contents, 'input');
      await shown(contents, optional);
    }
    const closed = new Promise<void>((resolve) => window.once('closed', () => resolve()));
    await contents.debugger
      .sendCommand('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: keyCode,
        code: keyCode,
        windowsVirtualKeyCode: keyCode === 'Escape' ? 27 : 13,
      })
      .catch(() => {});
    await closed;
    assert.equal(copied, keyCode === 'Escape' ? undefined : include ? optional : report);
    copied = undefined;
  }
  await writeFile(
    path.join(output!, 'example-default-report.txt'),
    diagnosticReport(reportFixture()),
    { flag: 'wx' },
  );
  await writeFile(
    path.join(output!, 'result.json'),
    JSON.stringify({ passed: true, clipboard: 'intercepted', evidence }, null, 2),
    { flag: 'wx' },
  );
  process.stdout.write(
    'Report window passed: default, opt-in, warning, exact Copy, Return, Escape and accessibility tree.\n',
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
