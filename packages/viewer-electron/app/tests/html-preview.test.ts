// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { EditorView } from '@codemirror/view';
import type { HtmlPreview } from '../src/domain/previews/web';
import type { TextBuffer, TextVersion } from '../src/domain/editing/documents';
import HTMLPreview from '../src/renderer/previews/web/HTMLPreview';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import { editingPlane, routeToEditor } from '../src/renderer/editing/planes';
import { activeWorkspace, addPane, flushState, initialize } from '../src/renderer/state/store';

const original = '<!doctype html><html><body><h1>Saved page</h1></body></html>\n';
let saved: string;
let capability: number;
const capabilityID = (sequence: number) =>
  `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
const buffers = new Map<string, TextBuffer>();
const version = (n: number): TextVersion => ({
  identity: '1:1',
  modified: n,
  size: original.length,
  sha256: String(n).repeat(64),
});
const viewer = {
  save: vi.fn(async () => {}),
  textOpen: vi.fn(async () => ({
    editable: true as const,
    document: { file: '/fixtures/page.html', text: saved, bom: false, version: version(1) },
  })),
  textSave: vi.fn(async (_file: string, text: string): Promise<TextVersion> => {
    saved = text;
    return version(2);
  }),
  textEditEnd: vi.fn(async () => {}),
  textPrompt: vi.fn(async (): Promise<'save' | 'discard' | 'cancel'> => 'cancel'),
  bufferWrite: vi.fn(async (buffer: TextBuffer) => {
    buffers.set(buffer.id, buffer);
  }),
  bufferRead: vi.fn(async (id: string) => buffers.get(id) ?? null),
  bufferDiscard: vi.fn(async (id: string) => {
    buffers.delete(id);
  }),
};
const htmlPreview = vi.fn(async (): Promise<HtmlPreview> => {
  const id = capabilityID(++capability);
  return { id, url: `viewer-html://${id}/page.html` };
});
const htmlPreviewClose = vi.fn(async () => {});
const read = vi.fn(async () => ({ text: saved, truncated: false, binary: false }));
let context: PreviewContext;
let abort: AbortController;
let paneID: string;

beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  Range.prototype.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect }) as DOMRect;
  Range.prototype.getClientRects = () =>
    ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: [][Symbol.iterator],
    }) as DOMRectList;
});

beforeEach(() => {
  saved = original;
  capability = 0;
  buffers.clear();
  for (const method of Object.values(viewer)) method.mockClear();
  viewer.textPrompt.mockReset().mockResolvedValue('cancel');
  htmlPreview.mockReset().mockImplementation(async () => {
    const id = capabilityID(++capability);
    return { id, url: `viewer-html://${id}/page.html` };
  });
  htmlPreviewClose.mockReset().mockResolvedValue(undefined);
  read.mockClear();
  Object.assign(window, { viewer });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
  paneID = addPane('/fixtures/page.html', 'preview', true).id;
  abort = new AbortController();
  context = {
    resource: {
      id: 'resource',
      url: 'viewer-resource://resource',
      entry: {
        path: '/fixtures/page.html',
        parent: '/fixtures',
        name: 'page.html',
        extension: 'html',
        kind: 'file',
        directory: false,
        size: original.length,
        modified: 1,
        created: 1,
        hidden: false,
        mime: 'text/html',
        identity: '1:1',
      },
    },
    signal: abort.signal,
    services: { read, htmlPreview, htmlPreviewClose } as unknown as PreviewContext['services'],
    active: true,
    interactive: true,
    look: 'dark',
    editing: { paneID },
  };
});

afterEach(async () => {
  cleanup();
  await flushState(false);
});

async function frame(container: HTMLElement): Promise<HTMLIFrameElement> {
  await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
  return container.querySelector('iframe')!;
}

async function editor(container: HTMLElement): Promise<EditorView> {
  await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull());
  return EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!;
}

describe('isolated HTML rendering', () => {
  it('uses the private URL in an opaque script-only iframe and closes its capability on unmount', async () => {
    const view = render(createElement(HTMLPreview, context));
    const iframe = await frame(view.container);
    expect(iframe.getAttribute('src')).toBe(`viewer-html://${capabilityID(1)}/page.html`);
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe.getAttribute('srcdoc')).toBeNull();
    expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(iframe.title).toBe('HTML preview of page.html');
    expect(htmlPreview).toHaveBeenCalledWith('resource');
    view.unmount();
    await waitFor(() => expect(htmlPreviewClose).toHaveBeenCalledExactlyOnceWith(capabilityID(1)));
  });

  it.each(['abort', 'unmount'] as const)('releases a grant that arrives after %s', async (end) => {
    let complete!: (preview: HtmlPreview) => void;
    htmlPreview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const view = render(createElement(HTMLPreview, context));
    if (end === 'abort') act(() => abort.abort());
    else view.unmount();
    await act(async () => complete({ id: 'late', url: 'viewer-html://late/page.html' }));
    await waitFor(() => expect(htmlPreviewClose).toHaveBeenCalledExactlyOnceWith('late'));
    expect(view.container.querySelector('iframe')).toBeNull();
  });

  it('revokes a mounted frame on abort and does not close it twice on unmount', async () => {
    const view = render(createElement(HTMLPreview, context));
    await frame(view.container);
    act(() => abort.abort());
    expect(view.container.querySelector('iframe')).toBeNull();
    view.unmount();
    await waitFor(() => expect(htmlPreviewClose).toHaveBeenCalledExactlyOnceWith(capabilityID(1)));
  });

  it('reloads with a fresh frame and capability while source stays mounted', async () => {
    const view = render(createElement(HTMLPreview, context));
    const first = await frame(view.container);
    await waitFor(() => expect(read).toHaveBeenCalledOnce());
    fireEvent.click(view.getByRole('button', { name: 'Reload' }));
    await waitFor(() =>
      expect(view.container.querySelector('iframe')?.getAttribute('src')).toContain(
        capabilityID(2),
      ),
    );
    expect(view.container.querySelector('iframe')).not.toBe(first);
    expect(htmlPreviewClose).toHaveBeenCalledWith(capabilityID(1));
    expect(read).toHaveBeenCalledOnce();
  });

  it('refuses a non-private iframe grant and closes it before offering source', async () => {
    htmlPreview.mockResolvedValueOnce({ id: 'unsafe', url: 'https://example.invalid/page.html' });
    const view = render(createElement(HTMLPreview, context));
    await view.findByText('The HTML preview address is unavailable.');
    expect(view.container.querySelector('iframe')).toBeNull();
    expect(htmlPreviewClose).toHaveBeenCalledExactlyOnceWith('unsafe');
    fireEvent.click(view.getByRole('button', { name: 'View source' }));
    expect(view.getByRole('tab', { name: 'Source' }).getAttribute('aria-selected')).toBe('true');
    expect(view.getByLabelText('File text')).toBeTruthy();
  });

  it('keeps archived HTML readable as source when there is no on-disk file', async () => {
    htmlPreview.mockRejectedValueOnce(new Error('Archived HTML has no local page to render.'));
    const view = render(createElement(HTMLPreview, { ...context, editing: undefined }));
    await view.findByText('Archived HTML has no local page to render.');
    fireEvent.click(view.getByRole('button', { name: 'View source' }));
    await waitFor(() => expect(view.getByLabelText('File text')).toBeTruthy());
    expect(view.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(view.container.querySelector('iframe')).toBeNull();
  });

  it.each([
    { id: capabilityID(1), url: `viewer-html://${capabilityID(2)}/page.html` },
    { id: capabilityID(1), url: `viewer-html://user@${capabilityID(1)}/page.html` },
    { id: capabilityID(1), url: `viewer-html://${capabilityID(1)}:80/page.html` },
  ])('rejects a mismatched or ambiguous page capability: $url', async (preview) => {
    htmlPreview.mockResolvedValueOnce(preview);
    const view = render(createElement(HTMLPreview, context));
    await view.findByText('The HTML preview address is unavailable.');
    expect(view.container.querySelector('iframe')).toBeNull();
    expect(htmlPreviewClose).toHaveBeenCalledExactlyOnceWith(preview.id);
  });
});

describe('HTML source composition', () => {
  it('routes Edit into Source and keeps dirty text, caret and undo history when returning to Preview is cancelled', async () => {
    const view = render(createElement(HTMLPreview, context));
    await frame(view.container);
    await waitFor(() => expect(editingPlane(paneID)?.edit).toBeTypeOf('function'));
    act(() => editingPlane(paneID)!.edit!());
    const cm = await editor(view.container);
    expect(view.getByRole('tab', { name: 'Source' }).getAttribute('aria-selected')).toBe('true');
    act(() =>
      cm.dispatch({ changes: { from: 0, insert: '<!-- unsaved -->\n' }, selection: { anchor: 4 } }),
    );
    await waitFor(() =>
      expect(activeWorkspace().panes.find((pane) => pane.id === paneID)).toHaveProperty('bufferID'),
    );
    const text = cm.state.doc.toString();
    let answer!: (value: 'save' | 'discard' | 'cancel') => void;
    viewer.textPrompt.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    fireEvent.click(view.getByRole('tab', { name: 'Preview' }));
    fireEvent.click(view.getByRole('tab', { name: 'Preview' }));
    await waitFor(() => expect(viewer.textPrompt).toHaveBeenCalledWith('close', 'page.html'));
    expect(viewer.textPrompt).toHaveBeenCalledOnce();
    await act(async () => answer('cancel'));
    expect(view.getByRole('tab', { name: 'Source' }).getAttribute('aria-selected')).toBe('true');
    expect(await editor(view.container)).toBe(cm);
    expect(cm.state.doc.toString()).toBe(text);
    expect(cm.state.selection.main.anchor).toBe(4);
    expect(editingPlane(paneID)!.dirty()).toBe(true);
    act(() => routeToEditor('undo-file', paneID));
    expect(cm.state.doc.toString()).toBe(original);
    act(() => routeToEditor('redo-file', paneID));
    expect(cm.state.doc.toString()).toBe(text);
  });

  it('uses the existing checked Save flow before returning to a refreshed rendered page', async () => {
    const view = render(createElement(HTMLPreview, context));
    await frame(view.container);
    await waitFor(() => expect(editingPlane(paneID)?.edit).toBeTypeOf('function'));
    act(() => editingPlane(paneID)!.edit!());
    const cm = await editor(view.container);
    act(() => cm.dispatch({ changes: { from: 0, insert: '<!-- saved -->\n' } }));
    viewer.textPrompt.mockResolvedValueOnce('save');
    fireEvent.click(view.getByRole('tab', { name: 'Preview' }));
    await waitFor(() =>
      expect(view.getByRole('tab', { name: 'Preview' }).getAttribute('aria-selected')).toBe('true'),
    );
    await waitFor(() =>
      expect(view.container.querySelector('iframe')?.getAttribute('src')).toContain(
        capabilityID(2),
      ),
    );
    expect(viewer.textSave).toHaveBeenCalledWith(
      '/fixtures/page.html',
      '<!-- saved -->\n' + original,
      version(1),
      expect.any(String),
      false,
    );
    expect(htmlPreviewClose).toHaveBeenCalledWith(capabilityID(1));
    expect(view.container.querySelector('.cm-editor')).toBeNull();
  });

  it('supports arrow and home keys on the tabs without remounting source', async () => {
    const view = render(createElement(HTMLPreview, context));
    await frame(view.container);
    const preview = view.getByRole('tab', { name: 'Preview' });
    const source = view.getByRole('tab', { name: 'Source' });
    fireEvent.keyDown(preview, { key: 'ArrowRight' });
    await waitFor(() => expect(source.getAttribute('aria-selected')).toBe('true'));
    expect(document.activeElement).toBe(source);
    fireEvent.keyDown(source, { key: 'Home' });
    await waitFor(() => expect(preview.getAttribute('aria-selected')).toBe('true'));
    expect(document.activeElement).toBe(preview);
    expect(read).toHaveBeenCalledOnce();
  });
});
