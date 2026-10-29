// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { JournalPane as Pane, ViewerAPI } from '../src/domain/contracts';
import type { JournalRecord } from '../src/domain/journal/events';
import { stateSchema } from '../src/desktop/persistence/storage';
import { activeWorkspace, flushState, getState, initialize } from '../src/renderer/state/store';
import { addContentPane } from '../src/renderer/state/panes';
import { WorkspaceContext, type WorkspaceController } from '../src/renderer/workspace/context';
import JournalPlane from '../src/renderer/journal/JournalPlane';
import { journalCommands } from '../src/renderer/journal/commands';
import { windowScopes, type WindowActions } from '../src/renderer/commands/window-commands/scope';
import { mockElementBox } from './support/layout';

let pane: Pane;
let records: JournalRecord[];
const focus = vi.fn();
const openJournal = vi.fn();
const query = vi.fn<ViewerAPI['journalQuery']>();
const exported = vi.fn<ViewerAPI['journalExportPreview']>();
const clear = vi.fn(async () => false);

beforeEach(() => {
  mockElementBox(1000, 360);
  focus.mockClear();
  openJournal.mockClear();
  clear.mockClear();
  query.mockReset();
  Object.assign(window, {
    viewer: {
      save: vi.fn(async () => {}),
      journalQuery: query,
      journalExportPreview: exported,
      journalClear: clear,
      onEvent: () => () => {},
      copyPaths: vi.fn(async () => {}),
    },
  });
  initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
  const space = activeWorkspace();
  records = [
    {
      version: 1,
      id: crypto.randomUUID(),
      sessionID: crypto.randomUUID(),
      sequence: 1,
      at: Date.now(),
      producer: 'desktop',
      source: 'git',
      action: 'commit',
      phase: 'succeeded',
      level: 'info',
      origin: { workspaceID: space.id, planeID: space.panes[0]!.id },
      traceID: crypto.randomUUID(),
      durationMs: 12,
    },
  ];
  pane = {
    id: crypto.randomUUID(),
    type: 'journal',
    path: '/fixture',
    filter: {},
    savedFilters: [
      { id: crypto.randomUUID(), name: 'Git failures', filter: { source: 'git', level: 'error' } },
    ],
  };
  addContentPane(pane);
  query.mockImplementation(async (input) => ({
    records: input.filter.level === 'error' ? [] : records,
    through: 1,
    matched: input.filter.level === 'error' ? 0 : records.length,
    status: {
      generation: 'one',
      latest: 1,
      stored: 1,
      bytes: 100,
      byteLimit: 1000,
      recordLimit: 100,
      dropped: 0,
      state: 'ready',
    },
  }));
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await flushState(false);
});
const mount = () =>
  render(
    createElement(
      WorkspaceContext.Provider,
      { value: { focusPane: focus } as unknown as WorkspaceController },
      createElement(JournalPlane, { pane, active: true }),
    ),
  );

describe('Journal plane integration', () => {
  it('opens authoritative event details, filters a trace, navigates to the source and persists filters', async () => {
    mount();
    await act(async () => {});
    expect(screen.getByRole('grid', { name: 'Journal events' })).toBeTruthy();
    const row = screen.getByRole('row', { name: /Commit completed/ });
    fireEvent.click(row);
    expect(screen.getByRole('complementary', { name: 'Event details' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Paused · Resume' })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Go to plane' })));
    expect(focus).toHaveBeenCalledWith(records[0]!.origin.planeID, { activate: true });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Show trace' })));
    expect(query.mock.calls.at(-1)?.[0].filter.traceID).toBe(records[0]!.traceID);
    const restored = stateSchema.parse(getState().saved);
    expect(
      restored.workspaces.flatMap((space) => space.panes).find((item) => item.id === pane.id),
    ).toMatchObject({ type: 'journal', filter: { traceID: records[0]!.traceID } });
  });

  it('restores saved filters and preserves rows when history review is cancelled', async () => {
    mount();
    await act(async () => {});
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Move history to Trash…' })),
    );
    expect(clear).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Commit completed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Journal filters' }));
    const menu = screen.getByRole('dialog', { name: 'Journal filters' });
    await act(async () =>
      fireEvent.click(menu.querySelector(`[data-menu-id="choice:${pane.savedFilters![0]!.id}"]`)!),
    );
    expect(screen.getByText('No matching events')).toBeTruthy();
    expect(query.mock.calls.at(-1)?.[0].filter).toMatchObject({ source: 'git', level: 'error' });
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Clear Journal filters' })),
    );
    expect(screen.getByText('Commit completed')).toBeTruthy();
  });

  it('registers distinct application, workspace and contextual plane entry points', () => {
    const scopes = windowScopes({
      ready: true,
      workspace: { openJournal },
    } as unknown as WindowActions);
    const commands = journalCommands(scopes);
    const context = {
      workspaceID: activeWorkspace().id,
      paneID: pane.id,
      scope: 'window',
      selection: [],
      clipboard: null,
      jobs: [],
    } as const;
    expect(commands.every((command) => command.when(context))).toBe(true);
    for (const command of commands) command.run(context);
    expect(openJournal.mock.calls.map((call) => call[0])).toEqual([
      {},
      { workspaceID: activeWorkspace().id },
      { workspaceID: activeWorkspace().id, planeID: pane.id },
    ]);
  });
});
