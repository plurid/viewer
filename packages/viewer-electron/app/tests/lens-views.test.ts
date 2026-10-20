// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createElement, createRef } from 'react';
import type { FileEntry } from '../src/domain/contracts';
import {
  applyLensOps,
  emptyLens,
  resolveLens,
  type Lens,
  type LensDocument,
  type LensFolder,
  type LensOp,
  type LensRequest,
} from '../src/domain/lenses';
import {
  fixedSections,
  gridRows,
  gridStep,
  lensSections,
  sectionRows,
  type ViewSections,
} from '../src/renderer/explorer/sections';
import { childNames } from '../src/renderer/explorer/folder-sections';
import {
  editLens,
  lastLensRedo,
  lastLensUndo,
  redoLens,
  undoLens,
  useLenses,
} from '../src/renderer/state/lenses';
import { MapView, type MapControls } from '../src/renderer/explorer/map/MapView';

const folder = '/Clients';
const entry = (name: string, extra: Partial<FileEntry> = {}): FileEntry => ({
  path: `${folder}/${name}`,
  name,
  parent: folder,
  extension: '',
  kind: 'directory',
  directory: true,
  size: 0,
  modified: 1,
  created: 1,
  hidden: false,
  mime: '',
  identity: `1:${name}`,
  ...extra,
});
const id = '0b6c3f3e-2a5e-4a8e-9a43-0d1c2b3a4f5e';
const base: Lens = {
  ...emptyLens(id, 'By year'),
  groups: [
    { id: 'gaaaaa', name: '2025', order: 0 },
    { id: 'gbbbbb', name: 'Active', order: 0, parent: 'gaaaaa' },
    { id: 'gccccc', name: '2026', order: 1 },
  ],
  members: [
    { name: 'Acme', group: 'gaaaaa' },
    { name: 'Borel', group: 'gbbbbb' },
  ],
};

describe('section rows', () => {
  it('shows empty and collapsed headings in order, keeping expanded rows with their item', () => {
    const items = [entry('Acme'), entry('Acme/inner'), entry('Cobalt')];
    const rows = sectionRows(
      items,
      {
        list: [
          { key: 'a', label: 'A', depth: 0, count: 1 },
          { key: 'b', label: 'B', depth: 0, count: 0 },
          { key: 'c', label: 'C', depth: 0, count: 1 },
          { key: 'd', label: 'D', depth: 0, count: 3, collapsed: true },
        ],
        of: (item) => (item.name === 'Cobalt' ? 'c' : 'a'),
      },
      new Map([['/Clients/Acme/inner', 1]]),
    );
    expect(
      rows.map((row) => (row.kind === 'header' ? row.section.label : items[row.index]!.name)),
    ).toEqual(['A', 'Acme', 'Acme/inner', 'B', 'C', 'Cobalt', 'D']);
  });
  it('counts kind groups in the order the sorted items meet them', () => {
    const sections = fixedSections(
      [entry('A'), entry('b.pdf', { directory: false, extension: 'pdf' })],
      'kind',
    )!;
    expect(sections.list.map((item) => [item.label, item.count])).toEqual([
      ['Folders', 1],
      ['PDF files', 1],
    ]);
  });
  it('hides items and subgroups behind a collapsed group, and Unsorted when it is empty', () => {
    const items = [entry('Acme'), entry('Borel')];
    const resolved = resolveLens(base, items);
    const open = lensSections(base, resolved, items, new Set(), false);
    expect(open.sections.list.map((item) => item.label)).toEqual(['2025', 'Active', '2026']);
    const closed = lensSections(base, resolved, items, new Set(['gaaaaa']), false);
    expect(closed.entries).toEqual([]);
    expect(closed.sections.list.map((item) => [item.label, item.collapsed])).toEqual([
      ['2025', true],
      ['2026', false],
    ]);
    const filtered = lensSections(base, resolved, [items[0]!], new Set(), true);
    expect(filtered.sections.list.map((item) => item.label)).toEqual(['2025']);
  });
  it('keeps a collapsed group’s items, in lens order, for the views that have no heading to expand', () => {
    // The Map and the Gallery show `ordered`: a group collapsed in the list emptied it on the Map,
    // and the Gallery lost its items and its label.
    const items = [entry('Cobalt'), entry('Borel'), entry('Acme')];
    const resolved = resolveLens(base, items);
    const closed = lensSections(base, resolved, items, new Set(['gaaaaa']), false);
    expect(closed.entries.map((item) => item.name)).toEqual(['Cobalt']);
    expect(closed.ordered.map((item) => item.name)).toEqual(['Acme', 'Borel', 'Cobalt']);
    expect(lensSections(base, resolved, items, new Set(), false).entries).toEqual(closed.ordered);
  });
  it('moves through a grouped grid by row and column, and by pages of rows', () => {
    // Stepping by the column count crossed groups, which start rows of their own: below the first
    // item of a two-item group was the third item of the next group.
    const items = ['a1', 'a2', 'b1', 'b2', 'b3', 'b4', 'b5'].map((name) => entry(name));
    const sections: ViewSections = {
      list: [
        { key: 'a', label: 'A', depth: 0, count: 2 },
        { key: 'b', label: 'B', depth: 0, count: 5 },
      ],
      of: (item) => item.name[0],
    };
    const rows = gridRows(items, sections, 4);
    expect(
      rows.map((row) => (row.kind === 'header' ? row.section.label : [row.start, row.end])),
    ).toEqual(['A', [0, 2], 'B', [2, 6], [6, 7]]);
    expect(gridStep(rows, 0, 1)).toBe(2);
    expect(gridStep(rows, 1, 1)).toBe(3);
    expect(gridStep(rows, 5, 1)).toBe(6);
    expect(gridStep(rows, 6, -1)).toBe(2);
    expect(gridStep(rows, 2, -1)).toBe(0);
    // the top and the bottom rows stay where they are
    expect(gridStep(rows, 0, -1)).toBe(0);
    expect(gridStep(rows, 6, 1)).toBe(6);
    // a page is rows, not tiles
    expect(gridStep(rows, 0, 2)).toBe(6);
    expect(gridStep(rows, 3, -10)).toBe(1);
    expect(gridStep(rows, 9, 1)).toBeUndefined();
  });
  it('groups only items directly inside the folder', () => {
    expect(childNames(folder, ['/Clients/Acme', '/Clients/Acme/x', '/Other/Borel'])).toEqual([
      'Acme',
    ]);
  });
});

describe('lens editing', () => {
  let current: Lens;
  const requests: LensRequest[] = [];
  const document = (): LensDocument => ({
    file: `${folder}/.viewer/lenses/by-year.lens.jsonc`,
    revision: 'r',
    lens: current,
    local: false,
    writable: true,
    repairs: [],
  });
  beforeEach(() => {
    vi.useFakeTimers();
    current = base;
    requests.length = 0;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    Object.assign(window, {
      viewer: {
        onEvent: () => () => {},
        watch: vi.fn(async () => {}),
        unwatch: vi.fn(async () => {}),
        thumbnail: vi.fn(async () => ''),
        lens: vi.fn(async (request: LensRequest) => {
          requests.push(request);
          if (request.kind === 'list')
            return {
              folder,
              lenses: [document()],
              broken: [],
              shared: true,
              collapsed: {},
            } satisfies LensFolder;
          if (request.kind === 'apply') {
            current = applyLensOps(current, request.ops).lens;
            return { document: document(), dropped: [] };
          }
          return null;
        }),
      },
    });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('shows edits at once, saves them in one batch, and undoes and redoes them', async () => {
    let seen: Lens | undefined;
    render(
      createElement(() => {
        seen = useLenses(folder).data?.lenses[0]?.lens;
        return null;
      }),
    );
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(seen?.name).toBe('By year');
    act(() => {
      editLens(
        folder,
        document().file,
        [{ kind: 'place', name: 'Cobalt', group: 'gccccc' }],
        'Move to “2026”',
      );
      editLens(
        folder,
        document().file,
        [{ kind: 'place', name: 'Delta', group: 'gccccc' }],
        'Move to “2026”',
      );
    });
    expect(seen?.members).toContainEqual({ name: 'Delta', group: 'gccccc' });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    const applies = requests.filter((request) => request.kind === 'apply');
    expect(applies).toHaveLength(1);
    expect(current.members).toContainEqual({ name: 'Cobalt', group: 'gccccc' });
    expect(lastLensUndo()?.label).toBe('Move to “2026”');
    await act(async () => {
      await undoLens();
      await vi.runAllTimersAsync();
    });
    expect(current.members.map((member) => member.name)).not.toContain('Delta');
    expect(current.members.map((member) => member.name)).toContain('Cobalt');
    expect(lastLensRedo()).toBeDefined();
    await act(async () => {
      await redoLens();
      await vi.runAllTimersAsync();
    });
    expect(current.members).toContainEqual({ name: 'Delta', group: 'gccccc' });
  });
  it('keeps the Map’s DOM bounded and moves through it spatially', async () => {
    const items = Array.from({ length: 5000 }, (_, index) => entry(`client-${index}`));
    const controls = createRef<MapControls>() as { current: MapControls | null };
    const select = vi.fn();
    const view = render(
      createElement(MapView, {
        path: folder,
        listing: items,
        entries: items,
        selection: [],
        selectionSet: new Set<string>(),
        cursor: items[0]!.path,
        select,
        open: vi.fn(),
        context: vi.fn(),
        drag: vi.fn(),
        showHidden: false,
        controls,
        prompt: vi.fn(),
        regionContext: vi.fn(),
      }),
    );
    expect(view.container.querySelectorAll('[role=option]').length).toBeLessThan(200);
    expect(view.getByRole('listbox', { name: 'Map of Map' })).toBeTruthy();
    act(() => controls.current!.move('ArrowRight', false));
    expect(select.mock.calls[0]?.[0].name).toBe('client-1');
  });
  it('nudges selected items by remembered places relative to their group', async () => {
    current = {
      ...base,
      members: [{ name: 'Acme', group: 'gaaaaa', at: [200, 16] }, ...base.members.slice(1)],
    };
    render(
      createElement(() => {
        useLenses(folder);
        return null;
      }),
    );
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    const items = [entry('Acme'), entry('Borel')];
    const controls = { current: null as MapControls | null };
    render(
      createElement(MapView, {
        path: folder,
        document: document(),
        listing: items,
        entries: items,
        selection: [items[0]!.path],
        selectionSet: new Set([items[0]!.path]),
        select: vi.fn(),
        open: vi.fn(),
        context: vi.fn(),
        drag: vi.fn(),
        showHidden: false,
        controls,
        prompt: vi.fn(),
        regionContext: vi.fn(),
      }),
    );
    act(() => controls.current!.nudge('right', 8));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    const apply = requests.find((request) => request.kind === 'apply') as {
      ops: LensOp[];
    };
    expect(apply.ops).toEqual([{ kind: 'place', name: 'Acme', group: 'gaaaaa', at: [208, 16] }]);
  });
});
