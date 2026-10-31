import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { OperationJob } from '../src/domain/contracts';
import { Operations } from '../src/desktop/operations/operations';
import * as removal from '../src/desktop/operations/removal';
import {
  OperationLog,
  operationJournal,
  type OperationReceipt,
} from '../src/desktop/operations/operation-journal';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import { removalBlocked } from './support/preservation';

let root: string, data: string;
beforeEach(async () => {
  root = await temporaryRoot('viewer-operation-log-');
  data = path.join(root, 'private');
});
afterEach(async () => {
  vi.restoreAllMocks();
  await trashTemporary(root);
});
const receipt = (overrides: Partial<OperationJob> = {}): OperationReceipt => {
  const id = randomUUID();
  return {
    job: {
      id,
      revision: 1,
      kind: 'copy',
      status: 'running',
      sources: [path.join(root, 'a')],
      destination: path.join(root, 'out'),
      bytesDone: 0,
      bytesTotal: 0,
      itemsDone: 0,
      itemsTotal: 1,
      completed: [],
      errors: [],
      errorCount: 0,
      undoable: false,
      ...overrides,
    },
    request: { kind: 'copy', sources: [path.join(root, 'a')], destination: path.join(root, 'out') },
    undo: [],
    intent: { source: path.join(root, 'a'), destination: path.join(root, 'out', 'a') },
  };
};
const logFile = (id: string) => path.join(data, 'operation-journal-v2', id + '.jsonl');

describe('append-only operation log', () => {
  it('clears finished notifications durably while preserving receipts and Undo', async () => {
    const log = new OperationLog(data);
    await log.load();
    const value = receipt({ status: 'completed', undoable: true });
    delete value.intent;
    value.undo = [
      {
        from: path.join(root, 'out', 'a'),
        to: path.join(root, 'a'),
        identity: '1:1',
        size: 0,
        modified: 0,
      },
    ];
    await log.record(value);
    const operations = new Operations(
      async () => {
        throw new Error('No file removal');
      },
      () => {},
      undefined,
      undefined,
      undefined,
      data,
    );
    try {
      await operations.load();
      await operations.dismiss([value.job.id]);
      expect(operations.all()[0]).toMatchObject({
        dismissed: true,
        undoable: true,
        status: 'completed',
      });
      const restored = (await new OperationLog(data).load()).receipts[0];
      expect(restored.job).toMatchObject({ dismissed: true, undoable: true });
      expect(restored.undo).toEqual(value.undo);
      expect(restored.request).toEqual(value.request);
      restored.intent = { source: path.join(root, 'out', 'a'), destination: path.join(root, 'a') };
      const interrupted = new OperationLog(data);
      await interrupted.load();
      await interrupted.record(restored);
      const restarted = new Operations(
        async () => {},
        () => {},
        undefined,
        undefined,
        undefined,
        data,
      );
      try {
        await restarted.load();
        expect(restarted.all()[0]).toMatchObject({ status: 'failed', undoable: false });
        expect(restarted.all()[0].dismissed).toBeUndefined();
      } finally {
        await restarted.close();
      }
    } finally {
      await operations.close();
    }
  });
  it('appends only changes, so a long job writes linearly, and compacts when finished', async () => {
    const files = Array.from({ length: 150 }, (_, index) => path.join(root, `file-${index}.txt`));
    await Promise.all(files.map((file) => writeFile(file, 'contents')));
    const destination = path.join(root, 'out');
    await mkdir(destination);
    const appended: number[] = [];
    const append = (
      OperationLog.prototype as unknown as { append: (...args: string[]) => Promise<void> }
    ).append;
    vi.spyOn(
      OperationLog.prototype as unknown as {
        append: (file: string, text: string) => Promise<void>;
      },
      'append',
    ).mockImplementation(function (this: OperationLog, file: string, text: string) {
      appended.push(Buffer.byteLength(text));
      return append.call(this, file, text);
    });
    const operations = new Operations(
      async () => {},
      () => {},
      undefined,
      undefined,
      undefined,
      data,
    );
    const id = operations.start({ kind: 'copy', sources: files, destination });
    await vi.waitFor(
      () => expect(operations.all().find((job) => job.id === id)?.status).toBe('completed'),
      { timeout: 60000, interval: 20 },
    );
    await operations.close();
    // Each append carries one item's changes, never the whole history.
    expect(Math.max(...appended)).toBeLessThan(4000);
    expect(appended.reduce((sum, size) => sum + size, 0)).toBeLessThan(files.length * 4000);
    const text = await readFile(logFile(id), 'utf8');
    expect(text.trim().split('\n')).toHaveLength(1);
    const restored = new Operations(
      async () => {},
      () => {},
      undefined,
      undefined,
      undefined,
      data,
    );
    await restored.load();
    expect(restored.all().find((job) => job.id === id)).toMatchObject({
      status: 'completed',
      undoable: true,
    });
    expect(restored.all().find((job) => job.id === id)?.completed).toHaveLength(files.length);
  }, 60_000);
  it('replays deltas, ignores a torn final line and keeps cleared fields cleared', async () => {
    const log = new OperationLog(data);
    await log.load();
    const value = receipt({ collision: { source: '/a', destination: '/b' } });
    await log.record(value);
    value.job.collision = undefined;
    value.job.completed.push({
      source: path.join(root, 'a'),
      destination: path.join(root, 'out', 'a'),
    });
    value.intent = undefined;
    await log.record(value);
    await appendFile(logFile(value.job.id), '{"t":"intent","intent":{"sou');
    const [restored] = (await new OperationLog(data).load()).receipts;
    expect(restored.job.collision).toBeUndefined();
    expect(restored.job.completed).toHaveLength(1);
    expect(restored.intent).toBeUndefined();
  });
  it('keeps a log readable after a torn final line, at the launch after next too', async () => {
    const log = new OperationLog(data);
    await log.load();
    const value = receipt();
    await log.record(value);
    await appendFile(logFile(value.job.id), '{"t":"intent","intent":{"sou');
    // The next launch restores the job and records its new status.
    const next = new OperationLog(data);
    const [restored] = (await next.load()).receipts;
    await next.record({ ...restored, job: { ...restored.job, status: 'failed', revision: 2 } });
    const { receipts, notices } = await new OperationLog(data).load();
    expect(notices).toEqual([]);
    expect(receipts.map((item) => item.job.status)).toEqual(['failed']);
  });
  it('sets aside a log with a damaged middle line and reports it', async () => {
    const log = new OperationLog(data);
    await log.load();
    const value = receipt();
    await log.record(value);
    await appendFile(logFile(value.job.id), 'not json\n{"t":"intent","intent":null}\n');
    const { receipts, notices } = await new OperationLog(data).load();
    expect(receipts).toEqual([]);
    expect(notices[0]).toContain('kept at');
    const names = await readdir(path.join(data, 'operation-journal-v2'));
    expect(names.some((name) => name.includes('.unreadable-'))).toBe(true);
  });
  it('migrates a version 1 journal once and keeps the original file', async () => {
    const value = receipt({ status: 'completed' });
    await operationJournal(data).save({ version: 1, records: [value] });
    const { receipts } = await new OperationLog(data).load();
    expect(receipts.map((item) => item.job.id)).toEqual([value.job.id]);
    const names = await readdir(data);
    expect(names.some((name) => name.startsWith('operation-journal-v1.json.migrated-'))).toBe(true);
    expect(names).not.toContain('operation-journal-v1.json');
    expect((await new OperationLog(data).load()).receipts).toHaveLength(1);
  });
  it('drops logs of jobs that left the bounded history', async () => {
    const log = new OperationLog(data);
    await log.load();
    const value = receipt({ status: 'completed' });
    await log.record(value);
    if (removalBlocked('operation-history log reclamation', [logFile(value.job.id)])) {
      await expect(log.forget(value.job.id)).rejects.toMatchObject({
        code: 'TEST_REMOVAL_BLOCKED',
      });
      expect((await new OperationLog(data).load()).receipts.map((item) => item.job.id)).toEqual([
        value.job.id,
      ]);
    } else {
      await log.forget(value.job.id);
      expect(await readdir(path.join(data, 'operation-journal-v2'))).toEqual([]);
    }
  });
  it('can retry forgetting a receipt after filesystem removal fails', async () => {
    const log = new OperationLog(data);
    await log.load();
    const value = receipt({ status: 'completed' });
    await log.record(value);
    const blocked = vi
      .spyOn(removal, 'removePrivateData')
      .mockRejectedValue(new Error('Generated removal failure'));
    try {
      await expect(log.forget(value.job.id)).rejects.toThrow('Generated removal failure');
      await expect(log.forget(value.job.id)).rejects.toThrow('Generated removal failure');
      expect(blocked).toHaveBeenCalledTimes(2);
      expect(await readFile(logFile(value.job.id), 'utf8')).toContain(value.job.id);
    } finally {
      blocked.mockRestore();
    }
  });
});
