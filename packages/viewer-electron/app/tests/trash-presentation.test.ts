import { expect, it } from 'vitest';
import type { TrashItem } from '../src/domain/trash';
import { originalTrashFolder, sortTrashItems, trashDateColumn } from '../src/domain/trash';
const item = (name: string, extra: Partial<TrashItem> = {}): TrashItem => ({
  id: name,
  name,
  directory: false,
  size: 5,
  location: 'Home',
  ...extra,
});
it('toggles natural filename sorting in both directions', () => {
  const files = [item('Note 10'), item('Note 2'), item('Alpha', { directory: true })];
  expect(sortTrashItems(files, 'name', false).map((file) => file.name)).toEqual([
    'Alpha',
    'Note 2',
    'Note 10',
  ]);
  expect(sortTrashItems(files, 'name', true).map((file) => file.name)).toEqual([
    'Note 10',
    'Note 2',
    'Alpha',
  ]);
  expect(files[0].name).toBe('Note 10');
});
it('does not manufacture deletion dates from modification timestamps', () => {
  expect(trashDateColumn([item('old', { modified: 1791970200000 })])).toBeUndefined();
  expect(trashDateColumn([item('bad', { deleted: 'invalid' })])).toBeUndefined();
  expect(trashDateColumn([item('added', { addedToTrash: '2026-10-14T12:00:00Z' })])).toBe('added');
  expect(trashDateColumn([item('deleted', { deleted: '2026-10-14T12:00:00Z' })])).toBe('deleted');
});
it('keeps missing dates and locations at the end in either direction', () => {
  const files = [
    item('unknown'),
    item('earlier', { addedToTrash: '2026-10-12T12:00:00Z' }),
    item('later', { addedToTrash: '2026-10-14T12:00:00Z' }),
  ];
  expect(sortTrashItems(files, 'date', false).map((file) => file.name)).toEqual([
    'earlier',
    'later',
    'unknown',
  ]);
  expect(sortTrashItems(files, 'date', true).map((file) => file.name)).toEqual([
    'later',
    'earlier',
    'unknown',
  ]);
});
it('extracts original containing folders on every desktop path style', () => {
  expect(originalTrashFolder('/Users/Example/Desktop/Note.txt')).toBe('/Users/Example/Desktop');
  expect(originalTrashFolder('/Note.txt')).toBe('/');
  expect(originalTrashFolder('C:\\Users\\Example\\Note.txt')).toBe('C:\\Users\\Example');
  expect(originalTrashFolder('C:\\Note.txt')).toBe('C:\\');
});
it('sorts containing folders and file sizes while keeping unknown values last', () => {
  const files = [
    item('unknown'),
    item('large', { size: 100, originalPath: '/Users/Example/Alpha/large.txt' }),
    item('small', { size: 1, originalPath: '/Users/Example/Zulu/small.txt' }),
    item('folder', { directory: true, originalPath: '/Users/Example/Beta/folder' }),
  ];
  expect(sortTrashItems(files, 'originalPath', false).map((file) => file.name)).toEqual([
    'large',
    'folder',
    'small',
    'unknown',
  ]);
  expect(sortTrashItems(files, 'originalPath', true).map((file) => file.name)).toEqual([
    'small',
    'folder',
    'large',
    'unknown',
  ]);
  expect(sortTrashItems(files, 'size', false).map((file) => file.name)).toEqual([
    'small',
    'unknown',
    'large',
    'folder',
  ]);
  expect(sortTrashItems(files, 'size', true).map((file) => file.name)).toEqual([
    'large',
    'unknown',
    'small',
    'folder',
  ]);
});
