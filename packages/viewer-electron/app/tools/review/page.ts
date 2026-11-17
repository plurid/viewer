/**
 * What a scene's steps do to the app: the actions a person takes, by role and visible name where
 * the page allows, waiting on what the page shows rather than on time.
 */
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { ownedApp } from '../../tests/owned-app';
import { until } from '../../tests/owned-app';
import { animationFrames, countOf, exists } from '../../tests/native/runtime/page';
import type { PageExpression } from '../../tests/native/runtime/page-function';
import { pageCall } from '../../tests/native/runtime/page-function';
import type { Connection } from '../docs/record';
import { checkSelectors, markLayoutBoxes, movedLayout } from './checks';
import type { Finding, Variant } from './types';

type OwnedApp = Awaited<ReturnType<typeof ownedApp>>;

/** CDP modifier bits. */
export const modifiers = { alt: 1, control: 2, command: 4, shift: 8 } as const;

/** The first enabled button in `scope` whose text or accessible name is `label`; presses it when
 * asked. */
function labelledButton(label: string, scope: string | null, press: boolean): boolean {
  const root = scope === null ? document : document.querySelector(scope);
  const button = [
    ...(root?.querySelectorAll<HTMLElement>('button, [role="button"], [role="menuitem"]') ?? []),
  ].find(
    (item) =>
      (item.textContent.trim() === label || item.getAttribute('aria-label') === label) &&
      !(item as HTMLButtonElement).disabled,
  );
  if (press) button!.click();
  return !!button;
}

/** Selects one row, as a click does, and gives it focus for the keys that follow. */
function selectRow(selector: string): void {
  const row = document.querySelector<HTMLElement>(selector)!;
  row.scrollIntoView({ block: 'nearest' });
  row.click();
  row.focus();
}

/** Adds a row to the selection, as ⌘-click does. */
function addRow(selector: string): void {
  document
    .querySelector(selector)!
    .dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
}

/** The palette result labelled `label`: whether it shows, pressing it when asked. Letter case is
 * ignored, so a scene survives a change between title and sentence case. */
function paletteResult(label: string, press: boolean): boolean {
  const result = [...document.querySelectorAll<HTMLElement>('button.command-result')].find(
    (row) =>
      row.querySelector('.command-result-text > span')?.textContent.trim().toLowerCase() ===
      label.toLowerCase(),
  );
  if (press) result!.click();
  return !!result;
}

/** Nothing moves: no camera motion, no finite transition running, fonts loaded. A spinner's
 * endless animation does not count. */
function settled(): Promise<boolean> {
  return document.fonts.ready.then(
    () =>
      !document.querySelector('[data-plurid-motion]') &&
      document
        .getAnimations()
        .every(
          (animation) =>
            animation.playState !== 'running' ||
            animation.effect?.getComputedTiming().iterations === Infinity,
        ),
  );
}

export class ReviewPage {
  /** The window the capture shows: the main window, or Settings once `settings` opened it. */
  connection: Connection;
  /** Layout shifts the steps measured. */
  readonly findings: Finding[] = [];
  /** Command palette labels the steps ran. */
  readonly commands: string[] = [];

  constructor(
    private readonly app: OwnedApp,
    readonly main: Connection,
    /** The app's home: the run's sample home. */
    readonly home: string,
    readonly variant: Variant,
  ) {
    this.connection = main;
  }

  /** An absolute path inside the sample home. */
  path(...parts: string[]): string {
    return path.join(this.home, ...parts);
  }

  /** The selector of a file's row or tile, by its absolute path. */
  row(file: string): string {
    return '[data-file-path=' + JSON.stringify(file) + ']';
  }

  evaluate<R>(expression: PageExpression<R>): Promise<Awaited<R>> {
    return this.connection.evaluate(expression);
  }

  command<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}) {
    return this.connection.command<T>(method, params);
  }

  until<T>(read: () => Promise<T>, accept: (value: T) => unknown, label: string, ms = 15000) {
    return until(read, accept, label, ms);
  }

  /** Waits until `selector` matches at least `count` elements. */
  async waitFor(selector: string, count = 1, ms = 15000): Promise<void> {
    await this.until(
      () => this.evaluate(countOf(selector)),
      (found) => found >= count,
      'Waiting for ' + selector,
      ms,
    );
  }

  async gone(selector: string, ms = 15000): Promise<void> {
    await this.until(
      () => this.evaluate(exists(selector)),
      (found) => !found,
      'Waiting for ' + selector + ' to close',
      ms,
    );
  }

  /** Clicks the one element `selector` matches. */
  async click(selector: string): Promise<void> {
    await this.until(
      () => this.evaluate(countOf(selector)),
      (found) => found === 1,
      'One element for ' + selector,
    );
    await this.evaluate(
      pageCall((selector: string) => {
        const element = document.querySelector<HTMLElement>(selector)!;
        element.scrollIntoView({ block: 'nearest' });
        element.click();
      }, selector),
    );
    await this.settle();
  }

  /** Clicks the first element `selector` matches, waiting for one. */
  async clickFirst(selector: string): Promise<void> {
    await this.waitFor(selector);
    await this.evaluate(
      pageCall((selector: string) => {
        const element = document.querySelector<HTMLElement>(selector)!;
        element.scrollIntoView({ block: 'nearest' });
        element.click();
      }, selector),
    );
    await this.settle();
  }

  /** Presses the enabled button whose text or accessible name is `label`. */
  async button(label: string, scope?: string): Promise<void> {
    await this.until(
      () => this.evaluate(pageCall(labelledButton, label, scope ?? null, false)),
      Boolean,
      'Button ' + label,
    );
    await this.evaluate(pageCall(labelledButton, label, scope ?? null, true));
    await this.settle();
  }

  /** Presses a key, with `modifiers` bits, as the keyboard does. */
  async key(key: string, code: string, bits = 0): Promise<void> {
    const virtual: Record<string, number> = {
      ' ': 32,
      Escape: 27,
      Enter: 13,
      ArrowDown: 40,
      ArrowUp: 38,
    };
    for (const type of ['keyDown', 'keyUp'])
      await this.command('Input.dispatchKeyEvent', {
        type,
        key,
        code,
        modifiers: bits,
        ...(virtual[key] ? { windowsVirtualKeyCode: virtual[key] } : {}),
        ...(type === 'keyDown' && key === 'Enter' ? { text: '\r' } : {}),
      });
    await this.settle();
  }

  /** Types into the field `selector`, replacing its text. */
  async type(selector: string, text: string): Promise<void> {
    await this.waitFor(selector);
    await this.evaluate(
      pageCall((selector: string) => {
        const field = document.querySelector<HTMLInputElement>(selector)!;
        field.focus();
        field.select();
      }, selector),
    );
    await this.command('Input.insertText', { text });
    await this.settle();
  }

  /** Selects one file in the shown folder, by its absolute path. */
  async select(file: string): Promise<void> {
    await this.waitFor(this.row(file));
    await this.evaluate(pageCall(selectRow, this.row(file)));
    await this.settle();
  }

  /** Adds a file to the selection, by its absolute path. */
  async addToSelection(file: string): Promise<void> {
    await this.waitFor(this.row(file));
    await this.evaluate(pageCall(addRow, this.row(file)));
    await this.settle();
  }

  /** Opens the command palette with `query` typed, without running anything. */
  async openPalette(query = ''): Promise<void> {
    const button = '[aria-label="Commands (⌘K)"]';
    if (await this.evaluate(exists(button))) await this.click(button);
    else await this.key('k', 'KeyK', modifiers.command);
    await this.waitFor('[aria-label="Search commands"]');
    if (query) await this.type('[aria-label="Search commands"]', query);
  }

  /** Runs the command labelled `label`, in any letter case, from the palette. */
  async palette(label: string): Promise<void> {
    await this.openPalette(label);
    await this.until(
      () => this.evaluate(pageCall(paletteResult, label, false)),
      Boolean,
      'Palette result ' + label,
    );
    await this.evaluate(pageCall(paletteResult, label, true));
    this.commands.push(label);
    await this.gone('[aria-label="Search commands"]');
    // the command runs after the palette lets go of its captured target
    await this.evaluate(animationFrames(2));
    await this.settle();
  }

  /** Waits for the page to stop moving, then a little longer for late layout. */
  async settle(ms = 250): Promise<void> {
    await this.evaluate(animationFrames(2));
    // a page that keeps moving is captured as it is: the picture shows it
    await this.until(() => this.evaluate(pageCall(settled)), Boolean, 'Page settled', 3000).catch(
      () => undefined,
    );
    await delay(ms);
  }

  /** Runs `change`, then records toolbars, footers and columns that moved because of it. */
  async layoutShift(change: () => Promise<void>, parts = checkSelectors.layout): Promise<void> {
    await this.settle();
    await this.evaluate(markLayoutBoxes(parts));
    await change();
    await this.settle(400);
    this.findings.push(...(await this.evaluate(movedLayout())));
  }

  /** Applies the variant's window size to the window being captured. */
  async applyViewport(): Promise<void> {
    await this.command('Emulation.setDeviceMetricsOverride', {
      width: this.variant.width,
      height: this.variant.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await this.settle();
  }

  /** Opens Settings at `category` and captures its window from now on. */
  async settings(category?: string): Promise<void> {
    await this.main.evaluate(pageCall(() => window.viewer.openSettings()));
    this.connection = await this.app.connect(true);
    await this.applyViewport();
    await this.waitFor('nav[aria-label="Settings categories"]');
    if (category) {
      await this.button(category, 'nav[aria-label="Settings categories"]');
      await this.settle(400);
    }
  }
}
