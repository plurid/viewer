import { describe, expect, it, vi } from 'vitest';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Operations } from '../src/desktop/operations/operations';
import { inspectReviewedFile } from '../src/desktop/native/reviewed-file';
import { fileCoordination } from '../src/desktop/files/file-coordination';
import { temporaryRoot } from '../tools/temporary';

describe('reviewed shell command removal queue', () => {
  it('passes the exact reviewed version and hash through the ordinary operation service', async () => {
    const root = await realpath(await temporaryRoot('viewer-reviewed-queue-'));
    const file = path.join(root, 'viewer');
    await writeFile(file, '#!/bin/sh\n# Generated shell fixture\n');
    const { reviewed } = await inspectReviewedFile(file, 32768);
    // Recording adapter: this test never removes its generated file.
    const trash = vi.fn(async () => undefined);
    const operations = new Operations(trash, () => {});
    try {
      await operations.trashReviewedFile(reviewed);
      expect(trash).toHaveBeenCalledExactlyOnceWith(file, reviewed);
      expect(await readFile(file, 'utf8')).toContain('Generated shell fixture');
    } finally {
      await operations.close();
    }
  });

  it('preserves a file changed while its reviewed removal waits for coordination', async () => {
    const root = await realpath(await temporaryRoot('viewer-reviewed-queue-race-'));
    const file = path.join(root, 'viewer');
    await writeFile(file, '#!/bin/sh\n# Reviewed fixture\n');
    const { reviewed } = await inspectReviewedFile(file, 32768);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocker = fileCoordination.run([{ path: file, mode: 'write' }], async () => {
      entered();
      await gate;
    });
    await Promise.race([started, blocker]);
    const trash = vi.fn(async () => undefined);
    const operations = new Operations(trash, () => {});
    try {
      const removal = operations.trashReviewedFile(reviewed);
      // Attach a rejection handler immediately, before releasing the queued operation.
      const preserved = expect(removal).rejects.toThrow(/changed|preserved/i);
      await writeFile(file, '#!/bin/sh\n# New unreviewed fixture\n');
      release();
      await blocker;
      await preserved;
      expect(trash).not.toHaveBeenCalled();
      expect(await readFile(file, 'utf8')).toContain('New unreviewed fixture');
    } finally {
      release();
      await blocker;
      await operations.close();
    }
  });
});
