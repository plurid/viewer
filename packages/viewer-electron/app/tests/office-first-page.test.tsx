// @vitest-environment jsdom
/**
 * An OpenDocument file shows the picture of its first page it carries while the Office engine lays
 * it out, then the laid-out page replaces it in place once that page has painted.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Resource } from '../src/domain/contracts';
import type { OfficeLayoutRequest } from '../src/domain/previews/documents/layout';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import OfficePreview from '../src/renderer/previews/modules/OfficePreview';

vi.mock('../src/renderer/previews/modules/PDFPreview', () => ({
  default: ({ resource, onPaint }: PreviewContext & { onPaint?(): void }) => (
    <div className="pdf-viewer">
      Rendered {resource.id}
      <button onClick={onPaint}>Paint page</button>
    </div>
  ),
}));
beforeEach(() => {
  // the picture's scroller is measured as the layout's is
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const picture = {
  id: 'picture',
  url: 'viewer-resource://picture/asset/thumbnail.png',
  dimensions: { width: 181, height: 256 },
  entry: { name: 'thumbnail.png', extension: 'png' },
} as Resource;
const layout = { id: 'layout', url: 'viewer-resource://layout/asset.pdf', entry: {} } as Resource;

function fixture(name: string, saved: Record<string, unknown> = {}) {
  const extension = name.split('.').pop()!;
  const values = new Map(Object.entries(saved));
  const services = {
    officeLayout: vi.fn<(id: string, request: OfficeLayoutRequest) => Promise<Resource>>(),
    archiveEntry: vi.fn<(id: string, name: string) => Promise<Resource>>(async () => picture),
    cancelDocument: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
  };
  let finish!: (resource: Resource) => void;
  services.officeLayout.mockImplementation(
    () =>
      new Promise<Resource>((resolve) => {
        finish = resolve;
      }),
  );
  const context = {
    resource: { id: 'source', entry: { extension, name, path: '/fixture/' + name } },
    services,
    active: true,
    interactive: true,
    signal: new AbortController().signal,
    look: 'dark',
    state: {
      get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => values.set(key, value),
    },
  } as unknown as PreviewContext;
  return { context, services, finish: (resource: Resource) => finish(resource) };
}

it('shows the first page picture fitted to the page, then the painted layout in its place', async () => {
  const { context, services, finish } = fixture('Field notes.odt');
  const view = render(<OfficePreview {...context} />);
  const image = await waitFor(() => {
    const found = view.container.querySelector<HTMLImageElement>('.office-first-page img');
    expect(found).toBeTruthy();
    return found!;
  });
  expect(services.archiveEntry).toHaveBeenCalledWith('source', 'Thumbnails/thumbnail.png');
  expect(image.getAttribute('src')).toBe(picture.url);
  // fitted to the page, as the layout's first page will be: the full height of the scroller
  expect(image.style.height).toBe('600px');
  expect(image.style.width).toBe(`${181 * (600 / 256)}px`);
  expect(screen.queryByText('Rendering Office layout…', { selector: '.loading' })).toBeNull();
  await act(async () => finish(layout));
  // the layout renders beneath the picture until its page has painted
  await screen.findByText('Rendered layout');
  expect(view.container.querySelector('.office-first-page')).toBeTruthy();
  fireEvent.click(screen.getByText('Paint page'));
  await waitFor(() => expect(view.container.querySelector('.office-first-page')).toBeNull());
  expect(services.release).toHaveBeenCalledWith('picture');
  expect(services.release).not.toHaveBeenCalledWith('source');
});

it('fits the picture to the width when the layout opens at its width', async () => {
  const { context } = fixture('Plan.odg', { 'pdf.view': 'width' });
  const view = render(<OfficePreview {...context} />);
  const image = await waitFor(() => {
    const found = view.container.querySelector<HTMLImageElement>('.office-first-page img');
    expect(found).toBeTruthy();
    return found!;
  });
  expect(image.style.width).toBe('800px');
});

it('shows the layout a second after it arrives even when no page paints', async () => {
  vi.useFakeTimers();
  const { context, finish } = fixture('Field notes.odp');
  const view = render(<OfficePreview {...context} />);
  await act(async () => {});
  expect(view.container.querySelector('.office-first-page')).toBeTruthy();
  await act(async () => finish(layout));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1001);
  });
  expect(view.container.querySelector('.office-first-page')).toBeNull();
  expect(view.container.textContent).toContain('Rendered layout');
});

it('keeps the ordinary progress for a missing, oversized or unusable picture', async () => {
  const { context, services } = fixture('Budget.ods');
  services.archiveEntry.mockRejectedValue(
    new Error('This picture is missing or exceeds its preview limit.'),
  );
  const view = render(<OfficePreview {...context} />);
  await screen.findByText('Rendering Office layout…');
  await waitFor(() => expect(services.archiveEntry).toHaveBeenCalled());
  expect(view.container.querySelector('.office-first-page')).toBeNull();
});

it('asks only OpenDocument packages, and only for a view opening on its first page', async () => {
  for (const [name, saved] of [
    ['Report.docx', {}],
    ['Field notes.fodt', {}],
    ['Field notes.odt', { 'pdf.page': 3 }],
    ['Budget.ods', { 'office.sheet': 'Notes' }],
  ] as const) {
    const { context, services } = fixture(name, saved);
    const view = render(<OfficePreview {...context} />);
    await screen.findByText('Rendering Office layout…');
    expect([name, services.archiveEntry.mock.calls.length]).toEqual([name, 0]);
    view.unmount();
  }
});

it('releases a picture that arrives after the view closed', async () => {
  const { context, services } = fixture('Field notes.odt');
  let deliver!: (resource: Resource) => void;
  services.archiveEntry.mockImplementation(
    () =>
      new Promise<Resource>((resolve) => {
        deliver = resolve;
      }),
  );
  const view = render(<OfficePreview {...context} />);
  await waitFor(() => expect(services.archiveEntry).toHaveBeenCalled());
  view.unmount();
  await act(async () => deliver({ ...picture, id: 'late' }));
  await waitFor(() => expect(services.release).toHaveBeenCalledWith('late'));
});
