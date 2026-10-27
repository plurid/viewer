// @vitest-environment jsdom
import type { PropsWithChildren } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PDFPreview from '../src/renderer/previews/modules/PDFPreview';
import type { PreviewContext } from '../src/renderer/previews/contracts';

const pdf = vi.hoisted(() => ({ getDocument: vi.fn(), textLayer: vi.fn() }));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  PixelsPerInch: { PDF_TO_CSS_UNITS: 96 / 72 },
  PasswordResponses: {},
  getDocument: pdf.getDocument,
  TextLayer: class {
    constructor() {
      pdf.textLayer();
    }
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
  Empty: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Loading: () => <div>Opening PDF</div>,
}));
vi.mock('../src/renderer/ui/ChoiceMenu', () => ({ ChoiceButton: () => null }));
vi.mock('../src/renderer/state/store', () => ({
  getState: () => ({ bootstrap: { platform: 'darwin' } }),
  report: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it.each([
  { name: 'after painting', resize: false },
  { name: 'during a resize', resize: true },
])('keeps the scroll and one text layer when PDF text finishes $name', async ({ resize }) => {
  type Observer = (entries: { contentRect: { width: number; height: number } }[]) => void;
  const observers = new Set<Observer>();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: Observer) {}
      observe(element: Element) {
        if (element.classList.contains('pdf-scroll')) {
          observers.add(this.callback);
          queueMicrotask(() => this.callback([{ contentRect: { width: 800, height: 600 } }]));
        }
      }
      disconnect() {
        observers.delete(this.callback);
      }
    },
  );
  let finishText!: (value: { items: never[] }) => void;
  const text = new Promise<{ items: never[] }>((resolve) => {
    finishText = resolve;
  });
  const paint = vi.fn(() => ({ promise: Promise.resolve(), cancel() {} }));
  const sheet = {
    getViewport: ({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: 800 * scale,
      scale,
    }),
    render: paint,
    getTextContent: () => text,
  };
  pdf.getDocument.mockReturnValue({
    promise: Promise.resolve({ numPages: 178, getPage: async () => sheet }),
    async destroy() {},
  });
  const values = new Map<string, unknown>([
    ['pdf.page', 3],
    ['pdf.view', 2],
  ]);
  const unavailable = async (): Promise<never> => {
    throw new Error('The PDF must use its authorized resource URL, not another preview service.');
  };
  const context: PreviewContext = {
    resource: {
      id: 'pdf',
      url: 'https://fixture.invalid/Book.pdf',
      entry: {
        path: '/fixtures/Book.pdf',
        name: 'Book.pdf',
        parent: '/fixtures',
        extension: 'pdf',
        kind: 'file',
        directory: false,
        size: 100,
        modified: 1,
        created: 1,
        hidden: false,
        mime: 'application/pdf',
        identity: 'pdf',
      },
    },
    active: true,
    interactive: true,
    look: 'dark',
    signal: new AbortController().signal,
    state: { get: (key) => values.get(key), set: (key, value) => values.set(key, value) },
    services: {
      htmlPreview: unavailable,
      htmlPreviewClose: unavailable,
      thumbnail: unavailable,
      document: unavailable,
      cancelDocument: unavailable,
      read: unavailable,
      archive: unavailable,
      archiveEntry: unavailable,
      rendition: unavailable,
      videoRendition: unavailable,
      officeImage: unavailable,
      release: unavailable,
    },
  };
  const view = render(<PDFPreview {...context} />);
  await waitFor(() =>
    expect(parseFloat(view.container.querySelector('canvas')?.style.height ?? '0')).toBeGreaterThan(
      1000,
    ),
  );
  const scroll = view.container.querySelector<HTMLDivElement>('.pdf-scroll')!;
  fireEvent.wheel(scroll);
  scroll.scrollTop = 400;
  fireEvent.scroll(scroll);
  if (resize) {
    act(() => {
      for (const notify of observers) notify([{ contentRect: { width: 780, height: 600 } }]);
    });
    await waitFor(() => expect(paint).toHaveBeenCalledTimes(2));
  }
  await act(async () => finishText({ items: [] }));
  expect(scroll.scrollTop).toBe(400);
  expect(pdf.textLayer).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(values.get('scroll.pdf')).toEqual({ section: '3:2', top: 400, left: 0 });
});
