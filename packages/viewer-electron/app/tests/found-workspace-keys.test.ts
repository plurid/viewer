import { expect, it } from 'vitest';
import { definitionKeySchema } from '../src/domain/workspaces/definitions/schema';
import { foundAliases, foundKey, foundName } from '../src/domain/workspaces/found/keys';
import { foundDefinitions } from '../src/domain/workspaces/found/catalog';
import { sampleDefinition } from './workspace-definition-fixtures';
import { definitionBasis } from '../src/domain/workspaces/definitions/catalog';

it('uses stable portable keys, bounded segments and deterministic collisions', () => {
  const home = '/Users/sample';
  const key = foundKey(home + '/Projects/café site', home);
  expect(key).toMatch(/^Projects\/cafe-site-[a-f0-9]{8}$/);
  const collision = foundKey(home + '/Projects/café site', home, new Set([key]));
  expect(collision).not.toBe(key);
  expect(collision).toBe(foundKey(home + '/Projects/café site', home, new Set([key])));
  for (const root of [
    home + '/' + Array(20).fill('part').join('/'),
    home + '/' + 'long'.repeat(200),
  ]) {
    const key = foundKey(root, home);
    expect(definitionKeySchema.safeParse(key).success).toBe(true);
    expect(foundKey(root, home)).toBe(key);
  }
  expect(foundName(home + '/sample/site')).toBe('sample site');
  expect(foundAliases(['sample', 'sample', '@sample/ui', 'third', 'fourth'])).toEqual([
    'sample',
    '@sample/ui',
    'third',
  ]);
});

it('shares canonical basis hashing and lets explicit path and realpath roots win', () => {
  const root = '/Users/sample/code/sample';
  const entry = {
    key: 'code/sample',
    root,
    realpath: root,
    identity: '1:2',
    names: ['sample'],
    at: 1,
  };
  const hash = (text: string) => text;
  const [found] = foundDefinitions([entry], [], '/Users/sample', hash);
  expect(found!.source).toBe('found');
  expect(found!.basis).toBe(definitionBasis({ ...found!, name: 'changed' } as typeof found, hash));
  const explicit = { ...sampleDefinition(), root: '/Users/sample/link' };
  expect(foundDefinitions([entry], [explicit], '/Users/sample', hash, () => root)).toEqual([]);
  expect(foundDefinitions([entry], [{ ...explicit, root }], '/Users/sample', hash)).toEqual([]);
});
