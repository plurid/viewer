import { chmod, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/desktop/files/file-coordination', () => ({
  fileCoordination: {
    run: async (_items: unknown, work: (signal?: AbortSignal) => Promise<unknown>) => work(),
    path: (p: string) => p,
    purpose: () => undefined,
  },
}));
import { temporaryRoot } from '../tools/temporary';
import { Lenses } from '../src/desktop/workspaces/lenses';

async function makeLenses(dataPath: string, home: string) {
  return new Lenses(dataPath, async () => {}, {
    home,
    trash: async () => 'job-1',
    trashOwn: async () => {},
    changed: () => {},
  });
}

describe('Lenses.create fallback overwrites existing local lens', () => {
  it('creating two local lenses with the same name in a folder without .viewer picks -2', async () => {
    const root = await temporaryRoot('viewer-probe-lenses-ctrl-');
    const dataPath = path.join(root, 'data');
    const home = path.join(root, 'home');
    const folder = path.join(root, 'readonly');
    await mkdir(dataPath, { recursive: true });
    await mkdir(home, { recursive: true });
    await mkdir(folder, { recursive: true });
    await chmod(folder, 0o555);
    const lenses = await makeLenses(dataPath, home);
    try {
      const first = await lenses.create(folder, 'Map');
      const second = await lenses.create(folder, 'Map');
      expect(first.local).toBe(true);
      expect(second.local).toBe(true);
      expect(second.file).not.toBe(first.file);
      expect(path.basename(second.file)).toBe('map-2.lens.jsonc');
    } finally {
      await chmod(folder, 0o755);
    }
  });

  it('fallback to local directory after unwritable .viewer/lenses preserves existing local map.lens.jsonc', async () => {
    const root = await temporaryRoot('viewer-probe-lenses-bug-');
    const dataPath = path.join(root, 'data');
    const home = path.join(root, 'home');
    const folder = path.join(root, 'project');
    await mkdir(dataPath, { recursive: true });
    await mkdir(home, { recursive: true });
    await mkdir(folder, { recursive: true });
    const lenses = await makeLenses(dataPath, home);
    const sharedLenses = path.join(folder, '.viewer', 'lenses');
    try {
      await chmod(folder, 0o555);
      const original = await lenses.create(folder, 'Map');
      expect(original.local).toBe(true);
      expect(path.basename(original.file)).toBe('map.lens.jsonc');
      const originalID = original.lens.id;

      await chmod(folder, 0o755);
      await mkdir(sharedLenses, { recursive: true });
      await chmod(sharedLenses, 0o555);

      const created = await lenses.create(folder, 'Map');
      const onDisk = await readFile(original.file, 'utf8');
      expect(created.file).not.toBe(original.file);
      expect(onDisk).toContain(originalID);
    } finally {
      await chmod(sharedLenses, 0o755).catch(() => {});
      await chmod(folder, 0o755).catch(() => {});
    }
  });
});
