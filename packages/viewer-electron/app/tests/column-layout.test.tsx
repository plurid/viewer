// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FileEntry } from '../src/domain/contracts';
import type { ColumnNavigation } from '../src/renderer/explorer/column-navigation';
import type { FileViewProps } from '../src/renderer/explorer/views';
import { ColumnsView } from '../src/renderer/explorer/views';
import {
  activeWorkspace,
  getState,
  initialize,
  quickPreview,
  updatePane,
} from '../src/renderer/state/store';
import { addPane } from '../src/renderer/state/panes';
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
/** The files plane the Columns view stands in. */
let paneID = '';
const props = (index: number, plane = paneID): FileViewProps => ({
  paneID: plane,
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
/** Where the current column starts in the strip, as if columns came before it. */
let columnLeft = 0;

beforeEach(() => {
  planeWidth = 900;
  scrollbars = false;
  columnLeft = 0;
  resizeCallbacks.clear();
  Object.assign(window, {
    viewer: {
      save: vi.fn(async () => {}),
      settingsPatch: vi.fn(async () => getState().settings),
      onEvent: () => () => {},
    },
  });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
  paneID = addPane('/fixtures', 'folder', true, { remember: false }).id;
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
    return this.classList.contains('column-preview')
      ? columnLeft + 280
      : this.classList.contains('file-column')
        ? columnLeft
        : 0;
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

/** The Columns preview's width a plane keeps, saved with the workspace. */
const widthOf = (id = paneID) => {
  const pane = activeWorkspace().panes.find((item) => item.id === id);
  return pane?.type === 'folder' ? pane.previewWidth : undefined;
};

it('resizes the preview by pointer and keyboard, remembers its width, and bounds it', () => {
  const view = render(<ColumnsView {...props(0)} path="/fixtures" navigation={navigation} />);
  const divider = screen.getByRole('separator', { name: 'Resize preview column' });
  fireEvent.pointerDown(divider, { button: 0, clientX: 600, clientY: 20, pointerId: 1 });
  fireEvent.pointerMove(divider, { clientX: 780, clientY: 20, pointerId: 1 });
  fireEvent.pointerUp(divider, { pointerId: 1 });
  expect(widthOf()).toBe(800);
  // the plane's own, never the folder's
  expect(getState().settings.settings.folders['/fixtures']).toBeUndefined();
  view.unmount();
  render(<ColumnsView {...props(1)} path="/fixtures" navigation={navigation} />);
  expect(
    screen.getByRole('separator', { name: 'Resize preview column' }).getAttribute('aria-valuenow'),
  ).toBe('800');
  fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize preview column' }), {
    key: 'Home',
  });
  expect(widthOf()).toBe(320);
  fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize preview column' }), {
    key: 'End',
  });
  expect(widthOf()).toBe(1600);
  // a width a file holds with a folder is dropped as it is read
  expect(folderOverrideSchema.parse({ mode: 'columns', previewWidth: 800 })).toEqual({
    mode: 'columns',
  });
});

it('says the width it shows, as wide as the room it fills', () => {
  // 720 shown in a 1000 px plane, its own width the 360 it starts with
  planeWidth = 1000;
  render(<ColumnsView {...props(0)} path="/fixtures" navigation={navigation} />);
  expect(
    screen.getByRole('separator', { name: 'Resize preview column' }).getAttribute('aria-valuenow'),
  ).toBe('720');
});

it('writes no width that did not change', () => {
  render(<ColumnsView {...props(0)} path="/fixtures" navigation={navigation} />);
  const divider = screen.getByRole('separator', { name: 'Resize preview column' });
  // the 360 it starts with, asked for again: nothing is saved
  fireEvent.doubleClick(divider);
  expect(widthOf()).toBeUndefined();
  fireEvent.keyDown(divider, { key: 'Home' });
  expect(widthOf()).toBe(320);
  const before = activeWorkspace();
  fireEvent.keyDown(divider, { key: 'Home' });
  expect(activeWorkspace()).toBe(before);
});

it('keeps each plane’s width, in any folder it shows, two planes on one folder each their own', () => {
  const other = addPane('/fixtures', 'folder', true, { remember: false }).id;
  const first = render(<ColumnsView {...props(0)} path="/fixtures" navigation={navigation} />);
  fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize preview column' }), {
    key: 'End',
  });
  first.unmount();
  render(<ColumnsView {...props(0, other)} path="/fixtures" navigation={navigation} />);
  fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize preview column' }), {
    key: 'Home',
  });
  expect([widthOf(), widthOf(other)]).toEqual([1600, 320]);
  cleanup();
  // the first plane, gone into another folder, keeps its width there
  act(() => updatePane(paneID, { path: '/fixtures/Photos' }));
  expect(widthOf()).toBe(1600);
  render(<ColumnsView {...props(0)} path="/fixtures" navigation={navigation} />);
  expect(
    screen.getByRole('region', { name: 'File preview' }).style.getPropertyValue('--preview-width'),
  ).toBe('1600px');
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

it('reveals the current column with as much of the preview as fits beside it', () => {
  columnLeft = 600;
  planeWidth = 500;
  const view = render(<ColumnsView {...props(0)} path="/fixtures" navigation={navigation} />);
  // 280 of column, then the 220 of preview the plane has room for
  expect(view.container.querySelector<HTMLElement>('.columns-view')!.scrollLeft).toBe(600);
});

it('keeps one width for the plane, whichever folder the file is in, written only when it changes', () => {
  planeWidth = 300;
  const deeper = { ...navigation, directory: () => '/fixtures/Photos' } as ColumnNavigation;
  render(<ColumnsView {...props(0)} path="/fixtures" navigation={deeper} />);
  const divider = () => screen.getByRole('separator', { name: 'Resize preview column' });
  const saved = () => widthOf();
  const drag = (from: number, to: number, end: 'pointerUp' | 'pointerCancel' = 'pointerUp') => {
    fireEvent.pointerDown(divider(), { button: 0, clientX: from, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(divider(), { clientX: to, clientY: 20, pointerId: 1 });
    fireEvent[end](divider(), { pointerId: 1 });
  };
  // dragged past either end, it stops at 1600 and 320; the subfolder gets no width of its own
  drag(600, 3000);
  expect(saved()).toBe(1600);
  expect(getState().settings.settings.folders).toEqual({});
  drag(600, -2000);
  expect(saved()).toBe(320);
  // a drag let go of elsewhere puts the width back
  drag(600, 900, 'pointerCancel');
  expect(saved()).toBe(320);
  expect(
    screen.getByRole('region', { name: 'File preview' }).style.getPropertyValue('--preview-width'),
  ).toBe('320px');
  // keys step by 10, or 50 with Shift, and Left narrows
  fireEvent.keyDown(divider(), { key: 'ArrowRight' });
  expect(saved()).toBe(330);
  fireEvent.keyDown(divider(), { key: 'ArrowRight', shiftKey: true });
  expect(saved()).toBe(380);
  fireEvent.keyDown(divider(), { key: 'ArrowLeft' });
  expect(saved()).toBe(370);
  // a double-click goes back to 360
  fireEvent.doubleClick(divider());
  expect(saved()).toBe(360);
});

it('writes nothing for a press on the divider of a preview wider than its width', () => {
  // 720 shown in a 1000 px plane, its width the default 360
  planeWidth = 1000;
  render(<ColumnsView {...props(0)} path="/fixtures" navigation={navigation} />);
  const divider = screen.getByRole('separator', { name: 'Resize preview column' });
  fireEvent.pointerDown(divider, { button: 0, clientX: 600, clientY: 20, pointerId: 1 });
  fireEvent.pointerUp(divider, { pointerId: 1 });
  expect(widthOf()).toBeUndefined();
});

it('keeps the file it showed while Quick Preview shows this plane’s selection', () => {
  const shown = (index: number) => (
    <ColumnsView {...props(index)} paneID="pane" path="/fixtures" navigation={navigation} />
  );
  const view = render(shown(0));
  const preview = () => view.container.querySelector('.held-preview')!.textContent;
  expect(preview()).toBe('/fixtures/a.png');
  act(() =>
    quickPreview(['/fixtures/a.png'], {
      paneID: 'pane',
      workspaceID: getState().saved.activeWorkspace,
    }),
  );
  view.rerender(shown(1));
  // the selection moved under Quick Preview: the column loads nothing behind it
  expect(preview()).toBe('/fixtures/a.png');
  act(() => quickPreview(null));
  view.rerender(shown(1));
  expect(preview()).toBe('/fixtures/2_A7_snec_alimentare_randare.png');
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
