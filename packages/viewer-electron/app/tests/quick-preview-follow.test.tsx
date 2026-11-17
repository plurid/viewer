// @vitest-environment jsdom
/**
 * QUICK PREVIEW FOLLOWS THE SELECTION, as Finder's Quick Look does: Up and Down, and in Grid and
 * Gallery all four arrows, move the plane's selection as they would without it, and it shows what
 * is selected now, a folder by name. With several selected, Left and Right step through them. A
 * focused preview that scrolls with the arrows keeps them.
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
const workspace = {
  openPath: vi.fn(async () => {}),
  focusPane: vi.fn(),
} as unknown as WorkspaceController;

/** The plane Quick Preview came from: its arrows move its selection, as a folder plane's do. */
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
      move: (key, range) => selecting.move(entries, key, range),
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
const press = (key: string, target: Element = document.body, shiftKey = false) =>
  act(() => {
    fireEvent.keyDown(target, { key, shiftKey });
  });
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

it('names a folder the selection reaches, with its own Open linked plane', () => {
  open('b.png');
  press('ArrowDown');
  expect(selected()).toEqual(['Photos']);
  expect(screen.queryByTestId('preview')).toBeNull();
  expect(screen.getByRole('group', { name: 'Folder' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Open linked plane' }));
  expect(workspace.openPath).toHaveBeenCalledWith(
    '/fixtures/Photos',
    expect.objectContaining({ paneID, linked: true }),
  );
  press('ArrowDown');
  expect(screen.getByTestId('preview').textContent).toContain('/fixtures/c.png');
});

it('steps through several selected with Left and Right; Up and Down move to one', () => {
  open('a.png', 'b.png', 'c.png');
  expect(shown()).toContain('a.png');
  press('ArrowRight');
  expect(shown()).toContain('b.png');
  press('ArrowLeft');
  press('ArrowLeft');
  expect(shown()).toContain('c.png');
  expect(selected()).toEqual(['a.png', 'b.png', 'c.png']);
  press('ArrowDown');
  expect(selected()).toHaveLength(1);
});

it('moves sideways in Grid and Gallery, where Left and Right move the selection', () => {
  act(() => updateFolderPresentation('/fixtures', { mode: 'grid' }));
  open('a.png');
  press('ArrowRight');
  expect(selected()).toEqual(['b.png']);
  expect(shown()).toContain('b.png');
  act(() => updateFolderPresentation('/fixtures', { mode: 'list' }));
  press('ArrowRight');
  // in List they move nothing with one selected
  expect(selected()).toEqual(['b.png']);
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
  press(' ');
  expect(getState().quickPreview).toBeNull();
});
