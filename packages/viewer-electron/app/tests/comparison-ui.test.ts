// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import type { DiffPane as DiffRecord, Resource } from '../src/domain/contracts';
import DiffPlane from '../src/renderer/diff/DiffPlane';
import {
  activeWorkspace,
  initialize,
  receiveFileChanges,
  useViewer,
} from '../src/renderer/state/store';
import { changeWorkspace } from '../src/renderer/state/core';
import { resetPersistence } from '../src/renderer/state/persistence';
import { resetPreferences } from '../src/renderer/state/preferences';

const pane: DiffRecord = {
  id: 'comparison',
  type: 'diff',
  path: '/fixtures/right.txt',
  left: { kind: 'file', path: '/fixtures/left.txt' },
  right: { kind: 'file', path: '/fixtures/right.txt' },
};
const resource = (file: string) =>
  ({
    id: file,
    url: `viewer-resource://test/asset/${file.split('/').at(-1)}`,
    entry: { path: file, name: file.split('/').at(-1), mime: 'text/plain' },
  }) as Resource;
const version = { identity: '1:1', modified: 1, size: 8, sha256: '1'.repeat(64) };
const viewer = {
  save: vi.fn(async () => {}),
  resource: vi.fn(async (file: string) => resource(file)),
  read: vi.fn(async (id: string) => ({
    text: id.endsWith('left.txt') ? 'Original\n' : 'Changed\n',
    binary: false,
    truncated: false,
  })),
  watch: vi.fn(async () => {}),
  unwatch: vi.fn(async () => {}),
  release: vi.fn(async () => {}),
  onEvent: vi.fn(() => () => {}),
  textOpen: vi.fn(async () => ({
    editable: true as boolean,
    reason: 'The file is read-only.',
    document: { file: pane.path, text: 'Changed\n', bom: false, version },
  })),
  textEditEnd: vi.fn(async () => {}),
  bufferRead: vi.fn(async () => null),
  bufferWrite: vi.fn(async () => {}),
  bufferDiscard: vi.fn(async () => {}),
};

beforeAll(() => {
  const rect = new DOMRect();
  Range.prototype.getBoundingClientRect = () => rect;
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as DOMRectList;
});
beforeEach(() => {
  vi.clearAllMocks();
  viewer.resource.mockImplementation(async (file) => resource(file));
  viewer.textOpen.mockImplementation(async () => ({
    editable: true,
    reason: 'The file is read-only.',
    document: { file: pane.path, text: 'Changed\n', bom: false, version },
  }));
  Object.assign(window, { viewer });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
  changeWorkspace((space) => ({ ...space, panes: [pane], roots: [pane.id] }));
});
afterEach(() => {
  cleanup();
  resetPersistence();
  resetPreferences();
});

function Scene() {
  const current = useViewer((state) => activeWorkspace(state).panes[0] as DiffRecord);
  return createElement(DiffPlane, { pane: current });
}

describe('comparison resource and editor lifetime', () => {
  it('unwinds a successful resource and watcher when the other source fails', async () => {
    viewer.resource.mockImplementation(async (file) => {
      if (file.endsWith('right.txt')) throw new Error('Right source missing');
      return resource(file);
    });
    render(createElement(Scene));
    await screen.findByText('Right source missing');
    await waitFor(() => expect(viewer.release).toHaveBeenCalledWith('/fixtures/left.txt'));
    expect(viewer.unwatch).toHaveBeenCalledTimes(1);
  });

  it('releases a late acquisition after the other side has already failed', async () => {
    let finish!: (value: Resource) => void;
    viewer.resource.mockImplementation(async (file) => {
      if (file.endsWith('right.txt')) throw new Error('Right source missing');
      return new Promise<Resource>((resolve) => {
        finish = resolve;
      });
    });
    const view = render(createElement(Scene));
    await screen.findByText('Right source missing');
    expect(viewer.release).not.toHaveBeenCalled();
    await act(async () => finish(resource('/fixtures/left.txt')));
    expect(viewer.release).toHaveBeenCalledExactlyOnceWith('/fixtures/left.txt');
    view.unmount();
    expect(viewer.release).toHaveBeenCalledTimes(1);
  });

  it('unwatches a late watch acknowledgement after the comparison closes', async () => {
    let acknowledge!: () => void;
    viewer.watch.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          acknowledge = resolve;
        }),
    );
    const view = render(createElement(Scene));
    await waitFor(() => expect(view.container.querySelectorAll('.cm-editor')).toHaveLength(2));
    view.unmount();
    expect(viewer.unwatch).not.toHaveBeenCalled();
    await act(async () => acknowledge());
    expect(viewer.unwatch).toHaveBeenCalledTimes(1);
    expect(viewer.release).toHaveBeenCalledTimes(2);
  });

  it('shows a readable comparison immediately when the right file cannot be edited', async () => {
    viewer.textOpen.mockResolvedValueOnce({
      editable: false,
      reason: 'The file is read-only.',
      document: { file: pane.path, text: 'Changed\n', bom: false, version },
    });
    const view = render(createElement(Scene));
    await waitFor(() => expect(view.container.querySelector('.cm-mergeView')).not.toBeNull());
    expect(view.container.textContent).toContain('Original');
    expect(view.container.textContent).toContain('Changed');
    expect(view.container.textContent).not.toContain('This file is not edited here');
  });

  it('retains text, selection and undo through an unrelated rename without reopening sources', async () => {
    const view = render(createElement(Scene));
    await waitFor(() => expect(view.container.querySelectorAll('.cm-editor')).toHaveLength(2));
    const editor = EditorView.findFromDOM(
      view.container.querySelectorAll<HTMLElement>('.cm-editor')[1]!,
    )!;
    act(() => editor.dispatch({ changes: { from: 0, insert: 'Kept ' }, selection: { anchor: 5 } }));
    const acquisitions = viewer.resource.mock.calls.length;
    act(() =>
      receiveFileChanges([{ source: '/unrelated/a.txt', destination: '/unrelated/b.txt' }]),
    );
    await act(async () => {});
    const current = EditorView.findFromDOM(
      view.container.querySelectorAll<HTMLElement>('.cm-editor')[1]!,
    )!;
    expect(current).toBe(editor);
    expect(current.state.sliceDoc()).toBe('Kept Changed\n');
    expect(current.state.selection.main.head).toBe(5);
    expect(viewer.resource).toHaveBeenCalledTimes(acquisitions);
    act(() => expect(undo(current)).toBe(true));
    expect(current.state.sliceDoc()).toBe('Changed\n');
  });
});
