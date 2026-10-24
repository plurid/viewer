// @vitest-environment jsdom
/**
 * THE COMMAND LINE IN THE PALETTE (2026-10-23): `:` starts it; Tab completes; Enter runs a line
 * that parses and points at the column of one that does not; past lines come back with ⌃P; `help`
 * lists what it can say; the ordinary palette shows a smart row's line.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement, useState } from 'react';
import { CommandPalette, type PaletteMode } from '../src/renderer/commands/CommandPalette';
import { CommandsContext } from '../src/renderer/commands/context';
import { CommandRegistry, type CommandContext } from '../src/renderer/commands/registry';
import { WorkspaceContext, type WorkspaceController } from '../src/renderer/workspace/context';
import { activeWorkspace, getState, initialize } from '../src/renderer/state/store';
import type { LineHost } from '../src/renderer/command-line/host';

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
};
beforeEach(() => {
  Object.assign(window, {
    viewer: { save: vi.fn(async () => {}), list: vi.fn(async () => ({ entries: [] })) },
  });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
afterEach(cleanup);
const show = (initial: PaletteMode = 'commands') => {
  const run = vi.fn();
  const registry = new CommandRegistry();
  const context = () =>
    ({
      scope: 'window',
      workspaceID: activeWorkspace().id,
      paneID: activeWorkspace().panes[0]!.id,
      directory: '/fixtures',
      selection: [],
      jobs: [],
      clipboard: null,
    }) as unknown as CommandContext;
  registry.register('window', {
    context,
    definitions: () => [
      {
        id: 'frame-all',
        label: 'Frame all planes',
        group: 'Space',
        when: () => true,
        run: vi.fn(),
      },
    ],
  });
  const host = {
    registry,
    context,
    workspace: {} as WorkspaceController,
    invoke: vi.fn(async () => true),
    newWorkspace: vi.fn(),
    switchWorkspace: vi.fn(),
    palette: vi.fn(),
  } satisfies LineHost;
  const Harness = () => {
    const [mode, setMode] = useState<PaletteMode>(initial);
    return createElement(CommandPalette, {
      mode,
      onMode: setMode,
      onClose: vi.fn(),
      line: { host, run },
    });
  };
  const view = render(
    createElement(
      CommandsContext.Provider,
      { value: registry },
      createElement(
        WorkspaceContext.Provider,
        { value: {} as WorkspaceController },
        createElement(Harness),
      ),
    ),
  );
  const field = () => view.getByRole('combobox', { name: 'Command line' }) as HTMLInputElement;
  const type = (text: string) => fireEvent.change(field(), { target: { value: text } });
  const key = (name: string, options: Record<string, unknown> = {}) =>
    fireEvent.keyDown(field(), { key: name, ...options });
  return { view, run, field, type, key };
};

it('starts after a colon, completes with Tab and runs with Enter', async () => {
  const { view, run, field, type, key } = show();
  fireEvent.change(view.getByRole('combobox', { name: 'Search commands' }), {
    target: { value: ':tabn' },
  });
  await waitFor(() => expect(field().value).toBe('tabn'));
  key('Tab');
  expect(field().value).toBe('tabnext ');
  type('frame');
  key('Tab');
  expect(field().value).toBe('frame-all');
  // the run row says what the line does before it runs
  expect(view.getAllByRole('option')[0]!.textContent).toContain('Frame all planes');
  key('Enter');
  expect(run).toHaveBeenCalledWith('frame-all');
  expect(getState().saved.lineHistory).toEqual(['frame-all']);
});
it('points at the column of a line that does not parse, and runs nothing', () => {
  const { view, run, type, key } = show('line');
  type('frame-all | nosuch');
  key('Enter');
  const alert = view.getByRole('alert');
  expect(alert.textContent).toContain('Not a command: nosuch');
  expect(alert.querySelectorAll('code')[1]!.textContent).toMatch(/^ {12}\^/);
  expect(run).not.toHaveBeenCalled();
});
it('brings past lines back with ⌃P and lists them with nothing typed', async () => {
  const first = show('line');
  first.type('set grid!');
  first.key('Enter');
  cleanup();
  const { view, field, key } = show('line');
  expect(view.getAllByRole('option')[0]!.textContent).toContain('set grid!');
  key('p', { ctrlKey: true });
  expect(field().value).toBe('set grid!');
  key('n', { ctrlKey: true });
  expect(field().value).toBe('');
});
it('lists what it can say after help, a verb’s whole help after its name', () => {
  const { view, type } = show('line');
  type('help');
  const labels = () => view.getAllByRole('option').map((row) => row.textContent);
  expect(labels().some((text) => text?.startsWith('vs[plit] [path]'))).toBe(true);
  expect(labels().some((text) => text?.startsWith('q[uit][!]'))).toBe(true);
  type('help q');
  expect(labels()[0]).toContain('q[uit]');
  expect(labels().some((text) => text?.includes('discards its unsaved text'))).toBe(true);
});
it('shows a smart row’s line in the ordinary palette', async () => {
  const { view } = show();
  fireEvent.change(view.getByRole('combobox', { name: 'Search commands' }), {
    target: { value: 'new folder Drafts' },
  });
  await waitFor(() => expect(view.getAllByRole('option').length).toBeGreaterThan(0));
  // once: the smart row's own source is not listed again among the commands
  expect(view.getAllByRole('option').map((row) => row.textContent)).toEqual([
    'New folder “Drafts”:mkdir Drafts · /fixtures',
  ]);
});
