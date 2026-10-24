import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { CapturedTarget } from '../src/domain/automation/actions';
import {
  bindGitTarget,
  validateGitTarget,
  type GitTargetWindow,
} from '../src/desktop/comparison/git-target';
import { schemas, methodWindows } from '../src/desktop/ipc/schemas';
import { projectDefinitionSchema } from '../src/domain/workspaces/project';

function fixture() {
  const target: CapturedTarget = {
    workspaceID: 'work',
    rootID: 'folder',
    paneID: 'folder',
    panePath: '/fixture',
    directory: '/fixture/subfolder',
    selection: [],
  };
  const window: GitTargetWindow = {
    originID: randomUUID(),
    workspaceID: 'work',
    alive: true,
    workspaces: {
      activeWorkspace: 'work',
      workspaces: [
        {
          id: 'work',
          name: 'Work',
          roots: ['folder'],
          panes: [{ id: 'folder', type: 'folder', path: '/fixture' }],
        },
      ],
    },
  };
  return { target, window };
}

const canonical = async (file: string) => path.resolve(file);

describe('Git action origin', () => {
  it('admits a live captured folder without a debounced discovery target', async () => {
    const { target, window } = fixture();
    await expect(bindGitTarget(target, window, canonical)).resolves.toMatchObject(target);
  });
  it('assigns native origin and freezes the matching folder context', async () => {
    const { target, window } = fixture();
    const bound = await bindGitTarget({ ...target, originID: randomUUID() }, window, canonical);
    expect(bound.originID).toBe(window.originID);
    target.directory = '/another';
    expect(bound.directory).toBe('/fixture/subfolder');
  });

  it('allows another open plane during review without retargeting the operation', async () => {
    const { target, window } = fixture();
    const bound = await bindGitTarget(target, window, canonical);
    window.workspaces!.workspaces[0]!.panes.push({ id: 'other', type: 'folder', path: '/other' });
    await expect(validateGitTarget(bound, window, canonical)).resolves.toBeUndefined();
  });

  it.each(['directory', 'rootID', 'paneID', 'workspaceID', 'panePath'] as const)(
    'rejects an initial forged or stale %s',
    async (key) => {
      const { target, window } = fixture();
      await expect(
        bindGitTarget({ ...target, [key]: '/forged' }, window, canonical),
      ).rejects.toThrow();
    },
  );

  it('rejects window replacement, workspace switch, closed folders and changed folder paths', async () => {
    for (const change of ['origin', 'workspace', 'folder', 'path', 'root', 'closed']) {
      const { target, window } = fixture();
      const bound = await bindGitTarget(target, window, canonical);
      const space = window.workspaces!.workspaces[0]!;
      if (change === 'origin') window.originID = randomUUID();
      if (change === 'workspace') window.workspaceID = 'another';
      if (change === 'folder') space.panes = [];
      if (change === 'path') space.panes[0]!.path = '/another';
      if (change === 'root') space.roots = [];
      if (change === 'closed') window.alive = false;
      await expect(validateGitTarget(bound, window, canonical), change).rejects.toThrow(
        'originating folder',
      );
    }
  });

  it('rejects symlink and sibling-prefix escapes from the originating folder', async () => {
    const { target, window } = fixture();
    await expect(
      bindGitTarget({ ...target, directory: '/fixture-other' }, window, canonical),
    ).rejects.toThrow('inside');
    const alias = async (file: string) => (file === target.directory ? '/outside' : file);
    await expect(bindGitTarget(target, window, alias)).rejects.toThrow('inside');
    const selected = { path: '/outside/file.txt' } as CapturedTarget['selection'][number];
    await expect(
      bindGitTarget({ ...target, selection: [selected] }, window, canonical),
    ).rejects.toThrow('selected Git path');
  });

  it.each(['/fixture/subfolder/..', '/fixture/subfolder/.'])(
    'rejects a selected dot-segment leaf: %s',
    async (selectedPath) => {
      const { target, window } = fixture();
      const selected = { path: selectedPath } as CapturedTarget['selection'][number];
      await expect(
        bindGitTarget({ ...target, selection: [selected] }, window, canonical),
      ).rejects.toThrow('outside the captured folder');
    },
  );

  it('requires the actual parent root for independent and linked folder planes', async () => {
    const { target, window } = fixture();
    const space = window.workspaces!.workspaces[0]!;
    space.roots.push('other');
    space.panes.push({ id: 'other', type: 'folder', path: '/other' });
    await expect(bindGitTarget({ ...target, rootID: 'other' }, window, canonical)).rejects.toThrow(
      'originating',
    );
    space.panes.push({ id: 'child', type: 'folder', path: '/fixture/child' });
    const child = {
      ...target,
      paneID: 'child',
      panePath: '/fixture/child',
      directory: '/fixture/child',
    };
    await expect(bindGitTarget(child, window, canonical)).rejects.toThrow('originating');
    window.owners = { child: 'folder' };
    await expect(bindGitTarget(child, window, canonical)).resolves.toMatchObject(child);
    await expect(bindGitTarget({ ...child, rootID: 'other' }, window, canonical)).rejects.toThrow(
      'originating',
    );
  });
});

describe('Git action IPC', () => {
  it('retains dormant Git result metadata in portable projects without widening profile identifiers', () => {
    const project = {
      version: 1,
      id: 'work',
      name: 'Work',
      bindings: [],
      folders: [],
      planes: [
        {
          id: 'git',
          type: 'terminal',
          target: { path: '.' },
          profileID: '@viewer-git',
          gitAction: 'push',
        },
      ],
      layout: { placements: [] },
      arrangements: {},
    };
    const restored = projectDefinitionSchema.parse(JSON.parse(JSON.stringify(project)));
    expect(restored.planes[0]).toMatchObject({ profileID: '@viewer-git', gitAction: 'push' });
    project.planes[0]!.profileID = '@another-program';
    expect(projectDefinitionSchema.safeParse(project).success).toBe(false);
  });

  it('accepts only the fixed action shape and assigns workspace-only authority', () => {
    const { target } = fixture();
    const request = { id: 'job', target, kind: 'commit', message: 'Literal $(text)\n\nBody' };
    expect(schemas.gitAction.parse([request])[0]).toEqual(request);
    expect(methodWindows.gitAction).toBe('viewer');
    expect(schemas.gitAction.safeParse([{ ...request, executable: '/bin/sh' }]).success).toBe(
      false,
    );
    expect(schemas.gitAction.safeParse([{ ...request, args: ['--amend'] }]).success).toBe(false);
    expect(schemas.gitAction.safeParse([{ ...request, kind: 'push' }]).success).toBe(false);
    expect(schemas.gitAction.safeParse([{ ...request, message: 'x'.repeat(16001) }]).success).toBe(
      false,
    );
  });
});
