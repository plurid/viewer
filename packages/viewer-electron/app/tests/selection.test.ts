import { beforeEach, describe, expect, it } from 'vitest';
import { FileSelection } from '../src/renderer/explorer/selection';
import { browseSession, clearSessions } from '../src/renderer/workspace/sessions';
import type { FileEntry } from '../src/domain/contracts';
const entries: FileEntry[] = Array.from({ length: 9 }, (_, i) => ({
  path: `/files/${i}`,
  parent: '/files',
  name: String(i),
  kind: 'file',
  directory: false,
  size: i,
  extension: 'txt',
  mime: 'text/plain',
  hidden: false,
  created: 0,
  modified: 0,
  identity: String(i),
}));
const plain = { shiftKey: false, metaKey: false, ctrlKey: false };
beforeEach(clearSessions);
function selection() {
  const session = browseSession('test', '/files');
  return {
    session,
    controller: new FileSelection(session, (paths) => {
      session.selection = paths;
    }),
  };
}
describe('file input selection', () => {
  it('jumps by typed prefixes, cycles repeated initials and handles accented names', () => {
    const { session, controller } = selection();
    const files = ['Alpha', 'Alpine', 'Éclair', 'Emoji 📁'].map((name, index) => ({
      ...entries[index],
      name,
    }));
    controller.type(files, 'a', 1000);
    expect(session.selection).toEqual([files[0].path]);
    controller.type(files, 'a', 1200);
    expect(session.selection).toEqual([files[1].path]);
    controller.type(files, 'l', 1300);
    controller.type(files, 'p', 1400);
    expect(session.selection).toEqual([files[0].path]);
    controller.type(files, 'e', 2600);
    expect(session.selection).toEqual([files[2].path]);
  });
  it('extends selection across virtual pages with a fixed anchor', () => {
    const { session, controller } = selection();
    controller.click(entries[1], plain, entries);
    controller.move(entries, 'PageDown', true, 1, 4);
    controller.move(entries, 'PageDown', true, 1, 4);
    expect(session.selection).toEqual(entries.slice(1).map((file) => file.path));
    controller.move(entries, 'PageUp', true, 1, 4);
    expect(session.selection).toEqual(entries.slice(1, 5).map((file) => file.path));
  });
  it('clears only the removed column branch, including its cursor and cached descendants', () => {
    const { session, controller } = selection();
    const nested = { ...entries[0], path: '/files/folder/note.txt', parent: '/files/folder' };
    controller.click(entries[1], plain, entries);
    controller.click(nested, { ...plain, metaKey: true }, [nested]);
    controller.removeBranch('/files/folder');
    expect(session.selection).toEqual([entries[1].path]);
    expect(session.cache.has(nested.path)).toBe(false);
    expect(session.cursor).toBe('');
    expect(session.anchor).toBe('');
    expect(session.cache.has(entries[1].path)).toBe(true);
  });
  it('extends upward repeatedly, shrinks on reversal and crosses its fixed anchor', () => {
    const { session, controller } = selection();
    controller.click(entries[4], plain, entries);
    controller.move(entries, 'ArrowUp', true);
    controller.move(entries, 'ArrowUp', true);
    expect(session.selection).toEqual(entries.slice(2, 5).map((file) => file.path));
    expect(session.cursor).toBe(entries[2].path);
    controller.move(entries, 'ArrowDown', true);
    expect(session.selection).toEqual(entries.slice(3, 5).map((file) => file.path));
    controller.move(entries, 'ArrowDown', true);
    expect(session.selection).toEqual([entries[4].path]);
    controller.move(entries, 'ArrowDown', true);
    expect(session.selection).toEqual(entries.slice(4, 6).map((file) => file.path));
    expect(session.anchor).toBe(entries[4].path);
  });
  it('keeps grid stride, range endpoints and all-selection cursor independent', () => {
    const { session, controller } = selection();
    controller.click(entries[4], plain, entries);
    controller.move(entries, 'ArrowUp', true, 3);
    expect(session.cursor).toBe(entries[1].path);
    expect(session.selection).toHaveLength(4);
    controller.all(entries);
    expect(session.cursor).toBe(entries[1].path);
    controller.move(entries, 'End', false);
    expect(session.selection).toEqual([entries[8].path]);
  });
  it('clears stale anchors and uses the actual column or search scope', () => {
    const { session, controller } = selection();
    controller.click(entries[7], plain, entries);
    controller.clear();
    expect(session.anchor).toBe('');
    expect(session.cursor).toBe('');
    controller.move(entries.slice(1, 4), 'ArrowDown', true);
    expect(session.selection).toEqual([entries[1].path]);
    controller.move(entries.slice(1, 4), 'ArrowDown', true);
    expect(session.selection).toEqual([entries[1].path, entries[2].path]);
  });
  it('preserves multiselection for a context target and supports additive Shift-click', () => {
    const { session, controller } = selection();
    controller.click(entries[0], plain, entries);
    controller.click(entries[4], { ...plain, metaKey: true }, entries);
    controller.target(entries[0]);
    expect(session.selection).toEqual([entries[0].path, entries[4].path]);
    controller.click(entries[6], { ...plain, metaKey: true, shiftKey: true }, entries);
    expect(session.selection).toEqual([
      entries[0].path,
      ...entries.slice(4, 7).map((file) => file.path),
    ]);
  });
});
