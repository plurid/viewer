// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FileEntry } from '../src/domain/contracts';
import type { ColumnNavigation } from '../src/renderer/explorer/column-navigation';
import type { FileViewProps } from '../src/renderer/explorer/views';
import { ColumnsView } from '../src/renderer/explorer/views';
import { getState, initialize } from '../src/renderer/state/store';
import { folderOverrideSchema } from '../src/domain/workspaces/project';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({
    count,
    estimateSize,
  }: {
    count: number;
    estimateSize(index: number): number;
  }) => ({
    measure() {},
    scrollToIndex() {},
    getTotalSize: () => count * estimateSize(0),
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * estimateSize(index),
        size: estimateSize(index),
      })),
  }),
}));
vi.mock('../src/renderer/previews/HeldPreview', () => ({
  HeldPreview: ({ path }: { path: string }) => <div className="held-preview">{path}</div>,
}));
vi.mock('../src/renderer/ui/projectedResize', () => ({
  measureLocalX:
    () =>
    ({ x }: { x: number }) =>
      x,
}));

const files = ['a.png', '2_A7_snec_alimentare_randare.png'].map((name): FileEntry => ({
  name,
  path: `/fixtures/${name}`,
  parent: '/fixtures',
  extension: 'png',
  mime: 'image/png',
  directory: false,
  kind: 'file',
  size: 2_100_000,
  modified: 1,
  created: 1,
  hidden: false,
  identity: name,
}));
const navigation = {
  trail: ['/fixtures'],
  scope: () => files,
  directory: () => '/fixtures',
  activeDirectory: () => '/fixtures',
  activate: vi.fn(),
} as unknown as ColumnNavigation;
const props = (index: number): FileViewProps => ({
  entries: files,
  selection: [files[index]!.path],
  selectionSet: new Set([files[index]!.path]),
  showHidden: false,
  select: vi.fn(),
  open: vi.fn(),
  context: vi.fn(),
  drag: vi.fn(),
});
const resizeCallbacks = new Set<ResizeObserverCallback>();
let planeWidth = 900;
let scrollbars = false;

beforeEach(() => {
  planeWidth = 900;
  scrollbars = false;
  resizeCallbacks.clear();
  Object.assign(window, {
    viewer: { save: vi.fn(async () => {}), settingsPatch: vi.fn(async () => getState().settings) },
  });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
  const style = document.createElement('style');
  style.textContent = readFileSync(
    path.resolve(import.meta.dirname, '../src/renderer/styles/files.css'),
    'utf8',
  );
  document.head.append(style);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.add(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains('file-column')) return Number.parseFloat(this.style.width) || 280;
    if (this.classList.contains('column-preview'))
      return Math.max(
        planeWidth - 280,
        Number.parseFloat(this.style.getPropertyValue('--preview-width')) || 360,
      );
    return 280;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('column-preview') ? 280 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains('columns-view')) return planeWidth;
    // a classic scroll bar takes 15 px where its room is kept, where it always shows, or when its
    // content scrolls (`scrollbars`)
    const style = getComputedStyle(this);
    const kept = style.scrollbarGutter === 'stable' || style.overflowY === 'scroll';
    return this.offsetWidth - (kept || scrollbars ? 15 : 0);
  });
  HTMLElement.prototype.setPointerCapture = vi.fn();
});
afterEach(() => {
  cleanup();
  document.head.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps list widths, preview width and horizontal scroll when the selected filename changes', () => {
  const view = render(<ColumnsView {...props(0)} path="/fixtures" navigation={navigation} />);
  const strip = view.container.querySelector<HTMLElement>('.columns-view')!;
  const preview = screen.getByRole('region', { name: 'File preview' });
  const list = view.container.querySelector<HTMLElement>('.file-column')!;
  const width = preview.offsetWidth;
  strip.scrollLeft = 17;
  view.rerender(<ColumnsView {...props(1)} path="/fixtures" navigation={navigation} />);
  expect(preview.offsetWidth).toBe(width);
  expect(list.offsetWidth).toBe(280);
  expect(getComputedStyle(list).flexGrow).toBe('0');
  expect(strip.scrollLeft).toBe(17);
  expect(getComputedStyle(strip).overflowY).toBe('hidden');
});

it('resizes the preview by pointer and keyboard, remembers its width, and bounds it', () => {
  const view = render(<ColumnsView {...props(0)} path="/fixtures" navigation={navigation} />);
  const divider = screen.getByRole('separator', { name: 'Resize preview column' });
  fireEvent.pointerDown(divider, { button: 0, clientX: 600, clientY: 20, pointerId: 1 });
  fireEvent.pointerMove(divider, { clientX: 780, clientY: 20, pointerId: 1 });
  fireEvent.pointerUp(divider, { pointerId: 1 });
  expect(getState().settings.settings.folders['/fixtures']?.previewWidth).toBe(800);
  view.unmount();
  render(<ColumnsView {...props(1)} path="/fixtures" navigation={navigation} />);
  expect(
    screen.getByRole('separator', { name: 'Resize preview column' }).getAttribute('aria-valuenow'),
  ).toBe('800');
  fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize preview column' }), {
    key: 'Home',
  });
  expect(getState().settings.settings.folders['/fixtures']?.previewWidth).toBe(320);
  fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize preview column' }), {
    key: 'End',
  });
  expect(getState().settings.settings.folders['/fixtures']?.previewWidth).toBe(1600);
  expect(folderOverrideSchema.safeParse({ previewWidth: 319 }).success).toBe(false);
  expect(folderOverrideSchema.parse({ previewWidth: 800 }).previewWidth).toBe(800);
});

it('keeps the selected column visible while a narrow plane grows', () => {
  planeWidth = 200;
  const view = render(<ColumnsView {...props(0)} path="/fixtures" navigation={navigation} />);
  const strip = view.container.querySelector<HTMLElement>('.columns-view')!;
  expect(strip.scrollLeft).toBe(80);
  expect(screen.getByRole('region', { name: 'File preview' }).offsetWidth).toBeGreaterThanOrEqual(
    320,
  );
  planeWidth = 1000;
  act(() => {
    for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
  });
  expect(strip.scrollLeft).toBe(0);
  expect(screen.getByRole('region', { name: 'File preview' }).offsetWidth).toBe(720);
});

it.each(['system', 'always'])(
  'runs rows to the edge, keeping a 15 px scroll bar room only under column headers (%s scroll bars)',
  (mode) => {
    // the Always choice's own rules (base.css), with classic 15 px scroll bars
    const always = /\/\* Only a list whose rows line up[\s\S]*?scrollbar-gutter: stable;\n\}/.exec(
      readFileSync(path.resolve(import.meta.dirname, '../src/renderer/styles/base.css'), 'utf8'),
    )![0];
    const style = document.createElement('style');
    style.textContent = always;
    document.head.append(style);
    document.documentElement.dataset.scrollbars = mode;
    const view = render(<ColumnsView {...props(0)} path="/fixtures" navigation={navigation} />);
    const column = screen.getByRole('listbox', { name: 'Column files' });
    // nothing scrolls: the rows and their selection reach the column's edge
    expect(column.clientWidth).toBe(column.offsetWidth);
    // once it scrolls, its scroll bar takes its own room inside the column, which keeps its width
    scrollbars = true;
    expect(column.clientWidth).toBe(column.offsetWidth - 15);
    expect(column.closest<HTMLElement>('.file-column')!.offsetWidth).toBe(280);
    scrollbars = false;
    const grid = document.createElement('div');
    grid.className = 'file-scroll grid-scroll';
    view.container.append(grid);
    expect(grid.clientWidth).toBe(grid.offsetWidth);
    // List and search results: rows line up with their headers
    const table = document.createElement('div');
    table.className = 'file-table-content';
    const list = document.createElement('div');
    list.className = 'file-scroll';
    const head = document.createElement('div');
    head.className = 'file-head';
    table.append(head, list);
    view.container.append(table);
    expect(list.clientWidth).toBe(list.offsetWidth - 15);
    expect(head.clientWidth).toBe(list.clientWidth);
    // Always shows the List's track, and a column's only while it scrolls
    expect(getComputedStyle(list).overflowY === 'scroll').toBe(mode === 'always');
    expect(getComputedStyle(column).overflowY).not.toBe('scroll');
    delete document.documentElement.dataset.scrollbars;
  },
);
