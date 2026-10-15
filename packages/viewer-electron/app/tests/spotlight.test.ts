import { describe, expect, it } from 'vitest';
import { tagQuery } from '../src/desktop/spotlight';
import { collectionSchema } from '../src/domain/collections';

describe('finding files by Finder tag', () => {
  it('matches a tag by exact name, escaping quotes and refusing control characters', () => {
    expect(tagQuery(' Red ')).toBe('kMDItemUserTags == "Red"c');
    expect(tagQuery('Say "hi" \\ there')).toBe('kMDItemUserTags == "Say \\"hi\\" \\\\ there"c');
    expect(() => tagQuery('Red\nkMDItemFSName == "*"')).toThrow('control characters');
    expect(() => tagQuery('   ')).toThrow();
  });
  it('stores tag smart folders, which need a tag name', () => {
    const base = { id: crypto.randomUUID(), name: 'Red', sources: ['/Users/fixture'] };
    expect(collectionSchema.parse({ ...base, kind: 'tag', tag: 'Red' }).tag).toBe('Red');
    expect(collectionSchema.safeParse({ ...base, kind: 'tag' }).success).toBe(false);
  });
});
