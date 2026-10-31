// @vitest-environment jsdom
/**
 * AN OFFICE DOCUMENT WITH DARK PAGES. Its layout is a PDF the bundled engine made, shown by the
 * PDF preview with the same dark pages; the picture of its first page that stands in until the
 * layout paints is dark too, so nothing white shows first. The engine's PDF itself is unchanged.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { Resource } from '../src/domain/contracts';
import type { OfficeLayoutRequest } from '../src/domain/previews/documents/layout';
import type { PageColors } from '../src/domain/previews/documents/dark-pages';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import OfficePreview from '../src/renderer/previews/modules/OfficePreview';

vi.mock('../src/renderer/previews/modules/PDFPreview', () => ({
  default: ({ resource, pages }: PreviewContext) => (
    <div className="pdf-viewer">
      Rendered {resource.id} on {pages?.dark?.page ?? 'white'}
    </div>
  ),
}));
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe() {
        this.callback(
          [{ contentRect: { width: 800, height: 600 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const colors: PageColors = { page: '#31353d', ink: '#f2f4f6', accent: '#82b3cf' };
const picture = {
  id: 'picture',
  url: 'viewer-resource://picture/asset/thumbnail.png',
  dimensions: { width: 181, height: 256 },
  entry: { name: 'thumbnail.png', extension: 'png' },
} as Resource;
const layout = { id: 'layout', url: 'viewer-resource://layout/asset.pdf', entry: {} } as Resource;

function open(name: string, dark: PageColors | undefined) {
  let finish!: (resource: Resource) => void;
  const services = {
    officeLayout: vi.fn<(id: string, request: OfficeLayoutRequest) => Promise<Resource>>(
      () =>
        new Promise<Resource>((resolve) => {
          finish = resolve;
        }),
    ),
    archiveEntry: vi.fn(async () => picture),
    cancelDocument: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
  };
  const values = new Map<string, unknown>();
  const context = {
    resource: { id: 'source', entry: { extension: name.split('.').pop(), name, path: '/' + name } },
    services,
    active: true,
    interactive: true,
    signal: new AbortController().signal,
    look: 'light',
    pages: { dark, toggle() {} },
    state: {
      get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => values.set(key, value),
    },
  } as unknown as PreviewContext;
  const view = render(<OfficePreview {...context} />);
  return { view, services, finish: (resource: Resource) => finish(resource) };
}

it('shows its first page dark while the layout renders, then the layout with dark pages', async () => {
  const { view, services, finish } = open('Field notes.odt', colors);
  const image = await waitFor(() => {
    const found = view.container.querySelector<HTMLImageElement>('.office-first-page img');
    expect(found).toBeTruthy();
    return found!;
  });
  // the page's filter; CSS writes the reference quoted
  expect(image.style.filter).toMatch(/^url\("?#viewer-dark-page-\d+"?\)$/);
  const sheet = image.closest<HTMLElement>('.pdf-sheet')!;
  expect(sheet.dataset.pages).toBe('dark');
  expect(sheet.style.getPropertyValue('--page')).toBe(colors.page);
  await act(async () => finish(layout));
  await screen.findByText(`Rendered layout on ${colors.page}`);
  // the engine is asked for its PDF as ever: dark pages are the view's, not the document's
  expect(services.officeLayout).toHaveBeenCalledWith('source', {
    requestID: expect.any(String),
    sheet: undefined,
  });
});

it('shows its first page as printed while pages are light', async () => {
  const { view, finish } = open('Field notes.odt', undefined);
  const image = await waitFor(() => {
    const found = view.container.querySelector<HTMLImageElement>('.office-first-page img');
    expect(found).toBeTruthy();
    return found!;
  });
  expect(image.style.filter).toBe('');
  expect(image.closest<HTMLElement>('.pdf-sheet')!.dataset.pages).toBeUndefined();
  await act(async () => finish(layout));
  await screen.findByText('Rendered layout on white');
});
