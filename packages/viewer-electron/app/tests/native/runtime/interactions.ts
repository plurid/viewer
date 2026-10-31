import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import type { NativeScenarioHarness } from './harness';
import { animationFrames, click, countOf, exists, focus, textOf } from './page';
import { pageCall } from './page-function';

/** Counts the enabled buttons labelled `label` in `scope`, pressing the first when asked. */
function enabledButtons(label: string, scope: string | null, press: boolean): number {
  const root = scope === null ? document : document.querySelector(scope);
  const buttons = [...(root?.querySelectorAll('button') ?? [])].filter(
    (button) => button.textContent.trim() === label && !button.disabled,
  );
  if (press) buttons[0]!.click();
  return buttons.length;
}

/** Whether `selector` is settled, at least 300 by 150, inside the window, opaque and on top. */
function unobstructed(selector: string): boolean {
  const element = document.querySelector(selector);
  if (!element || document.querySelector('[data-plurid-motion]')) return false;
  const rect = element.getBoundingClientRect();
  if (
    rect.width < 300 ||
    rect.height < 150 ||
    rect.left < 0 ||
    rect.top < 50 ||
    rect.right > innerWidth ||
    rect.bottom > innerHeight
  )
    return false;
  let opacity = 1;
  for (let parent: Element | null = element; parent; parent = parent.parentElement)
    opacity *= Number(getComputedStyle(parent).opacity);
  const centre = document.elementFromPoint(
    (rect.left + rect.right) / 2,
    (rect.top + rect.bottom) / 2,
  );
  return opacity > 0.999 && element.contains(centre);
}

/** Keys whose default action Chromium takes only with their virtual key code: Space presses the
 * focused button, Escape cancels a modal dialog. */
const virtualKeyCodes: Record<string, number> = { ' ': 32, Escape: 27 };

/** User-facing actions against an exclusively owned QA app. Waiting stays tied
 * to observed UI state; this adapter never answers native permission/removal dialogs. */
export class NativeInteractions {
  constructor(private readonly app: NativeScenarioHarness) {}

  async click(selector: string): Promise<void> {
    await this.app.until(
      () => this.app.evaluate(countOf(selector)),
      (count) => count === 1,
      'Unique control ' + selector,
    );
    await this.app.evaluate(click(selector));
  }

  /** `scope`: a selector for the part of the window that holds the button. */
  async button(label: string, scope?: string): Promise<void> {
    await this.app.until(
      () => this.app.evaluate(pageCall(enabledButtons, label, scope ?? null, false)),
      (count) => count === 1,
      'Unique enabled button ' + label,
    );
    await this.app.evaluate(pageCall(enabledButtons, label, scope ?? null, true));
  }

  async key(key: string, code: string, modifiers = 0, commands?: string[]): Promise<void> {
    const virtual = virtualKeyCodes[key];
    for (const type of ['keyDown', 'keyUp'])
      await this.app.command('Input.dispatchKeyEvent', {
        type,
        key,
        code,
        modifiers,
        ...(type === 'keyDown' && commands ? { commands } : {}),
        ...(virtual ? { windowsVirtualKeyCode: virtual } : {}),
      });
  }

  async text(selector: string, text: string): Promise<void> {
    await this.app.until(
      () => this.app.evaluate(exists(selector)),
      Boolean,
      'Text field ' + selector,
    );
    await this.app.evaluate(focus(selector));
    await this.key('a', 'KeyA', 4, ['selectAll']);
    await this.app.command('Input.insertText', { text });
  }

  async field(label: string, text: string): Promise<void> {
    await this.text('[aria-label=' + JSON.stringify(label) + ']', text);
  }

  async palette(label: string): Promise<void> {
    await this.click('[aria-label="Commands (⌘K)"]');
    await this.field('Search commands', label);
    await this.app.until(
      () => this.app.evaluate(textOf('.command-result[aria-selected=true]')),
      (text) => text.includes(label),
      'Palette result ' + label,
    );
    await this.click('.command-result[aria-selected=true]');
    await this.app.until(
      () => this.app.evaluate(exists('[aria-label="Search commands"]')),
      (open) => !open,
      'Palette dismissed',
    );
    // Dispatch happens after the palette releases its captured command source.
    await this.app.evaluate(animationFrames(2));
  }

  async capture(file: string): Promise<void> {
    await this.app.evaluate(animationFrames(2));
    await this.app.until(
      () => this.app.evaluate(exists('[data-plurid-motion]')),
      (moving) => !moving,
      'Camera settled',
    );
    const picture = await this.app.command<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
    });
    assert.ok(picture.data.length > 100);
    await writeFile(file, Buffer.from(picture.data, 'base64'), { flag: 'wx' });
  }

  async visible(selector: string): Promise<void> {
    await this.app.until(
      () => this.app.evaluate(pageCall(unobstructed, selector)),
      Boolean,
      'Readable, unobstructed view ' + selector,
    );
  }
}
