/**
 * Page expressions for the reads and actions a scenario makes on one selector. Reads answer even
 * when nothing matches, so `until` can wait on them; actions refuse a missing element.
 */
import { pageCall } from './page-function';

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** The text of the first match, or '' when nothing matches. */
export const textOf = (selector: string) =>
  pageCall((selector: string) => document.querySelector(selector)?.textContent ?? '', selector);

export const exists = (selector: string) =>
  pageCall((selector: string) => document.querySelector(selector) !== null, selector);

export const countOf = (selector: string) =>
  pageCall((selector: string) => document.querySelectorAll(selector).length, selector);

/** The value of the first matching field, or '' when nothing matches. */
export const valueOf = (selector: string) =>
  pageCall((selector: string) => document.querySelector<Field>(selector)?.value ?? '', selector);

/** An attribute of the first match: null without the element or the attribute. */
export const attributeOf = (selector: string, name: string) =>
  pageCall(
    (selector: string, name: string) =>
      document.querySelector(selector)?.getAttribute(name) ?? null,
    selector,
    name,
  );

export const click = (selector: string) =>
  pageCall((selector: string) => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error('Nothing to click: ' + selector);
    element.click();
  }, selector);

export const focus = (selector: string) =>
  pageCall((selector: string) => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error('Nothing to focus: ' + selector);
    element.focus();
  }, selector);

/** Resolves inside the `count`th animation frame from now. */
export const animationFrames = (count: number) =>
  pageCall(
    (count: number) =>
      new Promise<void>((resolve) => {
        const next = (left: number) => {
          if (left === 0) resolve();
          else requestAnimationFrame(() => next(left - 1));
        };
        next(count);
      }),
    count,
  );
