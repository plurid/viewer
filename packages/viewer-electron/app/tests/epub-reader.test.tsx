// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { epubReference } from '../src/domain/previews/documents/epub';
import { bookNodes, readBookChapter, searchBook } from '../src/renderer/previews/epub-content';
import EPUBPreview from '../src/renderer/previews/modules/EPUBPreview';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import type { DocumentData } from '../src/domain/services';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const chapters = [
  {
    title: 'Start',
    path: 'Book/start.xhtml',
    html: '<h1>Start</h1><p>copper <em>circuit</em></p><a href="notes.xhtml#one">Footnote one</a><img src="pictures/test.png" alt="Local picture"/>',
  },
  {
    title: 'Notes',
    path: 'Book/notes.xhtml',
    html: '<h1>Notes</h1><aside id="one"><p>A copper circuit footnote.</p></aside>',
  },
];
function context(): PreviewContext {
  const values = new Map<string, unknown>();
  const data: DocumentData = {
    path: '/Book.epub',
    metadata: {},
    evidence: [],
    text: '',
    chapters,
    epub: { images: [{ path: 'Book/pictures/test.png', size: 24 }] },
    truncated: false,
  };
  return {
    resource: { id: 'book', entry: { extension: 'epub' } },
    state: {
      get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => {
        values.set(key, value);
      },
    },
    active: true,
    interactive: true,
    look: 'dark',
    signal: new AbortController().signal,
    services: {
      document: vi.fn(async () => data),
      archiveEntry: vi.fn(async () => ({
        id: 'image',
        url: 'viewer-resource://image/asset/test.png',
        dimensions: { width: 64, height: 64 },
      })),
      cancelDocument: vi.fn(async () => {}),
      release: vi.fn(async () => {}),
    },
  } as unknown as PreviewContext;
}

it('resolves encoded book-local references and rejects external URLs and traversal', () => {
  expect(epubReference('Book/Text/start.xhtml', '../notes.xhtml#one%20two')).toEqual({
    path: 'Book/notes.xhtml',
    fragment: 'one two',
  });
  expect(epubReference('Book/start.xhtml', '#one')).toEqual({
    path: 'Book/start.xhtml',
    fragment: 'one',
  });
  for (const value of [
    '../../outside',
    '%2e%2e/%2e%2e/outside',
    '/etc/file',
    '//example.com/image',
    'https://example.com',
    'data:image/png,x',
    'javascript:alert(1)',
    'file:///secret',
    'bad%XX',
    '..\\file',
  ])
    expect(epubReference('Book/start.xhtml', value)).toBeUndefined();
});
it('mounts only safe text and book links, without source scripts, styling or external resources', () => {
  const html =
    '<script>bad()</script><style>body{display:none}</style><iframe src="https://example.invalid"></iframe><p id="safe" onclick="bad()" style="color:red">Readable</p><img src="https://example.invalid/tracker" alt="Blocked picture"><a href="javascript:bad()">Blocked link</a>';
  render(
    <>{bookNodes(readBookChapter(html), { chapter: chapters[0], chapters, navigate: vi.fn() })}</>,
  );
  expect(document.querySelector('script,style,iframe,img,a')).toBeNull();
  expect(screen.getByText('Readable').getAttribute('onclick')).toBeNull();
  expect(screen.getByText('Readable').getAttribute('style')).toBeNull();
  expect(screen.getByText('Readable').id).toBe('');
});
it('searches across inline formatting, bounds repeated hits and supports cancellation', async () => {
  expect(
    (await searchBook(chapters, 'copper circuit', new AbortController().signal)).matches,
  ).toHaveLength(2);
  const bounded = await searchBook(
    [{ title: 'Many', html: '<p>' + 'x '.repeat(300) + '</p>' }],
    'x',
    new AbortController().signal,
  );
  expect(bounded.matches).toHaveLength(200);
  expect(bounded.limited).toBe(true);
  const abort = new AbortController();
  abort.abort();
  await expect(searchBook(chapters, 'copper', abort.signal)).rejects.toThrow();
});
it('opens footnotes, returns to the reading position and highlights a book search result', async () => {
  const current = context();
  const view = render(<EPUBPreview {...current} />);
  await screen.findByRole('link', { name: 'Footnote one' });
  const article = document.querySelector<HTMLElement>('.epub-chapter')!;
  article.scrollTop = 234;
  fireEvent.click(screen.getByRole('link', { name: 'Footnote one' }));
  expect(screen.getByText('A copper circuit footnote.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Back to reading position' }));
  expect(document.querySelector('.epub-chapter')!.scrollTop).toBe(234);
  fireEvent.click(screen.getByRole('button', { name: 'Find in book' }));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search book text' }), {
    target: { value: 'copper circuit' },
  });
  await screen.findByText('2 matches');
  fireEvent.click(screen.getByRole('button', { name: /Notes A copper circuit footnote/ }));
  expect(document.querySelector('[data-epub-match]')?.textContent).toBe('copper circuit');
  view.unmount();
});
it('releases illustrations when the view closes, including a late acquisition', async () => {
  const current = context();
  const view = render(<EPUBPreview {...current} />);
  await screen.findByRole('img', { name: 'Local picture' });
  expect(current.services.archiveEntry).toHaveBeenCalledWith('book', 'Book/pictures/test.png');
  view.unmount();
  expect(current.services.release).toHaveBeenCalledWith('image');
  let finish!: (value: { id: string; url: string }) => void;
  const next = context();
  next.services.archiveEntry = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  ) as PreviewContext['services']['archiveEntry'];
  const late = render(<EPUBPreview {...next} />);
  await screen.findByText('Local picture');
  await waitFor(() => expect(next.services.archiveEntry).toHaveBeenCalled());
  late.unmount();
  await act(async () => finish({ id: 'late', url: 'viewer-resource://late/asset/test.png' }));
  expect(next.services.release).toHaveBeenCalledWith('late');
});
