// @vitest-environment jsdom
/**
 * ⌘K SAYS WHY: a command the query names that cannot run here is listed greyed out under the rows,
 * with the reason its definition gives, instead of "No matching actions". It is never chosen: no
 * click, arrow or Return runs it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type {
  CommandContext,
  CommandDefinition,
  DiscoverableCommand,
} from '../src/renderer/commands/registry';
import type { LineHost } from '../src/renderer/command-line/host';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { CommandPalette } from '../src/renderer/commands/CommandPalette';
import { CommandsContext } from '../src/renderer/commands/context';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { unavailableRows } from '../src/renderer/commands/palette-sections';
import { WorkspaceContext } from '../src/renderer/workspace/context';
import { activeWorkspace, flushState, getState, initialize } from '../src/renderer/state/store';
import { flushPreferences, resetPreferences } from '../src/renderer/state/preferences';

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
};

beforeEach(() => {
  Object.assign(window, {
    viewer: {
      save: vi.fn(async () => {}),
      settingsPatch: vi.fn(),
      list: vi.fn(async () => ({ entries: [] })),
      onEvent: () => () => {},
    },
  });
  initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
afterEach(async () => {
  cleanup();
  document.body.replaceChildren();
  await flushPreferences();
  await flushState(false);
  resetPreferences();
});

const unavailable = (
  id: string,
  label: string,
  aliases: string[],
  reason?: string,
): DiscoverableCommand => ({
  id,
  label,
  group: 'Files',
  aliases,
  primary: false,
  source: 'window',
  context: {} as CommandContext,
  available: false,
  unavailable: reason ?? 'Unavailable for this selection and view.',
  ...(reason ? { reason } : {}),
});

describe('unavailableRows', () => {
  const reason = 'fabrication holds Job 1042 and Evaluation: select one to check it.';
  const check = unavailable('check-laser-job', 'Check laser job…', ['laser', 'dxf'], reason);

  it('names a command by the start of a word of its label or of one alias', () => {
    expect(unavailableRows([check], 'laser', [])).toEqual([check]);
    expect(unavailableRows([check], 'Check laser job', [])).toEqual([check]);
    expect(unavailableRows([check], 'dxf', [])).toEqual([check]);
    expect(unavailableRows([check], 'las job', [])).toEqual([check]);
    // every word typed must be there, and a letter or two names nothing
    expect(unavailableRows([check], 'laser cutter', [])).toEqual([]);
    expect(unavailableRows([check], 'aser', [])).toEqual([]);
    expect(unavailableRows([check], 'la', [])).toEqual([]);
  });

  it('shows only a command that says why, not one available or already listed', () => {
    const silent = unavailable('silent', 'Laser engrave', ['laser']);
    const runs = { ...check, id: 'runs', available: true, unavailable: undefined };
    expect(unavailableRows([silent, runs, check], 'laser', [])).toEqual([check]);
    expect(unavailableRows([check], 'laser', [check])).toEqual([]);
    const setting = { ...check, id: 'setting', setting: { name: 'Laser', value: true } };
    expect(unavailableRows([setting as DiscoverableCommand], 'laser', [])).toEqual([]);
  });

  it('puts those its label names first, and shows three at most', () => {
    const byAlias = unavailable('a', 'Nest for cutting…', ['laser'], 'Select DXF parts.');
    const more = ['b', 'c', 'd'].map((id) => unavailable(id, `Laser ${id}`, [], 'Not here.'));
    expect(unavailableRows([byAlias, check, ...more], 'laser', []).map((row) => row.id)).toEqual([
      'check-laser-job',
      'b',
      'c',
    ]);
  });
});

describe('the palette', () => {
  function palette(definitions: CommandDefinition[]) {
    const registry = new CommandRegistry();
    const context = (): CommandContext => ({
      scope: 'window',
      workspaceID: activeWorkspace().id,
      paneID: getState().activePane,
      path: '/fixture',
      directory: '/fixture/fabrication',
      selection: [],
      jobs: [],
      clipboard: null,
    });
    registry.register('window', { context, definitions: () => definitions });
    const host: LineHost = {
      registry,
      context,
      workspace: {} as WorkspaceController,
      invoke: vi.fn(async () => true),
      newWorkspace: vi.fn(),
      switchWorkspace: vi.fn(),
      palette: vi.fn(),
    };
    const view = render(
      createElement(
        CommandsContext.Provider,
        { value: registry },
        createElement(
          WorkspaceContext.Provider,
          { value: host.workspace },
          createElement(CommandPalette, {
            mode: 'commands',
            onMode: vi.fn(),
            onClose: vi.fn(),
            line: { host, run: vi.fn() },
          }),
        ),
      ),
    );
    const field = view.getByRole('combobox', { name: 'Search commands' });
    const type = (value: string) => fireEvent.change(field, { target: { value } });
    return { view, field, type };
  }
  const check = vi.fn();
  const arrange = vi.fn();
  const definitions: CommandDefinition[] = [
    {
      id: 'check-laser-job',
      label: 'Check laser job…',
      group: 'Files',
      icon: 'drawing',
      aliases: ['laser', 'fabrication'],
      when: () => false,
      unavailable: (context) =>
        `${context.directory?.split('/').pop()} holds Job 1042 and Evaluation: select one to check it.`,
      run: check,
    },
    {
      id: 'engrave',
      label: 'Engrave with the laser',
      group: 'Files',
      when: () => false,
      run: check,
    },
    { id: 'arrange', label: 'Arrange planes', group: 'Space', when: () => true, run: arrange },
  ];

  it('lists a command it cannot run greyed out, with why, and never runs it', async () => {
    const { view, field, type } = palette(definitions);
    type('laser');
    const row = await waitFor(() => {
      const found = view.container.querySelector<HTMLElement>('.command-result.is-unavailable');
      if (!found) throw new Error('No greyed-out row');
      return found;
    });
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(row.textContent).toBe(
      'Check laser job…fabrication holds Job 1042 and Evaluation: select one to check it.',
    );
    expect(view.container.textContent).toContain('Not available here');
    expect(view.container.querySelector('.command-empty')).toBeNull();
    // a command without its own reason stays out
    expect(view.container.textContent).not.toContain('Engrave with the laser');
    fireEvent.click(row);
    for (const key of ['ArrowDown', 'Enter', 'End', 'Enter']) fireEvent.keyDown(field, { key });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(check).not.toHaveBeenCalled();
    expect(field.getAttribute('aria-activedescendant')).toBeNull();
  });

  it('says nothing matches when nothing is named, and lists what runs as before', async () => {
    const { view, type } = palette(definitions);
    type('zebra crossing');
    await waitFor(() =>
      expect(view.container.querySelector('.command-empty')?.textContent).toBe(
        'No matching actions',
      ),
    );
    type('Arrange');
    await waitFor(() =>
      expect(view.container.querySelector('.command-result')?.textContent).toContain(
        'Arrange planes',
      ),
    );
    expect(view.container.querySelector('.is-unavailable')).toBeNull();
    // nothing typed lists nothing greyed out
    type('');
    await waitFor(() => expect(view.container.querySelector('.is-unavailable')).toBeNull());
  });
});
