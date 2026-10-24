/** Production native review checks with a recording OS Trash selector. Fixtures stay on disk. */
import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { lstat, mkdir, readFile, realpath, symlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inspectReviewedFile } from '../src/desktop/native/reviewed-file';
import type { MacFiles } from '../src/desktop/native/macos-files';
import { temporaryRoot } from '../tools/temporary';
import { guardNativeTestRemovals } from '../src/desktop/native/test-removal-policy';

interface RecordingFiles extends MacFiles {
  readonly recordingTrash: boolean;
  recordedTrashCalls(): number;
}

it.skipIf(process.platform !== 'darwin' || !process.env.VIEWER_TEST_REVIEW_BINDING)(
  'blocks Trash before entering an actual recording N-API binding',
  async () => {
    const native = createRequire(import.meta.url)(
      path.resolve(process.env.VIEWER_TEST_REVIEW_BINDING!),
    ) as RecordingFiles;
    expect(native.recordingTrash).toBe(true);
    const before = native.recordedTrashCalls();
    const guarded = guardNativeTestRemovals(native, {
      VIEWER_RENDER_TEST: '1',
      VIEWER_DATA_DIRECTORY: '/generated/isolated-profile',
      VIEWER_TEST_NO_REMOVAL: '1',
    });
    await expect(guarded.trash('/generated/must-not-enter-native')).rejects.toMatchObject({
      code: 'TEST_REMOVAL_BLOCKED',
    });
    expect(guarded.recordedTrashCalls()).toBe(before);
    expect(native.recordedTrashCalls()).toBe(before);
  },
);

it.skipIf(process.platform !== 'darwin' || !process.env.VIEWER_TEST_REVIEW_BINDING)(
  'checks exact native versions and hashes before the recording Trash adapter',
  async () => {
    const native = createRequire(import.meta.url)(
      path.resolve(process.env.VIEWER_TEST_REVIEW_BINDING!),
    ) as RecordingFiles;
    // This assertion precedes every positive call, so a production binding can never erase a fixture.
    expect(native.recordingTrash).toBe(true);
    expect(typeof native.recordedTrashCalls).toBe('function');
    const root = await realpath(await temporaryRoot('viewer-reviewed-native-'));
    const file = path.join(root, 'Generated shell command');
    const text = '#!/bin/sh\n# Generated review fixture\n';
    await writeFile(file, text, { mode: 0o700 });
    const inspected = await inspectReviewedFile(file, 32768);
    const before = native.recordedTrashCalls();
    expect(await native.trash(file, undefined, inspected.reviewed)).toMatchObject({ path: file });
    expect(native.recordedTrashCalls()).toBe(before + 1);
    expect(await readFile(file, 'utf8')).toBe(text);

    const changedVersion = {
      ...inspected.reviewed,
      version: { ...inspected.reviewed.version, identity: '1:999' },
    };
    await expect(native.trash(file, undefined, changedVersion)).rejects.toThrow('preserved');
    await expect(
      native.trash(file, undefined, { ...inspected.reviewed, sha256: '0'.repeat(64) }),
    ).rejects.toThrow('preserved');

    const info = await lstat(file);
    await writeFile(file, text.replace('Generated', 'Different'));
    await utimes(file, info.atime, info.mtime);
    await expect(native.trash(file, undefined, inspected.reviewed)).rejects.toThrow('preserved');
    expect(native.recordedTrashCalls()).toBe(before + 1);
    expect(await readFile(file, 'utf8')).toContain('Different');

    const link = path.join(root, 'Generated link');
    await symlink(file, link);
    await expect(native.trash(link, undefined, inspected.reviewed)).rejects.toThrow('preserved');
    const folder = path.join(root, 'Generated folder');
    await mkdir(folder);
    await expect(native.trash(folder, undefined, inspected.reviewed)).rejects.toThrow('preserved');
    expect(native.recordedTrashCalls()).toBe(before + 1);

    expect(() =>
      native.trash(file, undefined, { ...inspected.reviewed, sha256: 'invalid' }),
    ).toThrow('Invalid native file argument');
    expect(native.recordedTrashCalls()).toBe(before + 1);
  },
);
