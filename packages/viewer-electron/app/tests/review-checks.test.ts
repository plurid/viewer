// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ownedApp } from './owned-app';
import type { PageExpression } from './native/runtime/page-function';
import { modifiers, ReviewPage } from '../tools/review/page';
import { checkSelectors, runChecks } from '../tools/review/checks';
import type { Connection } from '../tools/docs/record';
import { reviewAreas } from '../tools/review/scenes';
import { standardVariants } from '../tools/review/variants';

const home = '/Users/fixture';
const box = new DOMRect(20, 20, 100, 20);
const evaluate = <R>(expression: PageExpression<R>): R => window.eval(expression);

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.matches('[data-offscreen]') ? new DOMRect(20, innerHeight + 20, 100, 20) : box;
  });
  Object.defineProperty(Element.prototype, 'checkVisibility', {
    configurable: true,
    value(this: Element) {
      return !this.closest('[hidden], [style*="visibility: hidden"], [style*="opacity: 0"]');
    },
  });
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value(this: Range) {
      const lines = Number(
        this.startContainer.parentElement?.closest('[data-lines]')?.getAttribute('data-lines') ?? 1,
      );
      const y = Number(
        this.startContainer.parentElement?.closest('[data-y]')?.getAttribute('data-y') ?? 20,
      );
      return Array.from({ length: lines }, (_, line) => new DOMRect(20, y + line * 12, 100, 10));
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function findings() {
  return evaluate(
    runChecks({
      homes: [home],
      nameCells: checkSelectors.nameCells,
      nameFields: checkSelectors.nameFields,
      content: checkSelectors.content,
      horizontalScrollers: checkSelectors.horizontalScrollers,
      focus: [],
    }),
  );
}

it('reads visible text and fields without reading hidden descendants', () => {
  const forbidden = `${home}/Pictures \u2014 undefined 1 files ENOENT`;
  document.body.innerHTML = `
    <div>Pictures <span class="visually-hidden"><span>${forbidden}</span></span></div>
    <div>Pictures <span hidden>${forbidden}</span></div>
    <div>Pictures <span style="visibility: hidden">${forbidden}</span></div>
    <div>Pictures <span style="opacity: 0">${forbidden}</span></div>
    <div style="overflow-y: auto"><span data-y="100">${forbidden}</span></div>
    <div id="visible" aria-hidden="true">${home}/Pictures \u2014 <span>undefined</span>
         1 <span>files</span> ENOENT</div>
    <button>Retry<span class="visually-hidden"> photo</span></button>
    <input id="field" value="NaN">
    <input type="password" value="undefined">
  `;
  for (const field of document.querySelectorAll('input'))
    Object.defineProperties(field, {
      clientWidth: { value: box.width },
      clientHeight: { value: box.height },
    });

  expect(findings().map(({ check, selector }) => [check, selector])).toEqual([
    ['home-path', 'div#visible'],
    ['em-dash', 'div#visible'],
    ['broken-value', 'div#visible'],
    ['wording', 'div#visible'],
    ['plural', 'div#visible'],
    ['wording', 'button'],
    ['broken-value', 'input#field'],
  ]);
});

it('checks the displayed rows of the current textarea value as it scrolls away and back', () => {
  const field = document.createElement('textarea');
  field.id = 'script';
  field.rows = 1;
  field.style.cssText = 'line-height:20px; padding:0; border:0';
  field.defaultValue = 'EACCES';
  field.value = 'Ready\nundefined\n' + home + '/Pictures';
  field.getBoundingClientRect = () => new DOMRect(20, 20, 240, 20);
  Object.defineProperties(field, {
    clientWidth: { value: 240 },
    scrollWidth: { value: 240 },
    clientHeight: { value: 20 },
    scrollHeight: { value: 60 },
  });
  document.body.append(field);
  const reported = () =>
    findings()
      .filter(({ selector }) => selector === 'textarea#script')
      .map((f) => f.check);
  expect(reported()).toEqual([]);
  field.scrollTop = 20;
  expect(reported()).toEqual(['broken-value']);
  field.scrollTop = 40;
  expect(reported()).toEqual(['home-path']);
  field.scrollTop = 0;
  expect(reported()).toEqual([]);
});

// jsdom has no line layout. Each row here has 2 px above its text and 3 px below.
function measureTextRows() {
  vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
    const node = this.startContainer as Text;
    const origin = node.parentElement!.getBoundingClientRect();
    const rects: DOMRect[] = [];
    let start = 0;
    for (const [row, line] of node.data.split('\n').entries()) {
      const from = Math.max(start, this.startOffset);
      const to = Math.min(start + line.length, this.endOffset);
      if (from < to)
        rects.push(
          new DOMRect(
            origin.left + (from - start) * 10,
            origin.top + row * 21 + 2,
            (to - from) * 10,
            16,
          ),
        );
      start += line.length + 1;
    }
    return rects as unknown as DOMRectList;
  });
}

it('checks the text boxes at both partially scrolled textarea edges', () => {
  const field = document.createElement('textarea');
  field.rows = 4;
  field.style.cssText = 'line-height:21px; padding:0; border:0';
  field.value = 'undefined\nReady\nReady\nReady\nENOENT';
  field.getBoundingClientRect = () => new DOMRect(20, 20, 180, 84);
  Object.defineProperties(field, {
    clientWidth: { value: 180 },
    scrollWidth: { value: 180 },
    clientHeight: { value: 84 },
    scrollHeight: { value: 105 },
  });
  document.body.append(field);
  measureTextRows();
  const reported = (scrollTop: number) => {
    field.scrollTop = scrollTop;
    return findings()
      .filter(({ selector }) => selector === 'textarea')
      .map(({ check }) => check);
  };
  expect([0, 2, 3, 17, 18, 20, 21, 0].map(reported)).toEqual([
    ['broken-value'],
    ['broken-value'],
    ['broken-value', 'wording'],
    ['broken-value', 'wording'],
    ['wording'],
    ['wording'],
    ['wording'],
    ['broken-value'],
  ]);
});

it.each(['value', 'placeholder', 'label'] as const)(
  'keeps disjoint parts of a clipped %s separate when checking wording',
  async (source) => {
    const clip = document.createElement('section');
    clip.style.overflowX = 'hidden';
    clip.getBoundingClientRect = () => new DOMRect(20, 20, 90, 42);
    const subject = document.createElement(source === 'label' ? 'div' : 'textarea');
    subject.style.cssText = 'line-height:21px; white-space:pre; padding:0; border:0';
    subject.getBoundingClientRect = () => new DOMRect(20, 20, 200, 42);
    Object.defineProperties(subject, {
      clientWidth: { value: 200 },
      scrollWidth: { value: 200 },
      clientHeight: { value: 42 },
      scrollHeight: { value: 42 },
    });
    clip.append(subject);
    document.body.append(clip);
    if (source === 'placeholder') {
      const computed = window.getComputedStyle.bind(window);
      vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => computed(element));
    }
    measureTextRows();
    const reported = (value: string) => {
      if (source === 'label') subject.textContent = value;
      else (subject as HTMLTextAreaElement)[source] = value;
      return findings()
        .filter(({ check }) => check === 'broken-value' || check === 'plural')
        .map(({ check, text }) => [check, text]);
    };
    expect.soft(reported('undefined message\nCleared')).toEqual([['broken-value', 'undefined']]);
    expect.soft(reported('Ready    undefined\nOK')).toEqual([]);
    expect.soft(reported('Status 1 hidden\nfiles')).toEqual([]);
    expect.soft(reported('Status unfinished\ndefined')).toEqual([]);
    if (source === 'label') {
      expect(await reviewPage().shows('Status undefined')).toBe(false);
      expect(await reviewPage().shows('defined')).toBe(true);
    } else {
      expect(reported('1\nfiles')).toEqual([]);
    }
  },
);

it.each(['value', 'placeholder'] as const)(
  'reads only the visible horizontal slice of an input %s',
  (property) => {
    const field = document.createElement('input');
    field.id = 'entry';
    field.style.cssText = 'padding:0; border:0; line-height:20px';
    field[property] = 'undefined     ENOENT';
    const computed = window.getComputedStyle.bind(window);
    // jsdom supplies element styles but has no ::placeholder implementation.
    const placeholder = document.createElement('span');
    const styles = vi
      .spyOn(window, 'getComputedStyle')
      .mockImplementation((element, pseudo) =>
        computed(pseudo === '::placeholder' ? placeholder : element),
      );
    document.body.append(field);
    Object.defineProperties(field, {
      clientWidth: { value: 100 },
      scrollWidth: { value: 200 },
      clientHeight: { value: 20 },
      scrollHeight: { value: 20 },
    });
    vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
      const rect = this.startContainer.parentElement!.getBoundingClientRect();
      return [
        new DOMRect(
          rect.left + this.startOffset * 10,
          rect.top,
          (this.endOffset - this.startOffset) * 10,
          20,
        ),
      ] as unknown as DOMRectList;
    });
    field.focus();
    field.setSelectionRange(2, 4);
    const selection = [field.selectionStart, field.selectionEnd];
    const reported = () =>
      findings()
        .filter(({ selector }) => selector === 'input#entry')
        .map(({ check, text }) => [check, text]);
    expect(reported()).toEqual([['broken-value', 'undefined']]);
    field.scrollLeft = 100;
    expect(reported()).toEqual([['wording', 'ENOENT']]);
    field.scrollLeft = 50;
    expect(reported()).toEqual([]);
    field.scrollLeft = 0;
    expect(reported()).toEqual([['broken-value', 'undefined']]);
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual(selection);
    expect(document.body.children).toHaveLength(1);
    if (property === 'placeholder') {
      expect(styles).toHaveBeenCalledWith(field, '::placeholder');
      placeholder.style.opacity = '0';
      expect(reported()).toEqual([]);
    }
  },
);

it('follows soft-wrapped textarea lines while its scrolling parent clips the bottom row', () => {
  document.body.innerHTML =
    '<div style="overflow-y:hidden"><textarea id="wrapped" style="white-space:pre-wrap; line-height:20px; border:0; padding:0"></textarea></div>';
  const field = document.querySelector('textarea')!;
  field.value = 'Ready     undefined Cleared';
  field.getBoundingClientRect = () => new DOMRect(20, 20, 100, 40);
  Object.defineProperties(field, {
    clientWidth: { value: 100 },
    scrollWidth: { value: 100 },
    clientHeight: { value: 40 },
    scrollHeight: { value: 60 },
  });
  vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
    const parent = this.startContainer.parentElement!;
    const rect = parent.getBoundingClientRect();
    const columns = Number.parseFloat(parent.style.width) / 10;
    expect(parent.style.whiteSpace).toBe('pre-wrap');
    return Array.from({ length: this.endOffset - this.startOffset }, (_, i) => {
      const offset = this.startOffset + i;
      return new DOMRect(
        rect.left + (offset % columns) * 10,
        rect.top + Math.floor(offset / columns) * 20,
        10,
        20,
      );
    }) as unknown as DOMRectList;
  });
  const broken = () =>
    findings()
      .filter((f) => f.check === 'broken-value')
      .map((f) => f.text);
  expect(broken()).toEqual([]);
  field.scrollTop = 20;
  expect(broken()).toEqual(['undefined']);
  field.scrollTop = 0;
  expect(broken()).toEqual([]);

  const clip = field.parentElement!;
  clip.style.overflowX = 'hidden';
  clip.getBoundingClientRect = () => new DOMRect(20, 20, 90, 40);
  field.value = 'Status unXdefined    Cleared';
  expect(broken()).toEqual([]);
  clip.getBoundingClientRect = () => new DOMRect(20, 20, 100, 40);
  field.value = 'Ready undefined'.padEnd(20) + 'Cleared';
  expect(broken()).toEqual(['Ready undefined']);
});

it('checks a visible count across inline-block fragments without joining separate controls', () => {
  document.body.innerHTML = `
    <div id="label">1 <span style="display:inline-block">files</span></div>
    <div id="gap">1<span style="display:inline-block" data-gap>folders</span></div>
    <div>1 <span style="display:inline-block" hidden>files</span></div>
    <div><button>1 </button><button>files</button></div>`;
  vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
    const x = this.startContainer.parentElement?.hasAttribute('data-gap') ? 40 : 20;
    return [new DOMRect(x, 20, 12, 10)] as unknown as DOMRectList;
  });
  expect(
    findings()
      .filter(({ check }) => check === 'plural')
      .map(({ selector, text }) => [selector, text]),
  ).toEqual([
    ['div#label', '1 files'],
    ['div#gap', '1 folders'],
  ]);
});

it('reads neighboring flex items as one control label only when they share a rendered line', async () => {
  const count = '<span style="display:block">1</span>';
  const noun = '<span style="display:block" data-gap>files</span>';
  document.body.innerHTML = [
    '<button id="count" style="display:inline-flex">' + count + noun + '</button>',
    '<div role="button" id="choice" style="display:flex">' + count + noun + '</div>',
    '<button>' + count + '</button><button>' + noun + '</button>',
    '<button data-stack><span style="display:block">1 </span>' + noun + '</button>',
  ].join('');
  vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
    const parent = this.startContainer.parentElement!;
    const afterGap = parent.hasAttribute('data-gap');
    const y = afterGap && parent.closest('[data-stack]') ? 50 : 20;
    return [new DOMRect(afterGap ? 34 : 20, y, 10, 12)] as unknown as DOMRectList;
  });
  expect(
    findings()
      .filter(({ check }) => check === 'plural')
      .map(({ selector, text }) => [selector, text]),
  ).toEqual([
    ['button#count', '1 files'],
    ['div#choice', '1 files'],
  ]);
  expect(await reviewPage().shows('1 files')).toBe(true);
});

it('measures shown matches even when hidden matches come first', async () => {
  document.body.innerHTML = `
    <div class="visually-hidden"><span class="name">Hidden name</span></div>
    <div hidden><span class="cube">Hidden cube</span></div>
    <button class="cube" data-offscreen data-y="2000">Offscreen cube</button>
    <button class="control" style="opacity: 0">Hidden button</button>
    <button class="control">Visible button</button>
  `;
  const connection = { evaluate } as unknown as Connection;
  const page = new ReviewPage(
    {} as Awaited<ReturnType<typeof ownedApp>>,
    connection,
    home,
    standardVariants[0]!,
  );

  await page.expectNone('.name', 'No name in the footer');
  await page.expectNone('.cube', 'No cube on the error card');
  await page.expectPresent('.cube', 'Cube available');
  await page.expectBox('.control', { height: 1 }, 'The button box');
  await page.expectText('Hidden name', 'Hidden text');
  await page.expectText('Offscreen cube', 'Offscreen text');
  await page.expectText('Visible button', 'Visible text');

  expect(page.findings.map(({ selector, text }) => [selector, text])).toEqual([
    ['.cube', ''],
    ['.control', 'Visible button'],
    ['body', 'Hidden name'],
    ['body', 'Offscreen cube'],
  ]);
});

it('skips clipped controls and labels before choosing a match in view', async () => {
  document.body.innerHTML = `
    <section style="overflow-y: auto"><div><button class="choice" id="clipped" data-y="65">First choice</button></div></section>
    <button class="choice">Second choice</button>`;
  document.querySelector('#clipped')!.getBoundingClientRect = () => new DOMRect(20, 65, 100, 20);
  const page = reviewPage();
  await page.expectNone('#clipped', 'A scrolled-off button stays hidden');
  await page.expectPresent('#clipped', 'The button shows');
  await page.expectBox('.choice', { height: 1 }, 'Measure the first shown choice');
  await page.expectText('First choice', 'The label shows');
  await page.expectText('Second choice', 'The second label shows');
  expect(page.findings.map(({ selector, text }) => [selector, text])).toEqual([
    ['#clipped', ''],
    ['.choice', 'Second choice'],
    ['body', 'First choice'],
  ]);
});

it('checks only visible character ranges on clipped lines and at either horizontal edge', async () => {
  document.body.innerHTML = `
    <div id="first" style="overflow-y:hidden">Ready\nundefined</div>
    <div id="second" style="overflow-y:hidden">undefined\nReady</div>
    <div id="right" style="overflow-x:hidden">Ready then undefined</div>
    <div id="left" style="overflow-x:hidden">undefined then Ready</div>
    <div id="inside" style="overflow-x:hidden">undefined then Ready</div>
    <div id="part" style="overflow-x:hidden">Ready undefined</div>
    <div id="path" style="overflow-y:hidden; white-space:pre">Online\n${home}/Pictures</div>`;
  vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
    const text = this.startContainer as Text;
    const offset = text.parentElement?.id === 'left' ? -90 : 20;
    const before = text.data.slice(0, this.startOffset).split('\n');
    const lines = text.data.slice(this.startOffset, this.endOffset).split('\n');
    return lines.map(
      (line, index) =>
        new DOMRect(
          offset + (index === 0 ? before.at(-1)!.length * 10 : 0),
          20 + (before.length - 1 + index) * 22,
          line.length * 10,
          12,
        ),
    ) as unknown as DOMRectList;
  });
  expect(
    findings()
      .filter(({ check }) => check === 'broken-value')
      .map(({ selector }) => selector),
  ).toEqual(['div#second', 'div#inside']);
  expect(findings().some(({ check }) => check === 'home-path')).toBe(false);
  const page = reviewPage();
  expect(await page.shows('Online')).toBe(true);
  expect(await page.shows(home)).toBe(false);
  expect(await page.shows('Ready unde')).toBe(true);
  expect(await page.shows('Ready undefined')).toBe(false);
});

it('allows two lines only in Grid filenames', () => {
  document.body.innerHTML = `
    <div class="file-tile" role="option" id="grid-two"><span class="file-linked-label">
      <span class="file-name-label" data-fit="two-lines" data-lines="2">Two lines.txt</span></span></div>
    <div class="file-tile" role="option" id="grid-three"><span class="file-linked-label">
      <span class="file-name-label" data-fit="two-lines" data-lines="3">Three lines.txt</span></span></div>
    <div class="file-tile" role="option" id="grid-other"><small data-lines="2">More details</small></div>
    <button id="button" data-lines="2">Two lines</button>
    <div id="other" role="option"><span class="file-name-label" data-fit="two-lines" data-lines="2">Two lines.txt</span></div>
  `;

  expect(
    findings()
      .filter(({ check }) => check === 'wrap')
      .map(({ selector }) => selector),
  ).toEqual(['div#grid-three', 'div#grid-other', 'button#button', 'div#other']);
});

it('measures the Image Tools stem and suffix together after revealing the field', async () => {
  const scene = reviewAreas
    .flatMap((area) => area.scenes)
    .find(({ id }) => id === 'output-name-field')!;
  document.body.innerHTML = `
    <dialog open class="image-tools-dialog" aria-label="Image Tools · Long photo.jpg">
      <div class="dialog-field">
        <label for="stem">File name</label>
        <div class="file-name-control">
          <input id="stem" aria-label="File name: Long photo.webp"><span class="file-name-suffix">.webp</span>
        </div>
      </div>
    </dialog>
  `;
  const reveal = vi.fn();
  document.querySelector('.file-name-control')!.scrollIntoView = reveal;
  const measure = vi.fn(async (field: string, row: string) => {
    expect(document.querySelector(field)?.closest(row)?.className).toBe('dialog-field');
    expect(document.querySelector(field)?.querySelector('.file-name-suffix')?.textContent).toBe(
      '.webp',
    );
  });
  const page = {
    path: vi.fn(),
    select: vi.fn(),
    palette: vi.fn(),
    waitFor: vi.fn(),
    settle: vi.fn(),
    scrollIntoView: async (selector: string) => document.querySelector(selector)!.scrollIntoView(),
    evaluate,
    expectFillsRow: measure,
  } as unknown as ReviewPage;
  await scene.steps(page, standardVariants[0]!);
  expect(reveal).toHaveBeenCalledBefore(measure);
});

it('opens the sample Trash through the palette and waits for the dialog', async () => {
  const scene = reviewAreas.flatMap((area) => area.scenes).find(({ id }) => id === 'trash')!;
  const page = { palette: vi.fn(), waitFor: vi.fn(), settle: vi.fn(), key: vi.fn() };
  await scene.steps(page as unknown as ReviewPage, standardVariants[0]!);
  expect(scene.requires).toEqual([{ qaHooks: true }]);
  expect(page.palette).toHaveBeenCalledWith('Trash');
  expect(page.waitFor).toHaveBeenCalledWith(
    'dialog[open] .trash-footer, dialog[open][aria-label*="trash" i]',
  );
  expect(page.key).not.toHaveBeenCalledWith('Backspace', 'Backspace', modifiers.command);
});

function reviewPage() {
  return new ReviewPage(
    {} as Awaited<ReturnType<typeof ownedApp>>,
    { evaluate } as unknown as Connection,
    home,
    standardVariants[0]!,
  );
}

it('requires every seeded command summary in Settings even when built-in recipes are present', async () => {
  const scene = reviewAreas
    .flatMap((area) => area.scenes)
    .find(({ id }) => id === 'settings-actions')!;
  const names = scene.setup.customActions!.map((action) => action.name);
  const row = (name: string, field: string) =>
    '<details class="settings-recipe"><summary>' +
    name +
    '</summary><input aria-label="' +
    field +
    '"></details>';
  document.body.innerHTML =
    '<main class="settings-page">' + row(names[0]!, 'Recipe name') + '</main>';
  const main = document.querySelector('main')!;
  const page = reviewPage();
  vi.spyOn(page, 'settings').mockResolvedValue();
  const until = page.until.bind(page);
  vi.spyOn(page, 'until').mockImplementation((read, accept, label) =>
    until(read, accept, label, 0),
  );
  const steps = () => scene.steps(page, standardVariants[0]!);
  const missing = await steps().then(
    () => '',
    (error: Error) => error.message,
  );
  for (const name of names) expect(missing).toContain(name);
  for (const name of names.slice(1))
    main.insertAdjacentHTML('beforeend', row(name, 'Command name'));
  await expect(steps()).rejects.toThrow(names[0]);
  main.insertAdjacentHTML('beforeend', row(names[0]!, 'Command name'));
  await expect(steps()).resolves.toBeUndefined();
});

it('hit-tests the workflow button while the menu is open and presses it at that point', async () => {
  const scene = reviewAreas
    .flatMap((area) => area.scenes)
    .find(({ id }) => id === 'settings-workflow-editor')!;
  document.body.innerHTML =
    '<button aria-label="Workflow step 2"><span>Print a Caption</span></button><input aria-label="Workflow line 1">';
  const anchor = document.querySelector('button')!;
  anchor.scrollIntoView = vi.fn();
  const menu = document.createElement('div');
  menu.className = 'choice-menu';
  menu.setAttribute('aria-label', 'Workflow step 2');
  menu.innerHTML = '<div class="context-menu"></div>';
  menu.firstElementChild!.getBoundingClientRect = () => new DOMRect(20, 44, 100, 80);
  anchor.onclick = () => {
    if (menu.isConnected) menu.remove();
    else document.body.append(menu);
  };
  let covered = true;
  const hit = vi.fn(() => (covered ? menu : anchor.firstElementChild));
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hit });
  const command = vi.fn(async (_method: string, params: { type: string }) => {
    if (params.type === 'mouseReleased') anchor.click();
  });
  const page = new ReviewPage(
    {} as Awaited<ReturnType<typeof ownedApp>>,
    { evaluate, command } as unknown as Connection,
    home,
    standardVariants[0]!,
  );
  for (const method of ['settings', 'button', 'scrollIntoView', 'settle'] as const)
    vi.spyOn(page, method).mockResolvedValue();
  const steps = () => scene.steps(page, standardVariants[0]!);
  await expect(steps()).rejects.toThrow(/pointer.*Workflow step 2/i);
  expect(command).not.toHaveBeenCalled();
  expect(menu.isConnected).toBe(true);
  menu.remove();
  covered = false;
  await steps();
  expect(hit).toHaveBeenLastCalledWith(70, 30);
  for (const type of ['mousePressed', 'mouseReleased'])
    expect(command).toHaveBeenCalledWith(
      'Input.dispatchMouseEvent',
      expect.objectContaining({
        type,
        button: 'left',
        x: 70,
        y: 30,
      }),
    );
  expect(menu.isConnected).toBe(false);
  expect(page.findings).toEqual([]);
});

it('opens Dictate from the sample note only with local speech and no installed model', async () => {
  const scene = reviewAreas
    .flatMap((area) => area.scenes)
    .find(({ id }) => id === 'dialog-dictate')!;
  const speech = vi.fn();
  vi.stubGlobal('viewer', { speech });
  try {
    const page = reviewPage();
    const palette = vi.spyOn(page, 'palette').mockResolvedValue();
    const press = vi.spyOn(page, 'button').mockResolvedValue();
    const wait = vi.spyOn(page, 'waitFor').mockResolvedValue();
    const measure = vi.spyOn(page, 'expectText').mockResolvedValue();
    expect(scene.blocked).toBeUndefined();
    for (const [backend, installed] of [
      ['hosted', false],
      ['local', true],
    ] as const) {
      speech.mockResolvedValue({ preferences: { backend }, models: { models: [{ installed }] } });
      await expect(scene.steps(page, standardVariants[0]!)).rejects.toThrow(
        /local speech.*no installed model/i,
      );
      expect(press).not.toHaveBeenCalled();
    }
    speech.mockResolvedValue({
      preferences: {},
      models: { models: [], runtime: { recognitionAvailable: true } },
    });
    await scene.steps(page, standardVariants[0]!);
    expect(speech.mock.calls.every(([request]) => request.kind === 'status')).toBe(true);
    expect(palette).toHaveBeenLastCalledWith('New Note Plane');
    expect(press).toHaveBeenCalledExactlyOnceWith(
      'Dictate',
      '.preview-toolbar:has(button[aria-label="Dictate"])',
    );
    expect(wait).toHaveBeenCalledWith('dialog[open].speech-dialog [role="alert"]');
    for (const label of [
      'Append to Untitled note',
      'Choose an installed speech model in Settings → Speech.',
      'Open Speech Settings',
    ])
      expect(measure).toHaveBeenCalledWith(label, expect.any(String));
  } finally {
    vi.unstubAllGlobals();
  }
});

it('opens the enabled speech language choice after the scroll event and checks its search field', async () => {
  const scene = reviewAreas
    .flatMap((area) => area.scenes)
    .find(({ id }) => id === 'speech-language-menu')!;
  document.body.innerHTML = `
    <button aria-label="Speech language" disabled>Automatic</button>
    <section><button aria-label="Speech language" data-offscreen>English</button></section>
  `;
  const scroller = document.querySelector('section')!;
  const anchor = scroller.querySelector('button')!;
  const menu = document.createElement('div');
  menu.className = 'choice-menu';
  menu.setAttribute('aria-label', 'Speech language');
  menu.innerHTML =
    '<div class="context-menu"><input aria-label="Search Speech language" placeholder="Search"></div>';
  scroller.onscroll = () => {
    menu.hidden = true;
  };
  anchor.scrollIntoView = () => {
    anchor.removeAttribute('data-offscreen');
    requestAnimationFrame(() => scroller.dispatchEvent(new Event('scroll')));
  };
  anchor.onclick = () => {
    document.body.append(menu);
    menu.hidden = false;
  };
  const page = reviewPage();
  vi.spyOn(page, 'settings').mockResolvedValue();
  vi.spyOn(page, 'settle').mockImplementation(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  await scene.steps(page, standardVariants[0]!);
  expect(anchor.hasAttribute('data-offscreen')).toBe(false);
  expect(page.findings).toEqual([]);
});

it('targets the named Image Tools choices independent of their order', async () => {
  document.body.innerHTML = `
    <dialog open class="image-tools-dialog" aria-label="Image Tools · Photo.jpg">
      <button aria-label="Image metadata policy" aria-haspopup="dialog"></button>
      <button aria-label="Image resize fit" aria-haspopup="dialog"></button>
      <button aria-label="Image output format" aria-haspopup="dialog"></button>
    </dialog>
  `;
  for (const [id, label] of [
    ['format-menu-gap', 'Image output format'],
    ['metadata-menu-short-window', 'Image metadata policy'],
    ['dropdown-in-dialog', 'Image output format'],
  ] as const) {
    const clickFirst = vi.fn(async (selector: string) => {
      expect(document.querySelector(selector)?.getAttribute('aria-label')).toBe(label);
    });
    const page = {
      select: vi.fn(),
      path: vi.fn(),
      palette: vi.fn(),
      waitFor: vi.fn(),
      settle: vi.fn(),
      expectGap: vi.fn(),
      expectAligned: vi.fn(),
      clickNth: vi.fn(),
      clickFirst,
    };
    const scene = reviewAreas.flatMap((area) => area.scenes).find((scene) => scene.id === id)!;
    await scene.steps(page as unknown as ReviewPage, standardVariants[0]!);
    expect(clickFirst).toHaveBeenCalledOnce();
  }
});
