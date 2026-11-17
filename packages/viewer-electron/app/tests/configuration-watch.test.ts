import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BigIntStats } from 'node:fs';
import type * as FileSystem from 'node:fs';
import { JsoncConfiguration } from '../src/desktop/preferences/configuration';

const watchers = vi.hoisted(() => ({ watch: vi.fn(), unwatch: vi.fn() }));
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof FileSystem>()),
  watchFile: watchers.watch,
  unwatchFile: watchers.unwatch,
}));
afterEach(() => vi.clearAllMocks());

const info = (extra: Partial<BigIntStats> = {}): BigIntStats =>
  ({
    dev: 1n,
    ino: 2n,
    mode: 0o100600n,
    nlink: 1n,
    uid: 1n,
    size: 20n,
    blocks: 1n,
    atimeNs: 1_000_000n,
    mtimeNs: 2_000_000n,
    ctimeNs: 3_000_000n,
    birthtimeNs: 1_000_000n,
    mtimeMs: 2n,
    ctimeMs: 3n,
    ...extra,
  }) as BigIntStats;

describe('configuration watcher predicates', () => {
  it('keeps metadata-only changes quiet for config.jsonc but notices content and replacement', () => {
    const configuration = new JsoncConfiguration('/fixtures', (value) => value);
    const reload = vi.fn();
    configuration.watch(reload);
    const listener = watchers.watch.mock.calls[0]![2] as (
      current: BigIntStats,
      previous: BigIntStats,
    ) => void;
    const before = info();
    listener(info({ ctimeMs: 4n, ctimeNs: 4_000_000n, mode: 0o100640n }), before);
    expect(reload).not.toHaveBeenCalled();
    listener(info({ ctimeMs: 5n, ctimeNs: 5_000_000n }), before);
    expect(reload).not.toHaveBeenCalled();
    for (const changed of [{ mtimeMs: 4n }, { size: 21n }, { ino: 3n }])
      listener(info(changed), before);
    expect(reload).toHaveBeenCalledTimes(3);
    configuration.close();
    expect(watchers.unwatch).toHaveBeenCalledWith('/fixtures/config.jsonc', listener);
  });
  it('keeps ctime sensitivity for workspace definitions', () => {
    const configuration = new JsoncConfiguration('/fixtures', (value) => value, undefined, {
      name: 'workspaces.jsonc',
      schemaName: 'workspaces.schema.json',
    });
    const reload = vi.fn();
    configuration.watch(reload);
    const listener = watchers.watch.mock.calls[0]![2] as (
      current: BigIntStats,
      previous: BigIntStats,
    ) => void;
    listener(info({ ctimeMs: 4n, ctimeNs: 4_000_000n }), info());
    expect(reload).toHaveBeenCalledOnce();
    configuration.close();
  });
});
