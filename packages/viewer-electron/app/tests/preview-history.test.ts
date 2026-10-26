import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { previewState } from '../src/renderer/previews/state';
import {
  activeWorkspace,
  addPane,
  flushState,
  getState,
  initialize,
  removePanes,
} from '../src/renderer/state/store';
import type { FileEntry } from '../src/domain/contracts';
import { stateSchema } from '../src/desktop/persistence/storage';
import { fileViewSchema, rememberFileView } from '../src/domain/previews/history';

const file = {
  path: '/fixtures/Book.pdf',
  identity: 'volume:123',
  modified: 100,
  size: 1000,
} as FileEntry;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', {
    dispatchEvent: vi.fn(),
    viewer: {
      save: vi.fn(async (state) => {
        stateSchema.parse(state);
      }),
    },
  });
  initialize({ home: '/fixtures', platform: 'darwin', locations: [], state: null, openPaths: [] });
});
afterEach(async () => {
  await flushState(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('recalls the same file after closing its plane, saving and cold initialization', async () => {
  const first = addPane(file.path, 'preview', true);
  const view = previewState(first.id, file);
  view.set('pdf.page', 7);
  view.set('notes.text', 'Private plane note');
  view.set('model.camera', { position: [1, 2, 3], target: [0, 0, 0] });
  removePanes([first.id]);
  await flushState(false);
  const saved = structuredClone(getState().saved);
  expect(saved.previewHistory?.[activeWorkspace().id]?.[0]?.values['notes.text']).toBeUndefined();
  initialize({ home: '/fixtures', platform: 'darwin', locations: [], state: saved, openPaths: [] });
  const second = addPane(file.path, 'preview', true);
  const recalled = previewState(second.id, file);
  expect(recalled.get('pdf.page')).toBe(7);
  expect(recalled.get('model.camera')).toEqual({ position: [1, 2, 3], target: [0, 0, 0] });
  expect(recalled.get('notes.text')).toBeUndefined();
  expect(previewState(second.id, { ...file, modified: 101 }).get('pdf.page')).toBeUndefined();
});

it('keeps existing plane positions independent while new views recall the latest file position', () => {
  const first = addPane(file.path, 'preview', true);
  previewState(first.id, file).set('pdf.page', 3);
  const second = addPane(file.path, 'preview', true, { keepSeparate: true });
  previewState(second.id, file).set('pdf.page', 9);
  expect(previewState(first.id, file).get('pdf.page')).toBe(3);
  expect(previewState(second.id, file).get('pdf.page')).toBe(9);
  const third = addPane(file.path, 'preview', true, { keepSeparate: true });
  expect(previewState(third.id, file).get('pdf.page')).toBe(9);
});

it('recalls Quick Preview positions through a fresh transient view and a changed source resets them', () => {
  previewState('quick-one', file).set('media.position', 12.5);
  expect(previewState('quick-two', file).get('media.position')).toBe(12.5);
  const changed = previewState('quick-three', { ...file, modified: 102 });
  expect(changed.get('media.position')).toBeUndefined();
  changed.set('media.position', 2);
  expect(previewState('quick-four', { ...file, modified: 102 }).get('media.position')).toBe(2);
});

it('hydrates transient recall when file metadata arrives after its loading placeholder', () => {
  previewState('already-read', file).set('scroll.markdown', { section: '', top: 500, left: 0 });
  previewState('loading-placeholder');
  expect(previewState('loading-placeholder', file).get('scroll.markdown')).toEqual({
    section: '',
    top: 500,
    left: 0,
  });
});

it('bounds file history and excludes edits, private notes and arbitrary resource values', () => {
  let history;
  for (let index = 0; index < 80; index += 1)
    history = rememberFileView(history, 'workspace', `/fixture/${index}.pdf`, {
      'pdf.page': index,
      'notes.text': 'Private',
      'editor.buffer': 'Unsaved',
      'resource.url': 'capability',
      'model.resource': 'capability',
    });
  expect(history!.workspace).toHaveLength(50);
  expect(history!.workspace![0]!.path).toBe('/fixture/79.pdf');
  expect(history!.workspace![0]!.values).toEqual({ 'pdf.page': 79 });
});
it('enforces the recall byte budget for non-ASCII paths too', () => {
  expect(
    fileViewSchema.safeParse({ path: '/' + '文'.repeat(3000), updated: 1, values: {} }).success,
  ).toBe(false);
});
