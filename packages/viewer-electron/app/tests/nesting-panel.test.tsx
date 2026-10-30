// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FileEntry, ViewerAPI } from '../src/domain/contracts';
import { validateTransform } from '../src/domain/operations/transforms';
import { NestingPanel } from '../src/renderer/layout/nesting/NestingPanel';
import { flushState, initialize } from '../src/renderer/state/store';
import { nestingParts } from '../tools/playground/samples/nesting';

vi.mock('../src/renderer/workspace/context', () => ({
  useWorkspace: () => ({ openPath: vi.fn(async () => {}) }),
}));
/** The panel's workers, run in this thread: the same reader and search, a short budget. */
vi.mock('../src/renderer/layout/nesting/workers', async () => {
  const { readCutDrawing } = await import('../src/domain/layout/nesting/drawing');
  const { extractParts, suggestedMarks } = await import('../src/domain/layout/nesting/parts');
  const { nestSearch } = await import('../src/domain/layout/nesting/search');
  const { nestingParts } = await import('../tools/playground/samples/nesting');
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
      const name = message.url.replace('fixture:', '') as keyof typeof nestingParts;
      const drawing = readCutDrawing(nestingParts[name]());
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
