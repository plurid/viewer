import { describe, expect, it } from 'vitest';
import type { ResolvedCommand } from '../src/renderer/commands/registry';
import {
  paletteRows,
  workspaceRows,
  moreWorkspacesID,
  unavailableRows,
} from '../src/renderer/commands/palette-sections';
import { rankWorkspaceChoices } from '../src/domain/workspaces/definitions/query';
import { sampleDefinition, sampleWorkspace } from './workspace-definition-fixtures';

const context = {
  workspaceID: 'open',
  rootID: 'none',
  paneID: 'none',
  scope: 'window' as const,
  selection: [],
  directory: '/sample',
  jobs: [],
  clipboard: null,
};
const row = (id: string, label: string): ResolvedCommand => ({
  id,
  label,
  aliases: [],
  source: 'window',
  group: 'Workspaces',
  primary: false,
  context,
});
const definitions = Array.from({ length: 12 }, (_, index) =>
  sampleDefinition(`sample/project-${index}`, { name: `Project ${index}`, openedAt: index + 1 }),
);
const commands = definitions.map((definition) => row('defined:' + definition.key, definition.name));

describe('workspace palette sections', () => {
  it('keeps ranked mixed bands in both workspace search and the main palette', () => {
    const definition = sampleDefinition('north/technologies/tools/north-cli');
    const viewer = sampleDefinition('north/technologies/tools/viewer');
    const open = sampleWorkspace('w1', {
      name: viewer.name,
      definition: { key: viewer.key, basis: viewer.basis },
    });
    const choices = rankWorkspaceChoices([open], [viewer, definition], 'nocli');
    const expected = ['defined:' + definition.key, 'workspace:w1'];
    expect(choices.map((choice) => choice.id)).toEqual(expected);
    const rows = [
      row('workspace:w1', open.name),
      row('defined:' + definition.key, definition.name),
    ];
    expect(workspaceRows(rows, choices, 'nocli', 2).rows.map((row) => row.id)).toEqual(expected);
    expect(paletteRows(rows, 'nocli', [], choices).rows.map((row) => row.id)).toEqual(expected);
  });
  it('caps defined search rows at fifty without dropping or reordering open rows', () => {
    const many = Array.from({ length: 70 }, (_, index) =>
      sampleDefinition(`sample/project-${index}`),
    );
    const open = sampleWorkspace('open', { name: 'Project' });
    const choices = rankWorkspaceChoices([open], many, 'project');
    const rows = [
      row('workspace:open', open.name),
      ...many.map((item) => row('defined:' + item.key, item.name)),
    ];
    const view = workspaceRows(rows, choices, 'project', many.length);
    expect(view.rows.filter((row) => row.id.startsWith('defined:'))).toHaveLength(50);
    expect(view.rows.some((row) => row.id === 'workspace:open')).toBe(true);
    expect(view.note).toBe('20 more · keep typing');
  });
  it('keeps one-character open workspace matches while definitions wait for two characters', () => {
    const open = sampleWorkspace('w2', { name: 'Research' });
    const defined = sampleDefinition('research');
    expect(
      paletteRows(
        [
          row('workspace:w2', open.name),
          row('defined:research', defined.name),
          row('reports', 'Open reports'),
        ],
        'r',
        [],
        rankWorkspaceChoices([open], [defined], 'r'),
      ).rows.map((row) => row.id),
    ).toEqual(['workspace:w2', 'reports']);
  });
  it('shows open rows, eight recent definitions and the searchable total on an empty query', () => {
    const open = sampleWorkspace('open');
    const choices = rankWorkspaceChoices([open], definitions, '');
    const view = workspaceRows(
      [row('workspace:open', open.name), ...commands],
      choices,
      '',
      definitions.length,
    );
    expect(view.rows).toHaveLength(9);
    expect(view.rows[0]!.id).toBe('workspace:open');
    expect(view.rows[1]!.label).toBe('Project 11');
    expect(view.headings.get(view.rows[1]!.id)).toBe('Defined');
    expect(view.note).toBe('12 defined workspaces · type to search');
  });
  it('does not list unused definitions until the person types', () => {
    const definition = sampleDefinition();
    const rows = [row('defined:' + definition.key, definition.name)];
    expect(workspaceRows(rows, rankWorkspaceChoices([], [definition], ''), '', 1).rows).toEqual([]);
    expect(
      workspaceRows(rows, rankWorkspaceChoices([], [definition], 'site'), 'site', 1).rows,
    ).toHaveLength(1);
  });
  it('requires two characters, then shows four definitions after commands or eight alone', () => {
    const choices = rankWorkspaceChoices([], definitions, 'project');
    expect(paletteRows(commands, 'p', [], choices).rows).toHaveLength(0);
    const alone = paletteRows(commands, 'project', [], choices);
    expect(alone.rows).toHaveLength(9);
    expect(alone.rows.at(-1)!.id).toBe(moreWorkspacesID);
    expect(alone.rows.at(-1)!.label).toBe('All 12 matching workspaces');
    const withCommand = paletteRows(
      [row('project-command', 'Project action'), ...commands],
      'project',
      [],
      choices,
    );
    expect(withCommand.rows[0]!.id).toBe('project-command');
    expect(withCommand.rows.filter((row) => row.id.startsWith('defined:'))).toHaveLength(4);
  });
  it('keeps every open match even beyond the section budget', () => {
    const open = Array.from({ length: 10 }, (_, index) =>
      sampleWorkspace(String(index), { name: 'Project ' + index }),
    );
    const rows = open.map((workspace) => row('workspace:' + workspace.id, workspace.name));
    expect(
      paletteRows(rows, 'project', [], rankWorkspaceChoices(open, [], 'project')).rows,
    ).toHaveLength(10);
  });
  it('never shows a definition among unavailable commands', () => {
    expect(
      unavailableRows(
        [{ ...commands[0]!, available: false, reason: 'missing root' }],
        'project',
        [],
      ),
    ).toEqual([]);
  });
});
