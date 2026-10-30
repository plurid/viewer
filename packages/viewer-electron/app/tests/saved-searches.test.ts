/**
 * A saved search holds any query that runs: up to 1,000 characters, as the index and a search
 * plane do. A name starts from the query, cut to fit. A refusal says what to change.
 */
import { describe, expect, it } from 'vitest';
import { maxQueryLength, parseFileQuery } from '../src/domain/search/query';
import {
  savedSearchCount,
  savedSearchProblem,
  searchName,
  searchNameLength,
} from '../src/domain/search/saved';
import { settingsSchema } from '../src/desktop/preferences/settings-schema';

/** A query of `length` characters, words of the file query language. */
const queryOf = (length: number) => 'ext:md ' + 'draft '.repeat(length).slice(0, length - 7);

describe('saved searches', () => {
  it('save the longest query a search runs, under a name that fits', () => {
    const query = queryOf(maxQueryLength);
    expect(query).toHaveLength(maxQueryLength);
    expect(() => parseFileQuery(query)).not.toThrow();
    expect(savedSearchProblem(query, 0)).toBeUndefined();
    const name = searchName(query);
    expect(name.length).toBeLessThanOrEqual(searchNameLength);
    expect(name).toMatch(/^ext:md draft draft .*draft…$/);
    const saved = settingsSchema.shape.savedSearches.parse([
      { id: crypto.randomUUID(), name, query },
    ]);
    expect(saved[0]!.query).toBe(query);
  });
  it('keep a short query whole as its name', () => {
    expect(searchName('  draft   ext:md ')).toBe('draft ext:md');
  });
  it('say how much to shorten a longer query, and what to remove at the limit', () => {
    expect(savedSearchProblem(queryOf(maxQueryLength + 42), 0)).toBe(
      'A query is at most 1,000 characters; shorten this one by 42.',
    );
    expect(savedSearchProblem('draft', savedSearchCount)).toBe(
      'Viewer keeps 100 saved searches. Remove one in Settings → Search to save this one.',
    );
    expect(savedSearchProblem('(draft', 0)).toBe('A ( is not closed.');
  });
});
