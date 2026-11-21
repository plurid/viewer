// @vitest-environment jsdom
/**
 * NotePlane in Source mode: syncing another view's saved revision and inserting dictated text
 * keep the latest text instead of letting an unmounting editor overwrite it.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { EditorView } from '@codemirror/view';
import type { DesktopEvent, NotePane as NotePaneRecord } from '../src/domain/contracts';
import type { NoteDocument } from '../src/domain/editing/notes';
import NotePlane from '../src/renderer/notes/NotePlane';
import {
  changeNote,
  flushNote,
  noteSession,
  trimNoteSessions,
} from '../src/renderer/notes/sessions';
import { initialize } from '../src/renderer/state/store';

beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  Range.prototype.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect }) as DOMRect;
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as DOMRectList;
});

const listeners = new Set<(event: DesktopEvent) => void>();
let stored: NoteDocument;
const writes: { revision: number; text: string }[] = [];

const viewer = {
  save: vi.fn(async () => {}),
  onEvent: vi.fn((listener: (event: DesktopEvent) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }),
  notes: vi.fn(
    async (request: {
      kind: string;
      id?: string;
      revision?: number;
      title?: string;
      text?: string;
    }) => {
      if (request.kind === 'read') return { kind: 'document' as const, document: { ...stored } };
      if (request.kind === 'write') {
        writes.push({ revision: request.revision ?? -1, text: request.text ?? '' });
        stored = {
          ...stored,
          title: request.title ?? stored.title,
          text: request.text ?? stored.text,
          revision: stored.revision + 1,
          updated: Date.now(),
        };
        return { kind: 'document' as const, document: { ...stored } };
      }
      throw new Error(`Unexpected request: ${request.kind}`);
    },
  ),
  textSaveAs: vi.fn(async () => null),
  textEditEnd: vi.fn(async () => {}),
};

beforeEach(() => {
  listeners.clear();
  writes.length = 0;
  for (const fn of Object.values(viewer)) fn.mockClear();
  stored = {
    id: '00000000-0000-4000-8000-000000000001',
    kind: 'note',
    title: 'Shared note',
    text: 'original text',
    revision: 1,
    created: 1,
    updated: 1,
  };
  Object.assign(window, { viewer });
  initialize({ home: '/fixtures', platform: 'darwin', locations: [], state: null, openPaths: [] });
});

afterEach(() => {
  cleanup();
  trimNoteSessions(new Set());
});

async function cmView(container: HTMLElement): Promise<EditorView> {
  await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull());
  return EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!;
}

describe('NotePlane Source editing', () => {
  it('keeps synced edits from another view without writing back the unmounted editor text', async () => {
    const pane: NotePaneRecord = {
      id: 'pane-sync',
      type: 'note',
      path: '/fixtures',
      documentID: stored.id,
      title: stored.title,
    };
    const view = render(createElement(NotePlane, { pane, visible: true }));
    fireEvent.click(await view.findByRole('button', { name: 'Source' }));
    await cmView(view.container);
    stored = { ...stored, text: 'saved from View B', revision: 2, updated: 2 };
    await act(async () => {
      for (const listener of listeners) listener({ type: 'note-changed', id: stored.id });
    });
    await waitFor(() => expect(noteSession(pane.id)?.document.revision).toBe(2));
    await flushNote(pane.id);
    expect(stored.text).toBe('saved from View B');
    expect(writes).toHaveLength(0);
    const syncedEditor = await cmView(view.container);
    expect(syncedEditor.state.doc.toString()).toBe('saved from View B');
  });

  it('shows accepted dictation in Source mode and keeps it across edits and view switches', async () => {
    const pane: NotePaneRecord = {
      id: 'pane-dictation',
      type: 'note',
      path: '/fixtures',
      documentID: stored.id,
      title: stored.title,
    };
    const view = render(createElement(NotePlane, { pane, visible: true }));
    fireEvent.click(await view.findByRole('button', { name: 'Source' }));
    await cmView(view.container);
    act(() => {
      changeNote(pane.id, { text: 'original text\n\ndictated line' });
    });
    const updatedEditor = await cmView(view.container);
    expect(updatedEditor.state.doc.toString()).toBe('original text\n\ndictated line');
    act(() => {
      updatedEditor.dispatch({
        changes: { from: updatedEditor.state.doc.length, insert: '!' },
      });
    });
    fireEvent.click(view.getByRole('button', { name: 'Document' }));
    await flushNote(pane.id);
    expect(noteSession(pane.id)?.text).toBe('original text\n\ndictated line!');
    expect(stored.text).toBe('original text\n\ndictated line!');
  });
});
