import { describe, expect, it } from 'vitest';
import type { ResolvedCommand } from '../src/renderer/commands/registry';
import {
  paletteRows,
  workspaceRows,
  moreWorkspacesID,
  unavailableRows,
} from '../src/renderer/commands/palette-sections';
import {
  anchoredDefinitionMatch,
  rankWorkspaceChoices,
} from '../src/domain/workspaces/definitions/query';
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
  it('lists in the main palette only definitions whose words the typing starts', () => {
    const speech = sampleDefinition('sample/technologies/experiments/transview/transview-speech', {
      name: 'transview-speech',
    });
    const cli = sampleDefinition('sample/technologies/tools/sample-cli', { name: 'sample-cli' });
    const viewer = sampleDefinition('sample/technologies/tools/viewer', { name: 'viewer' });
    const all = [speech, cli, viewer];
    const rows = [
      row('file-overview', 'File overview'),
      ...all.map((definition) => row('defined:' + definition.key, definition.name)),
    ];
    const listed = (query: string) =>
      paletteRows(rows, query, [], rankWorkspaceChoices([], all, query))
        .rows.filter((item) => item.id.startsWith('defined:'))
        .map((item) => item.label);
    // scattered letters across "technologies/…/transview" are not a name
    expect(rankWorkspaceChoices([], all, 'overview').map((choice) => choice.key)).toContain(
      speech.key,
    );
    expect(listed('overview')).toEqual([]);
    expect(listed('view')).toEqual(['viewer']);
    expect(listed('sacli')).toEqual(['sample-cli']);
    expect(listed('tools/sample-cli')).toEqual(['sample-cli']);
    expect(listed('trans speech')).toEqual(['transview-speech']);
    // Change workspace… keeps the loose search
    expect(
      workspaceRows(rows, rankWorkspaceChoices([], all, 'overview'), 'overview', 3).rows.map(
        (item) => item.label,
      ),
    ).toContain('transview-speech');
  });

  // keys hold none of the words under test, so only the name or alias can match
  const named = (name: string, aliases: string[] = []) =>
    sampleDefinition('sample/q/x', { name, aliases });

  it('finds word starts across punctuation, case changes and capital runs', () => {
    expect(anchoredDefinitionMatch(named('PluridViewer'), 'viewer')).toBe(true);
    expect(anchoredDefinitionMatch(named('PluridViewer'), 'pv')).toBe(true);
    expect(anchoredDefinitionMatch(named('XMLParser'), 'parser')).toBe(true);
    expect(anchoredDefinitionMatch(named('@acme/ui-kit'), 'acme')).toBe(true);
    expect(anchoredDefinitionMatch(named('Desktop (Electron)'), 'electron')).toBe(true);
    expect(anchoredDefinitionMatch(named('pluridviewer'), 'viewer')).toBe(false);
  });

  it('folds accents and marks alike on both sides, so exact names in any script match', () => {
    for (const name of [
      'Crème Brûlée',
      'がっこう',
      'デザイン',
      'हिन्दी',
      'שָׁלוֹם',
      'สวัสดี',
      '한국어',
    ])
      expect(anchoredDefinitionMatch(named(name), name)).toBe(true);
    expect(anchoredDefinitionMatch(named('Crème Brûlée'), 'creme brulee')).toBe(true);
    expect(anchoredDefinitionMatch(named('Creme Brulee'), 'crème brûlée')).toBe(true);
    // a dropped mark joins its word: "Crème" is one word, so "me" does not start one
    expect(anchoredDefinitionMatch(named('Crème'), 'me')).toBe(false);
    // letters with no decomposition fold to what people type
    expect(anchoredDefinitionMatch(named('Łódź office'), 'lodz')).toBe(true);
    expect(anchoredDefinitionMatch(named('Đà Nẵng'), 'da nang')).toBe(true);
    expect(anchoredDefinitionMatch(named('Øresund'), 'oresund')).toBe(true);
    expect(anchoredDefinitionMatch(named('Straße'), 'strasse')).toBe(true);
    expect(anchoredDefinitionMatch(named('Strasse'), 'straße')).toBe(true);
  });

  it('matches aliases, terms in any order, but word starts only in order within a term', () => {
    expect(anchoredDefinitionMatch(named('Shop', ['storefront']), 'store')).toBe(true);
    expect(anchoredDefinitionMatch(named('Shop'), 'store')).toBe(false);
    expect(anchoredDefinitionMatch(named('plurid-cli'), 'cli plurid')).toBe(true);
    expect(anchoredDefinitionMatch(named('plurid-cli'), 'plcli')).toBe(true);
    expect(anchoredDefinitionMatch(named('plurid-cli'), 'clipl')).toBe(false);
    // every typed letter is used: "pluridx" is not "plurid" plus a stray letter
    expect(anchoredDefinitionMatch(named('plurid-cli'), 'pluridx')).toBe(false);
    // the longest shared start is not always the right one: "a" + "bcd", not "abc" + "d"
    expect(anchoredDefinitionMatch(named('abc bcd'), 'abcd')).toBe(true);
  });

  it('lists nothing for separators alone and caps a term at 100 letters', () => {
    const one = named('sample-cli');
    const rows = [row('defined:' + one.key, one.name)];
    for (const query of ['//', '/ /'])
      expect(
        paletteRows(rows, query, [], rankWorkspaceChoices([], [one], query)).rows,
      ).toHaveLength(0);
    expect(anchoredDefinitionMatch(named('s'.repeat(100)), 's'.repeat(100))).toBe(true);
    expect(anchoredDefinitionMatch(named('s'.repeat(101)), 's'.repeat(101))).toBe(false);
  });

  it('keeps the loose search one row away when nothing else matches', () => {
    const viewer = sampleDefinition('sample/tools/viewer', { name: 'viewer' });
    const choices = rankWorkspaceChoices([], [viewer], 'veiwer');
    expect(choices.map((choice) => choice.key)).toEqual([viewer.key]);
    const alone = paletteRows([row('defined:' + viewer.key, 'viewer')], 'veiwer', [], choices);
    expect(alone.rows.map((item) => item.id)).toEqual([moreWorkspacesID]);
    expect(alone.rows[0]!.label).toBe('All 1 matching workspaces');
    const beside = paletteRows(
      [row('veiwer-command', 'Veiwer command'), row('defined:' + viewer.key, 'viewer')],
      'veiwer',
      [],
      choices,
    );
    expect(beside.rows.map((item) => item.id)).toEqual(['veiwer-command']);
  });

  it('decides a failing word-start match over repeated words in bounded time', () => {
    // without remembering failed (letter, word) pairs this takes seconds; with it, well under 1 ms
    const heavy = named(Array.from({ length: 16 }, () => 'aaaa').join(' '));
    const started = performance.now();
    expect(anchoredDefinitionMatch(heavy, 'a'.repeat(15) + 'b')).toBe(false);
    expect(performance.now() - started).toBeLessThan(500);
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
