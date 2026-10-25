import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { JournalStore } from '../src/desktop/journal/store';
import { createJournalHandlers } from '../src/desktop/journal/handlers';
import { agentCommandID } from '../src/domain/agents/safety';
import { schemas, methodWindows } from '../src/desktop/ipc/schemas';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let directory: string;
let store: JournalStore;
let handlers: ReturnType<typeof createJournalHandlers>;
const trash = vi.fn(async () => {});
const confirm = vi.fn(async () => false);
const choose = vi.fn<() => Promise<string | undefined>>();

beforeEach(async () => {
  directory = await temporaryRoot('viewer-journal-export-');
  store = new JournalStore(path.join(directory, 'journal'));
  store.record({
    source: 'git',
    action: 'commit',
    phase: 'succeeded',
    origin: { workspaceID: 'alpha' },
    traceID: crypto.randomUUID(),
  });
  await store.flush();
  trash.mockClear();
  confirm.mockClear();
  choose.mockReset();
  handlers = createJournalHandlers({
    store,
    trash,
    confirmClear: confirm,
    chooseExport: choose,
    allowHuman: (owner) => {
      if (owner === 99) throw new Error('Human only');
    },
  });
});
afterEach(async () => {
  await store.close();
  await trashTemporary(directory);
});

describe('human Journal access, exports and removal review', () => {
  it('binds exact preview bytes to one owner and never overwrites an existing file', async () => {
    const preview = await handlers.journalExportPreview([{ filter: {}, limit: 200 }], 1);
    expect(preview.count).toBe(1);
    expect(preview.text).not.toContain(directory);
    await expect(handlers.journalExport([preview.id], 2)).rejects.toThrow('preview expired');
    const file = path.join(directory, 'export.json');
    await writeFile(file, 'keep existing export');
    choose.mockResolvedValue(file);
    await expect(handlers.journalExport([preview.id], 1)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(file, 'utf8')).toBe('keep existing export');
    const fresh = path.join(directory, 'new-export.json');
    choose.mockResolvedValue(fresh);
    expect(await handlers.journalExport([preview.id], 1)).toBe(true);
    expect(await readFile(fresh, 'utf8')).toBe(preview.text);
    await expect(handlers.journalExport([preview.id], 1)).rejects.toThrow('preview expired');
  });

  it('preserves history after a real review port denies clear; never invokes Trash', async () => {
    const before = await readFile(store.file, 'utf8');
    expect(await handlers.journalClear([], 1)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(1, store.file);
    expect(trash).not.toHaveBeenCalled();
    expect(await readFile(store.file, 'utf8')).toBe(before);
  });

  it('exposes no renderer append, arbitrary query/write parameters or agent command', async () => {
    expect(() => handlers.journalQuery([{ filter: {}, limit: 200 }], 99)).toThrow('Human only');
    await expect(handlers.journalExportPreview([{ filter: {}, limit: 200 }], 99)).rejects.toThrow(
      'Human only',
    );
    expect(() => handlers.journalClear([], 99)).toThrow('Human only');
    expect(Object.keys(schemas).filter((name) => name.startsWith('journal'))).toEqual([
      'journalQuery',
      'journalExportPreview',
      'journalExport',
      'journalClear',
    ]);
    expect(methodWindows.journalQuery).toBe('viewer');
    for (const id of ['open-journal', 'journal-workspace', 'journal-plane'])
      expect(() => agentCommandID(id, [])).toThrow('Agents cannot propose');
    expect(schemas.journalQuery.safeParse([{ filter: {}, sql: 'SELECT *' }]).success).toBe(false);
    expect(schemas.journalExport.safeParse(['id', '/arbitrary/path']).success).toBe(false);
  });
});
