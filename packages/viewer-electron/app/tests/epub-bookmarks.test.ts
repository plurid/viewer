import { expect, it } from 'vitest';
import {
  readEPUBBookmarks,
  saveEPUBBookmark,
} from '../src/domain/previews/documents/epub-bookmarks';

const bookmark = {
  id: 'one',
  name: 'Read again',
  chapter: 1,
  path: 'Book/chapter.xhtml',
  top: 140,
  left: 0,
};
it('validates imported markers and preserves identifiers when renaming', () => {
  expect(readEPUBBookmarks([bookmark, { ...bookmark, top: Infinity }, null])).toEqual([bookmark]);
  expect(saveEPUBBookmark([bookmark], { ...bookmark, name: 'New name' })).toEqual([
    { ...bookmark, name: 'New name' },
  ]);
});
it('refuses to discard earlier markers when the saved-state budget is exhausted', () => {
  const marks = Array.from({ length: 32 }, (_, index) => ({ ...bookmark, id: String(index) }));
  expect(() => saveEPUBBookmark(marks, { ...bookmark, id: 'extra' })).toThrow('full');
  expect(marks).toHaveLength(32);
  expect(() => saveEPUBBookmark([], { ...bookmark, name: ' ' })).toThrow();
});
