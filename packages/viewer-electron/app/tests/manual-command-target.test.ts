import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { CapturedTarget } from '../src/domain/automation/actions';
import type { GitTargetWindow } from '../src/desktop/comparison/git-target';
import { validateGitTarget } from '../src/desktop/comparison/git-target';
import { validateManualTarget } from '../src/desktop/actions/manual-target';
import { schemas } from '../src/desktop/ipc/schemas';

const home = '/home/example';
const canonical = async (file: string) => file;
function fixture(type: 'folder' | 'terminal' | 'preview' = 'folder') {
  const source = type === 'preview' ? '/work/image.png' : '/work';
  const window: GitTargetWindow = {
    originID: randomUUID(),
    workspaceID: 'workspace',
    alive: true,
    workspaces: {
      activeWorkspace: 'workspace',
      workspaces: [
        {
          id: 'workspace',
          name: 'Workspace',
          roots: ['pane'],
          panes: [{ id: 'pane', type, path: source }],
        },
      ],
    },
  };
  const target: CapturedTarget = {
    originID: window.originID,
    workspaceID: 'workspace',
    rootID: 'pane',
    paneID: 'pane',
    panePath: source,
    directory: '/work',
    selection: [],
  };
  return { window, target };
}
describe('manual command context', () => {
  it.each(['folder', 'terminal', 'preview'] as const)(
    'accepts the owned %s directory',
    async (type) => {
      const { target, window } = fixture(type);
      await expect(validateManualTarget(target, window, home, canonical)).resolves.toBeUndefined();
      if (type !== 'folder')
        await expect(validateGitTarget(target, window, canonical)).rejects.toThrow();
    },
  );
  it('accepts Home without a plane while retaining strict ordinary action targets', async () => {
    const { target, window } = fixture();
    const empty = { ...target, rootID: '', paneID: '', panePath: undefined, directory: home };
    window.workspaces!.workspaces[0]!.panes = [];
    window.workspaces!.workspaces[0]!.roots = [];
    await expect(validateManualTarget(empty, window, home, canonical)).resolves.toBeUndefined();
    expect(schemas.runCommand.safeParse([' pwd\n', empty]).success).toBe(true);
    expect(schemas.runCommand.parse([' pwd\n', empty])[0]).toBe(' pwd\n');
    await expect(
      validateManualTarget({ ...empty, directory: '/other' }, window, home, canonical),
    ).rejects.toThrow();
    await expect(validateGitTarget(empty, window, canonical)).rejects.toThrow();
  });
  it.each(['originID', 'workspaceID', 'rootID', 'paneID', 'panePath', 'directory'] as const)(
    'rejects a stale or forged %s',
    async (key) => {
      const { target, window } = fixture();
      await expect(
        validateManualTarget({ ...target, [key]: '/forged' }, window, home, canonical),
      ).rejects.toThrow();
    },
  );
  it('allows folder navigation below its source but rejects sibling and symlink escapes', async () => {
    const { target, window } = fixture();
    await expect(
      validateManualTarget({ ...target, directory: '/work/sub' }, window, home, canonical),
    ).resolves.toBeUndefined();
    await expect(
      validateManualTarget({ ...target, directory: '/work-other' }, window, home, canonical),
    ).rejects.toThrow();
    await expect(
      validateManualTarget({ ...target, directory: '/work/link' }, window, home, async (file) =>
        file === '/work/link' ? '/outside' : file,
      ),
    ).rejects.toThrow();
  });
});
