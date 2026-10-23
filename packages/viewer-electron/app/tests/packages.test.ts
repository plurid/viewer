// @vitest-environment jsdom
/**
 * AN APPLICATION IS ONE ITEM (2026-10-23): as in Finder, opening an app or another bundle starts it
 * (or opens it in its app) rather than browsing into it; Show Package Contents goes inside. It is
 * no folder to expand, drop into or sort among folders, and its kind says what it is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import type { FileEntry } from '../src/domain/contracts';
import { browsable, fileGroup, kindLabel, sortEntries } from '../src/domain/files';
import { defaultSettings } from '../src/domain/services';
import { nativeOpening } from '../src/renderer/explorer/opening';
import { folderCommands, type FolderActions } from '../src/renderer/commands/folder';
import { FileRow } from '../src/renderer/explorer/views';
import { useColumnNavigation } from '../src/renderer/explorer/column-navigation';
import type { FileSelection } from '../src/renderer/explorer/selection';
import { activeWorkspace, initialize } from '../src/renderer/state/store';
import type { CommandContext, ResolvedCommand } from '../src/renderer/commands/registry';
import { contextMenuSections } from '../src/renderer/commands/menu';

const entry = (name: string, directory: boolean): FileEntry => ({
  path: `/fixtures/${name}`,
  parent: '/fixtures',
  name,
  directory,
  kind: directory ? 'directory' : 'file',
  extension: name.includes('.') ? name.split('.').pop()!.toLowerCase() : '',
  size: 10,
  created: 0,
  modified: 0,
  hidden: false,
  mime: directory ? '' : 'text/plain',
  identity: name,
});
const app = entry('Claude.app', true);
const folder = entry('Adobe Photoshop 2026', true);
const pages = entry('Report.pages', true);
const notes = entry('notes.md', false);

beforeEach(() => {
  Object.assign(window, {
    viewer: { save: vi.fn(async () => {}), appIcon: vi.fn(async () => '') },
  });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
afterEach(cleanup);

describe('an application is one item', () => {
  it('opens in its own app, unless linked or set to open in a plane', () => {
    const policy = defaultSettings('/fixtures').fileOpening;
    expect(nativeOpening(app, policy)).toBe(true);
    expect(nativeOpening(pages, policy)).toBe(true);
    expect(nativeOpening(folder, policy)).toBe(false);
    expect(nativeOpening(app, policy, true)).toBe(false);
    expect(nativeOpening(app, { ...policy, types: { app: 'plane' } })).toBe(false);
  });
  it('is no folder to browse, and says what kind it is', () => {
    expect(browsable(folder)).toBe(true);
    expect(browsable(app)).toBe(false);
    expect(kindLabel(folder)).toBe('Folder');
    expect(kindLabel(app)).toBe('Application');
    expect(kindLabel(pages)).toBe('PAGES');
    expect(kindLabel(notes)).toBe('MD');
  });
  it('sorts among files with folders kept first, and groups as an application', () => {
    expect(sortEntries([app, notes, folder], 'name', false).map((item) => item.name)).toEqual([
      'Adobe Photoshop 2026',
      'Claude.app',
      'notes.md',
    ]);
    expect(sortEntries([app, entry('Zed', true)], 'name', false)[0].name).toBe('Zed');
    expect(fileGroup(app, 'kind')).toBe('Applications');
    expect(fileGroup(folder, 'kind')).toBe('Folders');
  });
  it('shows no disclosure, takes no drop and reads as an application in a list', () => {
    const props = {
      select: vi.fn(),
      open: vi.fn(),
      context: vi.fn(),
      drag: vi.fn(),
      toggle: vi.fn(),
      expanded: [],
      paneID: activeWorkspace().panes[0].id,
    };
    const row = (item: FileEntry) =>
      render(createElement(FileRow, { entry: item, selected: false, props })).container
        .firstElementChild as HTMLElement;
    const appRow = row(app);
    expect(appRow.querySelector('.folder-disclosure')).toBeNull();
    expect(appRow.dataset.directoryPath).toBeUndefined();
    expect(appRow.querySelector('[data-column="kind"]')?.textContent).toBe('Application');
    const folderRow = row(folder);
    expect(folderRow.querySelector('.folder-disclosure')).not.toBeNull();
    expect(folderRow.dataset.directoryPath).toBe(folder.path);
  });
  it('opens no column of its contents in the columns view', () => {
    const selecting = {
      click: vi.fn(),
      removeBranch: vi.fn(),
      move: vi.fn(),
    } as unknown as FileSelection;
    const paneID = activeWorkspace().panes[0].id;
    const entries = [folder, app];
    const { result } = renderHook(() =>
      useColumnNavigation(paneID, '/fixtures', entries, true, selecting),
    );
    act(() =>
      result.current.choose(app, { shiftKey: false, metaKey: false, ctrlKey: false }, entries),
    );
    expect(result.current.trail).toEqual([]);
    expect(result.current.directory()).toBe('/fixtures');
    act(() =>
      result.current.choose(folder, { shiftKey: false, metaKey: false, ctrlKey: false }, entries),
    );
    expect(result.current.trail).toEqual([folder.path]);
  });
});

describe('Show Package Contents', () => {
  const context = (selection: FileEntry[]) =>
    ({ scope: 'files', selection }) as unknown as CommandContext;
  const command = (actions: Partial<FolderActions>) =>
    folderCommands(actions as FolderActions).find((item) => item.id === 'show-package-contents')!;
  beforeEach(() => {
    Object.assign(window.viewer, { fileInformation: vi.fn(async () => ({ package: true })) });
  });
  it('browses into a package, now that opening one starts it', async () => {
    const actions = { open: vi.fn(), contents: vi.fn() };
    expect(command(actions).when(context([app]))).toBe(true);
    for (const selection of [[folder], [notes], [app, pages], []])
      expect(command(actions).when(context(selection))).toBe(false);
    await command(actions).run(context([app]));
    expect(actions.contents).toHaveBeenCalledWith(app);
    expect(actions.open).not.toHaveBeenCalled();
  });
  it('shows it in a linked plane where the plane cannot browse into it', async () => {
    const actions = { open: vi.fn() };
    await command(actions).run(context([app]));
    expect(actions.open).toHaveBeenCalledWith([app], true);
  });
});

describe('the context menu of a package', () => {
  it('offers Show Package Contents right under Open, as Finder does', () => {
    const command = (id: string, group = 'Files') =>
      ({ id, label: id, group, primary: false }) as unknown as ResolvedCommand;
    const sections = contextMenuSections(
      ['open-selection', 'show-package-contents', 'quick-preview', 'open-with', 'linked'].map(
        (id) => command(id),
      ),
      [],
    );
    expect(sections[0]!.entries.map((entry) => entry.id)).toEqual([
      'open-selection',
      'show-package-contents',
      'quick-preview',
      'open-with',
    ]);
  });
});
