import { describe, it, expect, vi } from 'vitest';
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { OperationPlans } from '../src/desktop/operation-plans';
import { Operations } from '../src/desktop/operations';
import { DocumentStore } from '../src/desktop/document-store';
import { Checkpoints } from '../src/desktop/checkpoints';
import type { OperationPlan } from '../src/domain/operation-plan';
import { sourceVersion } from '../src/domain/inspection';
import { entry } from '../src/desktop/filesystem';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
async function fixture() {
  const root = await temporaryRoot('viewer-operation-plan-');
  const dest = path.join(root, 'Destination');
  await mkdir(dest);
  const source = path.join(root, 'Source.txt');
  await writeFile(source, 'Original');
  const operations = new Operations(
    (file) => rename(file, path.join(root, 'Trashed-' + path.basename(file))),
    () => {},
    undefined,
    undefined,
    undefined,
    path.join(root, 'Profile'),
  );
  const checkpoints = new Checkpoints(
    path.join(root, 'Snapshots'),
    async () => {},
    () => 10485760,
  );
  const plans = new OperationPlans(
    path.join(root, 'Plans'),
    operations,
    checkpoints,
    async () => {},
  );
  return {
    root,
    dest,
    source,
    operations,
    checkpoints,
    plans,
    close: async () => {
      await plans.close();
      await operations.close();
      await checkpoints.close();
      await trashTemporary(root);
    },
  };
}
describe('shared reviewed operation plans', () => {
  it('keeps review usable and queues no mutation if the applying receipt cannot be saved', async () => {
    const f = await fixture();
    const original = DocumentStore.prototype.save;
    try {
      const plan = (await f.plans.request({
        kind: 'prepare',
        title: 'Receipt failure',
        intents: [{ kind: 'copy', sources: [f.source], destination: f.dest }],
      })) as OperationPlan;
      const spy = vi.spyOn(DocumentStore.prototype, 'save').mockImplementation(function (
        this: DocumentStore<unknown>,
        value,
      ) {
        if (
          this.file.endsWith('operation-plans-v1.json') &&
          Array.isArray(value) &&
          value.some((plan) => plan.status === 'applying')
        )
          return Promise.reject(new Error('Generated receipt failure'));
        return original.call(this, value);
      });
      await expect(
        f.plans.request({
          kind: 'apply',
          id: plan.id,
          revision: 1,
          checkpoint: false,
          rows: [{ id: plan.rows[0].id, approved: true }],
        }),
      ).rejects.toThrow('Generated receipt failure');
      expect(await f.plans.request({ kind: 'get', id: plan.id })).toMatchObject({
        status: 'review',
        revision: 1,
      });
      expect(f.operations.all()).toEqual([]);
      spy.mockRestore();
    } finally {
      vi.restoreAllMocks();
      await f.close();
    }
  });
  it('does not mutate while preparing, excludes unchecked rows, saves an optional checkpoint and guards Undo', async () => {
    const f = await fixture();
    try {
      const second = path.join(f.root, 'Second.txt');
      await writeFile(second, 'Other');
      const plan = (await f.plans.request({
        kind: 'prepare',
        title: 'Reviewed copy',
        intents: [{ kind: 'copy', sources: [f.source, second], destination: f.dest }],
      })) as OperationPlan;
      expect(plan.version).toBe(1);
      expect(await readFile(f.source, 'utf8')).toBe('Original');
      const queued = (await f.plans.request({
        kind: 'apply',
        id: plan.id,
        revision: plan.revision,
        checkpoint: true,
        rows: plan.rows.map((row, index) => ({ id: row.id, approved: index === 0 })),
      })) as OperationPlan;
      expect(queued.checkpointID).toBeTruthy();
      await vi.waitFor(() => expect(f.operations.all()[0]?.status).toBe('completed'), {
        timeout: 10000,
      });
      expect(await readFile(path.join(f.dest, 'Source.txt'), 'utf8')).toBe('Original');
      await expect(readFile(path.join(f.dest, 'Second.txt'))).rejects.toThrow();
      await f.operations.undo(queued.rows[0].jobID!);
      await expect(readFile(path.join(f.dest, 'Source.txt'))).rejects.toThrow();
      expect(await readFile(f.source, 'utf8')).toBe('Original');
    } finally {
      await f.close();
    }
  });
  it('rejects stale comparison versions, stale approvals and a file changed while its copy waits in the queue', async () => {
    const f = await fixture();
    try {
      const version = sourceVersion(await entry(f.source));
      await writeFile(f.source, 'Changed');
      await expect(
        f.plans.request({
          kind: 'prepare',
          title: 'Stale comparison',
          intents: [
            {
              kind: 'copy',
              sources: [f.source],
              destination: f.dest,
              expectedSources: [{ path: f.source, version }],
            },
          ],
        }),
      ).rejects.toThrow('Comparison source changed');
      const plan = (await f.plans.request({
        kind: 'prepare',
        title: 'Current',
        intents: [{ kind: 'copy', sources: [f.source], destination: f.dest }],
      })) as OperationPlan;
      await expect(
        f.plans.request({
          kind: 'apply',
          id: plan.id,
          revision: 0,
          checkpoint: false,
          rows: [{ id: plan.rows[0].id, approved: true }],
        }),
      ).rejects.toThrow('changed');
      const queuedVersion = sourceVersion(await entry(f.source));
      let job = '';
      await f.operations.exclusive(async () => {
        job = f.operations.start({
          kind: 'copy',
          sources: [f.source],
          destination: f.dest,
          expectedSources: [{ path: f.source, version: queuedVersion }],
        });
        await writeFile(f.source, 'A later edit');
      });
      await vi.waitFor(() =>
        expect(f.operations.all().find((value) => value.id === job)?.status).toBe('failed'),
      );
      expect(f.operations.all().find((value) => value.id === job)?.errors[0].message).toContain(
        'changed after review',
      );
      await expect(readFile(path.join(f.dest, 'Source.txt'))).rejects.toThrow();
    } finally {
      await f.close();
    }
  });
});
