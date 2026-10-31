import { expect, it } from 'vitest';
import { factLabel } from '../src/domain/files/fact-labels';

it('names inspection facts in words, and keeps unknown keys readable', () => {
  expect(factLabel('bytes')).toBe('Size');
  expect(factLabel('missingCachedValues')).toBe('Formulas without saved values');
  expect(factLabel('creationdate')).toBe('Created');
  expect(factLabel('author')).toBe('Author');
  expect(factLabel('pageCount')).toBe('Page count');
  expect(factLabel('page_layout')).toBe('Page layout');
  // a key from a document's metadata is data, never a property of the table
  expect(factLabel('constructor')).toBe('Constructor');
});
