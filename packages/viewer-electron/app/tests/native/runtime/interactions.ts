import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import type { NativeScenarioHarness } from './harness';

/** User-facing actions against an exclusively owned QA app. Waiting stays tied
 * to observed UI state; this adapter never answers native permission/removal dialogs. */
export class NativeInteractions {
  constructor(private readonly app: NativeScenarioHarness) {}

  async click(selector: string): Promise<void> {
    await this.app.until(
      () =>
        this.app.evaluate<number>(`document.querySelectorAll(${JSON.stringify(selector)}).length`),
      (count) => count === 1,
      'Unique control ' + selector,
    );
    await this.app.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  }

  async button(label: string, scope = 'document'): Promise<void> {
    const expression = `[...${scope}.querySelectorAll('button')].filter(button => button.textContent.trim() === ${JSON.stringify(label)} && !button.disabled)`;
    await this.app.until(
      () => this.app.evaluate<number>(`(${expression}).length`),
      (count) => count === 1,
      'Unique enabled button ' + label,
    );
    await this.app.evaluate(`(${expression})[0].click()`);
  }

  async key(key: string, code: string, modifiers = 0, commands?: string[]): Promise<void> {
    for (const type of ['keyDown', 'keyUp'])
      await this.app.command('Input.dispatchKeyEvent', {
        type,
        key,
        code,
        modifiers,
        ...(type === 'keyDown' && commands ? { commands } : {}),
        ...(key === ' ' ? { windowsVirtualKeyCode: 32 } : {}),
      });
  }

  async text(selector: string, text: string): Promise<void> {
    await this.app.until(
      () => this.app.evaluate<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`),
      Boolean,
      'Text field ' + selector,
    );
    await this.app.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
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
      () =>
        this.app.evaluate<string>(
          'document.querySelector(".command-result[aria-selected=true]")?.textContent || ""',
        ),
      (text) => text.includes(label),
      'Palette result ' + label,
    );
    await this.click('.command-result[aria-selected=true]');
    await this.app.until(
      () =>
        this.app.evaluate<boolean>(
          `!document.querySelector(${JSON.stringify('[aria-label="Search commands"]')})`,
        ),
      Boolean,
      'Palette dismissed',
    );
    // Dispatch happens after the palette releases its captured command source.
    await this.app.evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
  }

  async capture(file: string): Promise<void> {
    await this.app.evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    await this.app.until(
      () => this.app.evaluate<boolean>('!document.querySelector("[data-plurid-motion]")'),
      Boolean,
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
      () =>
        this.app.evaluate<boolean>(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element || document.querySelector('[data-plurid-motion]')) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width < 300 || rect.height < 150 || rect.left < 0 || rect.top < 50 || rect.right > innerWidth || rect.bottom > innerHeight) return false;
        let opacity = 1;
        for (let parent = element; parent; parent = parent.parentElement) opacity *= Number(getComputedStyle(parent).opacity);
        return opacity > 0.999 && element.contains(document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2));
      })()`),
      Boolean,
      'Readable, unobstructed view ' + selector,
    );
  }
}
