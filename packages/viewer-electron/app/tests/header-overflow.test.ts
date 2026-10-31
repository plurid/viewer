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
    const width = (element: HTMLElement) =>
      getComputedStyle(element).display === 'none' ? 0 : Number(element.dataset.width ?? 0);
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
