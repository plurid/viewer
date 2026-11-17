// @vitest-environment jsdom
/**
 * A PREVIEW'S TOOLBAR AND FOOTER (DESIGN.md, the Preview Bar and Preview Identity rules): one line
 * each, whatever the width. jsdom lays nothing out, so widths are mocked: a button is as wide as its
 * label, an icon 30 px, and a toolbar's spacer takes what its siblings leave, as in Chromium.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { useMemo, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FileEntry } from '../src/domain/contracts';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import {
  PreviewFacts,
  PreviewFileInfo,
  middleFilename,
} from '../src/renderer/previews/PreviewFileInfo';
import { PreviewToolbar, usePreviewCommands } from '../src/renderer/previews/controls';
import { headerItem } from '../src/renderer/workspace/header-overflow';
import { IconButton } from '../src/renderer/ui/primitives';
import { PreviewFrameFixture } from './support/preview-frame';

/** The toolbar's and the footer line's width. */
let room = 400;
const gap = 6;
const padding = 8;
const shown = (element: Element) => getComputedStyle(element).display !== 'none';

function width(element: HTMLElement): number {
  if (!shown(element)) return 0;
  if (element.matches('.preview-toolbar')) return room;
  if (element.matches('.toolbar-spacer')) {
    const siblings = [...element.parentElement!.children].filter(
      (child) => child !== element && shown(child),
    ) as HTMLElement[];
    const taken = siblings.reduce((total, child) => total + width(child), 0);
    return Math.max(0, room - 2 * padding - taken - gap * siblings.length);
  }
  if (element.hasAttribute('data-compact') || element.classList.contains('icon-button')) return 30;
  if (element.matches('.preview-toolbar-group')) {
    const children = [...element.children].filter(shown) as HTMLElement[];
    return (
      children.reduce((total, child) => total + width(child), 0) +
      gap * Math.max(0, children.length - 1)
    );
  }
  // a fact as the footer draws it: its separator and spacing, then its words
  if (element.matches('.preview-file-detail')) return (element.textContent!.length - 1) * 7 + 20;
  const text = element.textContent?.length ?? 0;
  return element.matches('button') ? text * 7 + 20 : text * 7;
}

beforeEach(() => {
  room = 400;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const style = document.createElement('style');
  style.textContent = [
    readFileSync(path.resolve(import.meta.dirname, '../src/renderer/styles/previews.css'), 'utf8'),
    // what jsdom cannot resolve from the token variables and base.css
    `.preview-host .preview-toolbar { column-gap: ${gap}px; padding: 0 ${padding}px; }`,
    `.preview-toolbar-group { column-gap: ${gap}px; }`,
    '.toolbar-spacer { flex-grow: 1; }',
    '.preview-file-info, .preview-file-details { column-gap: 8px; }',
  ].join('\n');
  document.head.append(style);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return width(this);
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.matches('.preview-file-info') ? room : width(this);
  });
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return width(this);
  });
});
afterEach(() => {
  cleanup();
  document.head.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const context = {} as PreviewContext;
const optimize = vi.fn();
const imageTools = vi.fn();

/** An image's toolbar, as ImagePreview builds it. */
function ImageToolbar() {
  const [zoom, setZoom] = useState(1);
  usePreviewCommands(
    context,
    useMemo(
      () => [
        { id: 'zoom-in', label: 'Zoom in', run: () => setZoom((value) => value * 2) },
        { id: 'zoom-out', label: 'Zoom out', run: () => setZoom((value) => value / 2) },
        { id: 'image-fit', label: 'Fit image', run: () => setZoom(1) },
      ],
      [],
    ),
  );
  return (
    <PreviewToolbar context={context}>
      <button {...headerItem('optimize', 8, ['optimize-files'])} onClick={optimize}>
        Optimize…
      </button>
      <button {...headerItem('image-tools', 5, ['image-tools'])} onClick={imageTools}>
        Image tools…
      </button>
      <IconButton {...headerItem('fit', 3, ['preview.image-fit'])} icon="fit" label="Fit image" />
      <IconButton
        {...headerItem('zoom-out', 4, ['preview.zoom-out'])}
        icon="zoom-out"
        label="Zoom out"
      />
      <span {...headerItem('zoom', 6, 'detail')}>{Math.round(zoom * 100)}%</span>
      <IconButton
        {...headerItem('zoom-in', 4, ['preview.zoom-in'])}
        icon="zoom-in"
        label="Zoom in"
      />
      <span className="toolbar-spacer" />
      <span {...headerItem('size', 9, 'detail')}>2400 × 900</span>
    </PreviewToolbar>
  );
}

function renderToolbar() {
  const view = render(
    <PreviewFrameFixture>
      <ImageToolbar />
    </PreviewFrameFixture>,
  );
  return { view, toolbar: view.container.querySelector<HTMLElement>('.preview-toolbar')! };
}
/** A width change, as the toolbar's ResizeObserver reports it, and the measuring it schedules. */
async function resize(to: number, toolbar: HTMLElement) {
  room = to;
  // the attribute is one the toolbar watches, as a change of its content would be
  await act(async () => {
    toolbar.firstElementChild!.setAttribute('class', toolbar.firstElementChild!.className);
    // the measuring, then what it shows or hides, each a frame
    for (let frame = 0; frame < 3; frame++)
      await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}
/** The toolbar item holding a control, by its accessible name, shown or not. */
const action = (name: string) =>
  document
    .querySelector(`.preview-toolbar [aria-label="${name}"]`)!
    .closest<HTMLElement>('[data-header-item]')!;
const away = (name: string) => action(name).hasAttribute('data-spilled');
const compact = (name: string) => action(name).hasAttribute('data-compact');

describe('a preview toolbar where it stands', () => {
  it('moves the image size to the footer and keeps every control on its line', () => {
    const { view, toolbar } = renderToolbar();
    expect(toolbar.textContent).not.toContain('2400 × 900');
    expect(screen.getByRole('contentinfo', { name: 'Footer facts' }).textContent).toBe(
      '2400 × 900',
    );
    expect(getComputedStyle(toolbar).height).toBe('44px');
    expect(getComputedStyle(toolbar).whiteSpace).toBe('nowrap');
    for (const button of toolbar.querySelectorAll('button'))
      expect(getComputedStyle(button).whiteSpace).toBe('nowrap');
    expect(view.container.querySelector('[data-spilled], [data-compact]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'More preview actions' })).toBeNull();
  });

  it('shows a labelled action as its named icon before anything gives way', async () => {
    const { toolbar } = renderToolbar();
    await resize(320, toolbar);
    expect(compact('Optimize…')).toBe(true);
    expect(compact('Image tools…')).toBe(false);
    const button = screen.getByRole('button', { name: 'Optimize…' });
    expect(button.getAttribute('title')).toBe('Optimize…');
    expect(button.querySelector('svg')).toBeTruthy();
    expect(toolbar.querySelector('[data-spilled]')).toBeNull();
  });

  it('then moves the least important into "…", the zoom staying whole, and brings all back', async () => {
    const { toolbar } = renderToolbar();
    await resize(200, toolbar);
    expect(away('Optimize…')).toBe(true);
    expect(away('Image tools…')).toBe(true);
    expect(away('Fit image')).toBe(false);
    // the zoom out, its level and the zoom in are one item
    const zoom = action('Zoom in');
    expect(zoom).toBe(action('Zoom out'));
    expect(zoom.textContent).toContain('100%');
    expect(zoom.hasAttribute('data-spilled')).toBe(false);
    // what shows fits: nothing scrolls
    const visible = [...toolbar.children].filter(shown) as HTMLElement[];
    const used = visible
      .filter((child) => !child.matches('.toolbar-spacer'))
      .reduce((total, child) => total + width(child), 0);
    expect(used + gap * (visible.length - 1)).toBeLessThanOrEqual(room - 2 * padding);
    // the spacer once took what was left; growing back must not count it
    await resize(400, toolbar);
    expect(toolbar.querySelector('[data-spilled], [data-compact]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'More preview actions' })).toBeNull();
  });

  it('runs what gave way from "…", a menu that closes on a second press and on Tab', async () => {
    const { toolbar } = renderToolbar();
    await resize(120, toolbar);
    expect(away('Zoom in')).toBe(true);
    const more = screen.getByRole('button', { name: 'More preview actions' });
    fireEvent.click(more);
    const menu = await screen.findByRole('dialog', { name: 'More preview actions' });
    const labels = [...menu.querySelectorAll('[role="menuitem"], [role="option"]')].map((item) =>
      item.textContent?.trim(),
    );
    expect(labels).toEqual(
      expect.arrayContaining(['Optimize…', 'Image tools…', 'Zoom out', 'Zoom in']),
    );
    // a second press on its button closes it
    fireEvent.pointerDown(more);
    fireEvent.click(more);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'More preview actions' })).toBeNull(),
    );
    // Tab closes it and gives the keyboard back to its button
    fireEvent.click(more);
    const again = await screen.findByRole('dialog', { name: 'More preview actions' });
    fireEvent.keyDown(again, { key: 'Tab' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'More preview actions' })).toBeNull(),
    );
    expect(document.activeElement).toBe(more);
    // a choice runs the module's command, or presses the control standing for it
    const choose = async (label: string) => {
      fireEvent.click(more);
      const open = await screen.findByRole('dialog', { name: 'More preview actions' });
      fireEvent.click(within(open).getByText(label));
    };
    await choose('Zoom in');
    await waitFor(() => expect(toolbar.textContent).toContain('200%'));
    await choose('Optimize…');
    await waitFor(() => expect(optimize).toHaveBeenCalledOnce());
  });
});

const entry = (name: string): FileEntry => ({
  path: `/fixtures/${name}`,
  parent: '/fixtures',
  name,
  extension: 'png',
  mime: 'image/png',
  kind: 'file',
  directory: false,
  size: 2_100_000,
  created: 1,
  modified: 1,
  hidden: false,
  identity: name,
});
const footer = (name: string) => (
  <footer className="preview-info">
    <PreviewFileInfo entry={entry(name)} kind="Image" details={['2400 × 900']} />
  </footer>
);
const filename = (view: ReturnType<typeof render>) =>
  view.container.querySelector('.preview-file-info > .preview-filename:not(.preview-info-measure)')!
    .textContent!;
const facts = (view: ReturnType<typeof render>) =>
  [
    ...view.container.querySelectorAll(
      '.preview-file-info > .preview-file-details:not(.preview-info-measure) > *',
    ),
  ].map((fact) => fact.textContent!.replace('·', ''));

describe('a preview footer', () => {
  it('shortens a filename in its middle, keeping its extension', () => {
    const measure = (text: string) => text.length * 7;
    expect(middleFilename('2_A7_snec_alimentare_randare.png', 140, measure)).toMatch(
      /^2_A7_sne.*….*re\.png$/,
    );
    expect(middleFilename('short.png', 140, measure)).toBe('short.png');
  });

  it('keeps one line of one height for a short and a long name, the whole in its tooltip', () => {
    room = 320;
    const view = render(footer('a.png'));
    const line = view.container.querySelector('footer')!;
    const height = getComputedStyle(line).height;
    expect(filename(view)).toBe('a.png');
    expect(facts(view)).toEqual(['Image', '2.1 MB', '2400 × 900']);
    view.rerender(footer('2_A7_snec_alimentare_randare.png'));
    expect(getComputedStyle(line).height).toBe(height);
    expect(height).toBe('31px');
    expect(getComputedStyle(line).whiteSpace).toBe('nowrap');
    expect(filename(view)).toMatch(/^2_A7.*….*\.png$/);
    const info = view.container.querySelector('.preview-file-info')!;
    const whole = '2_A7_snec_alimentare_randare.png · Image · 2.1 MB · 2400 × 900';
    expect(info.getAttribute('title')).toBe(whole);
    expect(info.getAttribute('aria-label')).toBe(whole);
  });

  it('gives way from the last fact: dimensions, then kind, then size', () => {
    const name = '2_A7_snec_alimentare_randare.png';
    const at = (width: number) => {
      room = width;
      const view = render(footer(name));
      const shown = facts(view);
      view.unmount();
      return shown;
    };
    // the name keeps 96 px, whatever goes
    expect(at(340)).toEqual(['Image', '2.1 MB', '2400 × 900']);
    expect(at(250)).toEqual(['Image', '2.1 MB']);
    expect(at(200)).toEqual(['2.1 MB']);
    expect(at(110)).toEqual([]);
  });

  it('shows a new name whole until it has room to be measured, never the last one', () => {
    room = 320;
    const view = render(footer('first-photo-of-the-day.png'));
    room = 0;
    view.rerender(footer('second.png'));
    expect(filename(view)).toBe('second.png');
  });

  it('shows only the facts where a title names the file, without a leading separator', () => {
    room = 400;
    const view = render(
      <footer className="quick-preview-footer">
        <PreviewFacts kind="Image" size="2.1 MB" details={['From Desktop']} />
      </footer>,
    );
    expect(
      view.container.querySelector(
        '.preview-file-info > .preview-filename:not(.preview-info-measure)',
      ),
    ).toBeNull();
    const first = view.container.querySelector(
      '.preview-file-info > .preview-file-details:not(.preview-info-measure) > *',
    )!;
    expect(first.querySelector('.separator')).toBeNull();
    expect(view.container.querySelector('.preview-file-info')!.getAttribute('aria-label')).toBe(
      'Image · 2.1 MB · From Desktop',
    );
  });
});
