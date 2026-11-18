// @vitest-environment jsdom
/**
 * A NARROW PLANE HEADER: items give way strictly in rank order, measured, and lead the plane's
 * "…" menu as their commands; a control with no command never gives way.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import type { SpillCandidate } from '../src/renderer/workspace/header-overflow';
import {
  headerItem,
  headerMenu,
  pinnedItem,
  settleHeader,
  spillHeader,
  titleMinimum,
  useHeaderOverflow,
} from '../src/renderer/workspace/header-overflow';
import { contextMenuSections } from '../src/renderer/commands/menu';
import type { ResolvedCommand } from '../src/renderer/commands/registry';

const item = (id: string, rank: SpillCandidate['rank'], cost: number): SpillCandidate => ({
  id,
  rank,
  cost,
});

describe('spillHeader', () => {
  it('spills nothing while the header fits', () => {
    expect(spillHeader(0, [item('a', 9, 30)])).toEqual([]);
    expect(spillHeader(-12, [item('a', 9, 30)])).toEqual([]);
  });
  it('gives way strictly in rank order, never keeping a later rank for a cheaper fit', () => {
    const items = [item('back', 3, 33), item('discover', 9, 33), item('git', 8, 120)];
    expect(spillHeader(20, items)).toEqual(['discover']);
    // the wide Git branch goes before Back, though Back alone would do
    expect(spillHeader(40, items)).toEqual(['discover', 'git']);
    expect(spillHeader(500, items)).toEqual(['discover', 'git', 'back']);
  });
  it('takes the rightmost first among equal ranks', () => {
    expect(spillHeader(10, [item('previous', 3, 32), item('next', 3, 32)])).toEqual(['next']);
  });
  it('counts the "…" button the person hid, which comes back for what spills', () => {
    const items = [item('pins', 6, 33), item('layout', 8, 33)];
    expect(spillHeader(10, items)).toEqual(['layout']);
    expect(spillHeader(10, items, 33)).toEqual(['layout', 'pins']);
  });
});

describe('settleHeader', () => {
  const items = [item('back', 3, 33), item('discover', 9, 33), item('git', 8, 120)];
  it('sends away only what does not fit, however little room is left', () => {
    // 4 px to spare after Discover goes: Git stays
    expect(settleHeader(29, items, new Set())).toEqual(['discover']);
  });
  it('brings back what is away only with a few pixels to spare', () => {
    const away = new Set(['discover', 'git']);
    // Git would fit again with 2 px to spare: it waits
    expect(settleHeader(31, items, away)).toEqual(['discover', 'git']);
    expect(settleHeader(20, items, away)).toEqual(['discover']);
    expect(settleHeader(-20, items, away)).toEqual([]);
  });
  it('keeps away only what was away: what would go next, shown now, stays', () => {
    // Discover is away and Git shown: 31 px over, Git stays though 8 px of doubt would send it
    expect(settleHeader(31, items, new Set(['discover']))).toEqual(['discover']);
    expect(settleHeader(31, items, new Set(['back']))).toEqual(['discover']);
  });
});

describe('the "…" menu', () => {
  const command = (id: string, group: string): ResolvedCommand => ({
    id,
    label: id,
    group,
    aliases: [],
    primary: false,
    source: 'test',
    context: { scope: 'window', workspaceID: 'w', selection: [], jobs: [], clipboard: null },
  });
  const commands = [
    command('rename', 'Files'),
    command('view-list', 'View'),
    command('view-grid', 'View'),
    command('group.kind', 'View'),
    command('search', 'Navigation'),
    command('git-changes', 'Git'),
  ];
  it('leads with what spilled, in header order, a menu of several as its group', () => {
    const sections = contextMenuSections(
      commands,
      [],
      false,
      [],
      [['view-list', 'view-grid'], ['search'], ['missing']],
    );
    const [lead] = sections;
    expect(lead!.entries.map((entry) => entry.id)).toEqual(['menu.View', 'search']);
    // each placed once: neither View nor search is in its own group below
    const ids = sections.slice(1).flatMap((section) => section.entries.map((entry) => entry.id));
    expect(ids).not.toContain('menu.View');
    expect(ids).not.toContain('menu.Navigation');
    expect(ids).toContain('menu.Git');
  });
  it('has no lead in a scoped picker', () => {
    const sections = contextMenuSections(commands, [], true, [], [['search']]);
    expect(sections.flatMap((section) => section.entries.map((entry) => entry.id))).toContain(
      'search',
    );
    // its groups as they come, with no lead before them
    expect(sections[0]!.label).toBe('Files');
  });
});

describe('useHeaderOverflow', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.head.innerHTML = '';
  });
  /** jsdom lays nothing out: each element is as wide as its `data-width` says, unless hidden. */
  function layout() {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    const style = document.createElement('style');
    style.textContent = '[data-spilled], [data-pinned-twin] { display: none; }';
    document.head.append(style);
    // a labelled action shown as its icon is as wide as its `data-compact-width`
    const width = (element: HTMLElement) =>
      getComputedStyle(element).display === 'none'
        ? 0
        : Number(
            (element.hasAttribute('data-compact') && element.dataset.compactWidth) ||
              (element.dataset.width ?? 0),
          );
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return width(this);
    });
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return width(this);
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return width(this);
    });
  }
  function Header({ width, pinned = false }: { width: number; pinned?: boolean }) {
    const header = useRef<HTMLDivElement>(null);
    const lead = useHeaderOverflow(header);
    return createElement(
      'div',
      {
        ref: header,
        className: 'plane-controls',
        'data-width': width,
        'data-lead': JSON.stringify(lead),
      },
      createElement('span', { className: 'plane-heading', 'data-width': 300 }),
      createElement('button', { ...headerItem('back', 3, ['back']), 'data-width': 30 }),
      createElement('button', { ...headerItem('discover', 9, ['capabilities']), 'data-width': 30 }),
      createElement('span', { ...headerItem('size', 9, 'detail'), 'data-width': 60 }),
      // no command of its own: it never gives way
      createElement('button', {
        'data-header-item': 'zoom',
        'data-header-rank': '9',
        'data-width': 80,
      }),
      createElement('button', { ...headerItem('edit', 3, ['edit-file']), 'data-width': 40 }),
      pinned && createElement('button', { ...pinnedItem('edit-file'), 'data-width': 30 }),
      createElement('button', { ...headerMenu, 'data-width': 30 }),
    );
  }
  const spilled = (view: ReturnType<typeof render>) =>
    [...view.container.querySelectorAll('[data-spilled]')].map(
      (element) => (element as HTMLElement).dataset.headerItem,
    );
  const lead = (view: ReturnType<typeof render>) =>
    JSON.parse((view.container.firstChild as HTMLElement).dataset.lead!);

  it('keeps everything while the title has its room', () => {
    layout();
    const view = render(createElement(Header, { width: 600 }));
    expect(spilled(view)).toEqual([]);
    expect(lead(view)).toEqual([]);
  });
  it('spills in rank order into a lead of commands, a detail with none', async () => {
    layout();
    // the title's minimum and the rest: 96 + 30 + 30 + 60 + 80 + 40 + 30
    const natural = titleMinimum + 270;
    const view = render(createElement(Header, { width: natural - 70 }));
    await act(async () => {});
    expect(spilled(view).sort()).toEqual(['discover', 'size']);
    expect(lead(view)).toEqual([['capabilities']]);
    expect(
      view.container.querySelector('[data-header-item="zoom"]')!.hasAttribute('data-spilled'),
    ).toBe(false);
  });
  /** A header of `children`, each `[attributes]`, measured again as a resize would have it. */
  function Bar({ width, items }: { width: number; items: Record<string, unknown>[] }) {
    const header = useRef<HTMLDivElement>(null);
    useHeaderOverflow(header);
    return createElement(
      'div',
      { ref: header, className: 'plane-controls', 'data-width': width },
      createElement('span', { className: 'plane-heading', 'data-width': 300 }),
      ...items.map((props, index) => createElement('button', { key: index, ...props })),
      createElement('button', { ...headerMenu, 'data-width': 30 }),
    );
  }
  /** Frames run when `flush` says, and a resize is reported when `resize` says. */
  function frames() {
    const queued: FrameRequestCallback[] = [];
    const observers: ResizeObserverCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      queued.push(callback),
    );
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          observers.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    const flush = () =>
      act(() => {
        while (queued.length) queued.shift()!(0);
      });
    return {
      flush,
      resize() {
        for (const observer of observers) observer([], {} as ResizeObserver);
        flush();
      },
    };
  }
  const share = {
    ...headerItem('share', 5, ['share']),
    'data-header-collapse': '',
    'data-width': 100,
    'data-compact-width': 30,
  };
  const at = (view: ReturnType<typeof render>, id: string) =>
    view.container.querySelector<HTMLElement>(`[data-header-item="${id}"]`)!;

  it('shows a labelled action as its icon before it gives way, and so when it comes back', () => {
    layout();
    const { resize } = frames();
    // the title's 96, Share's 100 or its icon's 30, and "…"'s 30
    const view = render(createElement(Bar, { width: 140, items: [share] }));
    expect(at(view, 'share').hasAttribute('data-spilled')).toBe(true);
    // room for its icon, not its label
    view.rerender(createElement(Bar, { width: 170, items: [share] }));
    resize();
    expect(at(view, 'share').hasAttribute('data-spilled')).toBe(false);
    expect(at(view, 'share').hasAttribute('data-compact')).toBe(true);
    view.rerender(createElement(Bar, { width: 300, items: [share] }));
    resize();
    expect(at(view, 'share').hasAttribute('data-compact')).toBe(false);
  });

  it('makes no label an icon for an item that gives way anyway', () => {
    layout();
    // the title's 96, Share's 100 or 30, a 200 px detail and "…": the detail goes, Share keeps its
    // label
    const detail = { ...headerItem('size', 9, 'detail'), 'data-width': 200 };
    const view = render(createElement(Bar, { width: 260, items: [share, detail] }));
    expect(at(view, 'size').hasAttribute('data-spilled')).toBe(true);
    expect(at(view, 'share').hasAttribute('data-compact')).toBe(false);
    expect(at(view, 'share').hasAttribute('data-spilled')).toBe(false);
  });

  it('needs only a flexible child’s minimum, not the room it took', () => {
    layout();
    const view = render(
      createElement(Bar, {
        width: 300,
        items: [
          { ...headerItem('discover', 9, ['capabilities']), 'data-width': 30 },
          // a spacer that grew to fill what was there
          { style: { flexGrow: '1', minWidth: '0px' }, 'data-width': 400 },
        ],
      }),
    );
    expect(at(view, 'discover').hasAttribute('data-spilled')).toBe(false);
  });

  it('gives the keyboard to "…" when the control it was on gives way', () => {
    layout();
    const { flush, resize } = frames();
    const items = [{ ...headerItem('discover', 9, ['capabilities']), 'data-width': 30 }];
    const view = render(createElement(Bar, { width: 300, items }), {
      container: document.body.appendChild(document.createElement('div')),
    });
    at(view, 'discover').focus();
    view.rerender(createElement(Bar, { width: 140, items }));
    resize();
    flush();
    expect(at(view, 'discover').hasAttribute('data-spilled')).toBe(true);
    expect(document.activeElement).toBe(view.container.querySelector('[data-header-menu]'));
    // one the keyboard was not on gives way without taking it
    const other = document.body.appendChild(document.createElement('button'));
    other.focus();
    view.rerender(createElement(Bar, { width: 300, items }));
    resize();
    view.rerender(createElement(Bar, { width: 140, items }));
    resize();
    flush();
    expect(document.activeElement).toBe(other);
  });

  it('shows a format’s control once when the person pinned the same command', async () => {
    layout();
    const view = render(createElement(Header, { width: 900, pinned: true }));
    await act(async () => {});
    expect(
      view.container.querySelector('[data-header-item="edit"]')!.hasAttribute('data-pinned-twin'),
    ).toBe(true);
    expect(
      view.container
        .querySelector('[data-header-item="pin:edit-file"]')!
        .hasAttribute('data-pinned-twin'),
    ).toBe(false);
  });
});

describe('the header in its plane', () => {
  // jsdom lays nothing out: the packaged smoke docks a narrow model plane and reaches its footer
  const planes = path.resolve(import.meta.dirname, '../src/renderer/styles/planes.css');
  const rule = /^\.plane-controls \{([^}]*)\}/m
    .exec(readFileSync(planes, 'utf8'))![1]!
    .replace(/\/\*[\s\S]*?\*\//g, '');
  it('takes its width from the plane, never widening it with what should give way', () => {
    expect(rule).toMatch(/(?:^|\s)contain:\s*inline-size;/);
  });
  it('is no container, so nothing in it hides by breakpoint', () => {
    expect(rule).not.toMatch(/container(?:-type)?\s*:/);
  });
});
