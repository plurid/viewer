// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import type {
  DefinitionCatalog,
  WorkspaceDefinition,
} from '../src/domain/workspaces/definitions/schema';
import type { ResolvedCommand } from '../src/renderer/commands/registry';
import { WorkspacesDialog } from '../src/renderer/ui/workspace/WorkspacesDialog';
import { FoundWorkspacesDetail } from '../src/renderer/ui/settings/FoundWorkspacesSettings';
import { CommandResults } from '../src/renderer/commands/CommandResults';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { catalogCommands } from '../src/renderer/commands/window-commands/catalog';
import { windowScopes } from '../src/renderer/commands/window-commands/scope';
import type { WindowActions } from '../src/renderer/commands/window-commands/scope';
import { initialize, activeWorkspace } from '../src/renderer/state/store';
import { getState, savePatch } from '../src/renderer/state/core';
import { clearRecentFolders, undoClearRecentFolders } from '../src/renderer/state/places';
import { flushState } from '../src/renderer/state/persistence';
import { foundDefinitions } from '../src/domain/workspaces/found/catalog';
import { rankWorkspaceChoices } from '../src/domain/workspaces/definitions/query';
import { paletteRows, workspaceRows } from '../src/renderer/commands/palette-sections';
import { hashDefinition, sampleDefinition } from './workspace-definition-fixtures';
import { agentCatalog } from '../src/renderer/commands/agent-catalog';

afterEach(async () => {
  cleanup();
  await flushState(false);
  vi.restoreAllMocks();
});
it('shows Found and a home-relative root in Manage and both palettes, keeping rows human-only', () => {
  const home = '/Users/sample';
  const definitions = foundDefinitions(
    [
      {
        key: 'code/sample-cli',
        root: home + '/code/sample-cli',
        realpath: home + '/code/sample-cli',
        identity: '1:2',
        names: [],
        at: 1,
      },
    ],
    [],
    home,
    hashDefinition,
  );
  Object.assign(window, {
    viewer: { workspaceDefinitionFile: vi.fn(async () => catalog), save: vi.fn() },
  });
  const catalog = {
    revision: 1,
    file: { path: '/data/workspaces.jsonc', state: 'absent' as const },
    projectManager: {
      path: '/source/projects.json',
      state: 'off' as const,
      enabled: false,
      projects: 0,
      missing: 0,
      disabled: 0,
      remote: 0,
      duplicateKeys: 0,
    },
    definitions,
    diagnostics: [],
  };
  initialize({
    home,
    platform: 'darwin',
    state: null,
    openPaths: [],
    locations: [],
    definitions: catalog,
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  const view = render(
    <WorkspacesDialog
      initialTab="defined"
      onClose={() => {}}
      onOpen={async () => {}}
      onAction={() => {}}
    />,
  );
  expect(view.getByText('Found')).toBeTruthy();
  expect(view.getByText('~/code/sample-cli')).toBeTruthy();
  cleanup();
  const host = {
    ready: true,
    workspaceDialog: vi.fn(),
    switchWorkspace: vi.fn(),
  } as unknown as WindowActions;
  const raw = catalogCommands(windowScopes(host));
  expect(raw.find((row) => row.id === 'defined:code/sample-cli')!.humanOnly).toBe(true);
  const registry = new CommandRegistry();
  registry.register('window', {
    context: () => ({
      scope: 'window',
      workspaceID: activeWorkspace().id,
      selection: [],
      jobs: [],
      clipboard: null,
    }),
    definitions: () => raw,
  });
  const commands = registry.list({ scope: 'window' });
  const choices = rankWorkspaceChoices([], definitions, 'samplecli');
  for (const rows of [
    paletteRows(commands, 'samplecli', [], choices).rows,
    workspaceRows(commands, choices, 'samplecli', 1).rows,
  ]) {
    const row = rows.find((item) => item.id.startsWith('defined:'))!;
    expect(row.detail).toBe('~/code/sample-cli');
    expect(row.badge).toBe('Found');
  }
  const rows = workspaceRows(commands, choices, 'samplecli', 1).rows;
  const results = render(
    <CommandResults
      query="samplecli"
      rows={rows}
      onQuery={() => {}}
      onSelect={() => {}}
      onClose={() => {}}
    />,
  );
  expect(results.getByText('Found')).toBeTruthy();
  expect(results.getByText('Found').closest('.command-result-text')).toBeNull();
  expect(
    agentCatalog(registry, {
      scope: 'window',
      workspaceID: activeWorkspace().id,
      selection: [],
      jobs: [],
      clipboard: null,
    }).some((row) => row.id.startsWith('defined:')),
  ).toBe(false);
});

const home = '/Users/sample';
const foundEntry = (name: string) => ({
  key: 'code/' + name,
  root: home + '/code/' + name,
  realpath: home + '/code/' + name,
  identity: '1:' + name.length,
  names: [],
  at: 1,
});
const catalogOf = (
  definitions: WorkspaceDefinition[],
  revision = 1,
  found: DefinitionCatalog['found'] = { state: 'ready', count: definitions.length, hidden: 0 },
): DefinitionCatalog => ({
  revision,
  file: { path: '/data/workspaces.jsonc', state: 'absent' },
  projectManager: {
    path: '/source/projects.json',
    state: 'off',
    enabled: false,
    projects: 0,
    missing: 0,
    disabled: 0,
    remote: 0,
    duplicateKeys: 0,
  },
  found,
  definitions,
  diagnostics: [],
});
function manage(
  catalog: DefinitionCatalog,
  reply: (request: { kind: string }) => DefinitionCatalog,
) {
  const workspaceDefinitionFile = vi.fn(async (request: { kind: string }) => reply(request));
  Object.assign(window, { viewer: { workspaceDefinitionFile, save: vi.fn() } });
  initialize({
    home,
    platform: 'darwin',
    state: null,
    openPaths: [],
    locations: [],
    definitions: catalog,
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  const view = render(
    <WorkspacesDialog
      initialTab="defined"
      onClose={() => {}}
      onOpen={async () => {}}
      onAction={() => {}}
    />,
  );
  return { view, workspaceDefinitionFile };
}

describe('Not a Workspace', () => {
  const definitions = foundDefinitions(
    [foundEntry('sample-cli'), foundEntry('notes')],
    [],
    home,
    hashDefinition,
  );
  const [cli, notes] = definitions as [WorkspaceDefinition, WorkspaceDefinition];
  const found = (hidden: number): DefinitionCatalog['found'] => ({
    state: 'ready',
    count: 2 - hidden,
    hidden,
  });
  /** The notice: only its words are live, Undo and Forget Planes… sit beside them. */
  const notice = (view: ReturnType<typeof render>) =>
    view.container.querySelector<HTMLElement>('.workspace-catalog-count')!;

  it('hides a found row with the person’s request and offers Undo for eight seconds', async () => {
    const { view, workspaceDefinitionFile } = manage(
      catalogOf(definitions, 1, found(0)),
      (request) =>
        request.kind === 'not-a-workspace'
          ? catalogOf([notes], 2, found(1))
          : request.kind === 'show-found'
            ? catalogOf(definitions, 3, found(0))
            : catalogOf(definitions, 1, found(0)),
    );
    // found rows have no workspaces.jsonc entry to edit
    expect(
      view.queryByRole('button', { name: /^edit workspace definitions for sample-cli$/i }),
    ).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Not a Workspace: sample-cli' }));
    await waitFor(() => expect(view.queryByText('sample-cli')).toBeNull());
    expect(workspaceDefinitionFile).toHaveBeenCalledWith({ kind: 'not-a-workspace', key: cli.key });
    const status = within(notice(view)).getByRole('status');
    expect(status.textContent).toBe('Hid “sample-cli”');
    // a long name gives way in the footer: the whole notice is on hover
    expect(status.getAttribute('title')).toBe('Hid “sample-cli”');
    expect(within(status).queryByRole('button')).toBeNull();
    const undo = within(notice(view)).getByRole('button', { name: 'Undo' });
    await waitFor(() => expect(document.activeElement).toBe(undo));
    fireEvent.click(undo);
    await waitFor(() => expect(view.getByText('sample-cli')).toBeTruthy());
    expect(workspaceDefinitionFile).toHaveBeenCalledWith({ kind: 'show-found', root: cli.root });
    expect(within(notice(view)).getByRole('status').textContent).toBe('2 definitions');
    await waitFor(() =>
      expect(document.activeElement).toBe(
        view.getByRole('searchbox', { name: 'Search definitions' }),
      ),
    );
    expect(getState().notice).toBeNull();
  });

  it('says so when the desktop answers that Undo showed nothing', async () => {
    // another window showed it already, then hid another: the counts alone would not say so
    const { view } = manage(catalogOf(definitions, 1, found(0)), (request) =>
      request.kind === 'not-a-workspace'
        ? catalogOf([notes], 2, found(1))
        : { ...catalogOf(definitions, 3, found(0)), changed: 0 },
    );
    fireEvent.click(view.getByRole('button', { name: 'Not a Workspace: sample-cli' }));
    fireEvent.click(await within(notice(view)).findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(getState().notice).toBe('“sample-cli” was already shown again.'));
  });

  it('waits while Forget Planes… asks, so Cancel leaves Undo', async () => {
    const remembering = { ...cli, remembered: { at: 5, basis: cli.basis, planes: 4 } };
    const { view } = manage(catalogOf([remembering, notes], 1, found(0)), (request) =>
      request.kind === 'not-a-workspace'
        ? catalogOf([notes], 2, found(1))
        : catalogOf([remembering, notes], 1, found(0)),
    );
    vi.useFakeTimers();
    try {
      fireEvent.click(view.getByRole('button', { name: 'Not a Workspace: sample-cli' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      fireEvent.click(within(notice(view)).getByRole('button', { name: 'Forget Planes…' }));
      const confirmation = view.getByRole('dialog', { name: 'Forget remembered planes?' });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(7900);
      });
      expect(within(notice(view)).getByRole('button', { name: 'Undo' })).toBeTruthy();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(within(notice(view)).queryByRole('button', { name: 'Undo' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the notice across tabs and offers to forget remembered planes', async () => {
    const remembering = { ...cli, remembered: { at: 5, basis: cli.basis, planes: 4 } };
    const forget = vi.fn(async () => ({ kind: 'forgotten' as const }));
    const { view } = manage(catalogOf([remembering, notes], 1, found(0)), (request) =>
      request.kind === 'not-a-workspace'
        ? catalogOf([notes], 2, found(1))
        : catalogOf([notes], 2, found(1)),
    );
    Object.assign(window.viewer, { workspaceDefinitions: forget });
    expect(view.getByText('Remembers 4 planes')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Not a Workspace: sample-cli' }));
    await waitFor(() =>
      expect(within(notice(view)).getByRole('status').textContent).toBe(
        'Hid “sample-cli” · remembers 4 planes',
      ),
    );
    fireEvent.click(view.getByRole('tab', { name: /^Open/ }));
    expect(within(notice(view)).getByRole('status').textContent).toBe(
      'Hid “sample-cli” · remembers 4 planes',
    );
    expect(within(notice(view)).getByRole('button', { name: 'Undo' })).toBeTruthy();
    fireEvent.click(view.getByRole('tab', { name: /^Defined/ }));
    fireEvent.click(within(notice(view)).getByRole('button', { name: 'Forget Planes…' }));
    const confirmation = view.getByRole('dialog', { name: 'Forget remembered planes?' });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Forget Remembered Planes' }));
    await waitFor(() => expect(forget).toHaveBeenCalledWith({ kind: 'forget', key: cli.key }));
    await waitFor(() =>
      expect(within(notice(view)).getByRole('status').textContent).toBe('Hid “sample-cli”'),
    );
    expect(within(notice(view)).queryByRole('button', { name: 'Forget Planes…' })).toBeNull();
  });

  it('lets the notice go after eight seconds', async () => {
    const { view } = manage(catalogOf(definitions), (request) =>
      request.kind === 'not-a-workspace' ? catalogOf([notes], 2) : catalogOf(definitions),
    );
    // fake time alone: a busy machine cannot move the eight seconds
    vi.useFakeTimers();
    try {
      fireEvent.click(view.getByRole('button', { name: 'Not a Workspace: sample-cli' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(document.activeElement).toBe(view.getByRole('button', { name: 'Undo' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(7850);
      });
      expect(view.getByText('Hid “sample-cli”')).toBeTruthy();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(view.queryByText('Hid “sample-cli”')).toBeNull();
      expect(view.getByText('1 definition')).toBeTruthy();
      // focus Undo held returns to the search field
      expect(document.activeElement).toBe(
        view.getByRole('searchbox', { name: 'Search definitions' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks to close an open found workspace first', () => {
    const { view } = manage(catalogOf(definitions), () => catalogOf(definitions));
    act(() =>
      savePatch({
        workspaces: getState().saved.workspaces.map((space) => ({
          ...space,
          definition: { key: cli.key, basis: cli.basis, source: 'found' as const },
        })),
      }),
    );
    const button = view.getByRole('button', { name: 'Not a Workspace: sample-cli' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('title')).toBe('Close “sample-cli” first.');
  });
});

describe('found workspaces in Settings', () => {
  let listener: ((event: { type: string; catalog?: DefinitionCatalog }) => void) | undefined;
  function settings(reply: (request: { kind: string }) => Promise<DefinitionCatalog>) {
    const workspaceDefinitionFile = vi.fn(reply);
    Object.assign(window, {
      viewer: {
        workspaceDefinitionFile,
        onEvent: (next: typeof listener) => {
          listener = next;
          return () => {};
        },
        save: vi.fn(),
      },
    });
    return { workspaceDefinitionFile, view: render(<FoundWorkspacesDetail />) };
  }

  it('names the count it shows again, with Undo for eight seconds', async () => {
    // the desktop says how many it showed: one of the two was shown elsewhere meanwhile
    const { view, workspaceDefinitionFile } = settings(async (request) =>
      request.kind === 'show-found'
        ? { ...catalogOf([], 3, { state: 'ready', count: 14, hidden: 0 }), changed: 1 }
        : request.kind === 'hide-found-again'
          ? { ...catalogOf([], 4, { state: 'ready', count: 12, hidden: 2 }), changed: 1 }
          : catalogOf([], 2, { state: 'ready', count: 12, hidden: 2 }),
    );
    await waitFor(() => expect(view.getByText('12 found · 2 hidden')).toBeTruthy());
    fireEvent.click(view.getByRole('button', { name: 'Show 2 Hidden Workspaces' }));
    await waitFor(() => expect(view.getByText('14 found · 1 shown again')).toBeTruthy());
    expect(workspaceDefinitionFile).toHaveBeenCalledWith({ kind: 'show-found' });
    const undo = view.getByRole('button', { name: 'Undo' });
    await waitFor(() => expect(document.activeElement).toBe(undo));
    fireEvent.click(undo);
    await waitFor(() => expect(view.getByText('12 found · 2 hidden')).toBeTruthy());
    expect(workspaceDefinitionFile).toHaveBeenCalledWith({ kind: 'hide-found-again' });
    expect(view.getByRole('button', { name: 'Show 2 Hidden Workspaces' })).toBeTruthy();
  });

  it('keeps the newest counts when a pass and a reply cross', async () => {
    let finish!: (catalog: DefinitionCatalog) => void;
    const { view } = settings((request) =>
      request.kind === 'show-found'
        ? new Promise((resolve) => (finish = resolve))
        : Promise.resolve(catalogOf([], 2, { state: 'ready', count: 1, hidden: 1 })),
    );
    await waitFor(() => expect(view.getByText('1 found · 1 hidden')).toBeTruthy());
    fireEvent.click(view.getByRole('button', { name: 'Show 1 Hidden Workspace' }));
    // a pass reports first, then the older reply arrives: the counts do not step back
    act(() =>
      listener?.({
        type: 'workspace-definitions',
        catalog: catalogOf([], 5, { state: 'ready', count: 3, hidden: 0 }),
      }),
    );
    await act(async () =>
      finish({ ...catalogOf([], 4, { state: 'ready', count: 2, hidden: 0 }), changed: 1 }),
    );
    expect(view.getByRole('status').textContent).toBe('3 found · 1 shown again');
  });

  it('moves focus from an expired Undo to the finding switch, never the page', async () => {
    const { workspaceDefinitionFile } = settings(async (request) =>
      request.kind === 'show-found'
        ? { ...catalogOf([], 3, { state: 'ready', count: 14, hidden: 0 }), changed: 2 }
        : catalogOf([], 2, { state: 'ready', count: 12, hidden: 2 }),
    );
    cleanup();
    const view = render(
      <>
        <label data-setting-path="settings.browsing.findWorkspaces">
          Suggest workspaces from folders you open
          <input type="checkbox" role="switch" />
        </label>
        <FoundWorkspacesDetail />
      </>,
    );
    await waitFor(() => expect(view.getByText('12 found · 2 hidden')).toBeTruthy());
    vi.useFakeTimers();
    try {
      fireEvent.click(view.getByRole('button', { name: 'Show 2 Hidden Workspaces' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(workspaceDefinitionFile).toHaveBeenCalledWith({ kind: 'show-found' });
      expect(document.activeElement).toBe(view.getByRole('button', { name: 'Undo' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8000);
      });
      expect(view.queryByRole('button', { name: 'Undo' })).toBeNull();
      expect(document.activeElement).toBe(view.getByRole('switch'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps focus in its row when Undo leaves and no switch is beside it', async () => {
    const { view } = settings(async (request) =>
      request.kind === 'show-found'
        ? { ...catalogOf([], 3, { state: 'ready', count: 14, hidden: 0 }), changed: 2 }
        : catalogOf([], 2, { state: 'ready', count: 12, hidden: 2 }),
    );
    await waitFor(() => expect(view.getByText('12 found · 2 hidden')).toBeTruthy());
    vi.useFakeTimers();
    try {
      fireEvent.click(view.getByRole('button', { name: 'Show 2 Hidden Workspaces' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(document.activeElement).toBe(view.getByRole('button', { name: 'Undo' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8000);
      });
      expect(document.activeElement).toBe(
        view.container.querySelector('.settings-found-workspaces'),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('says so when its Undo finds the roots hidden already', async () => {
    const { view } = settings(async (request) =>
      request.kind === 'show-found'
        ? { ...catalogOf([], 3, { state: 'ready', count: 14, hidden: 0 }), changed: 2 }
        : request.kind === 'hide-found-again'
          ? { ...catalogOf([], 4, { state: 'ready', count: 12, hidden: 2 }), changed: 0 }
          : catalogOf([], 2, { state: 'ready', count: 12, hidden: 2 }),
    );
    fireEvent.click(await view.findByRole('button', { name: 'Show 2 Hidden Workspaces' }));
    fireEvent.click(await view.findByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(view.getByRole('status').textContent).toBe('Those folders are hidden already.'),
    );
  });

  it('keeps hidden roots reachable while finding is off', async () => {
    const { view } = settings(async () => catalogOf([], 2, { state: 'off', count: 0, hidden: 2 }));
    await waitFor(() => expect(view.getByText('2 hidden')).toBeTruthy());
    expect(view.getByRole('button', { name: 'Show 2 Hidden Workspaces' })).toBeTruthy();
  });
});

describe('an empty Change workspace…', () => {
  const found = foundDefinitions(
    ['alpha', 'bravo', 'charlie', 'delta'].map(foundEntry),
    [],
    home,
    hashDefinition,
  );
  const recent = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      sampleDefinition('sample/recent-' + index, { openedAt: index + 1 }),
    );
  const command = (id: string): ResolvedCommand => ({
    id,
    label: id,
    aliases: [],
    source: 'window',
    group: 'Workspaces',
    primary: false,
    context: { scope: 'window', workspaceID: 'open', selection: [], jobs: [], clipboard: null },
  });
  const listed = (definitions: WorkspaceDefinition[]) =>
    workspaceRows(
      definitions.map((definition) => command('defined:' + definition.key)),
      rankWorkspaceChoices([], definitions, ''),
      '',
      definitions.length,
      definitions,
    ).rows.map((row) => row.id.replace('defined:', ''));

  it('fills a short list with three never-opened found workspaces in the catalog’s order', () => {
    // the catalog ranks found workspaces by use; their keys sort otherwise
    const ranked = [found[3]!, found[1]!, found[0]!, found[2]!];
    expect(listed([...recent(2), ...ranked])).toEqual([
      'sample/recent-1',
      'sample/recent-0',
      'code/delta',
      'code/bravo',
      'code/alpha',
    ]);
    const view = workspaceRows(
      ranked.map((definition) => command('defined:' + definition.key)),
      rankWorkspaceChoices([], ranked, ''),
      '',
      ranked.length,
      ranked,
    );
    expect(view.headings.get('defined:code/delta')).toBe('Defined');
  });

  it('fills only up to eight and not at all once eight recent definitions show', () => {
    expect(listed([...recent(6), ...found]).filter((key) => key.startsWith('code/'))).toHaveLength(
      2,
    );
    expect(listed([...recent(8), ...found]).filter((key) => key.startsWith('code/'))).toEqual([]);
    // a found workspace opened before is a recent definition, not a fill
    const opened = { ...found[0]!, openedAt: 50 };
    expect(listed([opened, ...found.slice(1)])).toEqual([
      'code/alpha',
      'code/bravo',
      'code/charlie',
      'code/delta',
    ]);
    // typing searches every definition instead
    expect(
      workspaceRows(
        found.map((definition) => command('defined:' + definition.key)),
        rankWorkspaceChoices([], found, 'zzz'),
        'zzz',
        found.length,
        found,
      ).rows,
    ).toEqual([]);
  });
});

describe('Clear Recent Folders and dismissed offers', () => {
  it('brings back with its Undo the dismissals Clear removed', async () => {
    const workspaceDefinitionFile = vi.fn(async () => catalogOf([], 9));
    Object.assign(window, { viewer: { workspaceDefinitionFile, save: vi.fn() } });
    initialize({ home, platform: 'darwin', state: null, openPaths: [], locations: [] });
    // Immediate pre-flush Undo cancels locally without contacting desktop.
    clearRecentFolders();
    undoClearRecentFolders();
    expect(workspaceDefinitionFile).not.toHaveBeenCalled();
    // Once Clear has flushed to desktop, Undo restores dismissed offers.
    clearRecentFolders();
    await flushState(false);
    expect(workspaceDefinitionFile).not.toHaveBeenCalled();
    undoClearRecentFolders();
    await waitFor(() =>
      expect(workspaceDefinitionFile).toHaveBeenCalledWith({ kind: 'restore-offers' }),
    );
  });
});
