// @vitest-environment jsdom
/**
 * The Layout plane: it reads the selection, opens in the mode the files suggest with the best
 * layout, offers other modes and candidates, and saves exactly the plan its preview draws.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import type { FileEntry, LayoutPane, ViewerAPI } from '../src/domain/contracts';
import type { InspectionResult } from '../src/domain/files/inspection';
import { layoutTransformSchema, millimetres as mm } from '../src/domain/layout/plan';
import type { LayoutTransform } from '../src/domain/layout/plan';
import { paneTitle } from '../src/domain/workspaces/planes';
import { stateSchema } from '../src/desktop/persistence/storage';
import { activeWorkspace, flushState, getState, initialize } from '../src/renderer/state/store';
import { addContentPane } from '../src/renderer/state/panes';
import { WorkspaceContext } from '../src/renderer/workspace/context';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { pngSize, readSelection } from '../src/renderer/layout/measure';
import LayoutPlane from '../src/renderer/layout/LayoutPlane';
import { LayoutSheet } from '../src/renderer/layout/LayoutSheet';
import { LayoutPictures } from '../src/renderer/layout/pictures';
import type { LayoutPage } from '../src/domain/layout/plan';
import { fitHelvetica } from '../src/domain/layout/helvetica';

// the nesting helper's panel is tested on its own; here it only has to be the one mounted
vi.mock('../src/renderer/layout/nesting/NestingPanel', () => ({
  NestingPanel: ({ files }: { files: FileEntry[] }) =>
    createElement('p', { 'data-nesting': files.map((file) => file.name).join(',') }),
}));
vi.mock('../src/renderer/layout/pdf', () => ({
  openLayoutDocument: vi.fn(async (path: string) => ({
    // an A5 zine of six pages
    pages: Array.from({ length: path.includes('Zine') ? 6 : 1 }, () => ({
      width: (148 * 72) / 25.4,
      height: (210 * 72) / 25.4,
    })),
    picture: async () => 'data:image/jpeg;base64,AAAA',
    close: vi.fn(),
  })),
}));

/** A PNG's first bytes, enough for its header to give its size. */
const png = (width: number, height: number) => {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return 'data:image/png;base64,' + btoa(String.fromCharCode(...bytes));
};
const entry = (path: string): FileEntry => {
  const name = path.split('/').at(-1)!;
  return {
    path,
    parent: path.slice(0, -name.length - 1),
    name,
    extension: name.split('.').at(-1)!.toLowerCase(),
    kind: 'file',
    directory: false,
    size: 1000,
    modified: Date.UTC(2026, 9, 21, 12),
    created: Date.UTC(2026, 9, 21, 12),
    hidden: false,
    mime: '',
    identity: 'id:' + name,
  };
};
/** Stored pixels, and the thumbnail as the photo is seen: Tall.jpg is stored on its side. */
const photos: Record<string, { stored: [number, number]; seen: [number, number] }> = {
  '/Photos/Beach.jpg': { stored: [4032, 3024], seen: [128, 96] },
  '/Photos/Dunes.jpg': { stored: [4032, 3024], seen: [128, 96] },
  '/Photos/Tall.jpg': { stored: [4032, 3024], seen: [96, 128] },
};
const inspection = (path: string): InspectionResult => {
  const [width, height] = photos[path]!.stored;
  return {
    path,
    version: { identity: 'id:' + path, modified: 1, size: 1000 },
    availability: 'available',
    facts: {
      width: { value: width, unit: 'px', source: 'image header' },
      height: { value: height, unit: 'px', source: 'image header' },
    },
    evidence: [],
    coverage: { content: 'partial' },
  };
};

let operate: ReturnType<typeof vi.fn<ViewerAPI['operate']>>;
const openPath = vi.fn(async () => {});
beforeEach(() => {
  operate = vi.fn<ViewerAPI['operate']>(async () => 'layout-job');
  Object.assign(window, {
    viewer: {
      save: vi.fn(async () => {}),
      stat: vi.fn(async (path: string) => entry(path)),
      inspect: vi.fn(async (path: string) => inspection(path)),
      thumbnail: vi.fn(async (path: string) => {
        const seen = photos[path]?.seen ?? [128, 96];
        return png(...seen);
      }),
      operate,
      cancelJob: vi.fn(async () => {}),
    },
  });
  initialize({ home: '/Users/a', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
afterEach(async () => {
  cleanup();
  await flushState(false);
});

const open = (sources: string[], mode?: LayoutPane['mode']) => {
  const pane: LayoutPane = {
    id: crypto.randomUUID(),
    type: 'layout',
    path: sources[0]!.slice(0, sources[0]!.lastIndexOf('/')),
    sources,
    ...(mode ? { mode } : {}),
  };
  addContentPane(pane);
  render(
    createElement(
      WorkspaceContext.Provider,
      { value: { openPath } as unknown as WorkspaceController },
      createElement(LayoutPlane, { pane }),
    ),
  );
  return pane;
};
const modeButton = (name: string) =>
  within(screen.getByRole('group', { name: 'Layout mode' })).getByRole('button', { name });
const ready = () =>
  waitFor(() => expect(screen.getByRole('group', { name: 'Layout mode' })).toBeTruthy());
/** The pictures the preview draws, as frames. */
const drawn = () =>
  [...screen.getByRole('img', { name: /^Page 1 of/ }).querySelectorAll('svg[data-source]')].map(
    (element) => ['x', 'y', 'width', 'height'].map((name) => Number(element.getAttribute(name))),
  );

describe('reading the selection', () => {
  it('reads a photo header and turns it as its thumbnail shows it', async () => {
    const read = await readSelection(Object.keys(photos), new AbortController().signal, () => {});
    expect(
      read.sources.map((source) => source.kind === 'image' && [source.width, source.height]),
    ).toEqual([
      [4032, 3024],
      [4032, 3024],
      [3024, 4032],
    ]);
    expect(pngSize(png(96, 128))).toEqual({ width: 96, height: 128 });
    expect(pngSize('data:image/jpeg;base64,AAAA')).toBeUndefined();
  });

  it('keeps what it cannot read out, and says so', async () => {
    const read = await readSelection(
      ['/Photos/Beach.jpg', '/Photos/notes.txt'],
      new AbortController().signal,
      () => {},
    );
    expect(read.sources).toHaveLength(1);
    expect(read.skipped).toEqual([{ name: 'notes.txt', reason: 'Not a photo, PDF or DXF file.' }]);
  });
});

describe('the Layout plane', () => {
  it('opens three photos as a collage with the best layout, and saves the plan it draws', async () => {
    const pane = open(Object.keys(photos));
    await ready();
    expect(modeButton('Collage').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toMatch(/^3 photos · \d+ × \d+ px$/);
    const name = screen.getByRole('textbox', { name: 'Output name' }) as HTMLInputElement;
    expect(name.value).toBe('Collage of 3 photos');
    const frames = drawn();
    expect(frames).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Save JPEG' }));
    await waitFor(() => expect(operate).toHaveBeenCalledTimes(1));
    const [request] = operate.mock.calls[0]!;
    expect(request).toMatchObject({
      kind: 'convert',
      destination: '/Photos',
      name: 'Collage of 3 photos.jpg',
      sources: Object.keys(photos),
    });
    expect(request.expectedSources).toEqual(
      Object.keys(photos).map((path) => ({
        path,
        version: {
          identity: 'id:' + path.split('/').at(-1),
          modified: Date.UTC(2026, 9, 21, 12),
          size: 1000,
        },
      })),
    );
    const plan = request.transform as LayoutTransform;
    expect(layoutTransformSchema.parse(plan)).toEqual(plan);
    expect(plan.format).toBe('jpeg');
    // the preview drew these frames, item for item
    expect(
      plan.pages[0]!.items.flatMap((item) =>
        item.kind === 'image'
          ? [[item.frame.x, item.frame.y, item.frame.width, item.frame.height]]
          : [],
      ),
    ).toEqual(frames);
    expect(paneTitle(pane)).toBe('Layout · 3 files');
  });

  it('keeps Save out of the scrolling choices, so it stays in view', async () => {
    open(Object.keys(photos));
    await ready();
    const save = screen.getByRole('button', { name: 'Save JPEG' });
    const choices = screen.getByRole('textbox', { name: 'Output name' }).closest('div')!;
    expect(choices.closest('.layout-options-choices')).toBeTruthy();
    expect(save.closest('.layout-options-choices')).toBeNull();
    expect(save.closest('.layout-save')).toBeTruthy();
  });

  it('switches modes, remembers the mode and names the output for it', async () => {
    const pane = open(Object.keys(photos));
    await ready();
    fireEvent.click(modeButton('Contact sheet'));
    expect(modeButton('Contact sheet').getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('textbox', { name: 'Output name' }) as HTMLInputElement).value).toBe(
      'Contact sheet of 3 photos',
    );
    expect(screen.getByRole('status').textContent).toMatch(/columns · 1 page · A4 portrait$/);
    const saved = activeWorkspace().panes.find((item) => item.id === pane.id);
    expect(saved).toMatchObject({ type: 'layout', mode: 'contact-sheet' });
    // the plane survives saving and restoring, mode and all
    const restored = stateSchema.parse(getState().saved);
    expect(
      restored.workspaces.flatMap((space) => space.panes).find((item) => item.id === pane.id),
    ).toEqual(saved);
    fireEvent.click(screen.getByRole('button', { name: 'Save PDF' }));
    await waitFor(() => expect(operate).toHaveBeenCalled());
    const [request] = operate.mock.calls[0]!;
    expect(request.name).toBe('Contact sheet of 3 photos.pdf');
    const texts = (request.transform as LayoutTransform).pages[0]!.items.flatMap((item) =>
      item.kind === 'text' ? [item.text] : [],
    );
    expect(texts).toContain('Beach.jpg');
    expect(texts).toContain('Page 1 of 1');
  });

  it('applies a candidate and shows it chosen', async () => {
    open(Object.keys(photos));
    await ready();
    const strip = await screen.findByRole('group', { name: 'Suggested layouts' });
    const candidates = within(strip).getAllByRole('button');
    expect(candidates.length).toBeGreaterThanOrEqual(3);
    expect(candidates[0]!.getAttribute('aria-pressed')).toBe('true');
    const other = candidates.find((button) =>
      /^(Grid|Featured|Thirds)/.test(button.textContent ?? ''),
    )!;
    fireEvent.click(other);
    await waitFor(() => expect(other.getAttribute('aria-pressed')).toBe('true'));
    expect(candidates[0]!.getAttribute('aria-pressed')).toBe('false');
    const style = screen.getByRole('button', { name: 'Collage style' });
    expect(other.textContent).toContain(style.textContent!);
  });

  it('offers image formats only for one page without PDF pages', async () => {
    open(['/Documents/Zine.pdf']);
    await ready();
    expect(modeButton('N-up').getAttribute('aria-pressed')).toBe('true');
    const format = screen.getByRole('group', { name: 'Format' });
    expect(
      (within(format).getByRole('button', { name: 'JPEG' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(modeButton('Booklet'));
    expect(screen.getByText(/^Print on both sides, flipping on the short edge/)).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Output name' }) as HTMLInputElement).value).toBe(
      'Booklet of Zine',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save PDF' }));
    await waitFor(() => expect(operate).toHaveBeenCalled());
    const plan = operate.mock.calls[0]![0].transform as LayoutTransform;
    expect(plan.pages).toHaveLength(4);
    expect(plan.pages[0]!.items.every((item) => item.kind === 'page')).toBe(true);
  });

  it('changes the page and shows the change at once', async () => {
    open(Object.keys(photos));
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Page size' }));
    const search = await waitFor(() => screen.getByLabelText('Search Page size'));
    fireEvent.change(search, { target: { value: 'A4' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/A4 (portrait|landscape)$/),
    );
    expect(screen.getAllByText(/^Fills/).length).toBeGreaterThan(0);
  });

  it('keeps the person’s own name for the output', async () => {
    open(Object.keys(photos));
    await ready();
    const name = screen.getByRole('textbox', { name: 'Output name' });
    fireEvent.change(name, { target: { value: 'Holiday' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save JPEG' }));
    await waitFor(() => expect(operate).toHaveBeenCalled());
    expect(operate.mock.calls[0]![0].name).toBe('Holiday.jpg');
  });

  it('says why a save failed', async () => {
    operate.mockRejectedValueOnce(new Error('Layouts are not available yet.'));
    open(Object.keys(photos));
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Save JPEG' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Layouts are not available yet.');
  });

  it('opens DXF parts in the nesting panel', async () => {
    open(['/Parts/Bracket.dxf', '/Parts/Plate.dxf'], 'nesting');
    await ready();
    expect(modeButton('Nesting').getAttribute('aria-pressed')).toBe('true');
    expect(
      document.querySelector('.layout-nesting [data-nesting]')?.getAttribute('data-nesting'),
    ).toBe('Bracket.dxf,Plate.dxf');
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
  });

  it('shows its progress while reading many files', async () => {
    const many = Array.from({ length: 24 }, (_, index) => `/Photos/IMG_${index}.jpg`);
    for (const path of many) photos[path] = { stored: [4032, 3024], seen: [128, 96] };
    open(many);
    expect(screen.getByRole('status').textContent).toMatch(/^Reading \d+ of 24 files…$/);
    await ready();
    expect(modeButton('Contact sheet').getAttribute('aria-pressed')).toBe('true');
    await act(async () => {});
    expect(screen.getByRole('img', { name: /^Page 1 of 1/ })).toBeTruthy();
    for (const path of many) delete photos[path];
  });
});

describe('the preview, drawn as the writer draws', () => {
  const sheet = (page: LayoutPage, format: LayoutTransform['format']) => {
    render(
      createElement(LayoutSheet, {
        page,
        format,
        sources: [],
        pictures: new LayoutPictures(new Map(), new Map()),
        size: 'small',
        label: 'Sheet',
      }),
    );
    return screen.getByRole('img', { name: 'Sheet' });
  };
  const line = (text: string, maxWidth?: number) => ({
    kind: 'text' as const,
    text,
    x: 10,
    y: 50,
    size: 10,
    color: '#000000',
    align: 'start' as const,
    weight: 'regular' as const,
    ...(maxWidth ? { maxWidth } : {}),
  });

  it('shortens text, leaves unpainted shapes out and draws a 0 line width as a hairline', () => {
    const svg = sheet(
      {
        width: 200,
        height: 100,
        background: '#ffffff',
        items: [
          { kind: 'rect', frame: { x: 0, y: 0, width: 10, height: 10 }, lineWidth: 0.5 },
          {
            kind: 'rect',
            frame: { x: 20, y: 0, width: 10, height: 10 },
            stroke: '#000000',
            lineWidth: 0,
          },
          { kind: 'path', points: [0, 0, 10, 10], closed: false, lineWidth: 0.25 },
          line('A very long photo name from the holiday.jpg', 60),
          line('anything', 3),
        ],
      },
      'pdf',
    );
    // the page's background, then the one painted rectangle
    const rects = svg.querySelectorAll(':scope > rect');
    expect(rects).toHaveLength(2);
    expect(rects[1]!.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    expect(svg.querySelectorAll('polyline')).toHaveLength(0);
    const texts = [...svg.querySelectorAll('text')];
    expect(texts.map((text) => text.textContent)).toEqual([
      fitHelvetica('A very long photo name from the holiday.jpg', 10, 'regular', 60),
    ]);
    expect(texts[0]!.getAttribute('font-family')).toMatch(/^Helvetica/);
  });

  it('draws a line WinAnsi cannot hold in the system sans-serif', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const svg = sheet({ width: 200, height: 100, items: [line('東京の写真.jpg')] }, 'pdf');
    expect(svg.querySelector('text')!.getAttribute('font-family')).toBe('sans-serif');
    vi.restoreAllMocks();
  });

  it('leaves a PNG without a background transparent, and puts paper under a PDF', () => {
    const empty = { width: 100, height: 100, items: [] };
    const png = sheet(empty, 'png');
    expect(png.classList.contains('is-transparent')).toBe(true);
    // checks on the page itself, not on the element around it
    const checks = png.querySelector(':scope > rect')!;
    expect([checks.getAttribute('width'), checks.getAttribute('height')]).toEqual(['100', '100']);
    const pattern = png.querySelector('pattern')!;
    expect(checks.getAttribute('fill')).toBe(`url("#${pattern.id}")`);
    cleanup();
    const pdf = sheet(empty, 'pdf');
    expect(pdf.querySelector('rect')!.getAttribute('fill')).toBe('#ffffff');
  });
});

it('keeps A5 page sizes for the zine', () => {
  expect(mm(148)).toBeCloseTo((148 * 72) / 25.4, 6);
});
