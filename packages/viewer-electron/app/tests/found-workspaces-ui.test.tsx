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

  it('hides a found row with the person’s request and offers Undo for eight seconds', async () => {
    const { view, workspaceDefinitionFile } = manage(catalogOf(definitions), (request) =>
      request.kind === 'not-a-workspace'
        ? catalogOf([notes], 2, { state: 'ready', count: 1, hidden: 1 })
        : request.kind === 'show-found'
          ? catalogOf(definitions, 3)
          : catalogOf(definitions),
    );
    // found rows have no workspaces.jsonc entry to edit
    expect(
      view.queryByRole('button', { name: /^edit workspace definitions for sample-cli$/i }),
    ).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Not a Workspace: sample-cli' }));
    await waitFor(() => expect(view.queryByText('sample-cli')).toBeNull());
    expect(workspaceDefinitionFile).toHaveBeenCalledWith({ kind: 'not-a-workspace', key: cli.key });
    const status = view.getByText('Hid “sample-cli”').closest('[role="status"]')!;
    const undo = within(status as HTMLElement).getByRole('button', { name: 'Undo' });
    await waitFor(() => expect(document.activeElement).toBe(undo));
    fireEvent.click(undo);
    await waitFor(() => expect(view.getByText('sample-cli')).toBeTruthy());
    expect(workspaceDefinitionFile).toHaveBeenCalledWith({ kind: 'show-found', root: cli.root });
    expect(view.queryByText('Hid “sample-cli”')).toBeNull();
    expect(document.activeElement).toBe(
      view.getByRole('searchbox', { name: 'Search definitions' }),
    );
  });

  it('lets the notice go after eight seconds', async () => {
    const { view } = manage(catalogOf(definitions), (request) =>
      request.kind === 'not-a-workspace' ? catalogOf([notes], 2) : catalogOf(definitions),
    );
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.click(view.getByRole('button', { name: 'Not a Workspace: sample-cli' }));
      await waitFor(() =>
        expect(document.activeElement).toBe(view.getByRole('button', { name: 'Undo' })),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(7900);
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
  it('counts found and hidden workspaces and shows hidden ones again', async () => {
    const workspaceDefinitionFile = vi.fn(async (request: { kind: string }) =>
      request.kind === 'show-found'
        ? catalogOf([], 3, { state: 'ready', count: 14, hidden: 0 })
        : catalogOf([], 2, { state: 'ready', count: 12, hidden: 2 }),
    );
    Object.assign(window, {
      viewer: { workspaceDefinitionFile, onEvent: () => () => {}, save: vi.fn() },
    });
    const view = render(<FoundWorkspacesDetail />);
    await waitFor(() => expect(view.getByText('12 found · 2 hidden')).toBeTruthy());
    fireEvent.click(view.getByRole('button', { name: 'Show Hidden Again' }));
    await waitFor(() => expect(view.getByText('14 found')).toBeTruthy());
    expect(workspaceDefinitionFile).toHaveBeenCalledWith({ kind: 'show-found' });
    expect(view.queryByRole('button', { name: 'Show Hidden Again' })).toBeNull();
  });

  it('keeps hidden roots reachable while finding is off', async () => {
    Object.assign(window, {
      viewer: {
        workspaceDefinitionFile: vi.fn(async () =>
          catalogOf([], 2, { state: 'off', count: 0, hidden: 2 }),
        ),
        onEvent: () => () => {},
        save: vi.fn(),
      },
    });
    const view = render(<FoundWorkspacesDetail />);
    await waitFor(() => expect(view.getByText('2 hidden')).toBeTruthy());
    expect(view.getByRole('button', { name: 'Show Hidden Again' })).toBeTruthy();
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
