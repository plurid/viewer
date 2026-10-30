// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import WebArchivePreview from '../src/renderer/previews/modules/WebArchivePreview';
import EPUBPreview from '../src/renderer/previews/modules/EPUBPreview';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import type { DocumentData } from '../src/domain/services';
import { readFictionBook } from '../src/domain/previews/documents/fiction-book';
import { messageSamples } from '../tools/playground/samples/messages';

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
  vi.unstubAllGlobals();
});

const id = '00000000-0000-4000-8000-000000000001';
function context(extension: string, document: DocumentData, blocked = 0) {
  const values = new Map<string, unknown>();
  const services = {
    document: vi.fn(async () => document),
    cancelDocument: vi.fn(async () => {}),
    htmlPreview: vi.fn(async () => ({ id, url: `viewer-html://${id}/page.html`, blocked })),
    htmlPreviewClose: vi.fn(async () => {}),
    archiveEntry: vi.fn(async () => {
      throw new Error('A FictionBook picture is never read from an archive.');
    }),
    release: vi.fn(async () => {}),
  };
  return {
    services,
    context: {
      resource: { id: 'resource', url: '', entry: { name: `Saved.${extension}`, extension } },
      state: {
        get: (key: string) => values.get(key),
        set: (key: string, value: unknown) => values.set(key, value),
      },
      active: true,
      interactive: true,
      look: 'dark',
      signal: new AbortController().signal,
      services,
    } as unknown as PreviewContext,
  };
}
const data = (fields: Partial<DocumentData>): DocumentData => ({
  path: '/fixtures/Saved',
  metadata: {},
  evidence: [],
  text: '',
  truncated: false,
  ...fields,
});

describe('web archive preview', () => {
  it('names the saved page and shows it in a script-free sandbox', async () => {
    const { context: preview, services } = context(
      'webarchive',
      data({
        webArchive: {
          url: 'https://field-notes.example.invalid/trip/',
          title: 'Field notes',
          resources: 2,
          frames: 0,
        },
      }),
      1,
    );
    const { container } = render(<WebArchivePreview {...preview} />);
    expect(await screen.findByText('Field notes')).toBeTruthy();
    expect(screen.getByText(/https:\/\/field-notes\.example\.invalid\/trip\//)).toBeTruthy();
    const frame = await waitFor(() => {
      const element = container.querySelector('iframe');
      expect(element).not.toBeNull();
      return element!;
    });
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('src')).toBe(`viewer-html://${id}/page.html`);
    expect(screen.getByRole('status').textContent).toBe(
      'Content not saved in the archive is not loaded.',
    );
    fireEvent.click(screen.getByRole('button', { name: /Reload/ }));
    await waitFor(() => expect(services.htmlPreview).toHaveBeenCalledTimes(2));
    expect(services.htmlPreviewClose).toHaveBeenCalledWith(id);
  });

  it('says why a page cannot be shown', async () => {
    const { context: preview, services } = context('webarchive', data({}));
    services.htmlPreview.mockRejectedValueOnce(
      new Error('This property list holds no saved web page.'),
    );
    render(<WebArchivePreview {...preview} />);
    expect(await screen.findByText('The saved page could not be shown')).toBeTruthy();
    expect(screen.getByText('This property list holds no saved web page.')).toBeTruthy();
  });
});

describe('FictionBook in the book reader', () => {
  const image = readFileSync(
    path.join(import.meta.dirname, '../tools/playground/assets/study-small.png'),
  );
  const sample = messageSamples(new Uint8Array(image)).find((item) => item.path.endsWith('.fb2'))!;
  const book = readFictionBook(new TextEncoder().encode(sample.bytes as string));
  const document = data({
    metadata: book.metadata,
    chapters: book.chapters,
    epub: {
      images: [
        ...book.images.map((picture) => ({
          path: picture.path,
          size: picture.data.length,
          data: `data:${picture.type};base64,${Buffer.from(picture.data).toString('base64')}`,
        })),
        // not a picture the reader accepts inline
        { path: 'images/9.svg', size: 10, data: 'data:image/svg+xml,<svg onload="x"/>' },
      ],
    },
  });

  it('shows the cover, title and authors, and follows a note into its chapter', async () => {
    const { context: preview, services } = context('fb2', document);
    const { container } = render(<EPUBPreview {...preview} />);
    expect(await screen.findByRole('heading', { name: 'Lighthouse Notes', level: 1 })).toBeTruthy();
    expect(screen.getByText('Ana Ionescu; Mara Lin')).toBeTruthy();
    const cover = screen.getByRole('img', { name: 'Cover' });
    expect(cover.getAttribute('src')).toBe(`data:image/png;base64,${image.toString('base64')}`);
    expect(services.archiveEntry).not.toHaveBeenCalled();
    const contents = screen.getByRole('navigation', { name: 'FictionBook contents' });
    expect(
      within(contents)
        .getAllByRole('button')
        .map((item) => item.textContent),
    ).toEqual(['Lighthouse Notes', 'Morning', 'Evening', 'Notes']);
    fireEvent.click(within(contents).getByText('Morning'));
    expect(await screen.findByRole('heading', { name: 'Morning' })).toBeTruthy();
    fireEvent.click(screen.getByText('[1]'));
    expect(await screen.findByText('The line closed in 1961.')).toBeTruthy();
    expect(container.querySelector('img[src^="data:image/svg"]')).toBeNull();
  });

  it('says a broken book could not be opened', async () => {
    const { context: preview, services } = context('fb2', document);
    services.document.mockRejectedValueOnce(new Error('Malformed or unsupported XML.'));
    render(<EPUBPreview {...preview} />);
    expect(await screen.findByText('FictionBook could not be opened')).toBeTruthy();
  });
});
