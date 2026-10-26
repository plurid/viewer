import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Notes } from '../src/desktop/editing/notes';
import {
  noteRequestSchema,
  checklistItems,
  editChecklist,
  reorderChecklist,
} from '../src/domain/editing/notes';
import { temporaryRoot } from '../tools/temporary';
import { changeNote, flushNotes, loadNote, noteSession } from '../src/renderer/notes/sessions';
import { initialize } from '../src/renderer/state/store';
import { addContentPane } from '../src/renderer/state/panes';
import { confirmClose } from '../src/renderer/editing/unsaved';

afterEach(() => vi.unstubAllGlobals());
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
