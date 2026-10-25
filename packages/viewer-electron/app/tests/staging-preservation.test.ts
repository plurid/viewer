import { afterEach, describe, expect, it, vi } from 'vitest';
import { lstat, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { privateStage } from '../src/desktop/operations/staging';
import { temporaryRoot } from '../tools/temporary';

afterEach(() => vi.unstubAllEnvs());

describe('transfer staging during preserved validation', () => {
  it('keeps an empty stage without failing a published transfer', async () => {
    vi.stubEnv('VIEWER_TEST_NO_REMOVAL', '1');
    const root = await temporaryRoot('viewer-stage-preservation-');
    const stage = await privateStage(root, '.viewer-transfer-');
    await writeFile(stage.file, 'generated copy');
    const published = path.join(root, 'Published.txt');
    await rename(stage.file, published);

    await expect(stage.dispose()).resolves.toBeUndefined();
    expect((await lstat(path.dirname(stage.file))).isDirectory()).toBe(true);
    expect(await readFile(published, 'utf8')).toBe('generated copy');
  });

  it('reports retained partial content without invoking any Trash adapter', async () => {
    vi.stubEnv('VIEWER_TEST_NO_REMOVAL', '1');
    const root = await temporaryRoot('viewer-stage-preservation-');
    const trash = vi.fn(async () => {});
    const stage = await privateStage(root, '.viewer-transfer-', trash);
    await writeFile(stage.file, 'generated partial copy');

    await expect(stage.dispose()).resolves.toBe(path.dirname(stage.file));
    expect(trash).not.toHaveBeenCalled();
    expect(await readFile(stage.file, 'utf8')).toBe('generated partial copy');
  });
});
