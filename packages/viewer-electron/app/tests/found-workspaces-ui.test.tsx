// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { WorkspacesDialog } from '../src/renderer/ui/workspace/WorkspacesDialog';
import { CommandResults } from '../src/renderer/commands/CommandResults';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { catalogCommands } from '../src/renderer/commands/window-commands/catalog';
import { windowScopes } from '../src/renderer/commands/window-commands/scope';
import type { WindowActions } from '../src/renderer/commands/window-commands/scope';
import { initialize, activeWorkspace } from '../src/renderer/state/store';
import { flushState } from '../src/renderer/state/persistence';
import { foundDefinitions } from '../src/domain/workspaces/found/catalog';
import { rankWorkspaceChoices } from '../src/domain/workspaces/definitions/query';
import { paletteRows, workspaceRows } from '../src/renderer/commands/palette-sections';
import { hashDefinition } from './workspace-definition-fixtures';
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
