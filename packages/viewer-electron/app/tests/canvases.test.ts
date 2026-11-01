import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Canvases } from '../src/desktop/canvases/service';
import { canvasAssetFile } from '../src/domain/canvases/document';
import { temporaryRoot } from '../tools/temporary';

let root: string;
let canvases: Canvases;
const changed = vi.fn();
beforeEach(async () => {
  root = await temporaryRoot('viewer-canvases-');
  changed.mockReset();
  canvases = new Canvases(root, { changed });
});
const create = () => canvases.create(1, randomUUID(), root);

describe('durable canvas revisions', () => {
  it('keeps user inputs through revisions, Undo, and a fresh service', async () => {
    const first = await create();
    const app = await canvases.write(1, first.id, 0, 'Budget', '<input>', { budget: 10 });
    await canvases.state(1, first.id, app.stateRevision, app.revision, { budget: 42 });
    const revised = await canvases.write(1, first.id, 1, 'Budget chart', '<main>Chart</main>', {
      budget: 20,
      chart: true,
    });
    expect(revised.state).toEqual({ budget: 42, chart: true });
    const undone = await canvases.undo(1, first.id, 2);
    expect(undone.html).toBe('<input>');
    expect(undone.state.budget).toBe(42);
    await canvases.flush();
    const restarted = new Canvases(root, { changed });
    expect(await restarted.read(2, first.id)).toEqual(undone);
  });

  it('refuses stale content, stale state, changed state types, and another owner', async () => {
    const first = await create();
    await canvases.write(1, first.id, 0, 'Budget', '<input>', { budget: 10 });
    await expect(canvases.write(1, first.id, 0, 'Old', '', {})).rejects.toThrow('changed');
    await expect(canvases.state(1, first.id, 0, 1, { budget: 1 })).rejects.toThrow('changed');
    await expect(canvases.state(1, first.id, 1, 0, { budget: 1 })).rejects.toThrow('changed');
    await expect(
      canvases.write(1, first.id, 1, 'Wrong type', '', { budget: 'ten' }),
    ).rejects.toThrow('type');
    await expect(canvases.read(2, first.id)).rejects.toThrow('another window');
    expect((await canvases.read(1, first.id)).state.budget).toBe(10);
  });

  it('isolates a branch and applies its design while retaining the original’s latest inputs', async () => {
    const first = await create();
    await canvases.write(1, first.id, 0, 'Budget', '<input>', { budget: 10 });
    const branch = await canvases.fork(1, first.id, randomUUID());
    await canvases.state(1, first.id, 1, 1, { budget: 99 });
    await canvases.state(1, branch.id, 0, 0, { budget: 2 });
    await canvases.write(1, branch.id, 0, 'Alternative', '<main>New design</main>', {
      budget: 1,
      chart: true,
    });
    expect((await canvases.read(1, first.id)).html).toBe('<input>');
    const applied = await canvases.apply(1, branch.id, 1);
    expect(applied.html).toBe('<main>New design</main>');
    expect(applied.state).toEqual({ budget: 99, chart: true });
    expect((await canvases.read(1, branch.id)).state.budget).toBe(2);
    await expect(canvases.apply(1, branch.id, 1)).rejects.toThrow('original canvas has changed');
  });
});

describe('portable canvas assets', () => {
  it('exports and reopens the exact HTML, state, and asset IDs without original paths', async () => {
    const first = await create();
    const source = path.join(root, 'source.txt');
    await writeFile(source, 'Attached source');
    const asset = await canvases.attachFile(1, first.id, source);
    const app = await canvases.write(1, first.id, 1, 'Portable', '<p>Selectable content</p>', {
      input: 'initial',
    });
    await canvases.state(1, first.id, app.stateRevision, app.revision, { input: 'user input' });
    const exported = await canvases.export(1, first.id, root);
    const manifest = path.join(exported, 'canvas.viewer.json');
    expect(await readFile(manifest, 'utf8')).not.toContain(source);
    expect(await readFile(path.join(exported, canvasAssetFile(asset)), 'utf8')).toBe(
      'Attached source',
    );
    const destination = path.join(root, 'fresh-profile');
    const reopened = new Canvases(destination, { changed });
    const imported = await reopened.import(1, manifest, randomUUID());
    expect(imported.id).not.toBe(first.id);
    expect(imported.html).toBe('<p>Selectable content</p>');
    expect(imported.state.input).toBe('user input');
    expect(imported.assets[0]!.id).toBe(asset.id);
    expect(imported.assets[0]!.source).toBeUndefined();
    expect((await reopened.files(imported)).has(canvasAssetFile(asset))).toBe(true);
    await reopened.flush();
    expect((await new Canvases(destination, { changed }).read(2, imported.id)).state.input).toBe(
      'user input',
    );
  });

  it('refuses changed assets and linked asset directories before creating an imported canvas', async () => {
    const first = await create();
    const asset = await canvases.attach(1, first.id, 'source.txt', Buffer.from('Original'));
    const exported = await canvases.export(1, first.id, root);
    await writeFile(path.join(exported, canvasAssetFile(asset)), 'Modified');
    await expect(
      canvases.import(1, path.join(exported, 'canvas.viewer.json'), randomUUID()),
    ).rejects.toThrow('changed');
    const second = await canvases.export(1, first.id, root);
    const elsewhere = path.join(root, 'retained-assets');
    await rename(path.join(second, 'assets'), elsewhere);
    await symlink(elsewhere, path.join(second, 'assets'));
    await expect(
      canvases.import(1, path.join(second, 'canvas.viewer.json'), randomUUID()),
    ).rejects.toThrow('without links');
  });

  it('rejects asset links and directories and verifies private copies when reopened', async () => {
    const first = await create();
    const source = path.join(root, 'source.txt');
    await writeFile(source, 'Original');
    await symlink(source, path.join(root, 'linked.txt'));
    await mkdir(path.join(root, 'directory'));
    await expect(canvases.attachFile(1, first.id, path.join(root, 'linked.txt'))).rejects.toThrow();
    await expect(canvases.attachFile(1, first.id, path.join(root, 'directory'))).rejects.toThrow();
    const asset = await canvases.attachFile(1, first.id, source);
    await writeFile(path.join(root, 'canvas-assets', asset.hash), 'Modified');
    await expect(canvases.files(await canvases.read(1, first.id))).rejects.toThrow('changed');
  });
});
