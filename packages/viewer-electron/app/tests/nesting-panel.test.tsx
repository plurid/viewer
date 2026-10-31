// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FileEntry, ViewerAPI } from '../src/domain/contracts';
import { validateTransform } from '../src/domain/operations/transforms';
import { NestingPanel } from '../src/renderer/layout/nesting/NestingPanel';
import { flushState, getState, initialize } from '../src/renderer/state/store';
import { nestingParts } from '../tools/playground/samples/nesting';
import { jobParts } from '../tools/playground/samples/fabrication';

const { openPath } = vi.hoisted(() => ({ openPath: vi.fn(async () => {}) }));
vi.mock('../src/renderer/workspace/context', () => ({ useWorkspace: () => ({ openPath }) }));
/** The panel's workers, run in this thread: the same reader and search, a short budget. */
vi.mock('../src/renderer/layout/nesting/workers', async () => {
  const { readCutDrawing } = await import('../src/domain/layout/nesting/drawing');
  const { extractParts, suggestedMarks } = await import('../src/domain/layout/nesting/parts');
  const { nestSearch } = await import('../src/domain/layout/nesting/search');
  const { nestingParts } = await import('../tools/playground/samples/nesting');
  const { autocadDXF, jobParts } = await import('../tools/playground/samples/fabrication');
  const sources: Record<string, () => string> = {
    ...nestingParts,
    ...Object.fromEntries(
      jobParts.map((part) => [part.file.replace('.dxf', ''), () => autocadDXF(part.entities)]),
    ),
  };
  type Handler = (data: never, post: (reply: unknown) => void) => Promise<void>;
  class Fake {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: unknown = null;
    private ended = false;
    constructor(private handle: Handler) {}
    postMessage(data: never) {
      setTimeout(
        () => void this.handle(data, (reply) => !this.ended && this.onmessage?.({ data: reply })),
      );
    }
    terminate() {
      this.ended = true;
    }
  }
  const drawings = new Map<string, ReturnType<typeof readCutDrawing>>();
  const parts: Handler = async (request: never, post) => {
    const message = request as {
      kind: string;
      id: number;
      key: string;
      url: string;
      options: { scale: number; marks: string[]; together: boolean; name: string };
    };
    if (message.kind === 'read') {
      const drawing = readCutDrawing(sources[message.url.replace('fixture:', '')]!());
      drawings.set(message.key, drawing);
      post({
        id: message.id,
        kind: 'read',
        drawing: {
          units: drawing.units,
          layers: drawing.layers,
          suggested: suggestedMarks(drawing.layers),
        },
      });
    } else if (message.kind === 'parts') {
      const { options } = message;
      const file = extractParts(
        drawings.get(message.key)!,
        { scale: options.scale, marks: new Set(options.marks), together: options.together },
        options.name,
      );
      post({
        id: message.id,
        kind: 'parts',
        parts: { ...file, parts: file.parts.map(({ entities: _entities, ...part }) => part) },
      });
    }
  };
  const nest: Handler = async (request: never, post) => {
    const message = request as { problem: never; looser?: never; seed: number };
    for (const update of nestSearch(message.problem, {
      budget: 150,
      now: () => performance.now(),
      seed: message.seed,
      looser: message.looser,
    })) {
      post({ kind: 'update', update });
      await new Promise((resolve) => setTimeout(resolve));
    }
  };
  return { nestingWorkers: { parts: () => new Fake(parts), nest: () => new Fake(nest) } };
});

afterEach(async () => {
  cleanup();
  await flushState(false);
  vi.restoreAllMocks();
  openPath.mockClear();
});
const names = ['Bracket with holes', 'Ring', 'Disc'] as const;
const files = names.map(
  (name, index) =>
    ({
      name: `${name}.dxf`,
      path: `/fixture/parts/${name}.dxf`,
      parent: '/fixture/parts',
      extension: 'dxf',
      mime: 'image/vnd.dxf',
      kind: 'file',
      directory: false,
      size: nestingParts[name]().length,
      identity: String(index + 1),
      modified: 10 + index,
      created: 1,
      hidden: false,
    }) as FileEntry,
);

it('estimates as quantities change and saves a valid nesting plan', async () => {
  const operate = vi.fn<ViewerAPI['operate']>(async () => 'nesting-job');
  Object.assign(window, {
    viewer: {
      operate,
      resource: vi.fn(async (file: string) => {
        const entry = files.find((item) => item.path === file)!;
        return {
          id: `resource-${entry.identity}`,
          url: `fixture:${entry.name.replace('.dxf', '')}`,
          entry,
        };
      }),
      release: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    },
  });
  initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
  render(<NestingPanel files={files} />);
  const bracket = (await screen.findByLabelText(
    'Quantity of Bracket with holes',
  )) as HTMLInputElement;
  await screen.findByLabelText('Quantity of Disc');
  expect(bracket.value).toBe('1');
  await waitFor(() =>
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      'About 1 sheet · 1250 × 2500 mm',
    ),
  );
  fireEvent.change(bracket, { target: { value: '60' } });
  // 48 bracket boxes fill a sheet; the estimate answers before any search.
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
    'About 2 sheets · 1250 × 2500 mm',
  );
  expect(screen.getByText('Boxes estimate. Nesting true shapes…')).toBeTruthy();
  // The true-shape search streams in, then settles with an exact check.
  await waitFor(() => expect(screen.getByText(/^Checked: parts at least/)).toBeTruthy(), {
    timeout: 5000,
  });
  expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(
    /^\d sheets? · 1250 × 2500 mm$/,
  );
  expect(
    screen.getAllByRole('img', { name: /^Sheet 1 · 1250 × 2500 · \d+% used · \d+ parts$/ }),
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Save nesting' }));
  await waitFor(() => expect(operate).toHaveBeenCalledOnce());
  const request = operate.mock.calls[0]![0];
  expect(request).toMatchObject({
    kind: 'convert',
    sources: files.map((file) => file.path),
    destination: '/fixture/parts',
    name: 'Nesting of 3 parts',
    expectedSources: files.map((file) => ({
      path: file.path,
      version: { identity: file.identity, modified: file.modified, size: file.size },
    })),
  });
  const plan = validateTransform(request.transform, 3);
  expect(plan.kind).toBe('nesting');
  if (plan.kind !== 'nesting') return;
  expect(plan.parts.map((part) => [part.name, part.quantity])).toEqual([
    ['Bracket with holes', 60],
    ['Ring', 1],
    ['Disc', 1],
  ]);
  expect(plan.sources.map((source) => source.marks)).toEqual([['ENGRAVE'], [], []]);
  expect(plan.sheets.flatMap((sheet) => sheet.placements)).toHaveLength(62);
});

it('nests one thickness at a time with the quantities given or named, and sums them', async () => {
  const job = jobParts.map(
    (part, index) =>
      ({
        name: part.file,
        path: `/fixture/job/${part.file}`,
        parent: '/fixture/job',
        extension: 'dxf',
        mime: 'image/vnd.dxf',
        kind: 'file',
        directory: false,
        size: 1000 + index,
        identity: String(20 + index),
        modified: 30 + index,
        created: 1,
        hidden: false,
      }) as FileEntry,
  );
  const bracket = job.find((file) => file.name === 'g6-MB20-A1-4buc.dxf')!;
  const operate = vi.fn<ViewerAPI['operate']>(async () => 'nesting-job');
  Object.assign(window, {
    viewer: {
      operate,
      resource: vi.fn(async (file: string) => {
        const entry = job.find((item) => item.path === file)!;
        return {
          id: `resource-${entry.identity}`,
          url: `fixture:${entry.name.replace('.dxf', '')}`,
          entry,
        };
      }),
      release: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    },
  });
  initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
  render(<NestingPanel files={job} quantities={{ [bracket.path]: 6 }} />);
  const thin = await screen.findByRole('button', { name: '3 mm, 2 files' });
  const thick = screen.getByRole('button', { name: '6 mm, 3 files' });
  expect(thin.getAttribute('aria-pressed')).toBe('true');
  const cover = (await screen.findByLabelText('Quantity of g3-CV25-E1-10buc')) as HTMLInputElement;
  expect(cover.value).toBe('10');
  expect(screen.getByText('From “10buc”')).toBeTruthy();
  expect(screen.queryByLabelText('Quantity of g6-PL60-B2-2buc')).toBeNull();
  expect(screen.getByRole('button', { name: 'Material and thickness' }).textContent).toContain(
    'Mild steel 3 mm · Fiber laser',
  );

  fireEvent.click(thick);
  const plate = (await screen.findByLabelText('Quantity of g6-PL60-B2-2buc')) as HTMLInputElement;
  expect(plate.value).toBe('2');
  expect((screen.getByLabelText('Quantity of g6-MB20-A1-4buc') as HTMLInputElement).value).toBe(
    '6',
  );
  expect(screen.getByText('As requested')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Material and thickness' }).textContent).toContain(
    'Mild steel 6 mm · Fiber laser',
  );
  const table = within(screen.getByRole('region', { name: 'By thickness' })).getByRole('table');
  await waitFor(() =>
    expect(
      [...table.querySelectorAll('tr')].map((row) => row.querySelector('th')!.textContent),
    ).toEqual(['Thickness', '3 mm', '6 mm', 'All']),
  );
  await waitFor(() =>
    expect(table.querySelector('tfoot td:nth-of-type(2)')!.textContent).toBe('26'),
  );

  await waitFor(() => expect(screen.getByText(/^Checked: /)).toBeTruthy(), { timeout: 5000 });
  fireEvent.click(screen.getByRole('button', { name: 'Save nesting' }));
  await waitFor(() => expect(operate).toHaveBeenCalledOnce());
  const request = operate.mock.calls[0]![0];
  expect(request.name).toBe('Nesting of 3 parts, 6 mm');
  expect(request.sources).toEqual(
    job.filter((file) => file.name.startsWith('g6-')).map((file) => file.path),
  );
  const plan = validateTransform(request.transform, 3);
  if (plan.kind !== 'nesting') throw new Error('Expected a nesting.');
  expect(plan.parts.map((part) => [part.name, part.quantity])).toEqual([
    ['g6-PL60-B2-2buc', 2],
    ['g6-MB20-A1-4buc', 6],
    ['g6-FL80-C1-2buc', 2],
  ]);
  expect(plan.cutting.thickness).toBe(6);
  // The 6 mm row now holds the checked layout, not an estimate.
  expect(table.querySelector('tbody tr[aria-current] td')!.textContent).toMatch(/^\d sheets?$/);
});

/** The panel on the bracket, ring and disc, with the desktop's answers it needs. */
function mount() {
  // the desktop's answer to a changed preference: the window's own, at the next revision
  const settingsPatch = vi.fn(async () => ({
    ...structuredClone(getState().settings),
    revision: getState().settings.revision + 1,
    ui: structuredClone(getState().saved.ui),
  }));
  Object.assign(window, {
    viewer: {
      operate: vi.fn(async () => 'nesting-job'),
      resource: vi.fn(async (file: string) => {
        const entry = files.find((item) => item.path === file)!;
        return {
          id: `resource-${entry.identity}`,
          url: `fixture:${entry.name.replace('.dxf', '')}`,
          entry,
        };
      }),
      release: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
      settingsPatch,
    },
  });
  initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
  render(<NestingPanel files={files} />);
}
const checked = () =>
  waitFor(() => expect(screen.getByText(/^Checked: /)).toBeTruthy(), { timeout: 5000 });

it('draws no sheet and says why when the last sheet format is removed', async () => {
  mount();
  await screen.findByLabelText('Quantity of Disc');
  await checked();
  expect(screen.getAllByRole('img', { name: /^Sheet 1 · 1250 × 2500 · / })).toHaveLength(1);
  // A layout of the format just removed must not be drawn: its sheets name a format that is gone.
  fireEvent.click(screen.getByRole('button', { name: 'Remove 1250 × 2500 mm' }));
  expect(screen.getByText('Choose a sheet format to nest on.')).toBeTruthy();
  expect(screen.queryAllByRole('img', { name: /^Sheet / })).toHaveLength(0);
  expect(screen.queryByRole('table', { name: 'Sheet formats' })).toBeNull();
  expect((screen.getByRole('button', { name: 'Save nesting' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(screen.queryByRole('button', { name: 'Search longer' })).toBeNull();
  // Adding a format back nests again.
  fireEvent.click(screen.getByRole('button', { name: 'Add format' }));
  fireEvent.click(await screen.findByText('1500 × 3000 mm'));
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
    'About 1 sheet · 1500 × 3000 mm',
  );
  await checked();
  expect(screen.getAllByRole('img', { name: /^Sheet 1 · 1500 × 3000 · / })).toHaveLength(1);
});

it('lists only the chosen formats and adds a custom size', async () => {
  mount();
  await screen.findByLabelText('Quantity of Disc');
  const table = screen.getByRole('table', { name: 'Sheet formats' });
  expect(
    within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent),
  ).toEqual(['1250 × 2500']);
  fireEvent.click(screen.getByRole('button', { name: 'Add format' }));
  fireEvent.click(await screen.findByText('Custom size…'));
  fireEvent.change(screen.getByLabelText('Custom sheet width in mm'), {
    target: { value: '3000' },
  });
  fireEvent.change(screen.getByLabelText('Custom sheet length in mm'), {
    target: { value: '1500' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  // 3000 × 1500 is the 1500 × 3000 preset, chosen rather than added twice
  expect(
    within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent),
  ).toEqual(['1250 × 2500', '1500 × 3000']);
  fireEvent.change(screen.getByLabelText('Price of a 1500 × 3000 mm sheet'), {
    target: { value: '160' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Remove 1500 × 3000 mm' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add format' }));
  fireEvent.click(await screen.findByText('1500 × 3000 mm'));
  // a preset removed and added again keeps its price
  expect((screen.getByLabelText('Price of a 1500 × 3000 mm sheet') as HTMLInputElement).value).toBe(
    '160',
  );
});

it('picks a part on a sheet, lights its copies and tells what it is', async () => {
  mount();
  const bracket = (await screen.findByLabelText(
    'Quantity of Bracket with holes',
  )) as HTMLInputElement;
  fireEvent.change(bracket, { target: { value: '3' } });
  await checked();
  const sheet = screen.getByRole('img', { name: /^Sheet 1 · / });
  const copies = () => [...sheet.querySelectorAll('use[data-part="0"]')];
  expect(copies()).toHaveLength(3);
  fireEvent.click(copies()[1]!);
  const card = screen.getByRole('region', { name: 'Selected part' });
  expect(card.textContent).toContain('1 · Bracket with holes');
  expect(card.textContent).toContain('Bracket with holes.dxf');
  expect(card.textContent).toContain('300 × 200 mm · 4 holes · 3 of 3 pieces placed');
  expect(card.textContent).toContain('On sheet 1');
  expect(copies().every((copy) => copy.classList.contains('nesting-picked'))).toBe(true);
  expect(sheet.querySelectorAll('use.nesting-picked')).toHaveLength(3);
  // a click on empty sheet lets it go
  fireEvent.click(sheet.querySelector('.nesting-stock')!);
  expect(screen.queryByRole('region', { name: 'Selected part' })).toBeNull();
  // from the keyboard: arrows step through the sheet's parts, Enter opens, Escape lets go
  const parts = screen.getByRole('group', { name: /^Parts on Sheet 1 · / });
  fireEvent.keyDown(parts, { key: 'ArrowRight' });
  expect(screen.getByRole('region', { name: 'Selected part' }).textContent).toContain(
    'Bracket with holes',
  );
  fireEvent.keyDown(parts, { key: 'ArrowRight' });
  expect(screen.getByRole('region', { name: 'Selected part' }).textContent).toContain('2 · Ring');
  fireEvent.keyDown(parts, { key: 'Enter' });
  expect(openPath).toHaveBeenCalledWith('/fixture/parts/Ring.dxf', { activate: true });
  fireEvent.keyDown(parts, { key: 'Escape' });
  expect(screen.queryByRole('region', { name: 'Selected part' })).toBeNull();
  // a double click opens the drawing too, and nothing moves
  const before = [...sheet.querySelectorAll('use')].map((use) => use.getAttribute('transform'));
  fireEvent.doubleClick(sheet.querySelector('use[data-part="2"]')!);
  expect(openPath).toHaveBeenLastCalledWith('/fixture/parts/Disc.dxf', { activate: true });
  expect([...sheet.querySelectorAll('use')].map((use) => use.getAttribute('transform'))).toEqual(
    before,
  );
});

it('reads lengths in inches, with sheets in feet, and saves the plan in them', async () => {
  mount();
  await screen.findByLabelText('Quantity of Disc');
  await checked();
  fireEvent.click(within(screen.getByRole('group', { name: 'Units' })).getByText('in'));
  // the untouched 1250 × 2500 mm start becomes the usual 4' × 8' sheet
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('About 1 sheet · 48 × 96 in');
  expect(screen.queryByText(/^300 × 200 mm/)).toBeNull();
  expect(screen.getByText(/^11\.81 × 7\.87 in · 90\.5 in² · 4 holes$/)).toBeTruthy();
  expect((screen.getByLabelText('Spacing between parts') as HTMLInputElement).value).toBe('0.197');
  expect(screen.getByLabelText('Speed').parentElement!.textContent).toContain('in/min');
  fireEvent.change(screen.getByLabelText('Spacing between parts'), { target: { value: '0.25' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add format' }));
  expect(await screen.findByText('60 × 120 in')).toBeTruthy();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  await checked();
  expect(screen.getByText(/^Offcut 48 × \d+(\.\d+)? in, reusable$/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save nesting' }));
  const operate = window.viewer.operate as ReturnType<typeof vi.fn>;
  await waitFor(() => expect(operate).toHaveBeenCalledOnce());
  const plan = validateTransform(operate.mock.calls[0]![0].transform, 3);
  if (plan.kind !== 'nesting') throw new Error('Expected a nesting.');
  expect(plan.units).toBe('in');
  expect(plan.spacing).toBeCloseTo(6.35, 6);
  expect(plan.formats).toEqual([{ width: 1219.2, height: 2438.4, price: 0 }]);
});
