/**
 * The automatic checks run in the captured page. Each looks for one defect people keep finding by
 * eye, and each is written to stay quiet unless the defect is plainly there:
 *
 * - `wrap`: a control meant to be one line (button, menu item, tab, chip, toolbar or footer item,
 *   dialog title) whose text takes more than one line box, and a toolbar or footer whose items
 *   sit on more than one row.
 * - `clipped`: text or a control cut by its container's edge, with no ellipsis. Text wholly outside
 *   its container is hidden on purpose (a header's spilled items) and is not counted.
 * - `window-overflow`: an element, dialog, menu or the plane in view that runs past the window.
 * - `scroll-overflow`: a container that scrolls sideways although it is not meant to.
 * - `dialog-scroll`: a horizontal scroll bar inside a dialog.
 * - `menu-covers-trigger`: an open menu or popover over the control that opened it.
 * - `menu-search`: an open menu of 8 or fewer choices with a search field; it moves by type-ahead.
 * - `home-path`, `em-dash`, `broken-value`, `plural`: visible text with a full home path, an em
 *   dash, `undefined`, `NaN` or `[object Object]`, or a count of one with a plural noun.
 * - `name-extension`: a file name cut at its end, so its extension is lost, and a file name field
 *   that opens a long name at its start.
 * - `wording`: a retry button that is not Try Again, or a raw error code or state in visible text.
 * - `layout-shift` (markLayout and layoutMoves): toolbars, footers and list columns that move when
 *   the selection changes.
 *
 * Page functions travel as source text (tests/native/runtime/page-function.ts), so each one below
 * keeps every helper inside its own body.
 */
import { pageCall } from '../../tests/native/runtime/page-function';
import type { Box, CheckID } from './types';

export interface PageCheckOptions {
  /** The app's home folder as a path may spell it: shown paths must start with `~` instead. */
  homes: string[];
  /** File name cells whose shown text must keep the extension. */
  nameCells: string[];
  /** File name fields, which open a long name at its end. */
  nameFields: string[];
  /** Regions that show a file's own content, where interface rules do not apply. */
  content: string[];
  /** Containers meant to scroll sideways, such as the Columns strip. */
  horizontalScrollers: string[];
  /** The scene's subject: when given, only findings inside it count. `planeInView` stands for the
   * plane the space shows. */
  focus: string[];
}

/** In a scene's focus, the plane the space shows. */
export const planeInView = ':plane-in-view';

export interface PageFinding {
  check: CheckID;
  selector: string;
  text: string;
  detail: string;
  box: Box;
}

/** The parts of the layout that stay put: `containers` (title bar, toolbars, footers) keep their
 * box; `items` in them keep their place unless their own text changes. */
export interface LayoutParts {
  containers: string[];
  items: string[];
}

/** Shared selectors for the checks. */
export const checkSelectors = {
  // Newer builds mark every file name; older ones are read by class: List and Columns rows, the
  // preview footer, Grid tiles and the Gallery strip.
  nameCells: [
    '[data-file-name]',
    '.filename',
    '.preview-filename',
    '.file-tile .file-linked-label > span',
    '.gallery-item > span',
  ],
  nameFields: [
    'input[aria-label*="filename" i]',
    'input[aria-label*="file name" i]',
    '.file-name-field input',
  ],
  content: [
    '.cm-editor',
    '.xterm',
    '.pdf-viewer',
    '.textLayer',
    'iframe',
    'webview',
    'canvas',
    '.text-preview',
    '.text-viewer',
    '.code-scroll',
    '.markdown-preview',
  ],
  // the Columns strip and the gallery strip scroll sideways by design
  horizontalScrollers: ['.columns-view', '.gallery-strip'],
  layout: {
    containers: [
      '.app-titlebar',
      '.plane-controls',
      'footer',
      '.file-head',
      '[role="toolbar"]',
      '.preview-toolbar',
    ],
    items: [
      '.plane-controls > *',
      'footer > *',
      '.file-heading',
      '[role="toolbar"] > *',
      '.columns-view > .file-column',
    ],
  } satisfies LayoutParts,
};

function pageChecks(options: PageCheckOptions): PageFinding[] {
  const findings: PageFinding[] = [];
  const width = innerWidth;
  const height = innerHeight;
  const content = options.content.join(',');
  const scrollers = options.horizontalScrollers.join(',');
  const focusPlane = options.focus.includes(':plane-in-view');
  const focus = options.focus.filter((item) => item !== ':plane-in-view').join(',');
  const emDash = String.fromCharCode(0x2014);
  const styles = new Map<Element, CSSStyleDeclaration>();
  const style = (element: Element) => {
    let computed = styles.get(element);
    if (!computed) {
      computed = getComputedStyle(element);
      styles.set(element, computed);
    }
    return computed;
  };
  const inContent = (element: Element) => content !== '' && element.closest(content) !== null;
  // The space shows the plane in view whole; the camera may leave other planes partly outside the
  // window, which is framing, not layout. Its status names the plane in view by its route.
  const space = document.querySelector('[role="application"][aria-label="plurid space"]');
  const status = [...(space?.querySelectorAll('[role="status"]') ?? [])]
    .map((node) => node.textContent ?? '')
    .find((text) => text.includes('plurid://'));
  const viewedRoute = /plurid:\/\/[^/\s]+(\/\S+)/.exec(status ?? '')?.[1];
  const planes = [...(space?.querySelectorAll('[role="group"][aria-label^="/"]') ?? [])];
  // newer builds mark the plane in view; older ones only name it in the status text
  const marked = document.querySelector('[data-plane-in-view="true"]')?.closest('[role="group"]');
  const viewed = marked ?? planes.find((plane) => plane.getAttribute('aria-label') === viewedRoute);
  const inBackgroundPlane = (element: Element) => {
    const plane = element.closest('[role="group"][aria-label^="/"]');
    return !!viewed && !!plane && plane !== viewed && planes.includes(plane);
  };
  /** The plurid space draws planes inside it; its own edges are the camera's, not a layout's. */
  const spaceRoot = (element: Element) =>
    element.matches('body, html, [role="application"][aria-label="plurid space"]');
  const rounded = (rect: DOMRect): Box => ({
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  });
  const shown = (element: Element): boolean => {
    if (
      !element.checkVisibility({
        opacityProperty: true,
        visibilityProperty: true,
        contentVisibilityAuto: true,
      })
    )
      return false;
    const rect = element.getBoundingClientRect();
    return (
      rect.width >= 1 &&
      rect.height >= 1 &&
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < width &&
      rect.top < height &&
      element.closest('.visually-hidden') === null
    );
  };
  /** Hashed class names from styled components say nothing to a reader. */
  const readableClass = (name: string) =>
    !name.startsWith('sc-') && !/^(?=.*[A-Z])[a-zA-Z]{6}$/.test(name);
  const describe = (element: Element): string => {
    const parts: string[] = [];
    for (
      let node: Element | null = element;
      node && parts.length < 4 && node !== document.body;
      node = node.parentElement
    ) {
      let part = node.tagName.toLowerCase();
      if (node.id && !/^[:«_]|^radix|^r[0-9]/.test(node.id)) {
        parts.unshift(part + '#' + CSS.escape(node.id));
        break;
      }
      const classes = [...node.classList].filter(readableClass).slice(0, 2);
      part += classes.map((name) => '.' + CSS.escape(name)).join('');
      const label = node.getAttribute('aria-label');
      const role = node.getAttribute('role');
      if (label && label.length <= 60) part += '[aria-label="' + label.replace(/"/g, '\\"') + '"]';
      else if (role) part += '[role="' + role + '"]';
      parts.unshift(part);
    }
    return parts.join(' > ');
  };
  const textOf = (element: Element): string =>
    (
      element.textContent ||
      (element as HTMLInputElement).value ||
      element.getAttribute('aria-label') ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
  const inFocus = (element: Element) =>
    (!focus && !focusPlane) ||
    (!!focus && element.closest(focus) !== null) ||
    (focusPlane && !!viewed && viewed.contains(element));
  const report = (check: CheckID, element: Element, detail: string, text = textOf(element)) => {
    if (!inFocus(element)) return;
    findings.push({
      check,
      selector: describe(element),
      text,
      detail,
      box: rounded(element.getBoundingClientRect()),
    });
  };
  /** Each element is reported once per check. */
  const reported = new Map<CheckID, Set<Element>>();
  const first = (check: CheckID, element: Element): boolean => {
    const elements = reported.get(check) ?? new Set<Element>();
    reported.set(check, elements);
    if (elements.has(element)) return false;
    elements.add(element);
    return true;
  };
  /** The boxes a text node's characters take, line by line. */
  const lineBoxes = (node: Text): DOMRect[] => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return [...range.getClientRects()].filter((rect) => rect.width > 0.5 && rect.height > 0.5);
  };
  /** How many lines the boxes sit on: boxes that overlap by half their height share a line. */
  const lineCount = (boxes: DOMRect[]): number => {
    const lines: { top: number; bottom: number }[] = [];
    for (const box of [...boxes].sort((a, b) => a.top - b.top)) {
      const line = lines.find(
        (item) =>
          Math.min(item.bottom, box.bottom) - Math.max(item.top, box.top) >
          Math.min(item.bottom - item.top, box.height) / 2,
      );
      if (line) {
        line.top = Math.min(line.top, box.top);
        line.bottom = Math.max(line.bottom, box.bottom);
      } else lines.push({ top: box.top, bottom: box.bottom });
    }
    return lines.length;
  };
  const union = (boxes: DOMRect[]) => ({
    left: Math.min(...boxes.map((box) => box.left)),
    top: Math.min(...boxes.map((box) => box.top)),
    right: Math.max(...boxes.map((box) => box.right)),
    bottom: Math.max(...boxes.map((box) => box.bottom)),
  });
  /** The element that lays out a text node's line: its nearest ancestor that is not inline. */
  const lineContainer = (element: Element): Element => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const display = style(node).display;
      if (display !== 'inline' && display !== 'contents') return node;
    }
    return element;
  };
  /** Where an element's content box sits on screen. The space scales planes, so screen boxes and
   * layout sizes differ by the element's scale. */
  const innerEdges = (element: Element) => {
    const rect = element.getBoundingClientRect();
    const layoutWidth = (element as HTMLElement).offsetWidth;
    const scale = layoutWidth ? rect.width / layoutWidth : 1;
    const left = rect.left + element.clientLeft * scale;
    return { left, right: left + element.clientWidth * scale, scale };
  };
  const singleLine = [
    'button',
    '[role="button"]',
    '[role="menuitem"]',
    '[role="menuitemradio"]',
    '[role="menuitemcheckbox"]',
    '[role="tab"]',
    '[role="radio"]',
    '[role="option"]',
    'summary',
    'dialog[open] > header strong',
    'dialog[open] h1',
    'dialog[open] h2',
    'dialog[open] h3',
    '[role="dialog"] h1',
    '[role="dialog"] h2',
    '.app-titlebar > *',
    '.plane-controls > *',
    'footer > *',
    '[role="toolbar"] > *',
    '.preview-toolbar > *',
    '.preview-file-info > *',
    '.column-title',
    '[class*="chip"]',
    '[class*="segment"] > *',
  ].join(',');

  type Cut = { container: Element; partly: boolean };
  /** The first container, from `start` outwards, whose hidden overflow cuts `edges` off: `scrolls`
   * when a scrolling container comes first. `partly`: part of the edges still shows, so the cut is
   * a defect; wholly outside is hidden on purpose. */
  const cutBy = (
    start: Element | null,
    edges: { left: number; right: number },
  ): Cut | 'scrolls' | undefined => {
    for (let node = start; node && !spaceRoot(node); node = node.parentElement) {
      const overflow = style(node).overflowX;
      if (overflow === 'visible') continue;
      if (overflow === 'auto' || overflow === 'scroll') return 'scrolls';
      const { left, right } = innerEdges(node);
      const inside = edges.right > left + 1 && edges.left < right - 1;
      if (!inside) return { container: node, partly: false };
      if (edges.right > right + 1.5 || edges.left < left - 1.5)
        return { container: node, partly: true };
    }
    return undefined;
  };
  const pastWindow = (edges: { left: number; right: number }) =>
    edges.right > width + 1 || edges.left < -1;

  // One pass over the visible text: wrapping, clipping and window edges.
  const groups = new Map<Element, { control: Element; boxes: DOMRect[] }>();
  const sentences = new Set<Element>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const parent = text.parentElement;
    if (!parent || !text.data.trim() || parent.closest('script, style, noscript, template'))
      continue;
    if (inContent(parent) || !shown(parent)) continue;
    const boxes = lineBoxes(text);
    if (!boxes.length) continue;
    const edges = union(boxes);
    if (edges.right <= 0 || edges.left >= width || edges.bottom <= 0 || edges.top >= height)
      continue;
    const container = lineContainer(parent);
    // a sentence split into several text nodes is read whole
    sentences.add(container);
    const control = parent.closest(singleLine);
    if (control) {
      const group = groups.get(container) ?? { control, boxes: [] };
      group.boxes.push(...boxes);
      groups.set(container, group);
    }
    // the text's own element may be the one that cuts it
    const cut = cutBy(parent, edges);
    if (cut === 'scrolls') continue;
    if (cut) {
      const ellipsis = cut.container === container && style(container).textOverflow === 'ellipsis';
      if (cut.partly && !ellipsis && first('clipped', cut.container))
        report(
          'clipped',
          parent,
          'Its text runs past the edge of ' + describe(cut.container) + ' with no ellipsis.',
        );
    } else if (
      pastWindow(edges) &&
      !inBackgroundPlane(container) &&
      first('window-overflow', container)
    )
      report('window-overflow', container, 'Its text runs past the window edge.');
  }
  for (const [container, group] of groups) {
    const lines = lineCount(group.boxes);
    if (lines > 1 && first('wrap', group.control))
      report(
        'wrap',
        group.control,
        'A one-line control takes ' +
          lines +
          ' lines' +
          (container === group.control ? '.' : ' in ' + describe(container) + '.'),
      );
  }

  // Bars are one row: a footer or toolbar whose items wrap onto a second row grows and shifts.
  for (const bar of document.querySelectorAll(
    'footer, .preview-file-info, .plane-controls, [role="toolbar"], .preview-toolbar, .app-titlebar',
  )) {
    if (!shown(bar) || inContent(bar) || inBackgroundPlane(bar)) continue;
    const boxes = [...bar.children]
      .filter(shown)
      .map((child) => child.getBoundingClientRect())
      .filter((box) => box.width >= 1 && box.height >= 1);
    const rows = lineCount(boxes);
    if (rows > 1 && first('wrap', bar))
      report('wrap', bar, 'Its items sit on ' + rows + ' rows; a bar keeps one.');
  }

  // Controls cut by their container or by the window, and containers that scroll sideways.
  for (const element of document.body.querySelectorAll('*')) {
    if (inContent(element)) continue;
    const interactive = element.matches('button, input, select, textarea, [role="button"]');
    if (interactive && shown(element)) {
      const rect = element.getBoundingClientRect();
      // a control's own overflow cuts its content, not the control
      const cut = cutBy(element.parentElement, rect);
      if (cut && cut !== 'scrolls') {
        if (cut.partly && first('clipped', cut.container))
          report(
            'clipped',
            element,
            'The control is cut by the edge of ' + describe(cut.container) + '.',
          );
      } else if (
        !cut &&
        pastWindow(rect) &&
        !inBackgroundPlane(element) &&
        first('window-overflow', element)
      )
        report('window-overflow', element, 'The control runs past the window edge.');
    }
    const computed = style(element);
    if (
      (computed.overflowX === 'auto' || computed.overflowX === 'scroll') &&
      element.scrollWidth > element.clientWidth + 1 &&
      shown(element)
    ) {
      const { right } = innerEdges(element);
      let widest: Element | undefined;
      let widestRight = right + 1;
      for (const child of element.querySelectorAll('*')) {
        const box = child.getBoundingClientRect();
        if (box.right > widestRight) {
          widest = child;
          widestRight = box.right;
        }
      }
      const cause = widest ? ' ' + describe(widest) + ' is wider than it.' : '';
      if (element.closest('dialog[open], [role="dialog"], [role="alertdialog"]'))
        report('dialog-scroll', element, 'A dialog part scrolls sideways.' + cause);
      else if (!(scrollers && element.matches(scrollers)))
        report('scroll-overflow', element, 'It scrolls sideways.' + cause);
    }
  }

  // Dialogs, menus, popovers and the plane in view stay inside the window.
  const layers = [
    ...document.querySelectorAll(
      'dialog[open], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [popover], .popover, .context-menu',
    ),
  ].filter((layer) => {
    if (!shown(layer)) return false;
    if (layer.matches('dialog[open], [popover], [role="dialog"], [role="alertdialog"]'))
      return true;
    // a listbox or menu that floats, not a list in a plane
    for (let node: Element | null = layer, depth = 0; node && depth < 4; depth++) {
      const position = style(node).position;
      if (position === 'fixed' || position === 'absolute') return true;
      node = node.parentElement;
    }
    return false;
  });
  if (viewed && shown(viewed)) {
    const rect = viewed.getBoundingClientRect();
    if (rect.left < -1 || rect.right > width + 1 || rect.bottom > height + 1)
      report('window-overflow', viewed, 'The plane in view does not fit inside the window.');
  }
  for (const layer of layers) {
    const rect = layer.getBoundingClientRect();
    if (
      (rect.left < -1 || rect.top < -1 || rect.right > width + 1 || rect.bottom > height + 1) &&
      first('window-overflow', layer)
    )
      report('window-overflow', layer, 'It does not fit inside the window.');
  }

  // A choice list of 8 or fewer moves by type-ahead, as a native menu does: no search field.
  for (const layer of layers) {
    const dialogs = 'dialog[open], [role="dialog"], [role="alertdialog"]';
    if (layer.matches(dialogs)) continue;
    // a menu's list inside its own menu layer is the same menu; a dialog around it is not
    if (layers.some((other) => other !== layer && !other.matches(dialogs) && other.contains(layer)))
      continue;
    const search = layer.querySelector('input:not([type="hidden"])');
    if (!search || !shown(search)) continue;
    const choices = [
      ...layer.querySelectorAll(
        '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"]',
      ),
      // scrolled out of view still counts: the list is that long
    ].filter((item) => item.checkVisibility()).length;
    if (choices > 0 && choices <= 8 && first('menu-search', layer))
      report(
        'menu-search',
        layer,
        'A list of ' + choices + ' choices has a search field; 8 or fewer move by type-ahead.',
      );
  }

  // An open menu or popover never covers the control that opened it.
  for (const trigger of document.querySelectorAll('[aria-expanded="true"]')) {
    if (!shown(trigger)) continue;
    const box = trigger.getBoundingClientRect();
    const controlled = trigger.getAttribute('aria-controls');
    const candidates = controlled
      ? layers.filter((layer) => layer.id === controlled)
      : layers.filter(
          (layer) =>
            !layer.contains(trigger) &&
            !trigger.contains(layer) &&
            !layer.matches('dialog[open], [role="dialog"], [role="alertdialog"]'),
        );
    for (const layer of candidates) {
      if (layer.contains(trigger)) continue;
      // a menu's list inside its own layer is the same layer
      if (candidates.some((other) => other !== layer && other.contains(layer))) continue;
      const rect = layer.getBoundingClientRect();
      const overlap =
        Math.max(0, Math.min(rect.right, box.right) - Math.max(rect.left, box.left)) *
        Math.max(0, Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top));
      if (overlap > 4)
        report(
          'menu-covers-trigger',
          layer,
          'It covers ' + Math.round(overlap) + ' square pixels of ' + describe(trigger) + '.',
        );
    }
  }

  // What the visible text says, line by line, fields included.
  const texts: { element: Element; text: string }[] = [...sentences].map((element) => ({
    element,
    text: element.textContent ?? '',
  }));
  for (const field of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'input:not([type="hidden"], [type="checkbox"], [type="radio"], [type="range"], [type="color"]), textarea',
  ))
    if (!inContent(field) && shown(field))
      texts.push({ element: field, text: field.value || field.placeholder });
  const homes = options.homes.filter(Boolean);
  const plural = /(?<![\d.,])1 ([A-Za-z]{3,}s)\b/;
  const singularEndings = /(ss|us|is|as|ics|ies|ws)$/i;
  const singularWords = new Set(['lens', 'canvas', 'alias', 'status', 'series', 'news', 'plus']);
  const said = new Set<string>();
  const once = (check: CheckID, element: Element, detail: string, text: string) => {
    const key = check + '\n' + describe(element) + '\n' + text;
    if (said.has(key)) return;
    said.add(key);
    report(check, element, detail, text.replace(/\s+/g, ' ').trim().slice(0, 160));
  };
  for (const { element, text } of texts) {
    const home = homes.find((item) => text.includes(item + '/') || text.trim() === item);
    if (home) once('home-path', element, 'It shows the home folder as a full path, not ~.', text);
    else if (/(^|[\s"'(])\/(Users|private\/var\/folders|var\/folders)\/[^/\s]+/.test(text))
      once('home-path', element, 'It shows a full path from the disk root, not from ~.', text);
    if (text.includes(emDash)) once('em-dash', element, 'It contains an em dash.', text);
    const broken = /\bundefined\b|\bNaN\b|\[object Object\]/.exec(text);
    if (broken) once('broken-value', element, 'It shows “' + broken[0] + '”.', text);
    const raw = /\b(mkdir|rmdir|ENOENT|EACCES|EPERM|EEXIST|ENOTDIR)\b/.exec(text);
    if (raw) once('wording', element, 'It shows the raw code “' + raw[0] + '”.', text);
    if (element.closest('button') && text.trim() === 'Retry')
      once('wording', element, 'A retry button reads Try Again.', text);
    const count = plural.exec(text.replace(/\s+/g, ' '));
    if (count && !singularEndings.test(count[1]!) && !singularWords.has(count[1]!.toLowerCase()))
      once('plural', element, 'It says “' + count[0] + '”.', text);
  }

  // File names keep their extension when they are shortened.
  const extensionOf = (name: string) => {
    const extension = /\.[A-Za-z0-9]{1,8}$/.exec(name.trim())?.[0];
    return extension && name.trim() !== extension ? extension : undefined;
  };
  for (const cell of document.querySelectorAll(options.nameCells.join(','))) {
    if (!shown(cell)) continue;
    const full =
      cell.getAttribute('data-file-name') ||
      cell.getAttribute('title') ||
      cell.closest('[title]')?.getAttribute('title') ||
      cell.textContent ||
      '';
    const extension = extensionOf(full);
    if (!extension) continue;
    const text = (cell.textContent ?? '').trim();
    const container = lineContainer(cell);
    const cutAtEnd =
      style(container).textOverflow === 'ellipsis' &&
      container.scrollWidth > container.clientWidth + 1;
    if ((text.includes('…') && !text.endsWith(extension)) || cutAtEnd)
      report(
        'name-extension',
        cell,
        'The name is cut at its end, so ' + extension + ' does not show.',
        // a tooltip may hold the whole path; the finding names the file
        (full.split('/').at(-1) ?? full).slice(0, 160),
      );
  }
  for (const field of document.querySelectorAll<HTMLInputElement>(options.nameFields.join(','))) {
    if (!shown(field) || inContent(field)) continue;
    const extension = extensionOf(field.value);
    const long = field.scrollWidth > field.clientWidth + 1;
    if (long && field.scrollLeft < 1)
      report(
        'name-extension',
        field,
        'The field opens a long name at its start' +
          (extension ? ', so ' + extension + ' does not show.' : '.'),
        field.value.slice(0, 160),
      );
  }
  return findings;
}

interface LayoutMark {
  element: Element;
  selector: string;
  /** Its text then: an item, not a container, whose text changed may change width along its
   * line, not its line or height. */
  text: string;
  item: boolean;
  box: Box;
}

interface LayoutWindow {
  __reviewLayout?: LayoutMark[];
}

/** Records the boxes of the layout's fixed parts before a change. */
function markLayout(parts: LayoutParts): number {
  const describe = (element: Element): string => {
    const names: string[] = [];
    for (
      let node: Element | null = element;
      node && names.length < 4 && node !== document.body;
      node = node.parentElement
    ) {
      const classes = [...node.classList]
        .filter((name) => !name.startsWith('sc-') && !/^(?=.*[A-Z])[a-zA-Z]{6}$/.test(name))
        .slice(0, 2);
      const label = node.getAttribute('aria-label');
      names.unshift(
        node.tagName.toLowerCase() +
          classes.map((name) => '.' + CSS.escape(name)).join('') +
          (label && label.length <= 60 ? '[aria-label="' + label.replace(/"/g, '\\"') + '"]' : ''),
      );
    }
    return names.join(' > ');
  };
  const marks: LayoutMark[] = [];
  const containers = parts.containers.join(',');
  const items = parts.items.join(',');
  for (const element of document.querySelectorAll(containers + ',' + items)) {
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1 || rect.bottom < 0 || rect.top > innerHeight) continue;
    marks.push({
      element,
      selector: describe(element),
      text: element.textContent ?? '',
      item: element.matches(items) && !element.matches(containers),
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    });
  }
  (window as LayoutWindow).__reviewLayout = marks;
  return marks.length;
}

/** The marked parts that moved or changed size since markLayout, by more than a pixel. A part
 * whose own text changed, such as a footer's count, may grow or shrink along its line. Siblings
 * that moved together by the same amount are one finding: their container scrolled or shifted. */
function layoutMoves(): PageFinding[] {
  const marks = (window as LayoutWindow).__reviewLayout ?? [];
  const moved: { mark: LayoutMark; rect: DOMRect; changes: [string, number][] }[] = [];
  for (const mark of marks) {
    if (!mark.element.isConnected) continue;
    const rect = mark.element.getBoundingClientRect();
    const ownText = mark.item && (mark.element.textContent ?? '') !== mark.text;
    const deltas: [string, number][] = [
      ['left', ownText ? 0 : rect.x - mark.box.x],
      ['top', rect.y - mark.box.y],
      ['width', ownText ? 0 : rect.width - mark.box.width],
      ['height', rect.height - mark.box.height],
    ];
    const changes = deltas.filter(([, delta]) => Math.abs(delta) > 1);
    if (changes.length) moved.push({ mark, rect, changes });
  }
  const said = (changes: [string, number][]) =>
    changes
      .map(([name, delta]) => name + ' ' + (delta > 0 ? '+' : '') + Math.round(delta) + ' px')
      .join(', ');
  // by container, then by the change itself
  const together = new Map<Element, Map<string, typeof moved>>();
  for (const entry of moved) {
    const parent = entry.mark.element.parentElement;
    if (!parent) continue;
    const byChange = together.get(parent) ?? new Map<string, typeof moved>();
    together.set(parent, byChange);
    const key = said(entry.changes);
    byChange.set(key, [...(byChange.get(key) ?? []), entry]);
  }
  const findings: PageFinding[] = [];
  const grouped = new Set<(typeof moved)[number]>();
  for (const [parent, byChange] of together)
    for (const [changes, group] of byChange) {
      if (group.length < 2) continue;
      const rect = parent.getBoundingClientRect();
      for (const entry of group) grouped.add(entry);
      findings.push({
        check: 'layout-shift',
        selector: group[0]!.mark.selector.split(' > ').slice(0, -1).join(' > '),
        text: group.length + ' parts',
        detail:
          group.length +
          ' parts moved together when the selection changed (' +
          changes +
          '): their container scrolled or shifted.',
        box: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      });
    }
  for (const entry of moved) {
    if (grouped.has(entry)) continue;
    findings.push({
      check: 'layout-shift',
      selector: entry.mark.selector,
      text: (entry.mark.element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
      detail: 'It moved when the selection changed: ' + said(entry.changes) + '.',
      box: {
        x: Math.round(entry.rect.x),
        y: Math.round(entry.rect.y),
        width: Math.round(entry.rect.width),
        height: Math.round(entry.rect.height),
      },
    });
  }
  return findings;
}

/** The page expressions: built here, beside the functions they send. */
export const runChecks = (options: PageCheckOptions) => pageCall(pageChecks, options);
export const markLayoutBoxes = (parts: LayoutParts) => pageCall(markLayout, parts);
export const movedLayout = () => pageCall(layoutMoves);
