/** Missing/empty definition semantics, with all file reads simulated. */
import { beforeEach, expect, it, vi } from 'vitest';
import type * as FileSystem from 'node:fs/promises';
import { Projects } from '../src/desktop/workspaces/projects';
import { missingDefinitionCode } from '../src/domain/definitions';
const fixture = vi.hoisted(() => ({ missing: true, close: vi.fn() }));
vi.mock('../src/desktop/files/file-coordination', () => ({
  fileCoordination: {
    path: (file: string) => file,
    run: async (_claims: unknown, read: () => unknown) => read(),
  },
}));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof FileSystem>()),
  lstat: async () => {
    if (fixture.missing) throw Object.assign(new Error('Missing'), { code: 'ENOENT' });
    return {
      dev: 1,
      ino: 2,
      size: 0,
      mtimeMs: 0,
      ctimeMs: 0,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
  },
  open: async () => ({
    stat: async () => ({ dev: 1, ino: 2, size: 0, mtimeMs: 0, ctimeMs: 0, isFile: () => true }),
    close: fixture.close,
  }),
}));
beforeEach(() => {
  fixture.missing = true;
  vi.clearAllMocks();
});
it('preserves a machine-readable missing-file code through the service read boundary', async () => {
  await expect(
    new Projects(async () => {}).read('/fixture/viewer.project.jsonc'),
  ).rejects.toMatchObject({
    code: missingDefinitionCode,
    message: 'No project definition was found.',
  });
});
it('reports an empty existing definition as invalid rather than missing and closes its descriptor', async () => {
  fixture.missing = false;
  const error = await new Projects(async () => {})
    .read('/fixture/viewer.project.jsonc')
    .catch((error) => error);
  expect(error).toBeInstanceOf(Error);
  expect(error.code).not.toBe(missingDefinitionCode);
  expect(fixture.close).toHaveBeenCalledOnce();
});
