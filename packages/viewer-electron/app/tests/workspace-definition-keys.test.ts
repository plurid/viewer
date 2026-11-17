import { describe, expect, it } from 'vitest';
import {
  keyFor,
  roleWords,
  slug,
  stubName,
  uniqueKey,
} from '../src/domain/workspaces/definitions/keys';
import { definitionKeySchema } from '../src/domain/workspaces/definitions/schema';

describe('txpl key parity', () => {
  it.each([
    ['atlas > technologies > tools > atlas-cli', 'atlas/technologies/tools/atlas-cli'],
    [' _outside > servers > north-api ', '_outside/servers/north-api'],
    [' > Acme > > Road Runner! > ', 'Acme/Road-Runner'],
    ['-- a --- b --', 'a-b'],
    ['???', 'x'],
    ['', 'x'],
  ])('keeps the txpl spelling of %s', (name, key) => expect(keyFor(name)).toBe(key));
  it('folds diacritics and keeps case and safe punctuation', () => {
    expect(keyFor('Țară > Élève > v1.2_api')).toBe('Tara/Eleve/v1.2_api');
    expect(slug('A  B__C..D')).toBe('A-B__C..D');
  });
  it('deduplicates in input order without displacing an earlier assigned key', () => {
    const taken = new Set(['north/api', 'north/api-2']);
    expect(uniqueKey('north/api', taken)).toBe('north/api-3');
  });
  it('ports every txpl role word and prefixes generic leaf names', () => {
    expect(roleWords.size).toBe(32);
    for (const role of roleWords)
      expect(stubName(`Clients > North > ${role}`)).toBe(`North ${role}`);
    expect(stubName('Clients > North > observatory')).toBe('observatory');
  });
  it.each(['.', '..', 'a/../b', 'a//b', 'a\\b', '/a', 'a/'.repeat(8) + 'a', 'a'.repeat(201)])(
    'refuses unsafe key %s',
    (key) => {
      expect(definitionKeySchema.safeParse(key).success).toBe(false);
    },
  );
});
