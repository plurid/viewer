// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import type { FileEntry, DesktopEvent } from '../src/domain/contracts';
import { useFolder } from '../src/renderer/explorer/useFolder';
import { useContextPublish } from '../src/renderer/explorer/context-publish';
import { WorkspaceContext, type WorkspaceController } from '../src/renderer/workspace/context';
import { initialize, receiveJob, setOperationsOpen } from '../src/renderer/state/store';
import type { OperationJob } from '../src/domain/contracts';
import { OperationsPanel } from '../src/renderer/operations/OperationsPanel';
import { DuplicateControls } from '../src/renderer/ui/comparison/Duplicates';
import { TrashContents, groupSelection } from '../src/renderer/explorer/FileDialogs';
import type { CommandContext } from '../src/renderer/commands/registry';
import { Thumbnail } from '../src/renderer/explorer/views';
import { rememberDrag, useFileDrop } from '../src/renderer/explorer/file-drop';
import { recordScroll, useScrollRestore } from '../src/renderer/explorer/scroll-restore';
import { browseSession } from '../src/renderer/workspace/sessions';

let listeners: ((event: DesktopEvent) => void)[];
let identity: string;
const viewer = {
  list: vi.fn(async (path: string) => ({ path, entries: [] as FileEntry[] })),
  watch: vi.fn(async () => {}),
  unwatch: vi.fn(async () => {}),
  stat: vi.fn(async (path: string) => ({ path, identity }) as FileEntry),
  contextPublish: vi.fn(async () => {}),
  folderSizeStart: vi.fn(async (paths: string[]) => ({
    id: 'size',
    paths,
    status: 'completed' as const,
    bytes: 2048,
    files: 12,
    folders: 3,
    skipped: 0,
  })),
  folderSizeCancel: vi.fn(async () => {}),
  operate: vi.fn(async (): Promise<string> => 'job'),
  duplicates: vi.fn(async () => ({
    id: 'search',
    roots: ['/Photos'],
    scanned: 3,
    coverage: 'complete' as const,
    errors: [],
    created: 0,
    groups: [
      {
        hash: 'a'.repeat(64),
        size: 2048,
        files: [
          { path: '/Photos/one.jpg', name: 'one.jpg', modified: 1, identity: '1:1', size: 2048 },
          { path: '/Photos/two.jpg', name: 'two.jpg', modified: 2, identity: '1:2', size: 2048 },
        ],
      },
    ],
  })),
  onEvent: (listener: (event: DesktopEvent) => void) => {
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((item) => item !== listener);
    };
  },
};
const emit = (event: DesktopEvent) => listeners.forEach((listener) => listener(event));
// jsdom has no modal dialogs; opening one only needs the `open` attribute here.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
};
beforeEach(() => {
  listeners = [];
  identity = '1:100';
  vi.useFakeTimers();
  Object.assign(window, { viewer });
  for (const mock of Object.values(viewer)) if (vi.isMockFunction(mock)) mock.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function settle() {
  await act(async () => {
    await vi.runAllTimersAsync();
  });
}

describe('shared folder listings', () => {
  it('re-lists after an ancestor change only when the folder itself moved or was replaced', async () => {
    const folder = '/Users/fixture/Documents/Project';
    renderHook(() => useFolder(folder));
    await settle();
    expect(viewer.list).toHaveBeenCalledTimes(1);
    // A write elsewhere in Home (a .DS_Store or shell history) changes nothing here.
    emit({ type: 'folder-changed', path: '/Users/fixture' });
    await settle();
    expect(viewer.list).toHaveBeenCalledTimes(1);
    // The folder was replaced by another one at the same path.
    identity = '1:200';
    emit({ type: 'folder-changed', path: '/Users/fixture/Documents' });
    await settle();
    expect(viewer.list).toHaveBeenCalledTimes(2);
    // Its own change always re-lists.
    emit({ type: 'folder-changed', path: folder });
    await settle();
    expect(viewer.list).toHaveBeenCalledTimes(3);
  });
});

describe('published selection context', () => {
  const workspace = { rootID: () => 'root' } as unknown as WorkspaceController;
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(WorkspaceContext.Provider, { value: workspace }, children);
  it('describes no sources rather than a partial list for very large selections', async () => {
    initialize({ home: '/', platform: 'darwin', locations: [], state: null, openPaths: [] });
    const small = [{ path: '/a' }, { path: '/b' }];
    const { rerender } = renderHook(({ selected }) => useContextPublish('pane', true, selected), {
      wrapper,
      initialProps: { selected: small },
    });
    expect(viewer.contextPublish).toHaveBeenLastCalledWith(
      expect.objectContaining({ sources: ['/a', '/b'] }),
    );
    const large = Array.from({ length: 2500 }, (_, index) => ({ path: `/f${index}` }));
    rerender({ selected: large });
    expect(viewer.contextPublish).toHaveBeenLastCalledWith(
      expect.objectContaining({ sources: [] }),
    );
  });
});

describe('Trash confirmation', () => {
  it('shows the full contents of selected folders before confirming', async () => {
    initialize({ home: '/', platform: 'darwin', locations: [], state: null, openPaths: [] });
    const context = {
      selection: [{ path: '/Users/fixture/Drafts', name: 'Drafts', directory: true }],
    } as unknown as CommandContext;
    const view = render(createElement(TrashContents, { context }));
    await settle();
    expect(viewer.folderSizeStart).toHaveBeenCalledWith(['/Users/fixture/Drafts']);
    expect(view.container.textContent).toContain('12 files in 3 folders');
  });
});

describe('new folder with selection', () => {
  it('moves the chosen items into the folder that was actually created', async () => {
    vi.useRealTimers();
    initialize({ home: '/', platform: 'darwin', locations: [], state: null, openPaths: [] });
    const created = {
      id: 'mkdir-job',
      revision: 1,
      kind: 'mkdir',
      status: 'completed',
      sources: [],
      destination: '/Work',
      bytesDone: 0,
      bytesTotal: 0,
      itemsDone: 1,
      itemsTotal: 1,
      completed: [{ source: '', destination: '/Work/Items copy' }],
      errors: [],
      errorCount: 0,
      undoable: true,
    } as OperationJob;
    viewer.operate.mockImplementationOnce(async () => {
      setTimeout(() => receiveJob(created));
      return 'mkdir-job';
    });
    const file = {
      path: '/Work/a.txt',
      name: 'a.txt',
      parent: '/Work',
      identity: '1:5',
      modified: 3,
      size: 4,
    };
    await groupSelection(
      { directory: '/Work', selection: [file] } as unknown as CommandContext,
      'Items',
    );
    expect(viewer.operate).toHaveBeenLastCalledWith({
      kind: 'move',
      sources: ['/Work/a.txt'],
      destination: '/Work/Items copy',
      expectedSources: [
        { path: '/Work/a.txt', version: { identity: '1:5', modified: 3, size: 4 } },
      ],
    });
  });
});

describe('duplicate finder dialog', () => {
  it('chooses nothing at first and never lets every copy of a file be chosen', async () => {
    vi.useRealTimers();
    render(createElement(DuplicateControls));
    act(() => {
      window.dispatchEvent(new CustomEvent('viewer:duplicates', { detail: ['/Photos'] }));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Find duplicates', { selector: 'button' }));
    });
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((box) => box.checked)).toEqual([false, false]);
    fireEvent.click(boxes[0]);
    expect(boxes[0].checked).toBe(true);
    expect(boxes[1].disabled).toBe(true);
    fireEvent.click(boxes[1]);
    expect(boxes[1].checked).toBe(false);
  });
});

describe('collision prompt', () => {
  it('says why Replace is unavailable, as the desktop decides it', () => {
    vi.useRealTimers();
    initialize({ home: '/', platform: 'darwin', locations: [], state: null, openPaths: [] });
    const collided = (id: string, kind: OperationJob['kind']) =>
      ({
        id,
        revision: 1,
        kind,
        status: 'collision',
        sources: ['/Work/Folder'],
        destination: '/Work/Inside',
        bytesDone: 0,
        bytesTotal: 0,
        itemsDone: 0,
        itemsTotal: 1,
        completed: [],
        errors: [],
        errorCount: 0,
        undoable: false,
        collision: {
          source: '/Work/Folder',
          destination: '/Work/Inside/Folder',
          replaceable: false,
        },
      }) as OperationJob;
    act(() => {
      receiveJob(collided('new-folder', 'mkdir'));
      receiveJob(collided('move-into-itself', 'move'));
      setOperationsOpen(true);
    });
    render(createElement(OperationsPanel));
    expect(screen.getByText('A new item cannot replace an existing one.')).toBeTruthy();
    expect(
      screen.getByText('The existing item contains the source, so it cannot be replaced.'),
    ).toBeTruthy();
    expect(screen.queryByText(/is a folder/)).toBeNull();
    expect(screen.queryByText('Replace')).toBeNull();
  });
});
describe('thumbnails (2026-10-20)', () => {
  it('asks the desktop only for files under the byte limit it applies itself', () => {
    // The renderer allowed 64 MiB, the desktop 64,000,000 bytes: one wasted request per file between.
    initialize({ home: '/', platform: 'darwin', locations: [], state: null, openPaths: [] });
    const thumbnail = vi.fn(async () => '');
    Object.assign(window, { viewer: { ...viewer, thumbnail } });
    const png = (size: number) =>
      ({
        path: `/Photos/${size}.png`,
        name: `${size}.png`,
        parent: '/Photos',
        extension: 'png',
        kind: 'file',
        directory: false,
        size,
        modified: 1,
        created: 1,
        hidden: false,
        mime: 'image/png',
        identity: `1:${size}`,
      }) as FileEntry;
    render(createElement(Thumbnail, { entry: png(65_000_000) }));
    expect(thumbnail).not.toHaveBeenCalled();
    render(createElement(Thumbnail, { entry: png(63_000_000) }));
    expect(thumbnail).toHaveBeenCalledOnce();
  });
});
describe('drop effect of a drag Viewer started (2026-10-20)', () => {
  it('shows the move a same-device drop performs, and the copy another device gets', async () => {
    // Native drags carry no Viewer data, so every drag showed the copy cursor though a drop on the
    // same volume moves.
    vi.useRealTimers();
    const stat = vi.fn(
      async (path: string) =>
        ({ path, identity: path.startsWith('/Volumes/Other') ? '9:1' : '5:1' }) as FileEntry,
    );
    Object.assign(window, { viewer: { ...viewer, stat } });
    const { result } = renderHook(() => useFileDrop(() => '/Work'));
    const over = (destination: string) => {
      const root = document.createElement('div');
      const folder = document.createElement('div');
      folder.dataset.directoryPath = destination;
      root.append(folder);
      document.body.append(root);
      const event = {
        dataTransfer: { types: ['Files'], dropEffect: 'none' },
        currentTarget: root,
        target: folder,
        altKey: false,
        metaKey: false,
        clientX: 1,
        clientY: 1,
        preventDefault: () => {},
        stopPropagation: () => {},
      };
      result.current.onDragOver(event as never);
      root.remove();
      return event.dataTransfer.dropEffect;
    };
    rememberDrag([{ path: '/Work/a.txt', identity: '5:100' } as FileEntry]);
    over('/Work/Inside');
    await vi.waitFor(() => expect(stat).toHaveBeenCalledWith('/Work/Inside'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(over('/Work/Inside')).toBe('move');
    over('/Volumes/Other/Folder');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(over('/Volumes/Other/Folder')).toBe('copy');
  });
});
describe('scroll memory (2026-10-20)', () => {
  // One value was shared by every view mode, restored into the first column whichever column was
  // scrolled, and Back or Forward to a cached folder restored nothing.
  const scrolled = (top: number, column?: string) => {
    const element = document.createElement('div');
    element.className = 'file-scroll';
    Object.defineProperty(element, 'scrollTop', { value: top, writable: true });
    if (!column) return element;
    const holder = document.createElement('div');
    holder.dataset.folderPath = column;
    holder.append(element);
    return element;
  };
  const surface = (...children: HTMLElement[]) => {
    const element = document.createElement('div');
    for (const child of children) element.append(child.parentElement ?? child);
    return { current: element };
  };
  it('keeps each mode’s own offset', () => {
    const session = browseSession('scroll-modes', '/Work');
    recordScroll(session, 'list', scrolled(900));
    const grid = scrolled(0);
    const view = renderHook(({ mode }) => useScrollRestore(surface(grid), session, mode, true), {
      initialProps: { mode: 'grid' as const },
    });
    expect(grid.scrollTop).toBe(0);
    const list = scrolled(0);
    view.unmount();
    renderHook(() => useScrollRestore(surface(list), session, 'list', true));
    expect(list.scrollTop).toBe(900);
  });
  it('restores each column’s own offset', () => {
    const session = browseSession('scroll-columns', '/Work');
    recordScroll(session, 'columns', scrolled(400, '/Work/B'));
    const first = scrolled(0, '/Work'),
      second = scrolled(0, '/Work/B');
    renderHook(() => useScrollRestore(surface(first, second), session, 'columns', true));
    expect(first.scrollTop).toBe(0);
    expect(second.scrollTop).toBe(400);
  });
  it('restores a folder’s offset on Back and Forward, as when it loads', () => {
    const a = browseSession('scroll-history', '/A');
    recordScroll(a, 'list', scrolled(800));
    const b = browseSession('scroll-history', '/B');
    const element = scrolled(0);
    const view = renderHook(
      ({ session }) => useScrollRestore(surface(element), session, 'list', true),
      {
        initialProps: { session: b },
      },
    );
    expect(element.scrollTop).toBe(0);
    view.rerender({ session: browseSession('scroll-history', '/A') });
    expect(element.scrollTop).toBe(800);
  });
});
