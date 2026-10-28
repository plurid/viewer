import { expect, it } from 'vitest';
import { searchPattern } from '../src/domain/search/pattern';
import { parseFileQuery, matchesQuery } from '../src/domain/search/query';

it('preserves unanchored, grouped, Unicode and case-insensitive name patterns', () => {
  for (const [source, value, expected] of [
    ['^IMG_\\d+', 'img_123.jpeg', true],
    ['report|notes', 'Research Notes.md', true],
    ['^(?:a|aa)+$', 'a'.repeat(1000), true],
    ['café', 'CAFÉ.epub', true],
    ['\\u{1F4D6}', 'Book 📖.epub', true],
    ['^draft$', 'draft notes.md', false],
  ] as const)
    expect(searchPattern(source).test(value), source).toBe(expected);
});

it('bounds previously catastrophic patterns without backtracking', () => {
  const start = performance.now();
  const query = parseFileQuery('~"(a+)+$"');
  expect(
    matchesQuery(query, {
      name: 'a'.repeat(20000) + '!',
      path: '/fixture',
      extension: '',
      directory: false,
      hidden: false,
      kind: 'file',
    }),
  ).toBe(false);
  expect(searchPattern('^(a|aa)+$').test('a'.repeat(20000) + '!')).toBe(false);
  expect(performance.now() - start).toBeLessThan(1000);
});

it('rejects unsupported or oversized patterns with an actionable query error', () => {
  for (const pattern of ['(?=a)a', '(a)\\1', '['])
    expect(() => parseFileQuery('~"' + pattern + '"')).toThrow('valid RE2 name pattern');
  expect(() => searchPattern('a'.repeat(513))).toThrow('512 characters');
});
