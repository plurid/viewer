// @vitest-environment jsdom
/**
 * Lay out… and Nest for cutting…: where they are offered, what they open, and the Suggested rows
 * that put them first for several photos and for DXF parts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry } from '../src/domain/contracts';
import { programCommands } from '../src/renderer/commands/programs';
import type { CommandContext, ResolvedCommand } from '../src/renderer/commands/registry';
import { contextMenuSections } from '../src/renderer/commands/menu';
import { rankSuggestions } from '../src/renderer/commands/suggestions';
import { suggestionRules } from '../src/domain/suggestions/rules';
import type { SuggestionInput } from '../src/domain/suggestions/rules';
import { contentPlaneActions } from '../src/renderer/workspace/content-planes';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { paneRoute } from '../src/renderer/workspace/tree';
import { paneTitle } from '../src/domain/workspaces/planes';
import { activeWorkspace, flushState, initialize } from '../src/renderer/state/store';
import { addContentPane } from '../src/renderer/state/panes';

const file = (name: string, parent = '/Users/a/Photos'): FileEntry => ({
  path: parent + '/' + name,
  parent,
  name,
  extension: name.split('.').pop()!.toLowerCase(),
  kind: 'file',
  directory: false,
  size: 1000,
  modified: 1,
  created: 1,
  hidden: false,
  mime: name.endsWith('.jpg') ? 'image/jpeg' : '',
  identity: name,
});
const context = (selection: FileEntry[]): CommandContext => ({
  scope: 'files',
  workspaceID: activeWorkspace().id,
  paneID: activeWorkspace().panes[0]!.id,
  directory: '/Users/a/Photos',
  selection,
  clipboard: null,
  jobs: [],
});
const openLayout = vi.fn<WorkspaceController['openLayout']>();
const command = (id: string) =>
  programCommands({ openLayout } as unknown as WorkspaceController, vi.fn()).find(
    (item) => item.id === id,
  )!;

beforeEach(() => {
  openLayout.mockClear();
  Object.assign(window, { viewer: { save: vi.fn(async () => {}) } });
  initialize({ home: '/Users/a', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
afterEach(async () => {
  await flushState(false);
});

describe('Lay out…', () => {
  it('is offered for photos and PDFs, and opens the plane with the files it uses', async () => {
    const lay = command('lay-out');
    expect(lay).toMatchObject({ label: 'Lay out…', group: 'Files' });
    expect(lay.aliases).toEqual(expect.arrayContaining(['collage', 'booklet', 'poster']));
    const selection = [file('a.jpg'), file('notes.txt'), file('Report.pdf'), file('b.HEIC')];
    expect(lay.when(context(selection))).toBe(true);
    expect(lay.when(context([file('clip.mp4')]))).toBe(false);
    expect(lay.when(context([]))).toBe(false);
    await lay.run(context(selection));
    expect(openLayout).toHaveBeenCalledWith(
      ['/Users/a/Photos/a.jpg', '/Users/a/Photos/Report.pdf', '/Users/a/Photos/b.HEIC'],
      context(selection).paneID,
    );
  });

  it('opens DXF parts in nesting mode from Nest for cutting…', async () => {
    const nest = command('nest-parts');
    expect(nest.label).toBe('Nest for cutting…');
    const parts = [file('Bracket.dxf', '/Users/a/Parts'), file('Plate.DXF', '/Users/a/Parts')];
    expect(nest.when(context(parts))).toBe(true);
    expect(nest.when(context([file('a.jpg')]))).toBe(false);
    // a DXF alone is nested; Lay out… is for photos and PDFs
    expect(command('lay-out').when(context(parts))).toBe(false);
    await nest.run(context(parts));
    expect(openLayout).toHaveBeenCalledWith(
      ['/Users/a/Parts/Bracket.dxf', '/Users/a/Parts/Plate.DXF'],
      context(parts).paneID,
      'nesting',
    );
  });
});

describe('Suggested', () => {
  const input = (selection: FileEntry[]): SuggestionInput => ({
    selection,
    now: 1,
    home: '/Users/a',
    modelReady: false,
    editable: () => false,
  });
  const resolved = (id: string, selection: FileEntry[]): ResolvedCommand => ({
    id,
    label: id === 'lay-out' ? 'Lay out…' : id,
    group: 'Files',
    aliases: [],
    primary: false,
    source: 'window',
    context: context(selection),
  });
  const reason = (id: string, selection: FileEntry[]) =>
    suggestionRules.find((rule) => rule.id === id)!.reason(input(selection));

  it('suggests a collage for several photos and a contact sheet for many', () => {
    expect(reason('photos.layout', [file('a.jpg'), file('b.jpg'), file('c.jpg')])).toBe(
      'Collage of 3 photos',
    );
    const many = Array.from({ length: 12 }, (_, index) => file(`IMG_${index}.jpg`));
    expect(reason('photos.layout', many)).toBe('Contact sheet of 12');
    expect(reason('photos.layout', [file('a.jpg')])).toBeUndefined();
    expect(reason('photos.layout', [file('a.jpg'), file('b.pdf')])).toBeUndefined();
  });

  it('suggests nesting for DXF parts', () => {
    expect(reason('drawings.nest', [file('a.dxf')])).toBe('DXF part');
    expect(reason('drawings.nest', [file('a.dxf'), file('b.dxf')])).toBe('2 DXF parts');
    expect(reason('drawings.nest', [file('a.dxf'), file('b.jpg')])).toBeUndefined();
  });

  it('puts Lay out… in the file menu’s Suggested section for three photos', () => {
    const selection = [file('a.jpg'), file('b.jpg'), file('c.jpg')];
    const applicable = ['lay-out', 'images-to-pdf', 'compress', 'rename'].map((id) =>
      resolved(id, selection),
    );
    const suggestions = rankSuggestions(applicable, input(selection), []);
    expect(suggestions[0]).toMatchObject({
      command: { id: 'lay-out' },
      reason: 'Collage of 3 photos',
    });
    const sections = contextMenuSections(applicable, [], false, suggestions);
    const suggested = sections.find((section) => section.label === 'Suggested')!;
    expect(suggested.entries[0]).toMatchObject({
      kind: 'command',
      id: 'suggested.lay-out',
      note: 'Collage of 3 photos',
    });
    // and in More file actions, where every file command is
    const more = sections
      .flatMap((section) => section.entries)
      .find((entry) => entry.kind === 'submenu' && entry.label === 'More file actions');
    expect(JSON.stringify(more)).toContain('"id":"lay-out"');
  });
});

describe('the Layout plane record', () => {
  const fixture = () => {
    const controller = {
      focusPane: vi.fn<WorkspaceController['focusPane']>(),
      rootID: vi.fn<WorkspaceController['rootID']>(() => 'root'),
      openDiff: vi.fn<WorkspaceController['openDiff']>(),
      open: vi.fn<WorkspaceController['open']>(),
    };
    const registerContent = vi.fn((pane: Parameters<typeof addContentPane>[0]) =>
      addContentPane(pane, false),
    );
    return {
      controller,
      registerContent,
      actions: contentPlaneActions({ controller: () => controller, registerContent }),
    };
  };

  it('opens beside the files, and brings the same files’ plane forward in a new mode', () => {
    const { actions, controller, registerContent } = fixture();
    const paths = ['/Users/a/Photos/a.jpg', '/Users/a/Photos/b.jpg'];
    actions.openLayout(paths, 'parent');
    expect(registerContent).toHaveBeenCalledTimes(1);
    const pane = activeWorkspace().panes.find((item) => item.type === 'layout')!;
    expect(pane).toMatchObject({ type: 'layout', path: '/Users/a/Photos', sources: paths });
    expect(controller.focusPane).toHaveBeenLastCalledWith(pane.id, { activate: true });
    actions.openLayout([...paths].reverse(), 'parent', 'contact-sheet');
    expect(registerContent).toHaveBeenCalledTimes(1);
    expect(activeWorkspace().panes.find((item) => item.id === pane.id)).toMatchObject({
      mode: 'contact-sheet',
    });
    expect(paneTitle(pane)).toBe('Layout · 2 files');
    expect(paneTitle({ ...pane, sources: [paths[0]!] })).toBe('Layout · a.jpg');
    expect(paneRoute('layout', pane.id)).toBe('/layouts/' + pane.id);
  });
});
