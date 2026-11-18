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

/** The box of the first element `selector` matches, in CSS pixels, and its text. `right` and
 * `bottom` are its distances from the window's edges, or from `within`'s when given. */
function boxOf(selector: string, within: string | null = null) {
  const element = document.querySelector(selector);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  const container = within ? element.closest(within)?.getBoundingClientRect() : undefined;
  // The space scales a plane to frame it: sizes and distances are read in the plane's own CSS
  // pixels, as DESIGN gives them, not in the window's.
  const layoutWidth = (element as HTMLElement).offsetWidth;
  const scale = layoutWidth ? rect.width / layoutWidth : 1;
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width / scale,
    height: rect.height / scale,
    right: ((container ? container.right : innerWidth) - rect.right) / scale,
    bottom: ((container ? container.bottom : innerHeight) - rect.bottom) / scale,
    left: (rect.left - (container ? container.left : 0)) / scale,
    top: (rect.top - (container ? container.top : 0)) / scale,
    text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
  };
}

/** How far a field's right edge stops short of its container's content edge, in CSS pixels. */
function shortOf(field: string, container: string): number | null {
  const element = document.querySelector(field);
  const holder = element?.closest(container);
  if (!element || !holder) return null;
  const style = getComputedStyle(holder);
  const rect = holder.getBoundingClientRect();
  const layoutWidth = (holder as HTMLElement).offsetWidth;
  const scale = layoutWidth ? rect.width / layoutWidth : 1;
  const inner =
    rect.right -
    (Number.parseFloat(style.paddingRight) + Number.parseFloat(style.borderRightWidth)) * scale;
  return (inner - element.getBoundingClientRect().right) / scale;
}

/** Clicks the `index`th element `selector` matches, counting from 0. */
function clickNth(selector: string, index: number): boolean {
  const element = document.querySelectorAll<HTMLElement>(selector)[index];
  element?.click();
  return !!element;
}

/** Whether the page's visible text contains `text`. */
function showsText(text: string): boolean {
  return document.body.innerText.includes(text);
}

/** Moves the pointer onto the first element `selector` matches: where to dispatch it. */
function centreOf(selector: string) {
  const element = document.querySelector(selector);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

type MeasuredBox = NonNullable<ReturnType<typeof boxOf>>;
const emptyBox: MeasuredBox = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  right: 0,
  bottom: 0,
  left: 0,
  top: 0,
  text: '',
};
/** Sides and sizes a scene may expect, in CSS pixels; `right` and `bottom` are distances from the
 * window's edges. */
export type BoxExpectation = Partial<
  Pick<MeasuredBox, 'width' | 'height' | 'right' | 'bottom' | 'left' | 'top'>
>;

/** A scene met a build without the feature it shows: the run reports "needs a newer build". */
export class NewerBuildNeeded extends Error {}

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

  /** Waits briefly for what a newer build shows; without it the scene needs a newer build. */
  async needs(selector: string, what: string, ms = 4000): Promise<void> {
    try {
      await this.waitFor(selector, 1, ms);
    } catch {
      throw new NewerBuildNeeded(what);
    }
  }

  /** Whether the palette offers a command labelled `label`, in any letter case. */
  async offers(label: string): Promise<boolean> {
    await this.openPalette(label);
    const found = await this.until(
      () => this.evaluate(pageCall(paletteResult, label, false)),
      Boolean,
      'Palette result ' + label,
      2500,
    ).catch(() => false);
    await this.key('Escape', 'Escape');
    return found;
  }

  private measured(selector: string, box: MeasuredBox, detail: string): void {
    this.findings.push({
      check: 'measure',
      selector,
      text: box.text,
      detail,
      box: {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      },
    });
  }

  /** Records a measurement finding when `selector`'s box differs from `expected` by more than
   * `tolerance` pixels. `what` says what DESIGN asks, such as "The footer is 31 px tall". */
  async expectBox(
    selector: string,
    expected: BoxExpectation,
    what: string,
    options: { within?: string; tolerance?: number } = {},
  ): Promise<void> {
    const tolerance = options.tolerance ?? 1;
    const box = await this.evaluate(pageCall(boxOf, selector, options.within ?? null));
    if (!box) return this.measured(selector, emptyBox, what + ': it is not there.');
    const misses = (Object.keys(expected) as (keyof BoxExpectation)[])
      .filter((key) => Math.abs(box[key] - expected[key]!) > tolerance)
      .map((key) => key + ' ' + Math.round(box[key]) + ' px, not ' + expected[key] + ' px');
    if (misses.length) this.measured(selector, box, what + ': ' + misses.join(', ') + '.');
  }

  /** Records a measurement finding unless `selector`'s width is between `minimum` and `maximum`. */
  async expectWidth(selector: string, minimum: number, maximum: number, what: string) {
    const box = await this.evaluate(pageCall(boxOf, selector, null));
    if (!box) return this.measured(selector, emptyBox, what + ': it is not there.');
    if (box.width < minimum - 1 || box.width > maximum + 1)
      this.measured(selector, box, what + ': it is ' + Math.round(box.width) + ' px wide.');
  }

  /** Records a measurement finding unless `selector` stays `margin` pixels inside the window. */
  async expectInsideWindow(selector: string, margin: number, what: string): Promise<void> {
    const box = await this.evaluate(pageCall(boxOf, selector, null));
    if (!box) return this.measured(selector, emptyBox, what + ': it is not there.');
    const sides = (['left', 'top', 'right', 'bottom'] as const).filter(
      (side) => box[side] < margin - 1,
    );
    if (sides.length)
      this.measured(
        selector,
        box,
        what +
          ': ' +
          sides.map((side) => side + ' ' + Math.round(box[side]) + ' px').join(', ') +
          '.',
      );
  }

  /** Records a measurement finding unless the field reaches its container's right edge. */
  async expectFills(field: string, container: string, what: string): Promise<void> {
    const box = await this.evaluate(pageCall(boxOf, field, container));
    if (!box) return this.measured(field, emptyBox, what + ': it is not there.');
    if (box.right > 2)
      this.measured(field, box, what + ': it stops ' + Math.round(box.right) + ' px short.');
  }

  /** Records a measurement finding unless the field reaches its container's content edge. */
  async expectFillsRow(field: string, container: string, what: string): Promise<void> {
    const short = await this.evaluate(pageCall(shortOf, field, container));
    const box = await this.evaluate(pageCall(boxOf, field, null));
    if (short === null || !box) return this.measured(field, emptyBox, what + ': it is not there.');
    if (short > 2)
      this.measured(field, box, what + ': it stops ' + Math.round(short) + ' px short.');
  }

  /** Records a finding unless the page shows `text`, as DESIGN or a checklist words it. */
  async expectText(text: string, what: string): Promise<void> {
    if (!(await this.shows(text)))
      this.findings.push({
        check: 'measure',
        selector: 'body',
        text,
        detail: what + ': “' + text + '” does not show.',
      });
  }

  /** Records a finding unless `selector` is on the page. */
  async expectPresent(selector: string, what: string): Promise<void> {
    if (!(await this.evaluate(exists(selector))))
      this.findings.push({
        check: 'measure',
        selector,
        text: '',
        detail: what + ': it is missing.',
      });
  }

  /** Records a finding when `selector` is on the page. */
  async expectNone(selector: string, what: string): Promise<void> {
    const box = await this.evaluate(pageCall(boxOf, selector, null));
    if (box) this.measured(selector, box, what + ': it shows.');
  }

  /** Records a finding unless two elements share an edge within a pixel. */
  async expectAligned(first: string, second: string, side: 'right' | 'left', what: string) {
    const one = await this.evaluate(pageCall(boxOf, first, null));
    const two = await this.evaluate(pageCall(boxOf, second, null));
    if (!one || !two) return this.measured(first, emptyBox, what + ': it is not there.');
    if (Math.abs(one[side] - two[side]) > 1)
      this.measured(
        first,
        one,
        what +
          ': the ' +
          side +
          ' edges differ by ' +
          Math.round(Math.abs(one[side] - two[side])) +
          ' px.',
      );
  }

  /** Clicks the `index`th match of `selector`, counting from 0. */
  async clickNth(selector: string, index: number): Promise<void> {
    await this.waitFor(selector, index + 1);
    await this.evaluate(pageCall(clickNth, selector, index));
    await this.settle();
  }

  /** Whether the page shows `text` anywhere. */
  async shows(text: string): Promise<boolean> {
    return this.evaluate(pageCall(showsText, text));
  }

  /** Puts the pointer over the first element `selector` matches. */
  async hover(selector: string): Promise<void> {
    await this.waitFor(selector);
    const point = await this.evaluate(pageCall(centreOf, selector));
    if (!point) return;
    await this.command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
    await this.settle(400);
  }

  /** Records a measurement finding unless `layer` sits `gap` pixels from `anchor`, below it or
   * above it, without covering it. */
  async expectGap(layer: string, anchor: string, gap: number, what: string): Promise<void> {
    const outer = await this.evaluate(pageCall(boxOf, layer, null));
    const inner = await this.evaluate(pageCall(boxOf, anchor, null));
    if (!outer || !inner) return this.measured(layer, emptyBox, what + ': it is not there.');
    const below = outer.y - (inner.y + inner.height);
    const above = inner.y - (outer.y + outer.height);
    const actual = below >= -1 ? below : above;
    if (Math.abs(actual - gap) > 1)
      this.measured(layer, outer, what + ': the gap is ' + Math.round(actual) + ' px.');
  }

  /** Runs `change` and records a layout shift when `selector` moves or resizes because of it. */
  async expectStill(selector: string, change: () => Promise<void>, what: string): Promise<void> {
    const before = await this.evaluate(pageCall(boxOf, selector, null));
    await change();
    await this.settle(400);
    const after = await this.evaluate(pageCall(boxOf, selector, null));
    if (!before || !after) return;
    const moved = (['x', 'y', 'width', 'height'] as const).filter(
      (key) => Math.abs(after[key] - before[key]) > 1,
    );
    if (moved.length)
      this.findings.push({
        check: 'layout-shift',
        selector,
        text: after.text,
        detail:
          what +
          ': ' +
          moved
            .map((key) => key + ' ' + Math.round(before[key]) + ' to ' + Math.round(after[key]))
            .join(', ') +
          '.',
        box: {
          x: Math.round(after.x),
          y: Math.round(after.y),
          width: Math.round(after.width),
          height: Math.round(after.height),
        },
      });
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
