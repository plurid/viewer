import { randomUUID } from 'node:crypto';
import { readFile, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Canvases } from '../src/desktop/canvases/service';
import { sourceSnapshot } from '../src/desktop/canvases/sources';
import { CanvasObservations } from '../src/desktop/canvases/observations';
import { canvasDocumentSchema } from '../src/domain/canvases/document';
import { canvasResultSchema } from '../src/domain/canvases/results';
import type { InspectionResult } from '../src/domain/files/inspection';
import { temporaryRoot } from '../tools/temporary';

let root: string;
let canvases: Canvases;
beforeEach(async () => {
  root = await temporaryRoot('viewer-canvas-productivity-');
  canvases = new Canvases(root, { changed: () => {} });
});
const inspection = (
  file: string,
  text = 'supplier,unit,shipping,days\nNorth,42,180,7\n',
): InspectionResult => ({
  path: file,
  version: { identity: '1:2', modified: 1, size: text.length },
  availability: 'available',
  facts: {},
  evidence: [{ source: 'text', text, anchor: { kind: 'text', line: 1, start: 0, end: 8 } }],
  coverage: { content: 'complete' },
});
const create = () => canvases.create(1, randomUUID(), root);

describe('file-grounded tools', () => {
  it('upgrades old canvases and their history with empty sources', async () => {
    const created = await create();
    const { sources: _sources, ...legacy } = created;
    const {
      id: _id,
      conversationID: _conversation,
      path: _path,
      version: _version,
      state: _state,
      stateRevision: _stateRevision,
      history: _history,
      ...oldContent
    } = legacy;
    const upgraded = canvasDocumentSchema.parse({ ...legacy, version: 1, history: [oldContent] });
    expect(upgraded.version).toBe(2);
    expect(upgraded.sources).toEqual([]);
    expect(upgraded.history[0]!.sources).toEqual([]);
  });
  it('keeps inputs, snapshot identity and Undo through explicit refresh and restart', async () => {
    const initial = await create();
    const attached = await canvases.source(
      1,
      initial.id,
      0,
      inspection(path.join(root, 'quote.csv')),
    );
    const app = await canvases.write(
      1,
      initial.id,
      attached.revision,
      'Quotes',
      '<main>Quotes</main>',
      { quantity: 20 },
    );
    await canvases.state(1, app.id, app.stateRevision, app.revision, { quantity: 40 });
    const updated = inspection(
      attached.source.path!,
      'supplier,unit,shipping,days\nNorth,43,180,7\n',
    );
    updated.version.modified = 2;
    const unchanged = await canvases.source(1, app.id, app.revision, updated);
    expect(unchanged.source.data.table!.rows[1]![1]).toBe('42');
    const refreshed = await canvases.source(1, app.id, app.revision, updated, attached.source.id);
    expect(refreshed.source.id).toBe(attached.source.id);
    expect(refreshed.source.data.table!.rows[1]![1]).toBe('43');
    expect((await canvases.read(1, app.id)).state.quantity).toBe(40);
    await expect(
      canvases.source(1, app.id, app.revision, updated, attached.source.id),
    ).rejects.toThrow('changed');
    const undone = await canvases.undo(1, app.id, refreshed.revision);
    expect(undone.sources[0]!.data.table!.rows[1]![1]).toBe('42');
    await canvases.flush();
    expect((await new Canvases(root, { changed: () => {} }).read(2, app.id)).state.quantity).toBe(
      40,
    );
  });
  it('forks sources independently and preserves snapshots in portable exports without paths', async () => {
    const initial = await create();
    const attached = await canvases.source(
      1,
      initial.id,
      0,
      inspection(path.join(root, 'quote.csv')),
    );
    const branch = await canvases.fork(1, initial.id, randomUUID());
    await canvases.source(
      1,
      branch.id,
      0,
      inspection(attached.source.path!, 'name,unit\nOther,5\n'),
      attached.source.id,
    );
    expect((await canvases.read(1, initial.id)).sources[0]!.data.table!.rows[1]![0]).toBe('North');
    await canvases.apply(1, branch.id, 1);
    expect((await canvases.read(1, initial.id)).sources[0]!.data.table!.rows[1]![0]).toBe('Other');
    const directory = await canvases.export(1, initial.id, root);
    const manifest = path.join(directory, 'canvas.viewer.json');
    expect(await readFile(manifest, 'utf8')).not.toContain(attached.source.path);
    const imported = await canvases.import(1, manifest, randomUUID());
    expect(imported.sources[0]!.path).toBeUndefined();
    expect(imported.sources[0]!.id).toBe(attached.source.id);
    const corrupted = JSON.parse(await readFile(manifest, 'utf8'));
    corrupted.sources[0].data.table.rows[1][1] = '999';
    await writeFile(manifest, JSON.stringify(corrupted));
    await expect(canvases.import(1, manifest, randomUUID())).rejects.toThrow('snapshot changed');
  });
  it('labels truncated, malformed and unsupported sources instead of claiming complete coverage', () => {
    const long = sourceSnapshot(inspection('/quote.csv', 'x,unit\n' + 'quoted,5\n'.repeat(1000)));
    expect(long.data.coverage.content).toBe('partial');
    const malformed = sourceSnapshot(inspection('/quote.csv', 'x,unit\n"unfinished'));
    expect(malformed.data.table!.malformed).toBe(true);
    expect(malformed.data.coverage.content).toBe('partial');
    const unsupported = inspection('/scan.pdf', '');
    unsupported.coverage = { content: 'unsupported', reason: 'No text reader.' };
    expect(sourceSnapshot(unsupported).data.coverage.content).toBe('unsupported');
    expect(sourceSnapshot(inspection('/bad.json', '{broken')).data.coverage.content).toBe(
      'partial',
    );
  });
});

describe('reviewed result saving', () => {
  const result = {
    format: 'csv' as const,
    name: 'comparison.csv',
    content: 'supplier,total\nNorth,1860\n',
  };
  it('cancels without writing and saves exact bytes to a fresh destination', async () => {
    const app = await create();
    expect(
      await canvases.saveResult(1, app.id, 0, 0, result, async () => undefined),
    ).toBeUndefined();
    const destination = path.join(root, result.name);
    expect(await canvases.saveResult(1, app.id, 0, 0, result, async () => destination)).toBe(
      destination,
    );
    expect(await readFile(destination, 'utf8')).toBe(result.content);
    await expect(
      canvases.saveResult(
        1,
        app.id,
        0,
        0,
        { ...result, content: 'changed' },
        async () => destination,
      ),
    ).rejects.toThrow();
    expect(await readFile(destination, 'utf8')).toBe(result.content);
    await symlink(destination, path.join(root, 'link.csv'));
    await expect(
      canvases.saveResult(1, app.id, 0, 0, result, async () => path.join(root, 'link.csv')),
    ).rejects.toThrow();
  });
  it('rejects input changes while the native picker is open', async () => {
    const app = await create();
    const destination = path.join(root, 'stale.csv');
    await expect(
      canvases.saveResult(1, app.id, 0, 0, result, async () => {
        await canvases.state(1, app.id, 0, 0, { quantity: 40 });
        return destination;
      }),
    ).rejects.toThrow('inputs changed');
    await expect(readFile(destination)).rejects.toThrow();
  });
  it('rejects invalid JSON, paths, oversized output and a different window', async () => {
    expect(
      canvasResultSchema.safeParse({ ...result, format: 'json', content: 'bad' }).success,
    ).toBe(false);
    expect(canvasResultSchema.safeParse({ ...result, name: '../secret' }).success).toBe(false);
    expect(
      canvasResultSchema.safeParse({ ...result, content: 'x'.repeat(1_000_001) }).success,
    ).toBe(false);
    const app = await create();
    await expect(
      canvases.saveResult(2, app.id, 0, 0, result, async () => path.join(root, result.name)),
    ).rejects.toThrow('another window');
  });
});

describe('runtime observations', () => {
  it('ties errors to a revision, retains them after ready, and respects cancellation', async () => {
    const observations = new CanvasObservations();
    observations.record('tool', 1, { status: 'error', message: 'missing control' });
    observations.record('tool', 1, { status: 'ready' });
    expect(await observations.wait('tool', 1, new AbortController().signal)).toEqual({
      status: 'error',
      message: 'missing control',
    });
    expect(observations.read('tool', 2).status).toBe('not-observed');
    const controller = new AbortController();
    const pending = observations.wait('tool', 2, controller.signal);
    controller.abort(new Error('Stopped'));
    await expect(pending).rejects.toThrow('Stopped');
    observations.record('tool', 2, { status: 'ready' });
    expect((await observations.wait('tool', 2, new AbortController().signal)).status).toBe('ready');
  });
});
