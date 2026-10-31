// @vitest-environment jsdom
/**
 * A PDF OPENED AT EVIDENCE stays on its anchored page. Its quote lists the pages that match, but
 * the first match never moves the page; `search: false` does not search at all. A region is
 * outlined on its page, which is enlarged so the region fills most of the view.
 */
import type { PropsWithChildren } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PDFPreview from '../src/renderer/previews/modules/PDFPreview';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import type { EvidenceAnchor } from '../src/domain/files/inspection';

const pdf = vi.hoisted(() => ({ getDocument: vi.fn() }));
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
  usePreviewCommands: () => {},
}));
vi.mock('../src/renderer/ui/primitives', () => ({
  IconButton: () => null,
  Empty: ({ title, detail, children }: PropsWithChildren<{ title?: string; detail?: string }>) => (
    <div>
      {title} {detail}
      {children}
    </div>
  ),
  Loading: () => <div>Opening PDF</div>,
}));
vi.mock('../src/renderer/ui/ChoiceMenu', () => ({ ChoiceButton: () => null }));
vi.mock('../src/renderer/state/store', () => ({
  getState: () => ({ bootstrap: { platform: 'darwin' } }),
  report: vi.fn(),
}));

// The quote is on pages 1 and 3; the evidence is on page 3.
const pages = ['Notes: holes 48 mm apart', 'Title block', 'Detail A: holes 48 mm apart', '', ''];
beforeEach(() => {
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
      disconnect() {}
    },
  );
  pdf.getDocument.mockReturnValue({
    promise: Promise.resolve({
      numPages: pages.length,
      getPage: async (number: number) => ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: 612 * scale,
          height: 792 * scale,
          scale,
        }),
        render: () => ({ promise: Promise.resolve(), cancel() {} }),
        getTextContent: async () => ({ items: [{ str: pages[number - 1] }] }),
        cleanup() {},
      }),
    }),
    async destroy() {},
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function open(anchor: EvidenceAnchor) {
  const values = new Map<string, unknown>([['pdf.page', 5]]);
  const context = {
    resource: {
      id: 'pdf',
      url: 'https://fixture.invalid/Bracket.pdf',
      entry: { path: '/Jobs/Bracket.pdf', name: 'Bracket.pdf', extension: 'pdf' },
    },
    evidence: {
      path: '/Jobs/Bracket.pdf',
      version: { identity: '1:2', modified: 1, size: 1 },
      anchor,
      quote: 'holes 48 mm',
    },
    active: true,
    interactive: true,
    look: 'dark',
    signal: new AbortController().signal,
    state: {
      get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => values.set(key, value),
    },
    services: {},
  } as unknown as PreviewContext;
  const view = render(<PDFPreview {...context} />);
  const page = () => view.container.querySelector<HTMLInputElement>('.page-number')?.value;
  return { view, values, page };
}

it('stays on the anchored page while its quote lists the matching pages', async () => {
  const { view, page } = open({ kind: 'pdf', page: 3 });
  await waitFor(() =>
    expect(view.container.querySelector('.pdf-search-results')?.textContent).toContain(
      '2 matching pages',
    ),
  );
  expect(page()).toBe('3');
  // still there once nothing is pending
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(page()).toBe('3');
});

it('does not search for the quote when the anchor says not to', async () => {
  const { view, page } = open({ kind: 'pdf', page: 3, search: false, zoom: 'width' });
  await waitFor(() => expect(page()).toBe('3'));
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(view.container.querySelector('.pdf-search-results')).toBeNull();
  expect(page()).toBe('3');
});

it('outlines a region on its page and enlarges the page around it', async () => {
  const { view, values, page } = open({
    kind: 'pdf',
    page: 3,
    search: false,
    region: [
      [0.6, 0.7],
      [0.8, 0.7],
      [0.8, 0.8],
      [0.6, 0.8],
    ],
  });
  await waitFor(() => expect(page()).toBe('3'));
  const outline = await waitFor(() => {
    const element = view.container.querySelector('.pdf-sheet svg[role="img"]');
    if (!element) throw new Error('No outline yet.');
    return element;
  });
  expect(outline.getAttribute('aria-label')).toBe('Outline on page 3');
  expect(outline.getAttribute('viewBox')).toBe('0 0 1 1');
  expect(outline.querySelector('.evidence-overlay-line')?.getAttribute('points')).toBe(
    '0.6,0.7 0.8,0.7 0.8,0.8 0.6,0.8',
  );
  // a region a fifth of the page wide fills about 60% of the 800 px view
  await waitFor(() => expect(values.get('pdf.view')).toBe(2.94));
});

it('draws again only once a cancelled draw has let go of the canvas', async () => {
  // pdf.js holds a canvas until a draw settles; a cancelled draw settles a little later
  const busy = new WeakSet<object>();
  let draws = 0;
  const draw = ({ canvas }: { canvas: object }) => {
    if (busy.has(canvas))
      throw new Error('Cannot use the same canvas during multiple render() operations.');
    busy.add(canvas);
    draws += 1;
    let settle!: (error?: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      settle = (error) => {
        busy.delete(canvas);
        if (error) reject(error);
        else resolve();
      };
    });
    const done = setTimeout(() => settle(), 40);
    return {
      promise,
      cancel() {
        clearTimeout(done);
        const cancelled = Object.assign(new Error('Rendering cancelled'), {
          name: 'RenderingCancelledException',
        });
        setTimeout(() => settle(cancelled), 10);
      },
    };
  };
  pdf.getDocument.mockReturnValue({
    promise: Promise.resolve({
      numPages: pages.length,
      getPage: async () => ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: 612 * scale,
          height: 792 * scale,
          scale,
        }),
        render: draw,
        getTextContent: async () => ({ items: [] }),
        cleanup() {},
      }),
    }),
    async destroy() {},
  });
  // a tour's region enlarges the page while its first draw is still running
  const { view, values } = open({
    kind: 'pdf',
    page: 3,
    search: false,
    region: [
      [0.6, 0.7],
      [0.8, 0.7],
      [0.8, 0.8],
      [0.6, 0.8],
    ],
  });
  await waitFor(() => expect(values.get('pdf.view')).toBe(2.94));
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(view.container.textContent).not.toContain('PDF could not be displayed');
  expect(view.container.textContent).not.toContain('Cannot use the same canvas');
  expect(draws).toBeGreaterThan(1);
});
