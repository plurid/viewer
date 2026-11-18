// @vitest-environment jsdom
/**
 * QUICK PREVIEW FOLLOWS THE SELECTION, as Finder's Quick Look does: the arrows move the plane's
 * selection as its own view would, from the file shown, and it shows what is selected now, a
 * folder by name. With several selected, Left and Right step through them. A focused preview that
 * scrolls with the arrows keeps them; with the plane closed, they step through what it shows.
 */
import { useMemo } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FileEntry } from '../src/domain/contracts';
import { QuickPreview } from '../src/renderer/previews/QuickPreview';
import { WorkspaceContext } from '../src/renderer/workspace/context';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import {
  getState,
  initialize,
  quickPreview,
  updateFolderPresentation,
  useViewer,
} from '../src/renderer/state/store';
import { addPane } from '../src/renderer/state/panes';
import {
  browseSession,
  selectedFiles,
  updateBrowseSession,
} from '../src/renderer/workspace/sessions';
import { FileSelection, useFileKeyboard } from '../src/renderer/explorer/selection';
import { routeExplorerInput } from '../src/renderer/explorer/input';

vi.mock('../src/renderer/previews/HeldPreview', () => ({
  HeldPreview: ({ path }: { path: string }) => (
    <div className="held-preview" data-testid="preview">
      {path}
      {/* a long text that scrolls with the arrows once it has the keyboard */}
      <div className="text-scroll" tabIndex={-1} data-testid="text" style={{ overflowY: 'auto' }} />
    </div>
  ),
}));

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
};

const item = (name: string, directory = false): FileEntry => ({
  path: `/fixtures/${name}`,
  parent: '/fixtures',
  name,
  extension: directory ? '' : name.split('.').pop()!,
  mime: directory ? '' : 'image/png',
  kind: directory ? 'directory' : 'file',
  directory,
  size: 10,
  created: 1,
  modified: 1,
  hidden: false,
  identity: name,
});
const entries = [item('a.png'), item('b.png'), item('Photos', true), item('c.png')];
/** What the plane's list shows now: a search can hide some. */
let shownEntries = entries;
const workspace = {
  openPath: vi.fn(async () => {}),
  focusPane: vi.fn(),
} as unknown as WorkspaceController;

/** The plane Quick Preview came from: its arrows move its selection, as a files plane's do. */
function Plane({ id }: { id: string }) {
  const session = browseSession(id, '/fixtures');
  const selecting = useMemo(
    () =>
      new FileSelection(session, (paths) =>
        updateBrowseSession(id, '/fixtures', { selection: paths }),
      ),
    [id, session],
  );
  useFileKeyboard(id, (event) =>
    routeExplorerInput(event, {
      settings: getState().settings.settings,
      command: vi.fn(),
      clear: () => selecting.clear(),
      move: (key, range) => selecting.move(shownEntries, key, range),
    }),
  );
  return null;
}
function Shown() {
  const session = useViewer((state) => state.quickPreview);
  return session && <QuickPreview session={session} />;
}

let paneID = '';
beforeEach(() => {
  Object.assign(window, {
    viewer: {
      save: vi.fn(async () => {}),
      settingsPatch: vi.fn(async () => getState().settings),
      applications: vi.fn(async () => ({ defaultName: 'Preview', applications: [] })),
    },
  });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
  paneID = addPane('/fixtures', 'folder', true, { remember: false }).id;
});
afterEach(cleanup);

/** Selects `names` in the plane, the cursor on the last, and opens Quick Preview on them. */
function open(...names: string[]) {
  const session = browseSession(paneID, '/fixtures');
  const chosen = entries.filter((entry) => names.includes(entry.name));
  for (const entry of chosen) session.cache.set(entry.path, entry);
  session.cursor = chosen.at(-1)!.path;
  updateBrowseSession(paneID, '/fixtures', { selection: chosen.map((entry) => entry.path) });
  const view = render(
    <WorkspaceContext.Provider value={workspace}>
      <Plane id={paneID} />
      <Shown />
    </WorkspaceContext.Provider>,
  );
  act(() =>
    quickPreview(
      chosen.map((entry) => entry.path),
      { paneID, workspaceID: getState().saved.activeWorkspace },
    ),
  );
  return view;
}
const press = (key: string, target: Element = document.body, more: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...more });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};
/** What Quick Preview shows now. */
const shown = () => {
  const quick = getState().quickPreview!;
  return quick.paths[quick.index] ?? '';
};
const selected = () => selectedFiles(paneID).map((entry) => entry.name);

it('moves the plane’s selection with Up and Down and shows what it selects', () => {
  open('a.png');
  expect(shown()).toContain('a.png');
  press('ArrowDown');
  expect(selected()).toEqual(['b.png']);
  expect(shown()).toContain('b.png');
  expect(screen.getByTestId('preview').textContent).toContain('/fixtures/b.png');
  press('ArrowUp');
  expect(selected()).toEqual(['a.png']);
  expect(shown()).toContain('a.png');
  // held down, it keeps going
  act(() => {
    fireEvent.keyDown(document.body, { key: 'ArrowDown', repeat: true });
  });
  expect(selected()).toEqual(['b.png']);
});

it('names a folder the selection reaches, with its own Open Linked Plane', () => {
  open('b.png');
  press('ArrowDown');
  expect(selected()).toEqual(['Photos']);
  expect(screen.queryByTestId('preview')).toBeNull();
  expect(screen.getByRole('group', { name: 'Folder' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Open Linked Plane' }));
  expect(workspace.openPath).toHaveBeenCalledWith(
    '/fixtures/Photos',
    expect.objectContaining({ paneID, linked: true }),
  );
  press('ArrowDown');
  expect(screen.getByTestId('preview').textContent).toContain('/fixtures/c.png');
});

it('steps through several selected with Left and Right, in any view; Down moves on from the one shown', () => {
  act(() => updateFolderPresentation('/fixtures', { mode: 'grid' }));
  open('a.png', 'b.png', 'c.png');
  expect(shown()).toContain('a.png');
  press('ArrowRight');
  expect(shown()).toContain('b.png');
  // the selection stays as it was
  expect(selected()).toEqual(['a.png', 'b.png', 'c.png']);
  press('ArrowLeft');
  press('ArrowLeft');
  expect(shown()).toContain('c.png');
  press('ArrowRight');
  press('ArrowRight');
  expect(shown()).toContain('b.png');
  // from b, the file shown, not from the plane's cursor on c
  press('ArrowDown');
  expect(selected()).toEqual(['Photos']);
});

it('moves the plane’s selection with every arrow when one is selected, as its view does', () => {
  for (const mode of ['map', 'list', 'grid'] as const) {
    act(() => updateFolderPresentation('/fixtures', { mode }));
    open('a.png');
    expect(press('ArrowRight').defaultPrevented).toBe(true);
    expect(selected()).toEqual(['b.png']);
    press('ArrowLeft');
    expect(selected()).toEqual(['a.png']);
    cleanup();
  }
});

it('extends the selection with Shift, showing the item it reached', () => {
  open('a.png');
  press('ArrowDown', document.body, { shiftKey: true });
  expect(selected()).toEqual(['a.png', 'b.png']);
  expect(shown()).toBe('/fixtures/b.png');
});

it('leaves an arrow with ⌘, ⌥ or ⌃ to the window', () => {
  open('a.png');
  for (const modifier of ['metaKey', 'altKey', 'ctrlKey'] as const)
    expect(press('ArrowDown', document.body, { [modifier]: true }).defaultPrevented).toBe(false);
  expect(selected()).toEqual(['a.png']);
});

it('steps through what it shows once the plane closed, and leaves a key it cannot use', () => {
  const view = open('a.png', 'b.png');
  // the plane goes; Quick Preview stays
  view.rerender(
    <WorkspaceContext.Provider value={workspace}>
      <Shown />
    </WorkspaceContext.Provider>,
  );
  press('ArrowDown');
  expect(shown()).toBe('/fixtures/b.png');
  press('ArrowUp');
  expect(shown()).toBe('/fixtures/a.png');
  cleanup();
  const single = open('c.png');
  single.rerender(
    <WorkspaceContext.Provider value={workspace}>
      <Shown />
    </WorkspaceContext.Provider>,
  );
  expect(press('ArrowDown').defaultPrevented).toBe(false);
  expect(shown()).toBe('/fixtures/c.png');
});

it('goes on from where the file shown stood once a filter hid it', () => {
  open('b.png');
  // a search typed in the plane, by name, hides b.png and the folder
  shownEntries = entries.filter((entry) => ['a.png', 'c.png'].includes(entry.name));
  press('ArrowDown');
  expect(selected()).toEqual(['c.png']);
  // from c, Up goes back past where b stood
  press('ArrowUp');
  expect(selected()).toEqual(['a.png']);
  shownEntries = entries;
});

it('leaves the arrows to a focused preview that scrolls with them', () => {
  open('a.png');
  const text = screen.getByTestId('text');
  Object.defineProperty(text, 'scrollHeight', { value: 900 });
  Object.defineProperty(text, 'clientHeight', { value: 300 });
  text.focus();
  press('ArrowDown', text);
  expect(selected()).toEqual(['a.png']);
  expect(shown()).toContain('a.png');
  // Space still closes it, once
  expect(press(' ', document.body, { repeat: true }).defaultPrevented).toBe(false);
  expect(getState().quickPreview).not.toBeNull();
  press(' ');
  expect(getState().quickPreview).toBeNull();
});
