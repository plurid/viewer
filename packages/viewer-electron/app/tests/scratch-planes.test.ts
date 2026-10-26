/**
 * Scratch planes and unsaved text: planes of text kept in the profile until saved or
 * discarded, the close prompt that asks first, and the recovery of text no plane holds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedState } from '../src/domain/contracts';
import type { TextBuffer, TextBufferSummary } from '../src/domain/editing/documents';
import { stateSchema } from '../src/desktop/persistence/storage';
import {
  activeWorkspace,
  addPane,
  addScratchPane,
  flushState,
  getState,
  initialize,
  receiveSettings,
  replacePane,
  updatePane,
} from '../src/renderer/state/store';
import { discardBuffer, keepBuffer, readBuffer } from '../src/renderer/editing/buffers';
import { confirmClose, recoverBuffers, scratchFileName } from '../src/renderer/editing/unsaved';
import { untitledFileName } from '../src/domain/editing/languages';

const kept = new Map<string, TextBuffer>();
const viewer = {
  save: vi.fn(async (state: SavedState) => {
    stateSchema.parse(state);
  }),
  bufferWrite: vi.fn(async (buffer: TextBuffer) => {
    kept.set(buffer.id, buffer);
  }),
  bufferRead: vi.fn(async (id: string) => kept.get(id) ?? null),
  bufferDiscard: vi.fn(async (id: string) => {
    kept.delete(id);
  }),
  bufferList: vi.fn(async () => ({
    buffers: [...kept.values()].map(
      ({ text, base: _base, bom: _bom, revision: _revision, ...rest }): TextBufferSummary => ({
        ...rest,
        bytes: text.length,
      }),
    ),
    problems: [] as string[],
  })),
  textPrompt: vi.fn(async (): Promise<'save' | 'discard' | 'cancel'> => 'cancel'),
  textSaveAs: vi.fn(async () => ({
    file: '/fixtures/Desktop/Untitled 1.txt',
    version: { identity: '1:2', modified: 1, size: 5, sha256: '0'.repeat(64) },
  })),
  textSave: vi.fn(async () => ({ identity: '1:2', modified: 2, size: 5, sha256: '1'.repeat(64) })),
};
beforeEach(() => {
  vi.useFakeTimers();
  kept.clear();
  for (const method of Object.values(viewer)) method.mockClear();
  vi.stubGlobal('window', { dispatchEvent: vi.fn(), viewer });
  initialize({
    home: '/fixtures',
    platform: 'darwin',
    locations: [],
    state: null,
    openPaths: [],
  });
});
afterEach(async () => {
  await flushState(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const scratchText = (id: string, text: string) =>
  keepBuffer({ id, kind: 'scratch', title: 'Untitled 1', language: 'markdown', text });

describe('scratch planes', () => {
  it('are numbered, start Save As on the Desktop and save as valid state', async () => {
    const first = addScratchPane();
    const second = addScratchPane();
    expect(first).toMatchObject({
      type: 'scratch',
      title: 'Untitled 1',
      path: '/fixtures/Desktop',
    });
    expect(second.title).toBe('Untitled 2');
    expect(first.bufferID).not.toBe(second.bufferID);
    expect(activeWorkspace().roots).toEqual(expect.arrayContaining([first.id, second.id]));
    await flushState(false);
    expect(viewer.save).toHaveBeenCalled();
  });
  it('start in the language of the configured new-file extension, Markdown by default', () => {
    expect(addScratchPane().language).toBe('markdown');
    const snapshot = structuredClone(getState().settings);
    snapshot.revision++;
    snapshot.settings.browsing.newFileExtension = 'txt';
    receiveSettings(snapshot);
    expect(addScratchPane().language).toBe('plaintext');
    expect(addScratchPane({ language: 'python' }).language).toBe('python');
  });
  it('are saved under the configured extension when it is one of their language', () => {
    expect(scratchFileName('Untitled 1', 'markdown', 'md')).toBe('Untitled 1.md');
    expect(scratchFileName('Untitled 1', 'markdown', 'markdown')).toBe('Untitled 1.markdown');
    // another language keeps its own
    expect(scratchFileName('Untitled 1', 'python', 'md')).toBe('Untitled 1.py');
    expect(scratchFileName('Untitled 1', undefined, 'txt')).toBe('Untitled 1.txt');
    expect(untitledFileName('md')).toBe('untitled.md');
  });
  it('becomes a file plane in place, keeping its id and place', () => {
    const scratch = addScratchPane();
    const before = activeWorkspace().panes.map((pane) => pane.id);
    replacePane(scratch.id, { id: scratch.id, type: 'preview', path: '/fixtures/Desktop/a.md' });
    expect(activeWorkspace().panes.map((pane) => pane.id)).toEqual(before);
    expect(activeWorkspace().panes.find((pane) => pane.id === scratch.id)).toMatchObject({
      type: 'preview',
      path: '/fixtures/Desktop/a.md',
    });
  });
});

describe('unsaved text', () => {
  it('is written half a second after typing stops, and at once when state is flushed', async () => {
    const { bufferID } = addScratchPane();
    scratchText(bufferID, 'one');
    scratchText(bufferID, 'one two');
    expect(viewer.bufferWrite).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(viewer.bufferWrite).toHaveBeenCalledOnce();
    expect(kept.get(bufferID)).toMatchObject({ text: 'one two', revision: 2 });
    scratchText(bufferID, 'one two three');
    await flushState(false);
    expect(kept.get(bufferID)).toMatchObject({ text: 'one two three', revision: 3 });
  });
  it('continues the revision of a buffer read back from the profile', async () => {
    kept.set('6f1c2c0a-6a43-4c51-9e3e-6f3f0d3b9a01', {
      id: '6f1c2c0a-6a43-4c51-9e3e-6f3f0d3b9a01',
      kind: 'scratch',
      text: 'kept',
      revision: 7,
      updated: 1,
    });
    expect((await readBuffer('6f1c2c0a-6a43-4c51-9e3e-6f3f0d3b9a01'))?.text).toBe('kept');
    scratchText('6f1c2c0a-6a43-4c51-9e3e-6f3f0d3b9a01', 'kept, then more');
    await flushState(false);
    expect(kept.get('6f1c2c0a-6a43-4c51-9e3e-6f3f0d3b9a01')?.revision).toBe(8);
  });
  it('is removed only when discarded', async () => {
    const { bufferID } = addScratchPane();
    scratchText(bufferID, 'draft');
    await flushState(false);
    await discardBuffer(bufferID);
    expect(kept.has(bufferID)).toBe(false);
    expect(await readBuffer(bufferID)).toBeNull();
  });
});

describe('closing planes with unsaved text', () => {
  it('asks first, and Cancel keeps the plane and its text', async () => {
    const scratch = addScratchPane();
    scratchText(scratch.bufferID, 'draft');
    expect(await confirmClose([scratch.id])).toBe(false);
    expect(viewer.textPrompt).toHaveBeenCalledWith('close', 'Untitled 1');
    await flushState(false);
    expect(kept.get(scratch.bufferID)?.text).toBe('draft');
  });
  it("discards the text on Don't Save", async () => {
    const scratch = addScratchPane();
    scratchText(scratch.bufferID, 'draft');
    viewer.textPrompt.mockResolvedValueOnce('discard');
    expect(await confirmClose([scratch.id])).toBe(true);
    expect(viewer.bufferDiscard).toHaveBeenCalledWith(scratch.bufferID);
  });
  it('saves a scratch plane through Save As, and a cancelled panel keeps it open', async () => {
    const scratch = addScratchPane();
    scratchText(scratch.bufferID, 'draft');
    viewer.textPrompt.mockResolvedValue('save');
    viewer.textSaveAs.mockResolvedValueOnce(null as never);
    expect(await confirmClose([scratch.id])).toBe(false);
    expect(await confirmClose([scratch.id])).toBe(true);
    expect(viewer.textSaveAs).toHaveBeenLastCalledWith(
      'draft',
      'Untitled 1.md',
      expect.any(String),
    );
    expect(kept.has(scratch.bufferID)).toBe(false);
  });
  it("saves a file's unsaved edits over the version they were made on", async () => {
    const pane = addPane('/fixtures/notes.txt', 'preview', true);
    const base = { identity: '1:1', modified: 1, size: 3, sha256: 'a'.repeat(64) };
    keepBuffer({
      id: '0b6f3a52-0a8e-4c7e-8d0f-58f3f3b7f1c2',
      kind: 'file',
      file: '/fixtures/notes.txt',
      base,
      bom: false,
      title: 'notes.txt',
      text: 'edited',
    });
    updatePane(pane.id, { bufferID: '0b6f3a52-0a8e-4c7e-8d0f-58f3f3b7f1c2' });
    viewer.textPrompt.mockResolvedValueOnce('save');
    expect(await confirmClose([pane.id])).toBe(true);
    expect(viewer.textPrompt).toHaveBeenCalledWith('close', 'notes.txt');
    expect(viewer.textSave).toHaveBeenCalledWith(
      '/fixtures/notes.txt',
      'edited',
      base,
      expect.any(String),
      false,
    );
  });
  it('closes an empty scratch plane without asking, removing its empty buffer', async () => {
    const scratch = addScratchPane();
    expect(await confirmClose([scratch.id])).toBe(true);
    expect(viewer.textPrompt).not.toHaveBeenCalled();
  });
});

describe('recovering unsaved text', () => {
  it('brings back text no plane holds, as planes, once', async () => {
    const held = addScratchPane();
    scratchText(held.bufferID, 'held');
    kept.set('6f1c2c0a-6a43-4c51-9e3e-6f3f0d3b9a01', {
      id: '6f1c2c0a-6a43-4c51-9e3e-6f3f0d3b9a01',
      kind: 'scratch',
      title: 'Untitled 4',
      language: 'python',
      text: 'orphan',
      revision: 1,
      updated: 1,
    });
    kept.set('0b6f3a52-0a8e-4c7e-8d0f-58f3f3b7f1c2', {
      id: '0b6f3a52-0a8e-4c7e-8d0f-58f3f3b7f1c2',
      kind: 'file',
      file: '/fixtures/notes.txt',
      title: 'notes.txt',
      text: 'edited',
      revision: 1,
      updated: 1,
    });
    await flushState(false);
    expect(await recoverBuffers()).toBe(2);
    const panes = activeWorkspace().panes;
    expect(panes).toContainEqual(
      expect.objectContaining({
        type: 'scratch',
        bufferID: '6f1c2c0a-6a43-4c51-9e3e-6f3f0d3b9a01',
        title: 'Untitled 4',
        language: 'python',
      }),
    );
    expect(panes).toContainEqual(
      expect.objectContaining({
        type: 'preview',
        path: '/fixtures/notes.txt',
        bufferID: '0b6f3a52-0a8e-4c7e-8d0f-58f3f3b7f1c2',
      }),
    );
    expect(await recoverBuffers()).toBe(0);
  });
});
