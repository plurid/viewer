// @vitest-environment jsdom
/**
 * NESTING WITHOUT A PLANE: a thickness nested for a handoff as the Layout plane starts it, giving
 * the plan the plane's own Save nesting would write; a part that does not fit, a drawing that
 * cannot be read and a cancel each stop it, naming the drawing or part.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FileEntry } from '../src/domain/contracts';
import { NestingPanel } from '../src/renderer/layout/nesting/NestingPanel';
import { nestWithoutPlane } from '../src/renderer/layout/nesting/headless';
import { forgetNestings, preparedNestings } from '../src/renderer/layout/nesting/prepared';
import { flushState, initialize } from '../src/renderer/state/store';
import { jobParts } from '../tools/playground/samples/fabrication';

vi.mock('../src/renderer/workspace/context', () => ({
  useWorkspace: () => ({ openPath: vi.fn(async () => {}) }),
}));
/** The plane's workers, run in this thread: the same reader and search, a short budget. */
vi.mock('../src/renderer/layout/nesting/workers', async () => {
  const { readCutDrawing } = await import('../src/domain/layout/nesting/drawing');
  const { extractParts, suggestedMarks } = await import('../src/domain/layout/nesting/parts');
  const { nestSearch } = await import('../src/domain/layout/nesting/search');
  const samples = await import('../tools/playground/samples/fabrication');
  const sources: Record<string, () => string> = {
    ...Object.fromEntries(
      samples.jobParts.map((part) => [
        part.file.replace('.dxf', ''),
        () => samples.autocadDXF(part.entities),
      ]),
    ),
    // a plate longer than the 2500 mm sheet, at every turn
    'g6-BIG-1buc': () =>
      samples.autocadDXF([
        { kind: 'line', a: [0, 0], b: [3000, 0] },
        { kind: 'line', a: [3000, 0], b: [3000, 100] },
        { kind: 'line', a: [3000, 100], b: [0, 100] },
        { kind: 'line', a: [0, 100], b: [0, 0] },
      ]),
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

const entry = (name: string, index: number): FileEntry => ({
  name,
  path: `/fixture/job/${name}`,
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
});
const job = jobParts.map((part, index) => entry(part.file, index));
const big = entry('g6-BIG-1buc.dxf', 9);
const bracket = job.find((file) => file.name === 'g6-MB20-A1-4buc.dxf')!;
let resource: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resource = vi.fn(async (file: string) => {
    const found = [...job, big].find((item) => item.path === file);
    if (!found) throw new Error('The file is no longer there.');
    return {
      id: `resource-${found.identity}`,
      url: `fixture:${found.name.replace('.dxf', '')}`,
      entry: found,
    };
  });
  Object.assign(window, {
    viewer: {
      operate: vi.fn(),
      resource,
      release: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    },
  });
  initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
afterEach(async () => {
  cleanup();
  forgetNestings();
  await flushState(false);
  vi.restoreAllMocks();
});

it('nests a thickness as the Layout plane starts it, with the plan its Save nesting writes', async () => {
  // the plane, opened as Prepare cut sheets opens it, checks its 6 mm tab
  render(<NestingPanel files={job} quantities={{ [bracket.path]: 6 }} />);
  fireEvent.click(await screen.findByRole('button', { name: '6 mm, 3 files' }));
  await waitFor(() => expect(screen.getByText(/^Checked: /)).toBeTruthy(), { timeout: 5000 });
  const [plane] = preparedNestings();
  expect(plane!.title).toBe('Nesting of 3 parts, 6 mm');
  cleanup();
  forgetNestings();

  const steps: string[] = [];
  const [made, ...rest] = await nestWithoutPlane(
    job.map((file) => file.path),
    { quantities: { [bracket.path]: 6 } },
    new Set(['6']),
    new AbortController().signal,
    (text) => steps.push(text),
  );
  expect(rest).toEqual([]);
  expect(steps).toEqual(['Reading 3 drawings…', 'Nesting 6 mm: 3 parts, 10 pieces…']);
  expect(made).toMatchObject({ label: '6 mm', parts: 3, pieces: 10 });
  const { sheets: _sheets, ...plan } = made!.nesting.plan;
  const { sheets: _planeSheets, ...planePlan } = plane!.plan;
  expect(made!.nesting.title).toBe(plane!.title);
  expect(made!.nesting.sources).toEqual(plane!.sources);
  expect(plan).toEqual(planePlan);
  expect(plan.cutting.thickness).toBe(6);
  expect(made!.nesting.plan.sheets.flatMap((sheet) => sheet.placements)).toHaveLength(10);
  // kept as the plane keeps a checked nesting, for the handoff to save
  expect(preparedNestings()).toEqual([made!.nesting]);
});

it('names the part that does not fit, and the drawing that cannot be read', async () => {
  const paths = [...job.filter((file) => file.name.startsWith('g6-')), big].map(
    (file) => file.path,
  );
  await expect(
    nestWithoutPlane(paths, {}, new Set(['6']), new AbortController().signal, () => {}),
  ).rejects.toThrow(
    'Nesting 6 mm: g6-BIG-1buc (3,000 × 100 mm) does not fit a 1250 × 2500 mm sheet inside its 10 mm margin. Choose a larger sheet or more turns in the Layout plane.',
  );
  expect(preparedNestings()).toEqual([]);

  await expect(
    nestWithoutPlane(
      [...paths.slice(0, 2), '/fixture/job/g6-GONE-2buc.dxf'],
      {},
      new Set(['6']),
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow('g6-GONE-2buc.dxf could not be read for nesting: The file is no longer there.');
});

it('stops when cancelled, keeping the thicknesses already checked', async () => {
  const abort = new AbortController();
  const nesting = nestWithoutPlane(
    job.map((file) => file.path),
    {},
    new Set(['3', '6']),
    abort.signal,
    (text) => {
      if (text.startsWith('Nesting 6 mm')) abort.abort();
    },
  );
  await expect(nesting).rejects.toThrow(/abort/i);
  expect(preparedNestings().map((item) => item.title)).toEqual(['Nesting of 2 parts, 3 mm']);
});
