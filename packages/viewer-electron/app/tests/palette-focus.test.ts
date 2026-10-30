// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement, useState } from 'react';
import { CommandPalette } from '../src/renderer/commands/CommandPalette';
import { CommandsContext } from '../src/renderer/commands/context';
import { CommandRegistry, type CommandContext } from '../src/renderer/commands/registry';
import type { LineHost } from '../src/renderer/command-line/host';
import { WorkspaceContext, type WorkspaceController } from '../src/renderer/workspace/context';
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

/** The title bar's ⌘K button, focused as a click leaves it, and the active plane's content. */
function layout() {
  const bar = document.createElement('header');
  bar.className = 'app-titlebar';
  const button = document.createElement('button');
  bar.append(button);
  const plane = document.createElement('section');
  plane.dataset.pluridPlane = 'engine-plane';
  const marker = document.createElement('div');
  marker.dataset.viewerPane = getState().activePane;
  const explorer = document.createElement('div');
  explorer.className = 'folder-explorer';
  explorer.tabIndex = -1;
  const field = document.createElement('input');
  marker.append(explorer, field);
  plane.append(marker);
  document.body.append(bar, plane);
  button.focus();
  return { button, explorer, field };
}

async function choose(run: () => void) {
  const registry = new CommandRegistry();
  const context = (): CommandContext => ({
    scope: 'window',
    workspaceID: activeWorkspace().id,
    paneID: getState().activePane,
    path: '/fixture',
    directory: '/fixture',
    selection: [],
    jobs: [],
    clipboard: null,
  });
  registry.register('window', {
    context,
    definitions: () => [
      { id: 'arrange', label: 'Arrange planes', group: 'Space', when: () => true, run },
    ],
  });
  const host: LineHost = {
    registry,
    context,
    workspace: {} as WorkspaceController,
    invoke: vi.fn(async () => true),
    newWorkspace: vi.fn(),
    switchWorkspace: vi.fn(),
    palette: vi.fn(),
  };
  function Harness() {
    const [open, setOpen] = useState(true);
    return open
      ? createElement(CommandPalette, {
          mode: 'commands',
          onMode: vi.fn(),
          onClose: () => setOpen(false),
          line: { host, run: vi.fn() },
        })
      : null;
  }
  const view = render(
    createElement(
      CommandsContext.Provider,
      { value: registry },
      createElement(WorkspaceContext.Provider, { value: host.workspace }, createElement(Harness)),
    ),
  );
  fireEvent.change(view.getByRole('combobox', { name: 'Search commands' }), {
    target: { value: 'Arrange' },
  });
  const row = await waitFor(() => {
    const found = [...view.container.querySelectorAll<HTMLElement>('.command-result')].find(
      (item) => item.textContent?.includes('Arrange planes'),
    );
    if (!found) throw new Error('No Arrange planes row');
    return found;
  });
  fireEvent.click(row);
}

describe('focus after a palette command', () => {
  it('returns to the active plane, not the title bar button that opened the palette', async () => {
    expect(getState().activePane).toBeTruthy();
    const { explorer } = layout();
    await choose(() => {});
    await waitFor(() => expect(document.activeElement).toBe(explorer));
  });

  it('stays where the command put it', async () => {
    const { field } = layout();
    await choose(() => field.focus());
    await waitFor(() => expect(document.activeElement).toBe(field));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(document.activeElement).toBe(field);
  });
});
