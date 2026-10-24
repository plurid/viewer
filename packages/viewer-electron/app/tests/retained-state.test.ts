import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Storage } from '../src/desktop/persistence/storage';
import { CURRENT_STATE_VERSION } from '../src/domain/contracts';
import { temporaryRoot } from '../tools/temporary';

describe('unmovable saved workspace recovery', () => {
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'preserves the original and refuses to acknowledge a new layout as saved',
    async () => {
      const root = await temporaryRoot('viewer-retained-state-');
      const profile = path.join(root, 'Profile');
      await mkdir(profile, { mode: 0o700 });
      const file = path.join(profile, 'state.json');
      const original = '{this damaged layout must be kept';
      await writeFile(file, original, { mode: 0o600 });
      await chmod(profile, 0o500);
      try {
        const storage = new Storage(file);
        const loaded = await storage.load();
        expect(loaded.state).toBeNull();
        expect(loaded.recovery).toContain('left at');
        await expect(
          storage.save({
            version: CURRENT_STATE_VERSION,
            activeWorkspace: 'new',
            workspaces: [{ id: 'new', name: 'Unsaved', panes: [], roots: [], arrangement: {} }],
            favorites: [],
            recents: [],
            look: 'dark',
          }),
        ).rejects.toMatchObject({ code: 'STATE_RETAINED' });
        expect(await readFile(file, 'utf8')).toBe(original);
      } finally {
        await chmod(profile, 0o700);
      }
    },
  );
});
