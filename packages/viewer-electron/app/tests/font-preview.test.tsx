// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import FontPreview from '../src/renderer/previews/modules/FontPreview';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import { Writer, fixtureFont } from './font-fixtures';

/** Records what the preview asks of Chromium's font loading. */
class FakeFontFace {
  static failing = false;
  static created: FakeFontFace[] = [];
  constructor(
    readonly family: string,
    readonly source: Uint8Array,
  ) {
    FakeFontFace.created.push(this);
  }
  load(): Promise<this> {
    return FakeFontFace.failing
      ? Promise.reject(new DOMException('A network error occurred.', 'NetworkError'))
      : Promise.resolve(this);
  }
}

const fonts = { add: vi.fn(), delete: vi.fn() };

beforeEach(() => {
  FakeFontFace.failing = false;
  FakeFontFace.created = [];
  fonts.add.mockClear();
  fonts.delete.mockClear();
  vi.stubGlobal('FontFace', FakeFontFace);
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function serve(bytes: Uint8Array<ArrayBuffer>) {
  const fetch = vi.fn(async () => new Response(bytes));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function fontContext(name: string, size: number): PreviewContext {
  return {
    resource: {
      id: 'font',
      url: `viewer-resource://font/${name}`,
      entry: { name, path: `/fixture/${name}`, extension: name.split('.').pop(), size },
    },
    active: true,
    interactive: true,
    signal: new AbortController().signal,
    look: 'dark',
    services: {},
  } as unknown as PreviewContext;
}

it('shows the specimen, details and character coverage in its own font face', async () => {
  const bytes = fixtureFont();
  serve(bytes);
  const view = render(<FontPreview {...fontContext('Fixture.ttf', bytes.length)} />);
  await screen.findByText('Fixture Sans Regular');
  const [face] = FakeFontFace.created;
  expect(face?.family).toMatch(/^viewer-font-\d+$/);
  expect([...face!.source]).toEqual([...bytes]);
  expect(fonts.add).toHaveBeenCalledWith(face);
  const specimen = screen.getByRole('region', { name: 'Specimen' });
  expect(specimen.style.fontFamily).toBe(`"${face!.family}"`);
  expect(specimen.style.fontSize).toBe('48px');
  expect(specimen.textContent).toContain('The quick brown fox jumps over the lazy dog');
  expect(specimen.textContent).toContain('0123456789');
  for (const fact of ['Fixture Sans', 'Regular', 'Version 1.000', 'A. Designer', 'Fixture Foundry'])
    expect(screen.getByText(fact)).toBeTruthy();
  expect(screen.getByText('Copyright 2026 Fixture Foundry')).toBeTruthy();
  expect(screen.getByText('120')).toBeTruthy();
  expect(screen.getByText('TrueType')).toBeTruthy();
  // the fixture maps printable ASCII and nothing from Latin-1
  const characters = screen.getByRole('region', { name: 'Characters' });
  expect(characters.querySelectorAll('.font-glyph')).toHaveLength(188);
  expect(characters.querySelectorAll('.font-glyph.is-missing')).toHaveLength(94);
  expect(characters.textContent).toContain('94 of 188 in this font');
  const letter = screen.getByTitle('U+0041');
  expect(letter.querySelector('span')?.style.fontFamily).toBe(`"${face!.family}"`);
  const missing = screen.getByTitle('U+00E9 is not in this font');
  expect(missing.querySelector('span')?.style.fontFamily).toBe('');
  view.unmount();
  expect(fonts.delete).toHaveBeenCalledWith(face);
});

it('renders the typed sample at the chosen size', async () => {
  const bytes = fixtureFont();
  serve(bytes);
  render(<FontPreview {...fontContext('Fixture.ttf', bytes.length)} />);
  const field = await screen.findByLabelText('Sample text');
  fireEvent.change(field, { target: { value: 'Sphinx of black quartz' } });
  const specimen = screen.getByRole('region', { name: 'Specimen' });
  expect(specimen.textContent).toContain('Sphinx of black quartz');
  expect(specimen.textContent).not.toContain('lazy dog');
  fireEvent.click(screen.getByRole('button', { name: 'Sample size' }));
  const search = await screen.findByLabelText('Search Sample size');
  fireEvent.change(search, { target: { value: '72' } });
  fireEvent.keyDown(search, { key: 'Enter' });
  await waitFor(() => expect(specimen.style.fontSize).toBe('72px'));
  // clearing the field restores the pangram
  fireEvent.change(field, { target: { value: '' } });
  expect(specimen.textContent).toContain('lazy dog');
});

it('explains a font Chromium refuses to load', async () => {
  FakeFontFace.failing = true;
  const bytes = fixtureFont();
  serve(bytes);
  render(<FontPreview {...fontContext('Fixture.ttf', bytes.length)} />);
  await screen.findByText('Font could not be loaded');
  expect(
    screen.getByText('The font may be damaged or use a format Viewer cannot render.'),
  ).toBeTruthy();
  expect(fonts.add).not.toHaveBeenCalled();
});

it('adds the parser reason when a refused font is also malformed', async () => {
  FakeFontFace.failing = true;
  const font = new Uint8Array(fixtureFont());
  // the first table record's offset, past the end of the file
  new DataView(font.buffer).setUint32(12 + 8, font.length);
  serve(font);
  render(<FontPreview {...fontContext('Broken.ttf', font.length)} />);
  await screen.findByText(
    'The font may be damaged or use a format Viewer cannot render. A font table lies outside the file.',
  );
});

it('refuses a font over the preview limit without reading it', () => {
  const fetch = serve(fixtureFont());
  render(<FontPreview {...fontContext('Huge.otf', 33 * 1024 * 1024)} />);
  expect(screen.getByText('Font preview unavailable')).toBeTruthy();
  expect(screen.getByText(/exceeds the preview file limit \(32 MB\)/)).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});

it('refuses a font that grows past the limit while it is read', async () => {
  const chunk = new Uint8Array(1024 * 1024);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      sent++;
      controller.enqueue(chunk);
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body)),
  );
  render(<FontPreview {...fontContext('Growing.ttf', 1024)} />);
  await screen.findByText('Font could not be loaded');
  expect(screen.getByText(/exceeds the preview file limit \(32 MB\)/)).toBeTruthy();
  expect(sent).toBeLessThan(40);
  expect(FakeFontFace.created).toHaveLength(0);
});

it('renders WOFF2 and says its details are unavailable', async () => {
  const bytes = new Writer().tag('wOF2').u32(0x00010000).raw(new Uint8Array(40)).done();
  serve(bytes);
  render(<FontPreview {...fontContext('Fixture.woff2', bytes.length)} />);
  await screen.findByText('WOFF2');
  expect(
    screen.getByText(
      'Font details are unavailable. WOFF2 tables use Brotli compression, which this preview cannot read.',
    ),
  ).toBeTruthy();
  expect(fonts.add).toHaveBeenCalledWith(FakeFontFace.created[0]);
  const characters = screen.getByRole('region', { name: 'Characters' });
  expect(characters.querySelectorAll('.font-glyph.is-missing')).toHaveLength(0);
});

it('never adds a face whose bytes arrive after the preview closed', async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const view = render(<FontPreview {...fontContext('Late.ttf', 1024)} />);
  view.unmount();
  await act(async () => finish(new Response(fixtureFont())));
  await waitFor(() => expect(FakeFontFace.created).toHaveLength(1));
  expect(fonts.add).not.toHaveBeenCalled();
});
