import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CheckedFolder } from '../src/domain/files/folder-checks';
import type { WorkspaceDefinitionsPorts } from '../src/desktop/workspaces/definitions';
import { WorkspaceDefinitions } from '../src/desktop/workspaces/definitions';
import { defaultSettings } from '../src/domain/services';
import { temporaryRoot } from '../tools/temporary';

const services: WorkspaceDefinitions[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(services.splice(0).map((service) => service.close()));
});

async function fixture(extra: Partial<WorkspaceDefinitionsPorts> = {}) {
  const root = await temporaryRoot('viewer-definitions-background-');
  const source = path.join(root, 'projects.json');
  const file = path.join(root, 'workspaces.jsonc');
  const folder = path.join(root, 'project');
  const emit = vi.fn();
  const checkRoot = vi.fn(async (_file: string): Promise<CheckedFolder> => ({ directory: true }));
  const service = new WorkspaceDefinitions(root, root, {
    access: async () => {},
    settings: () => defaultSettings(root),
    emit,
    checkRoot,
    ...extra,
  });
  services.push(service);
  const projects = (included = true) =>
    writeFile(
      source,
      JSON.stringify(included ? [{ name: 'Sample > site', rootPath: folder }] : []),
    );
  await writeFile(
    file,
    JSON.stringify({ version: 1, sources: { projectManager: { path: source } } }),
  );
  await projects();
  return { root, source, file, folder, service, emit, checkRoot, projects };
}

describe('background definition roots', () => {
  it('bounds the check of one selected root even when it never answers', async () => {
    const f = await fixture({ checkRoot: () => new Promise(() => {}) });
    await f.service.load();
    const started = performance.now();
    expect(await f.service.checkRoot('Sample/site')).toBe('unknown');
    expect(performance.now() - started).toBeLessThan(1000);
  });
  it('does not enqueue 5,000 roots on load or an expired-cache reload and checks only search candidates', async () => {
    const f = await fixture();
    await writeFile(
      f.source,
      JSON.stringify(
        Array.from({ length: 5000 }, (_, index) => ({
          name: 'Sample > project-' + index,
          rootPath: '/fixtures/root-' + index,
        })),
      ),
    );
    await f.service.load();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(f.checkRoot).not.toHaveBeenCalled();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 60_001);
    await f.service.reload();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(f.checkRoot).not.toHaveBeenCalled();
    f.service.searchRoots('project-99', 1, 4);
    await vi.waitFor(() => expect(f.checkRoot).toHaveBeenCalledTimes(4));
    expect(f.checkRoot.mock.calls.map(([file]) => file)).toHaveLength(4);
    f.service.clearRootSearch(1);
    const calls = f.checkRoot.mock.calls.length;
    f.service.refreshRoots();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(f.checkRoot).toHaveBeenCalledTimes(calls);
  });
  it('keeps only two root checks in flight while the rest wait', async () => {
    const releases: (() => void)[] = [];
    const checkRoot = vi.fn(
      () =>
        new Promise<CheckedFolder>((resolve) => {
          releases.push(() => resolve({ directory: true }));
        }),
    );
    const f = await fixture({ checkRoot });
    await writeFile(
      f.source,
      JSON.stringify(
        Array.from({ length: 20 }, (_, index) => ({
          name: `Sample > project-${index}`,
          rootPath: `/fixtures/root-${index}`,
        })),
      ),
    );
    await f.service.load();
    expect(checkRoot).not.toHaveBeenCalled();
    f.service.searchRoots('', 1, 20);
    await vi.waitFor(() => expect(checkRoot).toHaveBeenCalledTimes(2));
    releases.shift()!();
    await vi.waitFor(() => expect(checkRoot).toHaveBeenCalledTimes(3));
    await f.service.close();
    for (const release of releases) release();
  });
  it('loads and closes without waiting for a root that never answers', async () => {
    let release!: () => void;
    const rootAccess = new Promise<void>((resolve) => {
      release = resolve;
    });
    const checkRoot = vi.fn(() => new Promise<CheckedFolder>(() => {}));
    const f = await fixture({
      access: async (files) => {
        if (files[0]?.endsWith('/project')) await rootAccess;
      },
      checkRoot,
    });
    const loaded = f.service.load();
    try {
      const result = await Promise.race([
        loaded.then(() => 'loaded'),
        new Promise((resolve) => setTimeout(() => resolve('waiting on a root'), 1000)),
      ]);
      expect(result).toBe('loaded');
      expect(f.emit.mock.calls[0]![0].definitions[0].rootState).toBe('unknown');
      expect(f.service.entry('Sample/site')!.rootState).toBe('unknown');
      expect(checkRoot).not.toHaveBeenCalled();
      f.service.searchRoots('site', 1);
      await vi.waitFor(() => expect(checkRoot).toHaveBeenCalledOnce());
      await f.service.close();
    } finally {
      release();
      await loaded;
    }
  });
  it('publishes results later and rechecks missing roots on search and mounts', async () => {
    let mounted!: () => void;
    const checkRoot = vi.fn(async (): Promise<CheckedFolder> => ({
      directory: false,
      missing: true,
    }));
    const f = await fixture({
      checkRoot,
      watchVolumes: (changed) => {
        mounted = changed;
        return () => {};
      },
    });
    await f.service.load();
    f.service.searchRoots('site', 1);
    await vi.waitFor(() => expect(f.service.entry('Sample/site')!.rootState).toBe('missing'));
    checkRoot.mockResolvedValue({ directory: true });
    f.service.refreshRoots();
    await vi.waitFor(() => expect(f.service.entry('Sample/site')!.rootState).toBe('present'));
    checkRoot.mockResolvedValue({ directory: false, unchecked: true });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 60_001);
    await f.service.reload();
    await vi.waitFor(() => expect(f.service.entry('Sample/site')!.rootState).toBe('unknown'));
    await vi.waitFor(() => expect(checkRoot).toHaveBeenCalledTimes(3));
    // Let the preceding reload finish completely before changing the mount state.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const beforeMount = checkRoot.mock.calls.length;
    checkRoot.mockResolvedValue({ directory: true });
    mounted();
    await vi.waitFor(() => expect(f.service.entry('Sample/site')!.rootState).toBe('present'));
    expect(checkRoot).toHaveBeenCalledTimes(beforeMount + 1);
    expect(
      f.service
        .snapshot()
        .diagnostics.some((issue) => issue.message.includes('root folder is missing')),
    ).toBe(false);
  });
  it('reuses fresh roots but prunes removed roots before they can be reintroduced', async () => {
    const f = await fixture();
    await f.service.load();
    f.service.searchRoots('site', 1);
    await vi.waitFor(() => expect(f.service.entry('Sample/site')!.rootState).toBe('present'));
    await f.service.reload();
    expect(f.checkRoot).toHaveBeenCalledOnce();
    await f.projects(false);
    await f.service.reload();
    expect(f.service.snapshot().definitions).toEqual([]);
    await f.projects();
    await f.service.reload();
    await vi.waitFor(() => expect(f.checkRoot).toHaveBeenCalledTimes(2));
  });
  it('coalesces a burst of five file notifications into one catalog emission', async () => {
    const f = await fixture();
    let notify!: () => void;
    vi.spyOn(f.service.configuration, 'watch').mockImplementation((reload) => {
      notify = reload;
    });
    await f.service.load();
    f.service.searchRoots('site', 1);
    await vi.waitFor(() => expect(f.service.entry('Sample/site')!.rootState).toBe('present'));
    const reload = vi.spyOn(f.service, 'reload');
    f.emit.mockClear();
    vi.useFakeTimers();
    for (let index = 0; index < 5; index++) {
      await writeFile(
        f.file,
        JSON.stringify({
          version: 1,
          sources: { projectManager: { path: f.source } },
          workspaces: { 'Sample/site': { name: `Name ${index}` } },
        }),
      );
      notify();
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(129);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reload).toHaveBeenCalledOnce();
    await reload.mock.results[0]!.value;
    expect(f.service.entry('Sample/site')!.name).toBe('Name 4');
    expect(f.emit).toHaveBeenCalledOnce();
  });
});
