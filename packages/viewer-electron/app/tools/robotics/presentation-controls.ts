import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { canvasFrame } from '../../tests/native/runtime/canvas';
import { pageCall } from '../../tests/native/runtime/page-function';
import { until } from '../../tests/owned-app';
import type { Connection } from '../docs/record';

/** Native input goes through the visible, spatially transformed plane. */
export function presentationControls(
  main: Connection,
  mapPointer?: (
    session: string,
    projection: { x: number; y: number; scaleX: number; scaleY: number },
  ) => void,
) {
  const events: { milliseconds: number; action: string }[] = [];
  const started = performance.now();
  const mark = (action: string) =>
    events.push({ milliseconds: performance.now() - started, action });
  async function pointer(x: number, y: number, pressed = false, session?: string) {
    await main.command(
      'Input.dispatchMouseEvent',
      {
        type: 'mouseMoved',
        x,
        y,
        buttons: pressed ? 1 : 0,
      },
      session,
    );
  }
  async function clickPoint(x: number, y: number, session?: string) {
    await pointer(x, y, false, session);
    for (const type of ['mousePressed', 'mouseReleased'])
      await main.command(
        'Input.dispatchMouseEvent',
        { type, x, y, button: 'left', clickCount: 1 },
        session,
      );
    await delay(180);
  }
  async function key(key: string, code: string, virtual: number, modifiers = 0, session?: string) {
    for (const type of ['keyDown', 'keyUp'])
      await main.command(
        'Input.dispatchKeyEvent',
        {
          type,
          key,
          code,
          windowsVirtualKeyCode: virtual,
          modifiers,
        },
        session,
      );
    await delay(120);
  }
  async function point(selector: string, text?: string) {
    return main.evaluate(
      pageCall(
        (selector, text) => {
          const el = [...document.querySelectorAll<HTMLElement>(selector)].find(
            (el) =>
              (!text || el.textContent?.trim() === text) &&
              el.checkVisibility() &&
              !el.matches(':disabled'),
          );
          if (!el) return null;
          const r = el.getBoundingClientRect();
          if (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight)
            return null;
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        },
        selector,
        text,
      ),
    );
  }
  async function click(selector: string, text?: string) {
    const p = await until(
      () => point(selector, text),
      Boolean,
      'Visible control ' + (text ?? selector),
    );
    assert.ok(p);
    mark('Click ' + (text ?? selector));
    await clickPoint(p.x, p.y);
  }
  async function type(value: string, session?: string) {
    await main.command(
      'Input.dispatchKeyEvent',
      {
        type: 'keyDown',
        key: 'a',
        code: 'KeyA',
        windowsVirtualKeyCode: 65,
        modifiers: process.platform === 'darwin' ? 4 : 2,
        commands: ['selectAll'],
      },
      session,
    );
    await main.command(
      'Input.dispatchKeyEvent',
      {
        type: 'keyUp',
        key: 'a',
        code: 'KeyA',
        windowsVirtualKeyCode: 65,
      },
      session,
    );
    await main.command('Input.insertText', { text: value }, session);
  }
  async function fill(selector: string, value: string) {
    await click(selector);
    await type(value);
  }
  // Framing is fixture setup outside each take; recorded controls use native input below.
  async function dock(id: string, kind: 'canvas' | 'conversation' = 'canvas') {
    const selector = `[data-${kind}-id="${id}"]`;
    await until(
      () =>
        main.evaluate(
          pageCall(
            (selector) =>
              !!document.querySelector(selector) && !document.querySelector('[data-plurid-motion]'),
            selector,
          ),
        ),
      Boolean,
      'plane ready to frame',
    );
    await main.evaluate(
      pageCall((selector) => {
        let el = document.querySelector(selector);
        while (el) {
          const button = el.querySelector<HTMLElement>('[aria-label="Dock plane"]');
          if (button) {
            button.click();
            return;
          }
          el = el.parentElement;
        }
      }, selector),
    );
    await until(
      () =>
        main.evaluate(
          pageCall((selector) => {
            const r = document.querySelector(selector)!.getBoundingClientRect();
            return (
              !document.querySelector('[data-plurid-motion]') &&
              r.left >= -1 &&
              r.right <= innerWidth + 1 &&
              r.top >= 50 &&
              r.bottom <= innerHeight + 1
            );
          }, selector),
        ),
      Boolean,
      'plane framed',
    );
  }
  async function canvas(id: string) {
    const scope = `[data-canvas-id="${id}"]`;
    const frame = await canvasFrame(main, id);
    await until(
      () => frame.evaluate(pageCall(() => document.querySelector('#assetLine')?.textContent)),
      (text) => text?.includes('17 meshes loaded'),
      'all visual meshes',
    );
    async function box(selector: string) {
      const local = await frame.evaluate(
        pageCall(async (selector) => {
          const el = document.querySelector<HTMLElement>(selector);
          if (!el) throw Error('Missing canvas control: ' + selector);
          const panel = el.closest<HTMLElement>('.panel');
          if (panel) {
            const control = el.getBoundingClientRect(),
              bounds = panel.getBoundingClientRect();
            panel.scrollTop += control.y - bounds.y - bounds.height / 2 + control.height / 2;
          }
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          const r = el.getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            frameWidth: innerWidth,
            frameHeight: innerHeight,
          };
        }, selector),
      );
      const parent = await main.evaluate(
        pageCall((scope) => {
          const r = document.querySelector(`${scope} iframe`)!.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }, scope),
      );
      assert.ok(local.width > 0 && local.height > 0, 'Canvas control is visible.');
      mapPointer?.(frame.sessionId, {
        x: parent.x,
        y: parent.y,
        scaleX: parent.width / local.frameWidth,
        scaleY: parent.height / local.frameHeight,
      });
      return {
        x: local.x,
        y: local.y,
        width: local.width,
        height: local.height,
      };
    }
    async function press(selector: string) {
      const r = await box(selector);
      mark('Canvas click ' + selector);
      await clickPoint(r.x + r.width / 2, r.y + r.height / 2, frame.sessionId);
    }
    async function input(selector: string, value: string) {
      await press(selector);
      await type(value, frame.sessionId);
      await key('Tab', 'Tab', 9, 0, frame.sessionId);
    }
    async function drag(selector: string, from: number, to: number, vertical = 0) {
      const r = await box(selector);
      const start = { x: r.x + r.width * from, y: r.y + r.height / 2 };
      mark('Canvas drag ' + selector);
      await pointer(start.x, start.y, false, frame.sessionId);
      await main.command(
        'Input.dispatchMouseEvent',
        {
          type: 'mousePressed',
          ...start,
          button: 'left',
          clickCount: 1,
        },
        frame.sessionId,
      );
      for (let step = 1; step <= 40; step++) {
        await pointer(
          start.x + (r.width * (to - from) * step) / 40,
          start.y + (vertical * step) / 40,
          true,
          frame.sessionId,
        );
        await delay(25);
      }
      await main.command(
        'Input.dispatchMouseEvent',
        {
          type: 'mouseReleased',
          x: r.x + r.width * to,
          y: start.y + vertical,
          button: 'left',
          clickCount: 1,
        },
        frame.sessionId,
      );
      await delay(300);
    }
    return { frame, scope, press, input, drag };
  }
  async function folder(destination: string) {
    const selector = '.viewer-file-picker[open]';
    const entries = (await readdir(destination)).filter((name) => !name.startsWith('.')).sort();
    assert.ok(entries.length <= 12, 'Only the bounded rehearsal handoff is browsed.');
    await until(
      () =>
        main.evaluate(
          pageCall(
            (selector) =>
              !!document.querySelector(`${selector} .file-picker-files[aria-busy="false"]`),
            selector,
          ),
        ),
      Boolean,
      'file picker ready',
    );
    await fill(`${selector} [aria-label="Folder path"]`, destination);
    await click(`${selector} .file-picker-navigation button`, 'Go');
    await until(
      () =>
        main.evaluate(
          pageCall(
            (selector, destination, entries) => {
              const value = document.querySelector<HTMLInputElement>(
                `${selector} [aria-label="Folder path"]`,
              )?.value;
              return (
                value === destination &&
                JSON.stringify(
                  [...document.querySelectorAll(`${selector} .file-picker-row > span`)]
                    .map((el) => el.textContent)
                    .sort(),
                ) === JSON.stringify(entries) &&
                !!document.querySelector(`${selector} .file-picker-files[aria-busy="false"]`)
              );
            },
            selector,
            destination,
            entries,
          ),
        ),
      Boolean,
      'destination browsed',
    );
    await delay(500);
  }
  return { events, mark, canvas, dock, click, fill, key, folder };
}
