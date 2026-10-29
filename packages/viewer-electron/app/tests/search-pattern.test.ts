/**
 * A `~` name pattern runs in RE2, which is linear-time but costs microseconds a name: 20,000
 * names took 640 ms. A literal the pattern requires now rejects most names first. That check
 * must never hide a real match, so it is compared with RE2 alone on many patterns and names.
 */
import { describe, expect, it } from 'vitest';
import { RE2JS } from 're2js';
import { requiredLiteral, searchPattern } from '../src/domain/search/pattern';
import { matchesQuery, parseFileQuery } from '../src/domain/search/query';

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

describe('the literal a pattern requires', () => {
  it.each([
    ['^report', 'report'],
    ['foo.*barbaz', 'barbaz'],
    ['ab+c', 'ab'],
    ['ab?cd', 'cd'],
    ['a{0,3}bcd', 'bcd'],
    ['ab{2}x', 'ab'],
    ['\\.PDF$', '.pdf'],
    ['(a|b)xyz', 'xyz'],
    ['[]a]bcd', 'bcd'],
    ['[[:digit:]]+ notes', ' notes'],
    ['report\\d+', 'report'],
  ])('%s requires %s', (source, literal) => {
    expect(requiredLiteral(source)).toBe(literal);
  });

  it.each(['a|bc', '\\x41BC', '\\u0041bc', '\\p{L}abc', '(abc', '[abc', 'a{b}c', 'x*'])(
    '%s gives no literal',
    (source) => {
      expect(requiredLiteral(source)).toBeUndefined();
    },
  );
});

describe('the prefiltered pattern', () => {
  it('agrees with RE2 on every name', () => {
    const atoms = ['a', 'b', 'é', '.', '\\.', '[ab]', '[]a]', '(a|b)', '\\d', 'K', 's', 'σ', '-'];
    const quantifiers = ['', '', '*', '+', '?', '{0,2}', '{1}'];
    const names = [
      'ab',
      'ba.b',
      'A-B',
      'aab1',
      'é.b',
      ']a',
      'K',
      'ſ',
      'ΟΔΟΣ',
      'σς',
      'report 2026.pdf',
      '',
    ];
    let seed = 7;
    const random = (limit: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % limit;
    };
    let compared = 0;
    for (let trial = 0; trial < 1500; trial++) {
      let source = random(4) === 0 ? '^' : '';
      for (let part = 1 + random(4); part > 0; part--)
        source += atoms[random(atoms.length)]! + quantifiers[random(quantifiers.length)]!;
      if (random(5) === 0) source += '$';
      const reference = RE2JS.compile(RE2JS.translateRegExp(source), RE2JS.CASE_INSENSITIVE);
      const pattern = searchPattern(source);
      for (const name of names) {
        expect(pattern.test(name), `${source} on ${name}`).toBe(reference.test(name));
        compared++;
      }
    }
    expect(compared).toBe(1500 * names.length);
  });

  it('rejects most names without the matcher', () => {
    const pattern = searchPattern('^absent');
    const names = Array.from({ length: 20_000 }, (_, index) => `Item ${index}`);
    const started = performance.now();
    expect(names.filter((name) => pattern.test(name))).toEqual([]);
    expect(performance.now() - started).toBeLessThan(100);
  });
});
