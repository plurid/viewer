import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Notes } from '../src/desktop/editing/notes';
import {
  noteRequestSchema,
  checklistItems,
  editChecklist,
  reorderChecklist,
  removeChecklistItem,
} from '../src/domain/editing/notes';
import { temporaryRoot } from '../tools/temporary';
import {
  changeNote,
  finishNoteTrash,
  flushNotes,
  loadNote,
  noteLocked,
  noteSession,
  prepareNoteTrash,
  trimNoteSessions,
} from '../src/renderer/notes/sessions';
import { initialize } from '../src/renderer/state/store';
import { addContentPane } from '../src/renderer/state/panes';
import { confirmClose } from '../src/renderer/editing/unsaved';

afterEach(() => vi.unstubAllGlobals());
it('bounds retained note views while preserving dirty sessions and in-flight saves', async () => {
  const root = await temporaryRoot('viewer-note-retention-');
  const notes = new Notes(root);
  const created = await notes.request({ kind: 'create', format: 'note', directory: root });
  if (created.kind !== 'document') throw new Error('Expected note');
  let fail = false;
  vi.stubGlobal('window', {
    viewer: {
      notes: (request: Parameters<Notes['request']>[0]) => {
        if (fail && request.kind === 'write')
          return Promise.reject(new Error('Fixture save failure'));
        return notes.request(request);
      },
    },
  });
  const panes = Array.from({ length: 450 }, () => randomUUID());
  for (const pane of panes) await loadNote(pane, created.document.id);
  const keep = new Set(panes.slice(-200));
  const dirty = panes[0]!;
  changeNote(dirty, { text: 'Retain this unsaved edit' });
  fail = true;
  trimNoteSessions(keep);
  expect(panes.filter((pane) => noteSession(pane))).toHaveLength(201);
  await expect(flushNotes()).rejects.toThrow('Fixture save failure');
  expect(noteSession(dirty)?.text).toBe('Retain this unsaved edit');
  fail = false;
  await flushNotes();
  expect(noteSession(dirty)).toBeUndefined();
  expect(panes.filter((pane) => noteSession(pane))).toHaveLength(200);
  trimNoteSessions(new Set());
  expect(panes.filter((pane) => noteSession(pane))).toHaveLength(0);
  expect(await notes.request({ kind: 'read', id: created.document.id })).toMatchObject({
    document: { text: 'Retain this unsaved edit' },
  });
});
it('moves only a current ordinary note to the injected Trash adapter, and never resurrects it', async () => {
  const root = await temporaryRoot('viewer-note-trash-');
  const trash = vi.fn(async (_file: string) => {});
  const notes = new Notes(root, undefined, trash);
  const reply = await notes.request({ kind: 'create', format: 'checklist', directory: root });
  if (reply.kind !== 'document') throw new Error('Expected note');
  const file = path.join(root, 'notes', reply.document.id + '.json');
  const bytes = await readFile(file);
  await expect(
    notes.request({ kind: 'trash', id: reply.document.id, revision: 1 }),
  ).rejects.toThrow('changed');
  expect(trash).not.toHaveBeenCalled();
  expect(await notes.request({ kind: 'trash', id: reply.document.id, revision: 0 })).toEqual({
    kind: 'trashed',
    id: reply.document.id,
  });
  expect(trash).toHaveBeenCalledExactlyOnceWith(file);
  await expect(
    notes.request({
      kind: 'write',
      id: reply.document.id,
      revision: 0,
      title: 'Old view',
      text: 'Late draft',
    }),
  ).rejects.toThrow('Trash');
  expect(await notes.request({ kind: 'list' })).toMatchObject({ notes: [] });
  // This is an adapter contract test. The stub does not move or remove its fixture.
  expect(await readFile(file)).toEqual(bytes);
});
it('preserves a note when Trash fails and refuses a linked private note', async () => {
  const root = await temporaryRoot('viewer-note-trash-refusal-');
  const notes = new Notes(root, undefined, async () => {
    throw new Error('Generated Trash failure');
  });
  const reply = await notes.request({ kind: 'create', format: 'note', directory: root });
  if (reply.kind !== 'document') throw new Error('Expected note');
  await expect(
    notes.request({ kind: 'trash', id: reply.document.id, revision: 0 }),
  ).rejects.toThrow('Trash failure');
  expect(await notes.request({ kind: 'read', id: reply.document.id })).toMatchObject({
    document: reply.document,
  });
  const linkID = randomUUID();
  await symlink(
    path.join(root, 'notes', reply.document.id + '.json'),
    path.join(root, 'notes', linkID + '.json'),
  );
  await expect(notes.request({ kind: 'trash', id: linkID, revision: 0 })).rejects.toThrow();
});
it('freezes and flushes open note drafts before removal, then releases locks on failure', async () => {
  const root = await temporaryRoot('viewer-note-trash-barrier-');
  const notes = new Notes(root);
  const reply = await notes.request({ kind: 'create', format: 'note', directory: root });
  if (reply.kind !== 'document') throw new Error('Expected note');
  vi.stubGlobal('window', {
    viewer: { notes: (input: Parameters<Notes['request']>[0]) => notes.request(input) },
  });
  const paneID = randomUUID();
  await loadNote(paneID, reply.document.id);
  changeNote(paneID, { text: 'Latest saved draft' });
  await prepareNoteTrash(reply.document.id);
  expect(noteLocked(reply.document.id)).toBe(true);
  changeNote(paneID, { text: 'Ignored while frozen' });
  expect(noteSession(paneID)?.text).toBe('Latest saved draft');
  expect(await notes.request({ kind: 'read', id: reply.document.id })).toMatchObject({
    document: { text: 'Latest saved draft' },
  });
  finishNoteTrash(reply.document.id, false);
  expect(noteLocked(reply.document.id)).toBe(false);
  changeNote(paneID, { text: 'Editable again' });
  await flushNotes();
  finishNoteTrash(reply.document.id, true);
  expect(noteSession(paneID)).toBeUndefined();
  await expect(loadNote(paneID, reply.document.id)).rejects.toThrow('Trash');
});
it('keeps documents through view closure/restart and preserves concurrent edits in a separate recovered note', async () => {
  const root = await temporaryRoot('viewer-notes-');
  const notes = new Notes(root);
  const created = await notes.request({ kind: 'create', format: 'note', directory: root });
  if (created.kind !== 'document') throw new Error('Expected document');
  const id = created.document.id;
  await notes.request({
    kind: 'write',
    id,
    revision: 0,
    title: 'First view',
    text: '# Saved\nText',
  });
  const recovered = await notes.request({
    kind: 'write',
    id,
    revision: 0,
    title: 'Other view',
    text: 'Conflicting edits',
  });
  if (recovered.kind !== 'document') throw new Error('Expected recovered document');
  expect(recovered.document).toMatchObject({
    recoveredFrom: id,
    text: 'Conflicting edits',
    revision: 0,
  });
  expect(recovered.document.id).not.toBe(id);
  await notes.close();
  const reopened = new Notes(root);
  const original = await reopened.request({ kind: 'read', id });
  expect(original).toMatchObject({
    document: { title: 'First view', text: '# Saved\nText', revision: 1 },
  });
  const list = await reopened.request({ kind: 'list' });
  expect(list.kind === 'list' && list.notes).toHaveLength(2);
  expect(list.kind === 'list' && list.notes.every((note) => !('text' in note))).toBe(true);
  await writeFile(path.join(root, 'notes', randomUUID() + '.json'), 'malformed');
  expect(await reopened.request({ kind: 'list' })).toMatchObject({
    problems: [expect.stringContaining('preserved')],
  });
});
it('flushes the latest editor draft and normalizes titles without a write loop', async () => {
  const root = await temporaryRoot('viewer-note-flush-');
  const notes = new Notes(root);
  const created = await notes.request({ kind: 'create', format: 'checklist', directory: root });
  if (created.kind !== 'document') throw new Error('Expected document');
  const paneID = randomUUID();
  const request = vi.fn((input) => notes.request(input));
  vi.stubGlobal('window', { viewer: { notes: request } });
  await loadNote(paneID, created.document.id);
  changeNote(paneID, { title: '  My tasks  ', text: '- [ ] One\n' });
  changeNote(paneID, { text: '- [x] One\n- [ ] Two\n' });
  await flushNotes();
  expect(noteSession(paneID)?.document).toMatchObject({
    title: 'My tasks',
    text: '- [x] One\n- [ ] Two\n',
  });
  expect(request.mock.calls.filter(([input]) => input.kind === 'write')).toHaveLength(1);
});
it('edits and reorders checklist source without dropping other text, and rejects raw executor/removal fields', () => {
  const text = '# Checklist\n\n- [ ] First\n- [X] Second\n';
  expect(checklistItems(text)).toEqual([
    { line: 2, checked: false, text: 'First' },
    { line: 3, checked: true, text: 'Second' },
  ]);
  expect(editChecklist(text, 2, { checked: true, text: 'Edited' })).toBe(
    '# Checklist\n\n- [x] Edited\n- [X] Second\n',
  );
  expect(reorderChecklist(text, 2, 3)).toBe('# Checklist\n\n- [X] Second\n- [ ] First\n');
  expect(removeChecklistItem(text, 2)).toBe('# Checklist\n\n- [X] Second\n');
  expect(() => removeChecklistItem(text, 0)).toThrow('changed');
  expect(noteRequestSchema.safeParse({ kind: 'remove', id: randomUUID() }).success).toBe(false);
  expect(
    noteRequestSchema.safeParse({
      kind: 'create',
      format: 'note',
      directory: '/tmp',
      executable: '/bin/sh',
    }).success,
  ).toBe(false);
});
it('refuses to close a note whose latest draft could not be saved, without offering Discard', async () => {
  const root = await temporaryRoot('viewer-note-close-');
  const notes = new Notes(root);
  const reply = await notes.request({ kind: 'create', format: 'note', directory: root });
  if (reply.kind !== 'document') throw new Error('Expected note');
  let fail = true;
  const textPrompt = vi.fn();
  vi.stubGlobal('window', {
    dispatchEvent: vi.fn(),
    viewer: {
      textPrompt,
      notes: async (request: Parameters<Notes['request']>[0]) => {
        if (fail && request.kind === 'write') throw new Error('Generated disk failure');
        return notes.request(request);
      },
    },
  });
  initialize({ home: root, platform: 'darwin', locations: [], state: null, openPaths: [] });
  const pane = {
    id: randomUUID(),
    type: 'note' as const,
    path: root,
    documentID: reply.document.id,
    title: reply.document.title,
  };
  addContentPane(pane);
  await loadNote(pane.id, pane.documentID);
  changeNote(pane.id, { text: 'Latest draft' });
  await expect(confirmClose([pane.id])).rejects.toThrow('Generated disk failure');
  expect(noteSession(pane.id)?.text).toBe('Latest draft');
  expect(textPrompt).not.toHaveBeenCalled();
  fail = false;
  expect(await confirmClose([pane.id])).toBe(true);
  expect(await notes.request({ kind: 'read', id: pane.documentID })).toMatchObject({
    document: { text: 'Latest draft' },
  });
});
