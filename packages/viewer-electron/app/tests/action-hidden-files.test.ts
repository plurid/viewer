import { expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ActionPlanner } from '../src/desktop/actions/planner';
import { Operations } from '../src/desktop/operations/operations';
import { defaultSettings } from '../src/domain/services';
import { fileVisibility } from '../src/desktop/files/visibility';
import { temporaryRoot } from '../tools/temporary';

it('omits flag-hidden files and folder subtrees from an action scan without filename guesses', async () => {
  const root = await temporaryRoot('viewer-action-visibility-');
  const folder = path.join(root, 'Files');
  const hiddenFolder = path.join(folder, 'Hidden subtree');
  await mkdir(hiddenFolder, { recursive: true });
  for (const name of ['visible.txt', 'flagged.txt', '.dot-file', 'Thumbs.db'])
    await writeFile(path.join(folder, name), 'fixture', { flag: 'wx' });
  await writeFile(path.join(hiddenFolder, 'nested.txt'), 'fixture', { flag: 'wx' });
  const flags = vi
    .spyOn(fileVisibility, 'hiddenEntries')
    .mockImplementation(async (file) => (file === folder ? ['flagged.txt', 'Hidden subtree'] : []));
  const settings = defaultSettings(root);
  const operations = new Operations(
    async () => {
      throw new Error('No removal in this fixture.');
    },
    () => {},
  );
  const planner = new ActionPlanner(path.join(root, 'Plans'), {
    recipes: () => settings.recipes,
    providers: () => settings.providers,
    extract: vi.fn(),
    generate: vi.fn(),
    operations,
    emit: () => {},
    changed: () => {},
  });
  try {
    const id = await planner.start({
      recipeID: 'batch-rename',
      options: { prefix: 'New ' },
      context: {
        workspaceID: 'fixture',
        rootID: 'fixture',
        paneID: 'fixture',
        actor: 'user',
        sources: [folder],
        recursive: true,
      },
    });
    await planner.settled(id);
    const plan = await planner.get(id);
    expect(plan.status).toBe('review');
    expect(plan.rows.map((row) => row.source?.name).sort()).toEqual(['Thumbs.db', 'visible.txt']);
    expect(flags).toHaveBeenCalledExactlyOnceWith(folder);
  } finally {
    await planner.close();
    await operations.close();
    flags.mockRestore();
  }
});
