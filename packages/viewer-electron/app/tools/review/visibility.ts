import type { PageExpression } from '../../tests/native/runtime/page-function';
import { pageCall } from '../../tests/native/runtime/page-function';

export interface VisibleLabel {
  element: Element;
  text: string;
  lastBox?: DOMRect;
  lastBlock?: Element;
}

/** Shared geometry for one measurement in the captured window. */
function visibility() {
  const viewport = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
  const clips = new Map<Element, typeof viewport>();
  const clipsOverflow = /^(auto|scroll|hidden|clip|overlay)$/;
  function outerClip(element: Element, style = getComputedStyle(element)) {
    return style.position === 'fixed' || element.matches(':modal')
      ? viewport
      : clipAt(element.parentElement);
  }
  function clipAt(element: Element | null): typeof viewport {
    if (!element) return viewport;
    const cached = clips.get(element);
    if (cached) return cached;
    const style = getComputedStyle(element);
    const outer = outerClip(element, style);
    const clip = { ...outer };
    const clipX = clipsOverflow.test(style.overflowX || style.overflow);
    const clipY = clipsOverflow.test(style.overflowY || style.overflow);
    if (clipX || clipY) {
      const rect = element.getBoundingClientRect();
      const { offsetWidth, offsetHeight } = element as HTMLElement;
      if (clipX) {
        const scale = offsetWidth ? rect.width / offsetWidth : 1;
        const left = rect.left + element.clientLeft * scale;
        clip.left = Math.max(outer.left, left);
        clip.right = Math.min(
          outer.right,
          offsetWidth ? left + element.clientWidth * scale : rect.right,
        );
      }
      if (clipY) {
        const scale = offsetHeight ? rect.height / offsetHeight : 1;
        const top = rect.top + element.clientTop * scale;
        clip.top = Math.max(outer.top, top);
        clip.bottom = Math.min(
          outer.bottom,
          offsetHeight ? top + element.clientHeight * scale : rect.bottom,
        );
      }
    }
    clips.set(element, clip);
    return clip;
  }

  function intersects(rect: DOMRect, clip: typeof viewport): boolean {
    return (
      Math.min(rect.right, clip.right) > Math.max(rect.left, clip.left) &&
      Math.min(rect.bottom, clip.bottom) > Math.max(rect.top, clip.top)
    );
  }

  function visibleText(node: Text, boxes?: DOMRect[], clip = clipAt(node.parentElement)): string {
    const range = document.createRange();
    function read(start: number, end: number, rects?: DOMRect[]): string {
      if (!rects) {
        range.setStart(node, start);
        range.setEnd(node, end);
        rects = [...range.getClientRects()];
      }
      if (!rects.some((rect) => intersects(rect, clip))) return '';
      // Most labels fit. Subdivide only ranges with hidden lines or a horizontal cut.
      if (
        end - start <= 1 ||
        rects.every(
          (rect) => intersects(rect, clip) && rect.left >= clip.left && rect.right <= clip.right,
        )
      )
        return node.data.slice(start, end);
      const middle = start + Math.floor((end - start) / 2);
      return read(start, middle) + read(middle, end);
    }
    return read(0, node.length, boxes);
  }

  function fieldText(field: HTMLInputElement | HTMLTextAreaElement): string {
    if (field.type === 'password' && field.value) return '';
    const value = field.value || field.placeholder;
    if (!value) return '';
    const multiline = field instanceof HTMLTextAreaElement;
    const style = getComputedStyle(field);
    const textStyle = field.value ? style : getComputedStyle(field, '::placeholder');
    if (
      textStyle.opacity === '0' ||
      textStyle.visibility === 'hidden' ||
      textStyle.color === 'transparent' ||
      /^rgba\([^)]*,\s*0\)$/.test(textStyle.color)
    )
      return '';
    const outer = outerClip(field, style);
    const rect = field.getBoundingClientRect();
    const scaleX = field.offsetWidth ? rect.width / field.offsetWidth : 1;
    const scaleY = field.offsetHeight ? rect.height / field.offsetHeight : 1;
    const px = (length: string) => Number.parseFloat(length) || 0;
    const paddingX = px(style.paddingLeft) + px(style.paddingRight);
    const paddingY = px(style.paddingTop) + px(style.paddingBottom);
    const width = field.clientWidth - paddingX;
    const height = field.clientHeight - paddingY;
    const x = rect.left + (field.clientLeft + px(style.paddingLeft)) * scaleX;
    const y = rect.top + (field.clientTop + px(style.paddingTop)) * scaleY;
    const left = Math.max(0, (outer.left - x) / scaleX);
    const right = Math.min(width, (outer.right - x) / scaleX);
    const top = Math.max(0, (outer.top - y) / scaleY);
    const bottom = Math.min(height, (outer.bottom - y) / scaleY);
    if (right <= left || bottom <= top) return '';

    if (
      field.value &&
      left === 0 &&
      right === width &&
      !field.scrollLeft &&
      field.scrollWidth <= field.clientWidth
    ) {
      if (
        top === 0 &&
        bottom === height &&
        !field.scrollTop &&
        field.scrollHeight <= field.clientHeight
      )
        return value;
      // An exact line count means every newline is a row and none of those rows soft-wrap.
      const lines = value.split('\n');
      const lineHeight = px(style.lineHeight);
      if (
        multiline &&
        lineHeight &&
        Math.abs(lines.length * lineHeight + paddingY - field.scrollHeight) < 1
      )
        return lines
          .slice(
            Math.max(0, Math.floor((field.scrollTop + top) / lineHeight)),
            Math.max(0, Math.ceil((field.scrollTop + bottom) / lineHeight)),
          )
          .join('\n');
    }

    // Native editors keep their text in a private shadow tree. Lay it out at the same width
    // so a Range can locate the visible characters without moving the caret or the scrollbars.
    const mirror = document.createElement('div');
    mirror.setAttribute('aria-hidden', 'true');
    mirror.style.cssText =
      'all:initial;position:fixed;left:0;top:0;visibility:hidden;pointer-events:none';
    for (const property of [
      'font-family',
      'font-size',
      'font-style',
      'font-weight',
      'font-stretch',
      'font-variant',
      'font-feature-settings',
      'font-variation-settings',
      'font-kerning',
      'line-height',
      'letter-spacing',
      'word-spacing',
      'tab-size',
      'text-transform',
      'text-align',
      'text-indent',
      'direction',
      'unicode-bidi',
      'word-break',
      'overflow-wrap',
    ]) {
      mirror.style.setProperty(
        property,
        textStyle.getPropertyValue(property) || style.getPropertyValue(property),
      );
    }
    mirror.style.width = width + 'px';
    mirror.style.whiteSpace =
      multiline && field.wrap !== 'off' ? style.whiteSpace || 'pre-wrap' : 'pre';
    const text = document.createTextNode(value);
    mirror.append(text);
    document.body.append(mirror);
    try {
      const layout = mirror.getBoundingClientRect();
      const originX = layout.left + field.scrollLeft;
      const originY = layout.top + field.scrollTop - (multiline ? 0 : (height - layout.height) / 2);
      return visibleText(text, undefined, {
        left: originX + left,
        right: originX + right,
        top: originY + top,
        bottom: originY + bottom,
      });
    } finally {
      mirror.remove();
    }
  }

  function appendText(labels: VisibleLabel[], node: Text, boxes: DOMRect[]) {
    const text = visibleText(node, boxes);
    let element = node.parentElement;
    if (!element || !text) return;
    while (element.parentElement && !element.matches('button, label, summary, [role], a[href]')) {
      const display = getComputedStyle(element).display;
      if (!display.startsWith('inline') && display !== 'contents') break;
      element = element.parentElement;
    }
    const previous = labels.at(-1);
    const previousBox = previous?.lastBox;
    const box = boxes[0]!;
    const sameLine = previousBox && box.bottom > previousBox.top && box.top < previousBox.bottom;
    const controls =
      'button, label, summary, a[href], [role="button"], [role="tab"], [role="option"], [role^="menuitem"]';
    const control = element.closest(controls);
    const sharedControl = sameLine && control && previous?.element.closest(controls) === control;
    if (previous && (previous.lastBlock === element || sharedControl)) {
      const gap =
        sameLine && Math.max(previousBox.left - box.right, box.left - previousBox.right) > 1;
      if (sharedControl) previous.element = control;
      previous.text += (gap ? ' ' : '') + text;
      previous.lastBox = boxes.at(-1);
      previous.lastBlock = element;
    } else {
      labels.push({ element, text, lastBox: boxes.at(-1), lastBlock: element });
    }
  }

  function readLabels(root: Element): string[] {
    const labels: VisibleLabel[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      let parent = node.parentElement;
      if (parent?.closest('.visually-hidden, script, style, noscript, template, textarea'))
        continue;
      while (parent && getComputedStyle(parent).display === 'contents')
        parent = parent.parentElement;
      if (
        !parent?.checkVisibility({
          opacityProperty: true,
          visibilityProperty: true,
          contentVisibilityAuto: true,
        })
      )
        continue;
      range.selectNodeContents(node);
      appendText(labels, node as Text, [...range.getClientRects()]);
    }
    return labels.map(({ text }) => text.replace(/\s+/g, ' ').trim());
  }
  function boxVisible(element: Element): boolean {
    const clip = outerClip(element);
    return (
      !element.closest('.visually-hidden') &&
      element.checkVisibility({
        opacityProperty: true,
        visibilityProperty: true,
        contentVisibilityAuto: true,
      }) &&
      intersects(element.getBoundingClientRect(), clip)
    );
  }
  return { appendText, fieldText, readLabels, boxVisible };
}

export type ReviewVisibility = ReturnType<typeof visibility>;

/** Page functions travel as source. Give each one the same visibility rules inside its window. */
export function visibilityCall<Args extends unknown[], R>(
  fn: (visibility: ReviewVisibility, ...args: Args) => R,
  ...args: Args
): PageExpression<R> {
  return `(() => {
    const __name = (target) => target;
    return (${fn.toString()})(${pageCall(visibility)}, ...${JSON.stringify(args)});
  })()` as PageExpression<R>;
}
