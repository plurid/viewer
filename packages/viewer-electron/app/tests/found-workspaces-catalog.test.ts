import { afterEach, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { WorkspaceDefinitions } from '../src/desktop/workspaces/definitions';
import { temporaryRoot } from '../tools/temporary';
import { defaultSettings } from '../src/domain/services';
import { foundDefinitions } from '../src/domain/workspaces/found/catalog';
import { hashDefinition } from './workspace-definition-fixtures';

const services: WorkspaceDefinitions[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  vi.useRealTimers();
});
it('appends found rows, checks their roots, subscribes to changes and never makes them ROOT targets', async () => {
  const directory = await temporaryRoot('viewer-found-catalog-');
  const home = directory + '/home';
  const entries = [
    {
      key: 'code/sample',
      root: home + '/code/sample',
      realpath: home + '/code/sample',
      identity: '1:2',
      names: ['sample'],
      at: 1,
    },
  ];
  let changed!: () => void;
  const stop = vi.fn();
  const checkRoot = vi.fn(async () => ({ directory: true }));
  const found = {
    load: vi.fn(async () => {}),
    configure: vi.fn(async () => {}),
    snapshot: (explicit: Parameters<typeof foundDefinitions>[1]) => {
      const definitions = foundDefinitions(entries, explicit, home, hashDefinition);
      return {
        definitions,
        state: { state: 'ready' as const, count: definitions.length, hidden: 0 },
      };
    },
    subscribe: (listener: () => void) => {
      changed = listener;
      return stop;
    },
  };
  const service = new WorkspaceDefinitions(directory, home, {
    found,
    access: async () => {},
    settings: () => defaultSettings(home),
    emit: () => {},
    checkRoot,
  });
  services.push(service);
  await service.load();
  expect(found.load).toHaveBeenCalledOnce();
  expect(service.snapshot().definitions[0]!.source).toBe('found');
  expect(service.snapshot().found).toEqual({ state: 'ready', count: 1, hidden: 0 });
  expect(checkRoot).not.toHaveBeenCalled();
  await service.checkRoot('code/sample');
  expect(checkRoot).toHaveBeenCalledWith(entries[0]!.root);
  await writeFile(
    service.configuration.file,
    JSON.stringify({
      version: 1,
      workspaces: {
        alias: { root: '{{ROOT:code/sample}}' },
      },
    }),
  );
  await service.reload();
  expect(service.entry('alias')).toBeUndefined();
  expect(service.snapshot().diagnostics.some((issue) => issue.key === 'alias')).toBe(true);
  entries.splice(0);
  vi.useFakeTimers();
  changed();
  await vi.advanceTimersByTimeAsync(151);
  await service.reload();
  expect(service.snapshot().definitions).toEqual([]);
  await service.close();
  expect(stop).toHaveBeenCalled();
});
