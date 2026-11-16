// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Resource } from '../src/domain/contracts';
import type {
  PostScriptInspection,
  GhostscriptStatus,
} from '../src/domain/previews/documents/postscript';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import { inspectPostScript, epsCropMessage } from '../src/domain/previews/documents/postscript';
import { postscriptSample } from './support/postscript';
import PostScriptPreview from '../src/renderer/previews/modules/PostScriptPreview';

const children = vi.hoisted(() => ({ text: vi.fn(), image: vi.fn(), pdf: vi.fn() }));
vi.mock('../src/renderer/previews/modules/TextPreview', () => ({
  default: (context: PreviewContext) => {
    children.text(context);
    return <div>Existing text viewer</div>;
  },
}));
vi.mock('../src/renderer/previews/modules/ImagePreview', () => ({
  default: (context: PreviewContext) => {
    children.image(context);
    return <div>Existing image viewer</div>;
  },
}));
vi.mock('../src/renderer/previews/modules/PDFPreview', () => ({
  default: (context: PreviewContext) => {
    children.pdf(context);
    return <div>Existing PDF viewer</div>;
  },
}));
vi.mock('../src/renderer/previews/HexView', () => ({ HexView: () => <div>File bytes</div> }));
afterEach(cleanup);

const child = (extension: string): Resource =>
  ({
    id: `child-${extension}`,
    url: `viewer-resource://child-${extension}/asset/file.${extension}`,
    entry: { name: `file.${extension}`, extension, path: '/fixtures/file', size: 100 },
    derivation: { kind: 'postscript', decoder: 'Ghostscript 10.99.1' },
  }) as Resource;
function fixture(
  status: GhostscriptStatus = { kind: 'found' },
  partial: Partial<PostScriptInspection> = {},
) {
  const document: PostScriptInspection = {
    ...inspectPostScript(Buffer.from(postscriptSample), 'ps'),
    wmf: false,
    ...partial,
  };
  const services = {
    inspectPostscript: vi.fn(async () => document),
    postscriptStatus: vi.fn(async () => status),
    renderPostscript: vi.fn(async () => child('pdf')),
    cancelDocument: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
  };
  const context = {
    resource: { ...child('ps'), id: 'source' },
    services,
    active: true,
    interactive: true,
    look: 'dark',
    signal: new AbortController().signal,
  } as unknown as PreviewContext;
  return { context, services, document };
}

describe('PostScript preview composition and explicit rendering', () => {
  it('explains the full-page fallback before and after rendering an EPS with an unusable box', async () => {
    const f = fixture({ kind: 'found' }, { kind: 'Encapsulated PostScript', epsCrop: 'page' });
    render(<PostScriptPreview {...f.context} />);
    expect(await screen.findByText(epsCropMessage)).toBeTruthy();
    expect(f.services.renderPostscript).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Render pages with Ghostscript' }));
    expect(await screen.findByText('Pages rendered with Ghostscript 10.99.1.')).toBeTruthy();
    expect(screen.getByText(epsCropMessage)).toBeTruthy();
  });
  it('describes and shows source through the text viewer, with no automatic execution in Quick Preview', async () => {
    const f = fixture();
    render(<PostScriptPreview {...f.context} />);
    expect(await screen.findByText('Two squares')).toBeTruthy();
    expect(screen.getByText('144 × 72 pt (50.8 × 25.4 mm)')).toBeTruthy();
    expect(screen.getByText('2001-01-01')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Render pages with Ghostscript' })).toBeTruthy();
    expect(f.services.renderPostscript).not.toHaveBeenCalled();
    const sourceContext = children.text.mock.lastCall![0] as PreviewContext;
    expect(await sourceContext.services.read('source')).toEqual(f.document.source);
    expect(sourceContext.editing).toBeUndefined();
  });
  it('keeps missing comments unknown and labels the EPS picture separately', async () => {
    const f = fixture(
      { kind: 'found' },
      { kind: 'Encapsulated PostScript', metadata: {}, preview: child('bmp'), wmf: true },
    );
    render(<PostScriptPreview {...f.context} />);
    expect(await screen.findByText('Encapsulated PostScript')).toBeTruthy();
    expect(screen.getAllByText('Unknown')).toHaveLength(6);
    expect(
      screen.getByText('Embedded EPS preview; this is the picture saved in the file.'),
    ).toBeTruthy();
    expect(screen.getByText('Embedded WMF preview; this picture is not displayed.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    expect(screen.getByText('Existing text viewer')).toBeTruthy();
  });
  it('opens a PDF-compatible Illustrator file in the existing PDF viewer with its identity line', async () => {
    const f = fixture({ kind: 'found' }, { kind: 'Illustrator', pdf: true });
    render(<PostScriptPreview {...f.context} />);
    expect(await screen.findByText('Illustrator file with a PDF inside.')).toBeTruthy();
    expect(screen.getByText('Existing PDF viewer')).toBeTruthy();
    expect(children.pdf.mock.lastCall![0].printable).toBe(false);
    expect(screen.queryByRole('button', { name: 'Render pages with Ghostscript' })).toBeNull();
    expect(f.services.renderPostscript).not.toHaveBeenCalled();
  });
  it('starts rendering only after the click and labels the resulting PDF and version', async () => {
    const f = fixture();
    render(<PostScriptPreview {...f.context} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Render pages with Ghostscript' }));
    expect(await screen.findByText('Pages rendered with Ghostscript 10.99.1.')).toBeTruthy();
    expect(f.services.renderPostscript).toHaveBeenCalledOnce();
    expect(children.pdf.mock.lastCall![0].resource.id).toBe('child-pdf');
    expect(children.pdf.mock.lastCall![0].printable).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    expect(screen.getByText('Two squares')).toBeTruthy();
    expect(screen.getByText('Existing text viewer')).toBeTruthy();
  });
  it('keeps the described preview after a rendering failure', async () => {
    const f = fixture();
    f.services.renderPostscript.mockRejectedValueOnce(
      new Error('Ghostscript exceeded the rendering time limit.'),
    );
    render(<PostScriptPreview {...f.context} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Render pages with Ghostscript' }));
    expect(await screen.findByText('Ghostscript exceeded the rendering time limit.')).toBeTruthy();
    expect(screen.getByText('Two squares')).toBeTruthy();
    expect(screen.getByText('Existing text viewer')).toBeTruthy();
  });
  it.each([
    [{ kind: 'missing' }, 'Pages can be rendered if Ghostscript is installed.'],
    [{ kind: 'store' }, 'Page rendering is unavailable in the Store edition.'],
    [{ kind: 'failed' }, 'Ghostscript could not be checked.'],
  ] as const)('shows the quiet %s state with no rendering button', async (status, text) => {
    const f = fixture(status);
    render(<PostScriptPreview {...f.context} />);
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Render pages with Ghostscript' })).toBeNull();
    expect(f.services.renderPostscript).not.toHaveBeenCalled();
  });
  it('cancels explicitly and releases a late result without replacing the description', async () => {
    const f = fixture();
    let finish!: (value: Resource) => void;
    f.services.renderPostscript.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<PostScriptPreview {...f.context} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Render pages with Ghostscript' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel rendering' }));
    expect(screen.getByText('PostScript rendering was cancelled.')).toBeTruthy();
    await act(async () => finish(child('pdf')));
    expect(f.services.release).toHaveBeenCalledWith('child-pdf');
    expect(screen.getByText('Two squares')).toBeTruthy();
    expect(screen.queryByText('Existing PDF viewer')).toBeNull();
  });
  it('retains keyboard focus through rendering, cancellation and completion', async () => {
    const f = fixture();
    let finish!: (value: Resource) => void;
    f.services.renderPostscript.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<PostScriptPreview {...f.context} />);
    const button = await screen.findByRole('button', { name: 'Render pages with Ghostscript' });
    button.focus();
    fireEvent.click(button);
    expect(globalThis.document.activeElement).toBe(button);
    expect(button.textContent).toBe('Cancel rendering');
    fireEvent.click(button);
    expect(globalThis.document.activeElement).toBe(button);
    expect(button.textContent).toBe('Render pages with Ghostscript');
    await act(async () => finish(child('pdf')));
    fireEvent.click(button);
    await act(async () => finish(child('pdf')));
    expect(globalThis.document.activeElement).toBe(button);
    expect(button.textContent).toBe('Rendered pages');
  });
  it('cancels on close and releases a late embedded preview', async () => {
    const f = fixture();
    let finish!: (value: PostScriptInspection) => void;
    f.services.inspectPostscript.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const mounted = render(<PostScriptPreview {...f.context} />);
    mounted.unmount();
    await act(async () => finish({ ...f.document, preview: child('png') }));
    expect(f.services.release).toHaveBeenCalledWith('child-png');
    expect(f.services.cancelDocument).toHaveBeenCalled();
  });
  it('shows a malformed file as bytes with one plain sentence', async () => {
    const f = fixture();
    f.services.inspectPostscript.mockRejectedValueOnce(
      new Error('This PostScript file is malformed; its bytes are shown below.'),
    );
    render(<PostScriptPreview {...f.context} />);
    await waitFor(() => expect(screen.getByText('File bytes')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toBe(
      'This PostScript file is malformed; its bytes are shown below.',
    );
    expect(screen.queryByRole('button', { name: 'Render pages with Ghostscript' })).toBeNull();
  });
});
