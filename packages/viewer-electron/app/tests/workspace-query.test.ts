import { describe, expect, it } from 'vitest';
import {
  rankWorkspaceChoices,
  resolveWorkspaceQuery,
} from '../src/domain/workspaces/definitions/query';
import { sampleDefinition, sampleWorkspace } from './workspace-definition-fixtures';

describe('workspace CLI resolution order', () => {
  it('keeps weak fuzzy matches ambiguous even when the palette would drop them', () => {
    const strong = sampleDefinition('one', { name: 'Alphabet', projectName: undefined });
    const weak = sampleDefinition('two', { name: 'a---l---p---h---a', projectName: undefined });
    expect(rankWorkspaceChoices([], [strong, weak], 'alpha')).toHaveLength(1);
    expect(resolveWorkspaceQuery([], [strong, weak], 'alpha')).toEqual({
      kind: 'picker',
      query: 'alpha',
    });
  });
  it('resolves an exact open ID before an open name or a definition key', () => {
    const open = [
      sampleWorkspace('sample/site'),
      sampleWorkspace('other', { name: 'sample/site' }),
    ];
    expect(resolveWorkspaceQuery(open, [sampleDefinition()], 'sample/site')).toEqual({
      kind: 'open',
      workspaceID: 'sample/site',
    });
  });
  it('resolves a unique open name before a definition key', () => {
    expect(
      resolveWorkspaceQuery(
        [sampleWorkspace('id', { name: 'sample/site' })],
        [sampleDefinition()],
        'sample/site',
      ),
    ).toEqual({ kind: 'open', workspaceID: 'id' });
  });
  it('resolves an exact key before a case-insensitive key, Project Manager name or alias', () => {
    const definitions = [
      sampleDefinition('North/API'),
      sampleDefinition('north/api', { aliases: ['North/API'] }),
    ];
    expect(resolveWorkspaceQuery([], definitions, 'North/API')).toEqual({
      kind: 'defined',
      key: 'North/API',
    });
    expect(resolveWorkspaceQuery([], definitions, 'NORTH/API').kind).toBe('picker');
    expect(resolveWorkspaceQuery([], [definitions[1]!], 'NORTH/API')).toEqual({
      kind: 'defined',
      key: 'north/api',
    });
  });
  it('returns the existing open row for a definition key', () => {
    const definition = sampleDefinition();
    const open = sampleWorkspace('open', {
      definition: { key: definition.key, basis: definition.basis },
    });
    expect(resolveWorkspaceQuery([open], [definition], definition.key)).toEqual({
      kind: 'open',
      workspaceID: open.id,
    });
  });
  it('resolves a unique display name ignoring case before project names, aliases and fuzzy siblings', () => {
    const exact = sampleDefinition('clients/cedar/server', { name: 'Cedar' });
    const sibling = sampleDefinition('clients/cedar/web', { name: 'Cedar web' });
    const alias = sampleDefinition('other', { aliases: ['cedar'], projectName: 'cedar' });
    expect(resolveWorkspaceQuery([], [exact, sibling, alias], 'CEDAR')).toEqual({
      kind: 'defined',
      key: exact.key,
    });
    const open = sampleWorkspace('open', { definition: { key: exact.key, basis: exact.basis } });
    expect(resolveWorkspaceQuery([open], [exact, sibling], 'cedar')).toEqual({
      kind: 'open',
      workspaceID: open.id,
    });
    expect(
      resolveWorkspaceQuery([], [exact, sampleDefinition('second', { name: 'cedar' })], 'cedar')
        .kind,
    ).toBe('picker');
  });
  it('resolves an exact normalized Project Manager name before an alias', () => {
    const definition = sampleDefinition('north/site', { projectName: 'Clients > North > Site' });
    expect(
      resolveWorkspaceQuery(
        [],
        [definition, sampleDefinition('other', { aliases: ['Clients > North > Site'] })],
        'Clients> North > Site',
      ),
    ).toEqual({ kind: 'defined', key: definition.key });
  });
  it('requires a unique alias or fuzzy choice and opens a picker for ambiguities', () => {
    const a = sampleDefinition('north/site', { aliases: ['ns'] });
    const b = sampleDefinition('south/site', { aliases: ['ns'] });
    expect(resolveWorkspaceQuery([], [a], 'NS')).toEqual({ kind: 'defined', key: a.key });
    expect(resolveWorkspaceQuery([], [a, b], 'ns').kind).toBe('picker');
    expect(resolveWorkspaceQuery([], [a], 'nrthst').kind).toBe('defined');
    expect(resolveWorkspaceQuery([], [a, b], 'site').kind).toBe('picker');
    expect(resolveWorkspaceQuery([], [a], 'zzzzzzzz')).toEqual({ kind: 'none', query: 'zzzzzzzz' });
    expect(resolveWorkspaceQuery([], [a], '')).toEqual({ kind: 'picker', query: '' });
  });
  it('keeps hidden and missing definitions out of every CLI matching step', () => {
    for (const definition of [
      sampleDefinition('hidden', { hidden: true }),
      sampleDefinition('missing', { rootState: 'missing' }),
    ]) {
      expect(resolveWorkspaceQuery([], [definition], definition.key).kind).toBe('none');
    }
  });
});

describe('workspace choice ranking', () => {
  it.each(['north', 'plume'])('ranks %s cli in the leaf above the clients segment', (family) => {
    const target = sampleDefinition(`${family}/tools/${family}-cli`);
    const choices = rankWorkspaceChoices(
      [],
      [
        sampleDefinition(`clients/acme/${family}-site`),
        sampleDefinition(`clients/cedar/${family}-web`),
        target,
      ],
      `${family} cli`,
    );
    expect(choices[0]!.key).toBe(target.key);
  });
  it('prefers the open row within a band even when its score, recency and key sort later', () => {
    const open = sampleWorkspace('zzz', { name: 'Site archive' });
    const definition = sampleDefinition('aaa', { name: 'Site', openedAt: 100 });
    const choices = rankWorkspaceChoices([open], [definition], 'site');
    expect(choices[0]!.id).toBe('workspace:zzz');
  });
  it('scores an exact alias above a name prefix and an alias prefix above a path subsequence', () => {
    const aliased = sampleDefinition('zebra', { name: 'Unrelated', aliases: ['launchpad'] });
    const named = sampleDefinition('alpha', { name: 'Launchpad tools' });
    expect(rankWorkspaceChoices([], [named, aliased], 'launchpad')[0]!.key).toBe('zebra');
    expect(
      rankWorkspaceChoices([], [sampleDefinition('l/a/u/n/c/h'), aliased], 'launch')[0]!.key,
    ).toBe('zebra');
  });
  it('shows an open definition once and leads with open choices within a band', () => {
    const a = sampleDefinition('north/site', { name: 'Site' });
    const b = sampleDefinition('south/site', { name: 'Site' });
    const open = sampleWorkspace('open', {
      name: 'Site',
      definition: { key: a.key, basis: a.basis },
    });
    expect(rankWorkspaceChoices([open], [a, b], 'site').map((choice) => choice.id)).toEqual([
      'workspace:open',
      'defined:south/site',
    ]);
  });
  it('never drops a weak open match when a stronger definition exists', () => {
    const weak = sampleWorkspace('weak', { name: 'a----b----c' });
    expect(
      rankWorkspaceChoices([weak], [sampleDefinition('abc', { name: 'abc' })], 'abc').some(
        (choice) => choice.id === 'workspace:weak',
      ),
    ).toBe(true);
  });
  it('orders empty-query open rows and definitions by recency without showing hidden entries', () => {
    const choices = rankWorkspaceChoices(
      [sampleWorkspace('old'), sampleWorkspace('recent')],
      [sampleDefinition('hidden', { hidden: true }), sampleDefinition('unknown')],
      '',
      { recent: 2, old: 1 },
    );
    expect(choices.map((choice) => choice.id)).toEqual([
      'workspace:recent',
      'workspace:old',
      'defined:unknown',
    ]);
  });
});
