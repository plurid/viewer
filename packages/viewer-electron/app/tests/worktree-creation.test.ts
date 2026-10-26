import { execFile } from 'node:child_process';
import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it, vi } from 'vitest';
import { GitWorktrees } from '../src/desktop/comparison/worktrees';
import {
  validBranchName,
  worktreeDestination,
  type WorktreeCatalog,
  type WorktreeCreation,
} from '../src/domain/comparison/worktrees';
import type { CapturedTarget } from '../src/domain/automation/actions';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
const exec = promisify(execFile),
  roots: string[] = [],
  services: GitWorktrees[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) service.close();
  for (const root of roots.splice(0)) await trashTemporary(root);
});
async function fixture() {
  const root = await realpath(await temporaryRoot('viewer-worktree-create-'));
  roots.push(root);
  const repo = path.join(root, 'Source repo'),
    templates = path.join(root, 'Templates'),
    hooks = path.join(root, 'Hooks');
  await Promise.all([repo, templates, hooks].map((directory) => mkdir(directory)));
  const git = async (...args: string[]) =>
    (
      await exec('/usr/bin/git', ['-c', 'commit.gpgSign=false', '-C', repo, ...args], {
        env: {
          PATH: '/usr/bin:/bin',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_AUTHOR_NAME: 'Viewer fixture',
          GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
          GIT_COMMITTER_NAME: 'Viewer fixture',
          GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
        },
        timeout: 10000,
      })
    ).stdout.trim();
  await git('init', '--initial-branch=main', '--template=' + templates);
  await git('config', 'core.hooksPath', hooks);
  await writeFile(path.join(repo, 'source.txt'), 'retained baseline\n');
  await git('add', '--', 'source.txt');
  await git('commit', '-m', 'Generated baseline');
  await git('branch', 'existing');
  let alive = true,
    allowed = true;
  const validate = vi.fn(async () => {
    if (!alive) throw new Error('Origin changed');
  });
  const service = new GitWorktrees({
    available: () => true,
    access: async () => {
      if (!allowed) throw new Error('Access revoked');
    },
    owner: (id) => (id === 1 && alive ? 'owner' : id === 2 ? 'other' : undefined),
    validateTarget: validate,
  });
  services.push(service);
  const reply = await service.request({ kind: 'list', directory: repo }, 1);
  if (reply.kind !== 'catalog') throw Error('No catalog');
  const catalog = reply.catalog;
  const target = {
    workspaceID: 'space',
    rootID: 'pane',
    paneID: 'pane',
    panePath: repo,
    directory: repo,
    selection: [],
  } as CapturedTarget;
  const request = (
    checkout: WorktreeCreation['checkout'],
    destination = path.join(root, 'New checkout'),
  ): WorktreeCreation => ({ kind: 'create', catalogID: catalog.id, target, destination, checkout });
  const fresh = (name = 'feature/one') =>
    request({ kind: 'new', name, baseID: catalog.defaultBaseID! });
  return {
    root,
    repo,
    hooks,
    git,
    service,
    catalog,
    target,
    request,
    fresh,
    validate,
    setAlive: (value: boolean) => {
      alive = value;
    },
    revoke: () => {
      allowed = false;
    },
  };
}
it('creates an independent branch at a pinned revision and opens a verified catalog without changing source files or index', async () => {
  const f = await fixture(),
    index = await readFile(path.join(f.repo, '.git/index')),
    source = await readFile(path.join(f.repo, 'source.txt'));
  const marker = path.join(f.root, 'hook-observed');
  await writeFile(
    path.join(f.hooks, 'post-checkout'),
    `#!/bin/sh\nprintf observed > '${marker.replaceAll("'", "'\\''")}'\n`,
    { mode: 0o755 },
  );
  const reply = await f.service.request(f.fresh(), 1);
  if (reply.kind !== 'created') throw Error('Creation failed');
  expect(reply.entry.path).toBe(path.join(f.root, 'New checkout'));
  expect(reply.catalog.worktrees.find((tree) => tree.id === reply.worktreeID)).toMatchObject({
    branch: 'feature/one',
    commit: f.catalog.branches?.find((branch) => branch.id === f.catalog.defaultBaseID)?.commit,
    available: true,
  });
  expect(await readFile(marker, 'utf8')).toBe('observed');
  await writeFile(path.join(reply.entry.path, 'source.txt'), 'independent\n');
  expect(await readFile(path.join(f.repo, 'source.txt'))).toEqual(source);
  expect(await readFile(path.join(f.repo, '.git/index'))).toEqual(index);
  expect(await f.git('branch', '--show-current')).toBe('main');
  expect(f.validate).toHaveBeenCalledTimes(3);
});
it('uses an existing local branch without switching the source checkout', async () => {
  const f = await fixture(),
    branch = f.catalog.branches!.find((branch) => branch.branch === 'existing')!;
  const reply = await f.service.request(f.request({ kind: 'existing', branchID: branch.id }), 1);
  expect(reply.kind).toBe('created');
  expect(await f.git('branch', '--show-current')).toBe('main');
  expect(await f.git('worktree', 'list', '--porcelain')).toContain('branch refs/heads/existing');
});
it('refuses occupied branches, stale bases, foreign owners and existing or linked destination folders', async () => {
  const f = await fixture(),
    main = f.catalog.branches!.find((branch) => branch.branch === 'main')!;
  await expect(
    f.service.request(f.request({ kind: 'existing', branchID: main.id }), 1),
  ).rejects.toThrow('already checked out');
  await expect(f.service.request(f.fresh(), 2)).rejects.toThrow('another window');
  const occupied = path.join(f.root, 'Occupied');
  await mkdir(occupied);
  await writeFile(path.join(occupied, 'keep.txt'), 'untouched');
  await expect(f.service.request({ ...f.fresh(), destination: occupied }, 1)).rejects.toThrow(
    'already exists',
  );
  const alias = path.join(f.root, 'Alias');
  await symlink(occupied, alias);
  await expect(
    f.service.request({ ...f.fresh(), destination: path.join(alias, 'New') }, 1),
  ).rejects.toThrow('ordinary');
  expect(await readFile(path.join(occupied, 'keep.txt'), 'utf8')).toBe('untouched');
  await writeFile(path.join(f.repo, 'source.txt'), 'new revision');
  await f.git('add', '--', 'source.txt');
  await f.git('commit', '-m', 'Changed');
  await expect(f.service.request(f.fresh(), 1)).rejects.toThrow('changed');
});
it('preserves partial output on failure and stops an owned creation after access revocation', async () => {
  const f = await fixture();
  let started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const create = vi.fn(
    async (_repo: string, destination: string, _branch: unknown, signal: AbortSignal) => {
      await mkdir(destination);
      await writeFile(path.join(destination, 'partial.txt'), 'keep for inspection');
      started();
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true }),
      );
    },
  );
  const service = new GitWorktrees({
    available: () => true,
    access: async () => {},
    owner: () => 'owner',
    validateTarget: async () => {},
    create,
  });
  services.push(service);
  const reply = await service.request({ kind: 'list', directory: f.repo }, 1);
  if (reply.kind !== 'catalog') throw Error('No catalog');
  const catalog: WorktreeCatalog = reply.catalog,
    destination = path.join(f.root, 'Partial checkout');
  const work = service.request(
    {
      ...f.fresh(),
      catalogID: catalog.id,
      checkout: { kind: 'new', name: 'feature/partial', baseID: catalog.defaultBaseID! },
      destination,
    },
    1,
  );
  const rejected = expect(work).rejects.toThrow('Viewer kept any files');
  await began;
  await expect(
    service.request(
      {
        ...f.fresh(),
        catalogID: catalog.id,
        checkout: { kind: 'new', name: 'feature/other', baseID: catalog.defaultBaseID! },
        destination: path.join(f.root, 'Other'),
      },
      1,
    ),
  ).rejects.toThrow('already being created');
  await service.quiesce(f.repo);
  await rejected;
  expect(create).toHaveBeenCalledTimes(1);
  expect(await readFile(path.join(destination, 'partial.txt'), 'utf8')).toBe('keep for inspection');
});
it('checks origin and access before spawning and validates branch syntax independently', async () => {
  const f = await fixture();
  f.revoke();
  await expect(f.service.request(f.fresh(), 1)).rejects.toThrow('Access revoked');
  for (const name of ['-f', 'a..b', 'a b', 'a.lock', 'a@{b', 'a[b', 'a\\b', 'a?b', 'x/.hidden', ''])
    expect(validBranchName(name)).toBe(false);
  expect(validBranchName('feature/one')).toBe(true);
  expect(worktreeDestination('/projects/repo', 'feature/my-task')).toBe(
    '/projects/repo-feature-my-task',
  );
});
