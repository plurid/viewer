// @vitest-environment jsdom
/**
 * A PDF WITH DARK PAGES. pdf.js draws the printed page off screen, where it is turned dark and its
 * photographs put back as they were, and only then shown, so nothing white flashes; light pages
 * are drawn as before, straight onto the page's canvas. The page's outlines and selection draw in
 * an accent that shows on it. Printing, PDF tools and Optimize use the file, not the view.
 */
import type { PropsWithChildren } from 'react';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PDFPreview from '../src/renderer/previews/modules/PDFPreview';
import type { PreviewCommand, PreviewContext } from '../src/renderer/previews/contracts';
import type { EvidenceAnchor } from '../src/domain/files/inspection';
import {
  contrast,
  darkPageMatrix,
  type PageColors,
} from '../src/domain/previews/documents/dark-pages';
import { mockElementBox } from './support/layout';

const pdf = vi.hoisted(() => ({
  getDocument: vi.fn(),
  commands: [] as readonly PreviewCommand[],
}));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  PixelsPerInch: { PDF_TO_CSS_UNITS: 96 / 72 },
  PasswordResponses: {},
  getDocument: pdf.getDocument,
  TextLayer: class {
    async render() {}
    cancel() {}
  },
}));
vi.mock('../src/renderer/previews/controls', () => ({
  PreviewToolbar: ({ children }: PropsWithChildren) => <div>{children}</div>,
  usePreviewCommands: (_context: unknown, commands: readonly PreviewCommand[]) => {
    pdf.commands = commands;
  },
}));
vi.mock('../src/renderer/ui/primitives', () => ({
  IconButton: ({ label, ...props }: { label: string } & Record<string, unknown>) => (
    <button aria-label={label} {...props} />
  ),
  Empty: ({ title, detail }: { title?: string; detail?: string }) => (
    <div>
      {title} {detail}
    </div>
  ),
  Loading: () => <div>Opening PDF</div>,
}));
vi.mock('../src/renderer/ui/ChoiceMenu', () => ({ ChoiceButton: () => null }));
vi.mock('../src/renderer/state/store', () => ({
  getState: () => ({ bootstrap: { platform: 'darwin' } }),
  report: vi.fn(),
}));

const colors: PageColors = { page: '#31353d', ink: '#f2f4f6', accent: '#82b3cf' };

/** What a canvas was asked to draw. jsdom has no canvas: each records its calls. */
interface Drawing {
  calls: unknown[][];
  filters: string[];
}
const drawings = new Map<HTMLCanvasElement, Drawing>();
let picturePixels: (count: number) => Uint8ClampedArray;
function drawingOf(canvas: HTMLCanvasElement): Drawing {
  let drawing = drawings.get(canvas);
  if (!drawing) drawings.set(canvas, (drawing = { calls: [], filters: [] }));
  return drawing;
}
function fakeContext(this: HTMLCanvasElement) {
  const drawing = drawingOf(this);
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      drawing.calls.push([name, ...args]);
    };
  let filter = 'none';
  return {
    canvas: this,
    get filter() {
      return filter;
    },
    set filter(value: string) {
      filter = value;
      drawing.filters.push(value);
    },
    save: record('save'),
    restore: record('restore'),
    setTransform: record('setTransform'),
    drawImage: record('drawImage'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    closePath: record('closePath'),
    clip: record('clip'),
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      data: picturePixels(width * height),
    }),
  };
}
/** Pixels of one colour, RGBA. */
const filled =
  (red: number, green: number, blue: number) =>
  (count: number): Uint8ClampedArray =>
    Uint8ClampedArray.from({ length: count * 4 }, (_, index) =>
      index % 4 === 3 ? 255 : [red, green, blue][index % 4]!,
    );

let renders: { canvas: HTMLCanvasElement; recordImages?: boolean }[];
/** The page's pictures pdf.js recorded, three corners each as fractions of the canvas. */
let imageCoordinates: number[] | null;
beforeEach(() => {
  renders = [];
  imageCoordinates = null;
  picturePixels = filled(180, 60, 40);
  drawings.clear();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    fakeContext as unknown as HTMLCanvasElement['getContext'],
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) {
        if (element.classList.contains('pdf-scroll'))
          queueMicrotask(() =>
            this.callback(
              [{ contentRect: { width: 800, height: 600 } } as ResizeObserverEntry],
              this as unknown as ResizeObserver,
            ),
          );
      }
      unobserve() {}
      disconnect() {}
    },
  );
  Object.assign(window, { viewer: { printPDF: vi.fn(async () => {}) } });
  pdf.getDocument.mockReturnValue({
    promise: Promise.resolve({
      numPages: 3,
      getPage: async () => ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: 612 * scale,
          height: 792 * scale,
          scale,
        }),
        render: (parameters: { canvas: HTMLCanvasElement; recordImages?: boolean }) => {
          renders.push(parameters);
          return { promise: Promise.resolve(), cancel() {} };
        },
        get imageCoordinates() {
          return imageCoordinates;
        },
        getTextContent: async () => ({ items: [] }),
        cleanup() {},
      }),
    }),
    async destroy() {},
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function open(
  options: {
    pages?: PreviewContext['pages'];
    anchor?: EvidenceAnchor;
    saved?: Record<string, unknown>;
    toolbar?: PreviewContext['toolbar'];
  } = {},
) {
  const values = new Map<string, unknown>(Object.entries(options.saved ?? {}));
  const context = {
    resource: {
      id: 'pdf',
      url: 'https://fixture.invalid/Bracket.pdf',
      entry: { path: '/Jobs/Bracket.pdf', name: 'Bracket.pdf', extension: 'pdf' },
    },
    evidence: options.anchor && {
      path: '/Jobs/Bracket.pdf',
      version: { identity: '1:2', modified: 1, size: 1 },
      anchor: options.anchor,
      quote: '',
    },
    active: true,
    interactive: true,
    look: 'light',
    pages: options.pages,
    toolbar: options.toolbar,
    signal: new AbortController().signal,
    state: {
      get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => values.set(key, value),
    },
    optimize: vi.fn(),
    editPDF: vi.fn(),
    services: {},
  } as unknown as PreviewContext;
  const view = render(<PDFPreview {...context} />);
  const sheet = () => view.container.querySelector<HTMLElement>('.pdf-sheet')!;
  const visible = () => sheet().querySelector('canvas')!;
  return { view, context, sheet, visible };
}
const command = (id: string) => pdf.commands.find((item) => item.id === id);

describe('light pages', () => {
  it('are drawn as printed, straight onto the page, with no picture recording', async () => {
    const toggle = vi.fn();
    const { view, sheet, visible } = open({ pages: { toggle } });
    await waitFor(() => expect(renders).toHaveLength(1));
    expect(renders[0]!.canvas).toBe(visible());
    expect(renders[0]!.recordImages).toBeUndefined();
    expect(sheet().dataset.pages).toBeUndefined();
    expect(sheet().getAttribute('style')).toBeNull();
    expect([...drawings.values()].flatMap((drawing) => drawing.filters)).toEqual([]);
    const button = view.getByRole('button', { name: 'Dark pages' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(command('dark-pages')?.label).toBe('Dark pages');
    fireEvent.click(button);
    expect(toggle).toHaveBeenCalledTimes(1);
  });
  it('offer no button where the host has no Dark pages setting', async () => {
    const { view } = open();
    await waitFor(() => expect(renders).toHaveLength(1));
    expect(view.queryByRole('button', { name: 'Dark pages' })).toBeNull();
    expect(command('dark-pages')?.available).toBe(false);
  });
});

describe('dark pages', () => {
  it('are drawn off screen, recording pictures, turned dark, then shown', async () => {
    const toggle = vi.fn();
    const { view, sheet, visible } = open({ pages: { dark: colors, toggle } });
    await waitFor(() => expect(drawingOf(visible()).calls).toHaveLength(1));
    expect(renders).toHaveLength(1);
    const paper = renders[0]!.canvas;
    expect(paper).not.toBe(visible());
    expect(paper.isConnected).toBe(false);
    expect(renders[0]!.recordImages).toBe(true);
    // the page turned dark through the filter its colours make, then shown on the page's canvas
    const [filter] = drawingOf(paper).filters;
    expect(filter).toMatch(/^url\(#viewer-dark-page-\d+\)$/);
    const element = document.getElementById(filter!.slice('url(#'.length, -1))!;
    expect(element.getAttribute('color-interpolation-filters')).toBe('sRGB');
    expect(element.querySelector('feColorMatrix')?.getAttribute('values')).toBe(
      darkPageMatrix(colors).join(' '),
    );
    expect(drawingOf(paper).calls).toContainEqual(['drawImage', paper, 0, 0]);
    expect(drawingOf(visible()).calls).toEqual([['drawImage', paper, 0, 0]]);
    // the sheet beneath is the page's colour, never white, while a page draws
    expect(sheet().dataset.pages).toBe('dark');
    expect(sheet().style.getPropertyValue('--page')).toBe(colors.page);
    const button = view.getByRole('button', { name: 'Dark pages' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(command('dark-pages')?.label).toBe('Light pages');
    await command('dark-pages')!.run();
    expect(toggle).toHaveBeenCalledTimes(1);
  });
  it('keep photographs as they were, and darken a picture that reads as paper', async () => {
    // one picture over the page's top half
    imageCoordinates = [0, 0, 0, 0.5, 1, 0];
    const { visible } = open({ pages: { dark: colors, toggle() {} } });
    await waitFor(() => expect(drawingOf(visible()).calls).toHaveLength(1));
    const paper = renders[0]!.canvas;
    // the page off screen is released once shown; it was the page's own size
    const { width, height } = visible();
    expect(paper.width).toBe(0);
    const restored = drawingOf(paper).calls.filter(([name]) => name === 'clip');
    expect(restored).toHaveLength(1);
    expect(drawingOf(paper).calls.filter(([name]) => name === 'lineTo')).toEqual([
      ['lineTo', 0, height / 2],
      ['lineTo', width, height / 2],
      ['lineTo', width, 0],
    ]);
    cleanup();
    renders = [];
    // a scanned page: white paper, black type
    picturePixels = (count) =>
      Uint8ClampedArray.from({ length: count * 4 }, (_, index) =>
        index % 4 === 3 ? 255 : Math.floor(index / 4) % 9 ? 250 : 15,
      );
    const scan = open({ pages: { dark: colors, toggle() {} } });
    await waitFor(() => expect(drawingOf(scan.visible()).calls).toHaveLength(1));
    expect(drawingOf(renders[0]!.canvas).calls.some(([name]) => name === 'clip')).toBe(false);
  });
  it('draw the pages sidebar dark too', async () => {
    mockElementBox(800, 600);
    const { view } = open({
      pages: { dark: colors, toggle() {} },
      saved: { 'pdf.sidebar': 'pages' },
    });
    const thumbnails = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.pdf-thumbnails');
      expect(element?.querySelectorAll('canvas').length).toBeGreaterThan(0);
      return element!;
    });
    expect(thumbnails.dataset.pages).toBe('dark');
    expect(thumbnails.style.getPropertyValue('--page')).toBe(colors.page);
    // the selected page's outline keeps the window's accent, beside the dark pages
    expect(thumbnails.style.getPropertyValue('--accent')).toBe('');
    await waitFor(() => {
      const drawn = [...thumbnails.querySelectorAll('canvas')].map((canvas) =>
        renders.find((parameters) => parameters.canvas === canvas),
      );
      expect(drawn.every((parameters) => parameters === undefined)).toBe(true);
      expect(renders.filter((parameters) => parameters.recordImages)).toHaveLength(renders.length);
      expect(renders.length).toBeGreaterThan(1);
    });
  });
});

describe('marks on a dark page', () => {
  it('outline a region in an accent that shows on the page', async () => {
    const { view, sheet } = open({
      pages: { dark: colors, toggle() {} },
      anchor: {
        kind: 'pdf',
        page: 1,
        search: false,
        zoom: 1,
        region: [
          [0.6, 0.7],
          [0.8, 0.7],
          [0.8, 0.8],
          [0.6, 0.8],
        ],
        marks: [
          {
            kind: 'text',
            region: [
              [0.1, 0.1],
              [0.3, 0.1],
              [0.3, 0.12],
              [0.1, 0.12],
            ],
          },
        ],
      },
    });
    const outline = await waitFor(() => {
      const element = view.container.querySelector('.evidence-overlay');
      expect(element).toBeTruthy();
      return element!;
    });
    // the overlay draws in --accent, which the dark sheet sets, whatever the window's look
    expect(outline.closest('.pdf-sheet')).toBe(sheet());
    expect(sheet().style.getPropertyValue('--accent')).toBe(colors.accent);
    expect(contrast(colors.accent, colors.page)).toBeGreaterThanOrEqual(3);
    expect(outline.querySelectorAll('[data-kind="feature"], [data-kind="text"]')).toHaveLength(2);
  });
});

describe('what dark pages leave alone', () => {
  it('print the file, and leave PDF tools and Optimize to the file', async () => {
    const { view, context } = open({ pages: { dark: colors, toggle() {} } });
    await waitFor(() => expect(renders).toHaveLength(1));
    fireEvent.click(view.getByRole('button', { name: 'Print…' }));
    expect(window.viewer.printPDF).toHaveBeenCalledWith('pdf', undefined);
    fireEvent.click(view.getByText('Optimize…'));
    fireEvent.click(view.getByText('PDF tools…'));
    expect(context.optimize).toHaveBeenCalledTimes(1);
    expect(context.editPDF).toHaveBeenCalledTimes(1);
  });
  it('keep Dark pages in the Essential header, and leave the rest to the plane’s commands', async () => {
    const { view } = open({ pages: { toggle() {} }, toolbar: 'essential' });
    await waitFor(() => expect(renders).toHaveLength(1));
    // fabrication's native check presses this one
    expect(view.getByRole('button', { name: 'Dark pages' })).toBeTruthy();
    for (const name of ['Search PDF', 'Previous page', 'Next page'])
      expect(view.getByRole('button', { name })).toBeTruthy();
    expect(view.getByText('PDF tools…')).toBeTruthy();
    for (const name of ['Show pages', 'Show outline', 'Print…'])
      expect(view.queryByRole('button', { name })).toBeNull();
    expect(view.queryByText('Optimize…')).toBeNull();
    for (const id of ['pdf-pages', 'pdf-outline', 'pdf-print'])
      expect(command(id)?.available, id).toBe(true);
  });
  it('are drawn only by the page previews: printing, exports, layout and nesting never use them', async () => {
    const source = path.join(import.meta.dirname, '../src');
    const files = (await fs.readdir(source, { recursive: true })).filter((file) =>
      /\.tsx?$/.test(file),
    );
    const users: string[] = [];
    for (const file of files) {
      const text = await fs.readFile(path.join(source, file), 'utf8');
      if (/from '[./]*(pdf\/)?darken'|from '[./]*previews\/pdf\/darken'/.test(text))
        users.push(file);
    }
    expect(users.sort()).toEqual([
      'renderer/previews/FirstPagePicture.tsx',
      'renderer/previews/modules/PDFPreview.tsx',
      'renderer/previews/pdf/PDFSidebar.tsx',
    ]);
  });
});
