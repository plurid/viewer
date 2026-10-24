// @vitest-environment jsdom
/**
 * EDITING TEXT IN PLANES (2026-10-23): a previewed file edited where it is, its unsaved edits kept
 * and restored, saves checked against the version read, Edit menu commands routed to the editor,
 * and a scratch plane saved as a file in place.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { EditorView } from '@codemirror/view';
import type { SavedState } from '../src/domain/contracts';
import {
  textChangedCode,
  type TextBuffer,
  type TextVersion,
} from '../src/domain/editing/documents';
import { stateSchema } from '../src/desktop/persistence/storage';
import {
  activeWorkspace,
  addPane,
  addScratchPane,
  flushState,
  getState,
  initialize,
  receiveSettings,
  setActivePane,
  updatePane,
} from '../src/renderer/state/store';
import { FileEditor } from '../src/renderer/editing/FileEditor';
import ScratchPlane from '../src/renderer/editing/ScratchPlane';
import { editingPlane, routeToEditor } from '../src/renderer/editing/planes';

beforeAll(() => {
  // CodeMirror measures text through ranges, which jsdom does not lay out
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  Range.prototype.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect }) as DOMRect;
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as DOMRectList;
});
const version = (n: number): TextVersion => ({
  identity: '1:1',
  modified: n,
  size: 4,
  sha256: String(n).repeat(64),
});
const kept = new Map<string, TextBuffer>();
const viewer = {
  save: vi.fn(async (state: SavedState) => {
    stateSchema.parse(state);
  }),
  textOpen: vi.fn(async () => ({
    editable: true as const,
    document: { file: '/fixtures/notes.md', text: 'one\n', bom: false, version: version(1) },
  })),
  textSave: vi.fn(async (): Promise<TextVersion> => version(2)),
  textSaveAs: vi.fn(async () => ({ file: '/fixtures/Desktop/Untitled 1.py', version: version(3) })),
  textEditEnd: vi.fn(async () => {}),
  textPrompt: vi.fn(async (): Promise<'save' | 'discard' | 'cancel'> => 'cancel'),
  bufferWrite: vi.fn(async (buffer: TextBuffer) => {
    kept.set(buffer.id, buffer);
  }),
  bufferRead: vi.fn(async (id: string) => kept.get(id) ?? null),
  bufferDiscard: vi.fn(async (id: string) => {
    kept.delete(id);
  }),
};
beforeEach(() => {
  kept.clear();
  for (const method of Object.values(viewer)) method.mockClear();
  (window as unknown as { viewer: typeof viewer }).viewer = viewer;
  initialize({ home: '/fixtures', platform: 'darwin', locations: [], state: null, openPaths: [] });
});
afterEach(async () => {
  cleanup();
  await flushState(false);
});
async function editor(container: HTMLElement): Promise<EditorView> {
  await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull());
  return EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!;
}
const type = (view: EditorView, text: string) =>
  act(() => {
    view.dispatch({ changes: { from: 0, insert: text } });
  });
const pane = (id: string) => activeWorkspace().panes.find((item) => item.id === id);

describe('editing a previewed file', () => {
  it('keeps its unsaved edits as they are typed, and a save checks the version read', async () => {
    const { id } = addPane('/fixtures/notes.md', 'preview', true);
    const view = render(
      createElement(FileEditor, { resourceID: 'resource', paneID: id, onClose: vi.fn() }),
    );
    const cm = await editor(view.container);
    await type(cm, 'zero ');
    await waitFor(() => expect(pane(id)).toHaveProperty('bufferID'));
    expect(await editingPlane(id)!.save!()).toBe(true);
    expect(viewer.textSave).toHaveBeenCalledWith(
      '/fixtures/notes.md',
      'zero one\n',
      version(1),
      expect.any(String),
      false,
    );
    await waitFor(() => expect(pane(id)).not.toHaveProperty('bufferID', expect.anything()));
    // the next save is checked against what this one wrote
    await type(cm, 'again ');
    await editingPlane(id)!.save!();
    expect(viewer.textSave).toHaveBeenLastCalledWith(
      '/fixtures/notes.md',
      'again zero one\n',
      version(2),
      expect.any(String),
      false,
    );
  });
  it('offers Save only while something is unsaved, and Save As and Revert in the ⋯ menu', async () => {
    const { id } = addPane('/fixtures/notes.md', 'preview', true);
    const view = render(
      createElement(FileEditor, { resourceID: 'resource', paneID: id, onClose: vi.fn() }),
    );
    const cm = await editor(view.container);
    expect(view.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(view.getByRole('button', { name: 'Done' })).toBeTruthy();
    expect(view.queryByRole('button', { name: /Save As|Revert/ })).toBeNull();
    await type(cm, 'more ');
    await waitFor(() => expect(view.getByRole('button', { name: 'Save' })).toBeTruthy());
    // the plane's commands still carry them
    expect(editingPlane(id)?.saveAs).toBeTypeOf('function');
    expect(editingPlane(id)?.revert).toBeTypeOf('function');
  });
  it('asks before saving over a file changed on disk, then moves that version aside', async () => {
    const { id } = addPane('/fixtures/notes.md', 'preview', true);
    const view = render(
      createElement(FileEditor, { resourceID: 'resource', paneID: id, onClose: vi.fn() }),
    );
    await type(await editor(view.container), 'mine ');
    viewer.textSave.mockRejectedValueOnce(
      Object.assign(new Error('changed'), { code: textChangedCode }),
    );
    expect(await editingPlane(id)!.save!()).toBe(false);
    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('changed on disk'));
    viewer.textOpen.mockResolvedValueOnce({
      editable: true,
      document: { file: '/fixtures/notes.md', text: 'theirs\n', bom: false, version: version(5) },
    });
    fireEvent.click(view.getByText('Save Over It'));
    await waitFor(() =>
      expect(viewer.textSave).toHaveBeenLastCalledWith(
        '/fixtures/notes.md',
        'mine one\n',
        version(5),
        expect.any(String),
        false,
      ),
    );
  });
  it('comes back with its unsaved edits, and says when the file changed since', async () => {
    const { id } = addPane('/fixtures/notes.md', 'preview', true);
    const bufferID = '0b6f3a52-0a8e-4c7e-8d0f-58f3f3b7f1c2';
    kept.set(bufferID, {
      id: bufferID,
      kind: 'file',
      file: '/fixtures/notes.md',
      base: version(0),
      text: 'kept edits\n',
      revision: 1,
      updated: 1,
    });
    updatePane(id, { bufferID });
    const view = render(
      createElement(FileEditor, { resourceID: 'resource', paneID: id, bufferID, onClose: vi.fn() }),
    );
    const cm = await editor(view.container);
    expect(cm.state.doc.toString()).toBe('kept edits\n');
    expect(view.getByRole('alert').textContent).toContain('after these unsaved edits');
    expect(editingPlane(id)!.dirty()).toBe(true);
  });
  it('shows a version saved in another app, unless it holds unsaved edits', async () => {
    const { id } = addPane('/fixtures/notes.md', 'preview', true);
    const view = render(
      createElement(FileEditor, { resourceID: 'resource', paneID: id, onClose: vi.fn() }),
    );
    let cm = await editor(view.container);
    const opened = (text: string, n: number) =>
      viewer.textOpen.mockResolvedValueOnce({
        editable: true,
        document: { file: '/fixtures/notes.md', text, bom: false, version: version(n) },
      });
    // the version it read: nothing to do
    opened('one\n', 1);
    await act(async () => editingPlane(id)!.changedOnDisk!());
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
    opened('from vscode\n', 7);
    await act(async () => editingPlane(id)!.changedOnDisk!());
    await waitFor(async () => {
      cm = await editor(view.container);
      expect(cm.state.doc.toString()).toBe('from vscode\n');
    });
    // the next save is checked against the version shown
    await type(cm, 'mine ');
    await editingPlane(id)!.save!();
    expect(viewer.textSave).toHaveBeenLastCalledWith(
      '/fixtures/notes.md',
      'mine from vscode\n',
      version(7),
      expect.any(String),
      false,
    );
    await type(cm, 'unsaved ');
    opened('again from vscode\n', 8);
    await act(async () => editingPlane(id)!.changedOnDisk!());
    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('changed on disk'));
    expect(cm.state.doc.toString()).toBe('unsaved mine from vscode\n');
  });
  it('takes the Edit menu Undo while the plane is active, rather than the file operation', async () => {
    const { id } = addPane('/fixtures/notes.md', 'preview', true);
    const view = render(
      createElement(FileEditor, { resourceID: 'resource', paneID: id, onClose: vi.fn() }),
    );
    const cm = await editor(view.container);
    await type(cm, 'typed ');
    expect(routeToEditor('undo-file', id)).toBe(true);
    expect(cm.state.doc.toString()).toBe('one\n');
    expect(routeToEditor('redo-file', id)).toBe(true);
    expect(cm.state.doc.toString()).toBe('typed one\n');
    // the focused editor takes it whichever plane is active; unfocused, another plane's is the file's
    cm.focus();
    expect(routeToEditor('select-all', 'another plane')).toBe(true);
    expect(cm.state.selection.main.to - cm.state.selection.main.from).toBe(cm.state.doc.length);
    cm.contentDOM.blur();
    expect(routeToEditor('undo-file', 'another plane')).toBe(false);
    expect(routeToEditor('select-all', id)).toBe(false);
  });
  it('shows why a file cannot be edited, offering the folder to allow', async () => {
    const { id } = addPane('/fixtures/notes.md', 'preview', true);
    viewer.textOpen.mockResolvedValueOnce({
      editable: false,
      reason: 'Allow access to its folder to save edits beside it.',
      folder: '/fixtures',
    } as never);
    const view = render(
      createElement(FileEditor, { resourceID: 'resource', paneID: id, onClose: vi.fn() }),
    );
    await waitFor(() => expect(view.getByText(/Allow access to its folder/)).toBeTruthy());
  });
});

describe('the editor settings (2026-10-23)', () => {
  const configure = (
    editor: Partial<ReturnType<typeof getState>['settings']['settings']['editor']>,
  ) => {
    const snapshot = structuredClone(getState().settings);
    snapshot.revision++;
    snapshot.settings.editor = { ...snapshot.settings.editor, ...editor };
    receiveSettings(snapshot);
  };
  it('sets the font, size, line height, tabs and gutter, by default as VS Code', async () => {
    const { id } = addPane('/fixtures/notes.md', 'preview', true);
    const view = render(
      createElement(FileEditor, { resourceID: 'resource', paneID: id, onClose: vi.fn() }),
    );
    const cm = await editor(view.container);
    const host = view.container.querySelector<HTMLElement>('.text-editor')!;
    expect(host.style.getPropertyValue('--editor-font-size')).toBe('18px');
    expect(host.style.getPropertyValue('--editor-line-height')).toBe('40px');
    expect(host.style.getPropertyValue('--editor-font')).toBe('"Menlo"');
    expect(cm.state.tabSize).toBe(4);
    expect(view.container.querySelector('.cm-lineNumbers')).not.toBeNull();
    await act(async () =>
      configure({ fontSize: 14, lineNumbers: false, wordWrap: true, tabSize: 2 }),
    );
    await waitFor(() => expect(host.style.getPropertyValue('--editor-font-size')).toBe('14px'));
    expect(view.container.querySelector('.cm-lineNumbers')).toBeNull();
    expect(cm.contentDOM.classList.contains('cm-lineWrapping')).toBe(true);
    expect(cm.state.tabSize).toBe(2);
  });
  it('trims trailing whitespace on save, in the editor too, when set', async () => {
    const { id } = addPane('/fixtures/notes.md', 'preview', true);
    const view = render(
      createElement(FileEditor, { resourceID: 'resource', paneID: id, onClose: vi.fn() }),
    );
    const cm = await editor(view.container);
    await type(cm, 'trail  \t\n');
    await editingPlane(id)!.save!();
    expect(viewer.textSave).toHaveBeenLastCalledWith(
      '/fixtures/notes.md',
      'trail\none\n',
      version(1),
      expect.any(String),
      false,
    );
    expect(cm.state.doc.toString()).toBe('trail\none\n');
    await act(async () => configure({ trimTrailingWhitespace: false }));
    await type(cm, 'kept  \n');
    await editingPlane(id)!.save!();
    expect(viewer.textSave).toHaveBeenLastCalledWith(
      '/fixtures/notes.md',
      'kept  \ntrail\none\n',
      version(2),
      expect.any(String),
      false,
    );
  });
  it("keeps a CRLF file's line breaks when trimming", async () => {
    const { trimTrailingWhitespace } = await import('../src/domain/editing/documents');
    expect(trimTrailingWhitespace('a  \r\nb \t\nc')).toBe('a\r\nb\nc');
  });
});

describe('a scratch plane', () => {
  it('takes the focus once it is shown, when it is the active plane', async () => {
    // a new plane is framed after it mounts: focusing it while hidden left the keys in another editor
    const scratch = addScratchPane();
    setActivePane(scratch.id);
    const view = render(createElement(ScratchPlane, { pane: scratch, visible: false }));
    const cm = await editor(view.container);
    expect(cm.hasFocus).toBe(false);
    view.rerender(createElement(ScratchPlane, { pane: scratch, visible: true }));
    await waitFor(() => expect(cm.hasFocus).toBe(true));
  });
  it('leaves the focus alone when it is not the active plane, as at launch', async () => {
    const scratch = addScratchPane();
    setActivePane(addPane('/fixtures/notes.md', 'preview', true).id);
    const view = render(createElement(ScratchPlane, { pane: scratch, visible: true }));
    const cm = await editor(view.container);
    expect(cm.hasFocus).toBe(false);
  });
  it('keeps its text as it is typed, and becomes the file Save As writes, in place', async () => {
    const scratch = addScratchPane({ language: 'python' });
    const view = render(createElement(ScratchPlane, { pane: scratch, visible: true }));
    const cm = await editor(view.container);
    await type(cm, 'print(1)\n');
    await waitFor(() => expect(kept.get(scratch.bufferID)?.text).toBe('print(1)\n'), {
      timeout: 3000,
    });
    expect(kept.get(scratch.bufferID)).toMatchObject({ kind: 'scratch', language: 'python' });
    expect(await editingPlane(scratch.id)!.saveAs!()).toBe(true);
    expect(viewer.textSaveAs).toHaveBeenCalledWith(
      'print(1)\n',
      'Untitled 1.py',
      expect.any(String),
    );
    expect(pane(scratch.id)).toEqual({
      id: scratch.id,
      type: 'preview',
      path: '/fixtures/Desktop/Untitled 1.py',
    });
    expect(kept.has(scratch.bufferID)).toBe(false);
  });
});
