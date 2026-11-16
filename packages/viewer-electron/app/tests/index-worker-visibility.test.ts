import { expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { HiddenPaths } from '../src/desktop/files/hidden-paths';
import type { ApplicationSettings } from '../src/domain/services';
import { defaultSettings } from '../src/domain/services';
import { FileIndex } from '../src/desktop/search/index-core';
import { fileVisibility } from '../src/desktop/files/visibility';
import { temporaryRoot } from '../tools/temporary';

const transport = vi.hoisted(() => ({
  receive: undefined as ((event: { data: unknown }) => void | Promise<void>) | undefined,
  batch: undefined as ((files: readonly string[]) => Promise<void>) | undefined,
  postMessage: vi.fn(),
}));
vi.mock('../src/desktop/workers/worker-port', () => ({
  workerPort: {
    postMessage: transport.postMessage,
    on: (_name: string, receive: typeof transport.receive) => {
      transport.receive = receive;
    },
  },
}));
vi.mock('../src/desktop/search/index-watch', () => ({
  IndexWatcher: class {
    constructor(
      _config: ApplicationSettings['search'],
      _changed: unknown,
      _failed: unknown,
      batch: typeof transport.batch,
    ) {
      transport.batch = batch;
    }
    async stop() {}
  },
}));
vi.mock('../src/desktop/previews/formats', () => ({ extractDocument: vi.fn(async () => '') }));
vi.mock('../src/desktop/files/inspection', () => ({ inspectFile: vi.fn() }));
vi.mock('../src/desktop/previews/drawing-geometry', () => ({ readDrawingGeometry: vi.fn() }));

it('uses direct flags for an isolated worker event and one shared folder cache for each real worker batch', async () => {
  const root = await temporaryRoot('viewer-worker-visibility-');
  const folder = path.join(root, 'Folder');
  await mkdir(folder);
  const files = Array.from({ length: 8 }, (_, index) => path.join(folder, `File ${index}.txt`));
  for (const file of files) await writeFile(file, 'fixture', { flag: 'wx' });
  const flags = vi.spyOn(fileVisibility, 'hiddenEntries').mockResolvedValue([]);
  const single = vi.spyOn(fileVisibility, 'fileHidden').mockResolvedValue(false);
  const index = new FileIndex(':memory:');
  const open = vi.spyOn(FileIndex, 'open').mockResolvedValue(index);
  try {
    await import('../src/desktop/workers/worker');
    await transport.receive!({ data: { id: 1, method: 'init', args: [':memory:', false] } });
    await transport.receive!({
      data: { id: 2, method: 'configure', args: [defaultSettings(root).search] },
    });
    await index.settled();
    flags.mockClear();
    single.mockClear();
    await transport.batch!([files[0]!]);
    expect(flags).not.toHaveBeenCalled();
    expect(single.mock.calls.map(([file]) => file)).toEqual([folder, files[0]]);
    single.mockClear();
    const update = vi.spyOn(index, 'update');
    await transport.batch!(files);
    expect(flags.mock.calls.map(([file]) => file)).toEqual([root, folder]);
    expect(single).not.toHaveBeenCalled();
    const cache = update.mock.calls[0]?.[2] as HiddenPaths;
    expect(cache).toBeTruthy();
    expect(update.mock.calls.every((call) => call[2] === cache)).toBe(true);
    await transport.batch!(files);
    expect(flags).toHaveBeenCalledTimes(4);
    expect(update.mock.calls.at(-1)?.[2]).not.toBe(cache);
  } finally {
    await index.close();
    open.mockRestore();
    flags.mockRestore();
    single.mockRestore();
  }
});
