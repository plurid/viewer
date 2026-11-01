import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { WindowDialogs } from '../src/desktop/native/window-dialogs';
import type { DialogPrompt, FileDialogPrompt } from '../src/domain/dialogs';
import { dialogRequestSchema } from '../src/domain/dialogs';
import { temporaryRoot } from '../tools/temporary';

let root: string;
let owner: WindowDialogs;
let shown: DialogPrompt | null;
const access = vi.fn(async (_paths: string[]) => {});
beforeEach(async () => {
  root = await temporaryRoot('viewer-dialogs-');
  shown = null;
  access.mockReset().mockResolvedValue(undefined);
  owner = new WindowDialogs({
    home: root,
    access,
    places: async () => [],
    publish: (prompt) => {
      shown = prompt;
    },
  });
  await owner.request({ kind: 'current' });
});
async function filePrompt(): Promise<FileDialogPrompt> {
  await vi.waitFor(() => expect(shown?.kind).toBe('file'));
  return shown as FileDialogPrompt;
}
describe('window-owned dialogs', () => {
  it('browses and opens multiple filtered files without native panels', async () => {
    const first = path.join(root, 'first.pdf'),
      second = path.join(root, 'second.PDF');
    await writeFile(first, 'first');
    await writeFile(second, 'second');
    await writeFile(path.join(root, 'wrong.txt'), 'wrong');
    const selected = owner.open({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    const prompt = await filePrompt();
    const result = await owner.request({ kind: 'browse', id: prompt.id, path: root });
    expect(result.listing?.entries).toHaveLength(3);
    await expect(
      owner.request({ kind: 'choose', id: prompt.id, paths: [path.join(root, 'wrong.txt')] }),
    ).rejects.toThrow('supported file');
    expect(shown?.id).toBe(prompt.id);
    await owner.request({ kind: 'choose', id: prompt.id, paths: [first, second] });
    await expect(selected).resolves.toEqual({ canceled: false, filePaths: [first, second] });
    expect(access).toHaveBeenCalledWith([first, second]);
    expect(shown).toBeNull();
  });
  it('keeps folder selection separate from files and accepts application packages as files', async () => {
    const file = path.join(root, 'document.txt');
    await writeFile(file, 'text');
    const chosen = owner.open({ properties: ['openDirectory'] });
    let prompt = await filePrompt();
    await expect(owner.request({ kind: 'choose', id: prompt.id, paths: [file] })).rejects.toThrow(
      'folder',
    );
    await owner.request({ kind: 'choose', id: prompt.id, paths: [root] });
    await expect(chosen).resolves.toMatchObject({ filePaths: [root] });
    const bundle = path.join(root, 'Application.app');
    await mkdir(bundle);
    const application = owner.open({
      properties: ['openFile'],
      filters: [{ name: 'Application', extensions: ['app'] }],
    });
    prompt = await filePrompt();
    await owner.request({ kind: 'choose', id: prompt.id, paths: [bundle] });
    await expect(application).resolves.toMatchObject({ filePaths: [bundle] });
  });
  it('does not overwrite export destinations or create a file just by choosing its name', async () => {
    const existing = path.join(root, 'existing.csv');
    await writeFile(existing, 'original');
    const selected = owner.save({ defaultPath: 'result.csv' }, false);
    const prompt = await filePrompt();
    expect(prompt.name).toBe('result.csv');
    expect(prompt.folder).toBe(root);
    await expect(
      owner.request({ kind: 'choose', id: prompt.id, paths: [existing], replace: true }),
    ).rejects.toThrow('already exists');
    expect(await readFile(existing, 'utf8')).toBe('original');
    const fresh = path.join(root, 'fresh.csv');
    await owner.request({ kind: 'choose', id: prompt.id, paths: [fresh] });
    await expect(selected).resolves.toEqual({ canceled: false, filePath: fresh });
    await expect(readFile(fresh)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('requires a matching reviewed conflict for replacement and refuses links', async () => {
    const existing = path.join(root, 'note.txt');
    await writeFile(existing, 'original');
    const selected = owner.save({ defaultPath: existing }, true);
    const prompt = await filePrompt();
    expect(
      await owner.request({ kind: 'choose', id: prompt.id, paths: [existing], replace: true }),
    ).toEqual({ conflict: existing });
    await writeFile(existing, 'changed while reviewing');
    expect(
      await owner.request({ kind: 'choose', id: prompt.id, paths: [existing], replace: true }),
    ).toEqual({ conflict: existing });
    const link = path.join(root, 'linked.txt');
    await symlink(existing, link);
    await expect(
      owner.request({ kind: 'choose', id: prompt.id, paths: [link], replace: true }),
    ).rejects.toThrow('already exists');
    await owner.request({ kind: 'choose', id: prompt.id, paths: [existing], replace: true });
    await expect(selected).resolves.toMatchObject({ canceled: false, filePath: existing });
    // Choosing a destination never modifies or removes it; the owning writer retains authority.
    expect(await readFile(existing, 'utf8')).toBe('changed while reviewing');
  });
  it('queues notices, rejects foreign and stale answers, and cancels them when the renderer stops', async () => {
    const first = owner.message({
      message: 'Save changes?',
      buttons: ['Save', 'Discard', 'Cancel'],
      cancelId: 2,
    });
    const id = shown!.id;
    const second = owner.message({
      message: 'Second',
      buttons: ['Cancel', 'Continue'],
      cancelId: 0,
    });
    await expect(owner.request({ kind: 'answer', id: randomUUID(), button: 0 })).rejects.toThrow(
      'no longer open',
    );
    await expect(owner.request({ kind: 'answer', id, button: 4 })).rejects.toThrow(
      'available answer',
    );
    await owner.request({ kind: 'answer', id, button: 0 });
    await expect(first).resolves.toMatchObject({ response: 0 });
    await expect(owner.request({ kind: 'answer', id, button: 0 })).rejects.toThrow(
      'no longer open',
    );
    expect(shown).toMatchObject({ message: 'Second' });
    owner.stop();
    await expect(second).resolves.toMatchObject({ response: 0 });
    expect(owner.ready).toBe(false);
  });
  it('cancels an aborted notice without consuming the next one', async () => {
    const abort = new AbortController();
    const first = owner.message({
      message: 'Waiting',
      buttons: ['Continue', 'Cancel'],
      cancelId: 1,
      signal: abort.signal,
    });
    const second = owner.message({ message: 'Next', buttons: ['OK'] });
    abort.abort();
    await expect(first).resolves.toMatchObject({ response: 1 });
    expect(shown).toMatchObject({ message: 'Next' });
    owner.stop();
    await second;
  });
  it('creates only a named child folder and supports explicitly opening the system picker', async () => {
    const selected = owner.open({ properties: ['openDirectory'] });
    const prompt = await filePrompt();
    await expect(
      owner.request({ kind: 'new-folder', id: prompt.id, parent: root, name: '../outside' }),
    ).rejects.toThrow('valid file name');
    const reply = await owner.request({
      kind: 'new-folder',
      id: prompt.id,
      parent: root,
      name: 'Output',
    });
    expect(reply.listing?.path).toBe(path.join(root, 'Output'));
    await owner.request({ kind: 'system', id: prompt.id });
    await expect(selected).resolves.toBeUndefined();
  });
  it('does not browse or select through revoked file access', async () => {
    const chosen = owner.open({ properties: ['openDirectory'] });
    const prompt = await filePrompt();
    access.mockRejectedValue(new Error('Access revoked'));
    await expect(owner.request({ kind: 'browse', id: prompt.id, path: root })).rejects.toThrow(
      'revoked',
    );
    await expect(owner.request({ kind: 'choose', id: prompt.id, paths: [root] })).rejects.toThrow(
      'revoked',
    );
    await owner.request({ kind: 'cancel', id: prompt.id });
    await expect(chosen).resolves.toMatchObject({ canceled: true });
  });
  it('bounds and validates dialog answers at the IPC boundary', () => {
    expect(
      dialogRequestSchema.safeParse({ kind: 'choose', id: randomUUID(), paths: [] }).success,
    ).toBe(false);
    expect(
      dialogRequestSchema.safeParse({
        kind: 'browse',
        id: randomUUID(),
        path: '/valid',
        native: true,
      }).success,
    ).toBe(false);
    expect(
      dialogRequestSchema.safeParse({ kind: 'answer', id: randomUUID(), button: -1 }).success,
    ).toBe(false);
  });
});
