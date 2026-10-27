import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { CapturedTarget } from '../src/domain/automation/actions';
import type { Resource } from '../src/domain/contracts';
import type { GitTargetWindow } from '../src/desktop/comparison/git-target';
import type { GitReader } from '../src/desktop/comparison/git';
import type { GitReviews } from '../src/desktop/comparison/review';
import type { GitWorktrees } from '../src/desktop/comparison/worktrees';
import type { GitActions } from '../src/desktop/comparison/git-actions';
import type { JournalActivity } from '../src/desktop/journal/activity';
import type { JournalAction, JournalOrigin } from '../src/domain/journal/events';
import { createGitHandlers } from '../src/desktop/ipc/git-handlers';
import { entry } from '../src/desktop/files/filesystem';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string;
beforeEach(async () => {
  root = await realpath(await temporaryRoot('viewer-git-ipc-'));
});
afterEach(async () => {
  await trashTemporary(root);
});

async function fixture() {
  const target: CapturedTarget = {
    originID: 'renderer-supplied',
    workspaceID: 'work',
    rootID: 'folder',
    paneID: 'folder',
    panePath: root,
    directory: root,
    selection: [],
  };
  const window: GitTargetWindow = {
    originID: 'desktop-owner',
    workspaceID: 'work',
    alive: true,
    workspaces: {
      activeWorkspace: 'work',
      workspaces: [
        {
          id: 'work',
          name: 'Work',
          roots: ['folder'],
          panes: [{ id: 'folder', type: 'folder', path: root }],
        },
      ],
    },
  };
  const resource: Resource = {
    id: randomUUID(),
    url: 'viewer-resource://generated/asset',
    entry: await entry(root),
  };
  const reader = {
    status: vi.fn<GitReader['status']>(),
    head: vi.fn<GitReader['head']>(),
    blob: vi.fn<GitReader['blob']>().mockResolvedValue(Buffer.from('committed bytes')),
  };
  const worktrees = {
    request: vi.fn<GitWorktrees['request']>().mockResolvedValue({ kind: 'released' }),
  };
  const reviews = {
    request: vi
      .fn<GitReviews['request']>()
      .mockResolvedValue({ kind: 'opened', reviewID: 'review', branches: [] }),
  };
  const actions = {
    start: vi.fn<GitActions['start']>().mockResolvedValue({ id: 'action', root, title: 'Status' }),
  };
  const resources = { grantBytes: vi.fn(async () => resource) };
  const observedAt = vi.fn<(origin: JournalOrigin) => void>();
  const observedGit = vi.fn<(id: string, action: JournalAction) => void>();
  const activity: Pick<JournalActivity, 'at' | 'git'> = {
    at<T>(origin: JournalOrigin, work: () => T): T {
      observedAt(origin);
      return work();
    },
    git<T>(id: string, action: JournalAction, work: () => Promise<T>): Promise<T> {
      observedGit(id, action);
      return work();
    },
  };
  const isAgent = vi.fn(() => false);
  const retainResource = vi.fn();
  const handlers = createGitHandlers({
    reader,
    worktrees,
    reviews,
    actions,
    resources,
    activity,
    window: () => window,
    isAgent,
    retainResource,
  });
  return {
    target,
    window,
    handlers,
    reader,
    worktrees,
    reviews,
    actions,
    resources,
    resource,
    activity,
    observedAt,
    observedGit,
    isAgent,
    retainResource,
  };
}

describe('Git IPC ownership', () => {
  it('rebinds worktree creation to the native owner without modifying the renderer target', async () => {
    const view = await fixture();
    await view.handlers.gitWorktrees(
      [
        {
          kind: 'create',
          catalogID: 'catalog',
          target: view.target,
          destination: root + '-checkout',
          checkout: { kind: 'new', name: 'feature/test', baseID: 'base' },
        },
      ],
      17,
    );
    expect(view.worktrees.request).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { ...view.target, originID: 'desktop-owner' },
      }),
      17,
    );
    expect(view.target.originID).toBe('renderer-supplied');
  });

  it('blocks agent worktree, review and Git program requests before reaching their services', async () => {
    const view = await fixture();
    view.isAgent.mockReturnValue(true);
    await expect(
      view.handlers.gitWorktrees([{ kind: 'list', directory: root }], 17),
    ).rejects.toThrow('person');
    await expect(
      view.handlers.gitReview([{ kind: 'open', target: view.target }], 17),
    ).rejects.toThrow('person');
    await expect(
      view.handlers.gitAction([{ id: 'action', kind: 'status', target: view.target }], 17),
    ).rejects.toThrow('Agents cannot');
    expect(view.worktrees.request).not.toHaveBeenCalled();
    expect(view.reviews.request).not.toHaveBeenCalled();
    expect(view.actions.start).not.toHaveBeenCalled();
  });

  it('rejects a stale captured workspace before starting a Git program', async () => {
    const view = await fixture();
    view.window.workspaceID = 'another';
    await expect(
      view.handlers.gitAction([{ id: 'action', kind: 'status', target: view.target }], 17),
    ).rejects.toThrow('originating');
    expect(view.actions.start).not.toHaveBeenCalled();
    expect(view.observedAt).not.toHaveBeenCalled();
  });

  it('accepts review from a Git changes plane while keeping program execution folder-only', async () => {
    const view = await fixture();
    view.window.workspaces!.workspaces[0]!.panes[0]!.type = 'git-changes';
    await expect(
      view.handlers.gitReview([{ kind: 'open', target: view.target }], 17),
    ).resolves.toMatchObject({ kind: 'opened' });
    await expect(
      view.handlers.gitAction([{ id: 'action', kind: 'status', target: view.target }], 17),
    ).rejects.toThrow('originating');
    expect(view.reviews.request).toHaveBeenCalledWith(
      { kind: 'open', target: { ...view.target, originID: 'desktop-owner' } },
      17,
    );
  });

  it('records activity against the bound target and returns the actual program result', async () => {
    const view = await fixture();
    await expect(
      view.handlers.gitAction([{ id: 'action', kind: 'status', target: view.target }], 17),
    ).resolves.toEqual({ id: 'action', root, title: 'Status' });
    expect(view.observedAt).toHaveBeenCalledWith({ workspaceID: 'work', planeID: 'folder' });
    expect(view.observedGit).toHaveBeenCalledWith('action', 'status');
    expect(view.actions.start).toHaveBeenCalledWith(
      { id: 'action', kind: 'status', target: { ...view.target, originID: 'desktop-owner' } },
      17,
    );
  });

  it('retains a successfully granted Git snapshot capability', async () => {
    const view = await fixture();
    const source = {
      kind: 'git' as const,
      repository: root,
      path: 'readme.txt',
      commit: 'a'.repeat(40),
    };
    await expect(view.handlers.gitResource([source], 17)).resolves.toBe(view.resource);
    expect(view.resources.grantBytes).toHaveBeenCalledWith(
      root,
      'readme.txt',
      Buffer.from('committed bytes'),
    );
    expect(view.retainResource).toHaveBeenCalledExactlyOnceWith(view.resource.id);
  });

  it('does not retain a resource when publication fails', async () => {
    const view = await fixture();
    view.resources.grantBytes.mockRejectedValueOnce(new Error('Resource budget full'));
    await expect(
      view.handlers.gitResource(
        [{ kind: 'git', repository: root, path: 'readme.txt', commit: 'a'.repeat(40) }],
        17,
      ),
    ).rejects.toThrow('Resource budget');
    expect(view.retainResource).not.toHaveBeenCalled();
  });
});
