import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { temporaryRoot } from '../tools/temporary';
import { FileAccess } from '../src/desktop/files/file-access';
import { createFolderHistoryChecks } from '../src/desktop/windows/folder-history-checks';
import type { CheckedFolder } from '../src/domain/files/folder-checks';

const sleeping = vi.hoisted(() => new Set<string>());
vi.mock('../src/desktop/workers/utility-client', async () => {
  const { checkHistoryFolder } = await import('../src/desktop/files/folder-history');
  return {
    launchWorker: () => {
      let receive: ((reply: { value: CheckedFolder }) => void) | undefined;
      return {
        postMessage: (file: string) => {
          if (sleeping.has(file)) return;
          let value: CheckedFolder;
          try {
            value = checkHistoryFolder(file);
          } catch {
            value = { directory: false, unavailable: true };
          }
          queueMicrotask(() => receive?.({ value }));
        },
        message: (listener: typeof receive) => {
          receive = listener;
        },
        exit: () => {},
        thread: { terminate: async () => {}, on: () => {} },
      };
    },
  };
});
afterEach(() => sleeping.clear());
async function fixture() {
  const root = await temporaryRoot('viewer-history-access-');
  const folder = path.join(root, 'Granted');
  const sub = path.join(folder, 'Sub');
  await mkdir(sub, { recursive: true });
  const stop = vi.fn();
  const start = vi.fn(() => stop);
  const access = new FileAccess(path.join(root, 'private'), { start });
  Reflect.set(access, 'store', {
    load: async () => ({
      version: 1,
      grants: [{ path: folder, directory: true, bookmark: 'fixture' }],
    }),
  });
  const checks = createFolderHistoryChecks('/fixtures/history-worker.cjs', access);
  return { folder, sub, access, checks, stop, start };
}
it('does not release an ordinary live grant when a remembered folder was deleted', async () => {
  const { folder, sub, access, checks, stop, start } = await fixture();
  try {
    await access.require([sub]);
    const result = await checks
      .check(path.join(folder, 'Gone'))
      .catch(() => ({ directory: false, unavailable: true }));
    expect(result.directory).toBe(false);
    expect(stop).not.toHaveBeenCalled();
    await expect(access.require([sub])).resolves.toBeUndefined();
    expect(start).toHaveBeenCalledTimes(1);
  } finally {
    checks.close();
    await access.close();
  }
});
it('cannot poison ordinary access by starting a history check on a slow saved grant', async () => {
  const { folder, sub, access, checks, stop, start } = await fixture();
  sleeping.add(folder);
  try {
    const history = checks.check(sub).catch(() => ({ directory: false, unavailable: true }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(access.require([sub])).resolves.toBeUndefined();
    await history;
    expect(stop).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledTimes(1);
  } finally {
    checks.close();
    await access.close();
  }
});

it('skips dormant saved grants without starting or stopping them', async () => {
  const { sub, access, checks, start, stop } = await fixture();
  try {
    expect(await checks.check(sub)).toMatchObject({ directory: false, unavailable: true });
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  } finally {
    checks.close();
    await access.close();
  }
});
