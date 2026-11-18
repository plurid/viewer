/**
 * Not a Workspace and the workspace offer's dismissals in the desktop catalog: hiding takes only
 * found definitions and shows at once; dismissed offers live in a private file, never config.jsonc.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { WorkspaceDefinitions } from '../src/desktop/workspaces/definitions';
import { OfferDismissals, offerDismissalLimit } from '../src/desktop/workspaces/offer-dismissals';
import { temporaryRoot } from '../tools/temporary';
import { defaultSettings } from '../src/domain/services';
import { foundDefinitions } from '../src/domain/workspaces/found/catalog';
import { hashDefinition } from './workspace-definition-fixtures';

const services: WorkspaceDefinitions[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
});

async function catalog() {
  const directory = await temporaryRoot('viewer-offer-dismissals-');
  const home = directory + '/home';
  const entries = ['sample', 'other'].map((name) => ({
    key: 'code/' + name,
    root: home + '/code/' + name,
    realpath: home + '/code/' + name,
    identity: '1:' + name.length,
    names: [],
    at: 1,
  }));
  const hidden = new Set<string>();
  const found = {
    load: vi.fn(async () => {}),
    configure: vi.fn(async () => {}),
    snapshot: (explicit: Parameters<typeof foundDefinitions>[1]) => {
      const definitions = foundDefinitions(
        entries.filter((entry) => !hidden.has(entry.root)),
        explicit,
        home,
        hashDefinition,
      );
      return {
        definitions,
        state: { state: 'ready' as const, count: definitions.length, hidden: hidden.size },
      };
    },
    // a change is announced only through the reload the service runs itself
    subscribe: () => () => {},
    hide: vi.fn(async (root: string) => {
      hidden.add(root);
    }),
    show: vi.fn(async (roots?: readonly string[]) => {
      for (const root of roots ?? [...hidden]) hidden.delete(root);
      return 1;
    }),
    hideAgain: vi.fn(async () => 0),
  };
  const service = new WorkspaceDefinitions(directory, home, {
    found,
    access: async () => {},
    settings: () => defaultSettings(home),
    emit: () => {},
    checkRoot: async () => ({ directory: true }),
  });
  services.push(service);
  await service.load();
  return { directory, home, entries, found, service };
}

describe('Not a Workspace in the catalog', () => {
  it('hides only found definitions, and the catalog drops them at once', async () => {
    const f = await catalog();
    await f.service.hideFound('code/sample');
    expect(f.found.hide).toHaveBeenCalledWith(f.entries[0]!.root);
    // no wait for the catalog's own reload
    expect(f.service.snapshot().definitions.map((item) => item.key)).toEqual(['code/other']);
    expect(f.service.snapshot().found?.hidden).toBe(1);
    await writeFile(
      f.service.configuration.file,
      JSON.stringify({ version: 1, workspaces: { written: { root: f.home + '/written' } } }),
    );
    await f.service.reload();
    await expect(f.service.hideFound('written')).rejects.toThrow(
      'Viewer no longer finds this workspace.',
    );
    await expect(f.service.hideFound('code/missing')).rejects.toThrow();
    expect(f.found.hide).toHaveBeenCalledTimes(1);
  });

  it('shows one root, every root, or undoes Show all', async () => {
    const f = await catalog();
    await f.service.hideFound('code/sample');
    await f.service.hideFound('code/other');
    expect(await f.service.showFound(f.entries[0]!.root)).toBe(1);
    expect(f.found.show).toHaveBeenLastCalledWith([f.entries[0]!.root]);
    expect(f.service.snapshot().definitions.map((item) => item.key)).toEqual(['code/sample']);
    await f.service.showFound();
    expect(f.found.show).toHaveBeenLastCalledWith(undefined);
    await f.service.showFound(undefined, true);
    expect(f.found.hideAgain).toHaveBeenCalledOnce();
  });
});

describe('Clear recent folders and dismissed offers', () => {
  it('clears dismissals of found workspaces only, and its Undo brings them back', async () => {
    const f = await catalog();
    await writeFile(
      f.service.configuration.file,
      JSON.stringify({ version: 1, workspaces: { written: { root: f.home + '/written' } } }),
    );
    await f.service.reload();
    const found = f.home + '/code/sample';
    const written = f.home + '/written';
    // a root no longer in the catalog came from history too
    const gone = f.home + '/code/gone';
    await f.service.dismissOffers([found, written, gone]);
    await f.service.clearFoundOffers();
    expect(f.service.snapshot().dismissedOffers).toEqual([written]);
    await f.service.restoreOffers();
    expect(f.service.snapshot().dismissedOffers).toEqual([written, found, gone]);
    // Undo applies once
    await f.service.restoreOffers();
    expect(f.service.snapshot().dismissedOffers).toEqual([written, found, gone]);
  });

  it('carries the dismissals Clear removed through a Viewer move, for its Undo', async () => {
    const f = await catalog();
    await f.service.dismissOffers([f.home + '/code/sample']);
    await f.service.clearFoundOffers();
    await f.service.remapOffers([
      { source: f.home + '/code/sample', destination: f.home + '/code/renamed' },
    ]);
    await f.service.restoreOffers();
    expect(f.service.snapshot().dismissedOffers).toEqual([f.home + '/code/renamed']);
  });
});

describe('dismissed workspace offers', () => {
  it('lives in a private file the catalog reads, written only once something is dismissed', async () => {
    const f = await catalog();
    const file = path.join(f.directory, 'workspace-offers-v1.json');
    expect(await readdir(f.directory)).not.toContain('workspace-offers-v1.json');
    expect(f.service.snapshot().dismissedOffers).toBeUndefined();
    await f.service.dismissOffers([f.home + '/code/sample', f.home + '/code/other']);
    expect(f.service.snapshot().dismissedOffers).toEqual([
      f.home + '/code/sample',
      f.home + '/code/other',
    ]);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      version: 1,
      dismissed: [f.home + '/code/sample', f.home + '/code/other'],
    });
    // config.jsonc never holds them
    const config = await readFile(f.service.configuration.file, 'utf8').catch(() => '');
    expect(config).not.toContain('code/sample');
    // Viewer's own moves carry them; Show Hidden Insights and Clear recent folders empty them
    await f.service.remapOffers([
      { source: f.home + '/code/sample', destination: f.home + '/code/renamed' },
    ]);
    expect(f.service.snapshot().dismissedOffers).toEqual([
      f.home + '/code/renamed',
      f.home + '/code/other',
    ]);
    await f.service.clearOffers();
    expect(f.service.snapshot().dismissedOffers).toBeUndefined();
    expect(JSON.parse(await readFile(file, 'utf8')).dismissed).toEqual([]);
  });

  it('keeps 500 roots, the latest last, without duplicates after a move', async () => {
    const directory = await temporaryRoot('viewer-offer-store-');
    const store = new OfferDismissals(directory);
    await store.load();
    const roots = Array.from({ length: offerDismissalLimit + 1 }, (_, index) => '/r/' + index);
    await store.dismiss(roots);
    expect(store.roots()).toHaveLength(offerDismissalLimit);
    expect(store.roots()[0]).toBe('/r/1');
    await store.dismiss(['/r/1']);
    expect(store.roots().at(-1)).toBe('/r/1');
    expect(await store.dismiss(['/r/1'])).toBe(false);
    // two roots moved into one stay one
    await store.remap([{ source: '/r/2', destination: '/r/3' }]);
    expect(store.roots().filter((root) => root === '/r/3')).toHaveLength(1);
    expect(JSON.parse(await readFile(store.store.file, 'utf8')).dismissed).toEqual(store.roots());
  });

  it('moves an unreadable file aside on the next change, and loses no dismissal', async () => {
    const directory = await temporaryRoot('viewer-offer-broken-');
    const file = path.join(directory, 'workspace-offers-v1.json');
    await writeFile(file, 'broken');
    const unreadable = new OfferDismissals(directory);
    await unreadable.load();
    // nothing changes it until the person dismisses something
    expect(await unreadable.clear()).toEqual([]);
    expect(await readFile(file, 'utf8')).toBe('broken');
    expect(await unreadable.dismiss(['/r/x'])).toBe(true);
    const aside = (await readdir(directory)).filter((name) => name.includes('.unreadable-'));
    expect(aside).toHaveLength(1);
    expect(await readFile(path.join(directory, aside[0]!), 'utf8')).toBe('broken');
    // the next launch reads it
    const next = new OfferDismissals(directory);
    await next.load();
    expect(next.roots()).toEqual(['/r/x']);
  });

  it('changes nothing when a save fails or a root cannot be kept, and says so', async () => {
    const directory = await temporaryRoot('viewer-offer-failure-');
    const store = new OfferDismissals(directory);
    await store.load();
    const save = vi.spyOn(store.store, 'save').mockRejectedValueOnce(new Error('disk full'));
    await expect(store.dismiss(['/r/a'])).rejects.toThrow('disk full');
    expect(store.roots()).toEqual([]);
    // asked again, it is written
    expect(await store.dismiss(['/r/a'])).toBe(true);
    save.mockRestore();
    await expect(store.dismiss(['/' + 'a'.repeat(5000)])).rejects.toThrow();
    expect(await store.dismiss(['/r/b'])).toBe(true);
    const next = new OfferDismissals(directory);
    await next.load();
    expect(next.roots()).toEqual(['/r/a', '/r/b']);
  });
});
