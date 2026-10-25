import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitWorktrees } from '../src/desktop/comparison/worktrees';
import {
  maximumWorktrees,
  parseGitWorktrees,
  type WorktreeCatalog,
} from '../src/domain/comparison/worktrees';
import { schemas } from '../src/desktop/ipc/schemas';
import { agentCommandID } from '../src/domain/agents/safety';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const execute = promisify(execFile);
const roots: string[] = [];
const services: GitWorktrees[] = [];
const environment: NodeJS.ProcessEnv = {
  PATH: '/usr/bin:/bin',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Viewer fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Viewer fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};
afterEach(async () => {
  for (const service of services.splice(0)) service.close();
  for (const root of roots.splice(0)) await trashTemporary(root);
  vi.restoreAllMocks();
});

async function fixture() {
  const root = await realpath(await temporaryRoot('viewer-worktrees-'));
  roots.push(root);
  const main = path.join(root, 'Main repository');
  const feature = path.join(root, 'Feature checkout');
  const templates = path.join(root, 'Empty templates');
  await Promise.all([main, templates].map((directory) => mkdir(directory)));
  const git = async (directory: string, ...args: string[]) =>
    (
      await execute(
        '/usr/bin/git',
        [
          '--no-pager',
          '--no-optional-locks',
          '-c',
          'core.hooksPath=/dev/null',
          '-c',
          'core.fsmonitor=false',
          '-c',
          'commit.gpgSign=false',
          '-c',
          'tag.gpgSign=false',
          '-c',
          'credential.helper=',
          '-c',
          'protocol.allow=never',
          '-c',
          'gc.auto=0',
          '-c',
          'maintenance.auto=false',
          '-C',
          directory,
          ...args,
        ],
        { env: environment, timeout: 10000, maxBuffer: 1024 * 1024 },
      )
    ).stdout;
  await git(main, 'init', '--initial-branch=main', '--template=' + templates);
  await writeFile(path.join(main, 'notes.txt'), 'baseline\n');
  await git(main, 'add', '--', 'notes.txt');
  await git(main, 'commit', '--no-verify', '--no-gpg-sign', '-m', 'Generated baseline');
  await git(main, 'worktree', 'add', '-b', 'feature', feature);
  const access = vi.fn(async () => {});
  const owners = new Map([
    [1, 'window-one'],
    [2, 'window-two'],
  ]);
  const service = new GitWorktrees({
    available: () => true,
    access,
    owner: (owner) => owners.get(owner),
  });
  services.push(service);
  const reply = await service.request({ kind: 'list', directory: main }, 1);
  if (reply.kind !== 'catalog') throw new Error('Fixture catalog missing');
  const catalog = reply.catalog;
  const selected = catalog.worktrees.find((tree) => tree.branch === 'feature')!;
  const selection = { catalogID: catalog.id, worktreeID: selected.id };
  return { root, main, feature, git, service, catalog, selected, selection, owners, access };
}

describe('bounded Git worktree registry', () => {
  it('preserves NUL-delimited paths and distinguishes detached, unborn, bare and locked registrations', () => {
    const oid = 'a'.repeat(40);
    const rows = parseGitWorktrees(
      [
        `worktree /repo with\nnewline\t`,
        `HEAD ${oid}`,
        'branch refs/heads/feature/nested',
        'locked maintenance\nreason',
        '',
        'worktree /detached',
        `HEAD ${oid}`,
        'detached',
        '',
        'worktree /unborn',
        'HEAD ' + '0'.repeat(40),
        'branch refs/heads/main',
        '',
        'worktree /bare',
        'bare',
        '',
        'worktree /missing',
        `HEAD ${oid}`,
        'detached',
        'prunable missing folder',
        '',
        '',
      ].join('\0'),
    );
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      path: '/repo with\nnewline\t',
      branch: 'feature/nested',
      locked: 'maintenance\nreason',
    });
    expect(rows[1]?.detached).toBe(true);
    expect(rows[2]?.commit).toBeUndefined();
    expect(rows[3]?.bare).toBe(true);
    expect(rows[4]?.prunable).toBe('missing folder');
    for (const value of [
      'worktree /truncated\0',
      'worktree /x\0HEAD bad\0\0',
      `worktree /x\0HEAD ${oid}\0detached\0branch refs/heads/main\0\0`,
      `worktree /x\0HEAD ${oid}\0HEAD ${oid}\0\0`,
    ])
      expect(() => parseGitWorktrees(value)).toThrow();
    const repeated = `worktree /x\0HEAD ${oid}\0detached\0\0`;
    expect(() => parseGitWorktrees(repeated + repeated)).toThrow('repeated');
    const tooMany = Array.from(
      { length: maximumWorktrees + 1 },
      (_, index) => `worktree /${index}\0HEAD ${oid}\0detached\0\0`,
    ).join('');
    expect(() => parseGitWorktrees(tooMany)).toThrow('limited');
  });

  it('opens and inspects existing independent checkouts without changing refs, files or indices', async () => {
    const f = await fixture();
    await writeFile(path.join(f.feature, 'notes.txt'), 'feature-only change\n');
    const marker = path.join(f.root, 'fsmonitor-ran');
    const hook = path.join(f.root, 'fsmonitor');
    await writeFile(hook, `#!/bin/sh\nprintf called > '${marker.replaceAll("'", "'\\''")}'\n`, {
      mode: 0o755,
    });
    await f.git(f.main, 'config', 'core.fsmonitor', hook);
    const index = path.join(f.main, '.git', 'index');
    const featureIndex = path.join(
      (await f.git(f.feature, 'rev-parse', '--absolute-git-dir')).replace(/\n$/, ''),
      'index',
    );
    const before = await readFile(index);
    const featureBefore = await readFile(featureIndex);
    const featureModified = (await lstat(featureIndex)).mtimeMs;
    const modified = (await lstat(index)).mtimeMs;
    const refs = await f.git(f.main, 'for-each-ref', '--format=%(refname) %(objectname)');
    const status = await f.service.request({ kind: 'inspect', ...f.selection }, 1);
    expect(status).toMatchObject({
      kind: 'status',
      snapshot: {
        branch: 'feature',
        changes: [expect.objectContaining({ path: 'notes.txt', status: 'modified' })],
      },
    });
    const folder = await f.service.request({ kind: 'open', ...f.selection }, 1);
    expect(folder).toMatchObject({ kind: 'folder', entry: { path: f.feature, directory: true } });
    expect(await readFile(path.join(f.main, 'notes.txt'), 'utf8')).toBe('baseline\n');
    expect(await readFile(path.join(f.feature, 'notes.txt'), 'utf8')).toBe('feature-only change\n');
    expect(await f.git(f.main, 'for-each-ref', '--format=%(refname) %(objectname)')).toBe(refs);
    expect(
      createHash('sha256')
        .update(await readFile(index))
        .digest('hex'),
    ).toBe(createHash('sha256').update(before).digest('hex'));
    expect((await lstat(index)).mtimeMs).toBe(modified);
    expect((await readFile(featureIndex)).equals(featureBefore)).toBe(true);
    expect((await lstat(featureIndex)).mtimeMs).toBe(featureModified);
    await expect(lstat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('binds catalogs to their exact window and expiry, and releases only owned leases', async () => {
    const f = await fixture();
    await expect(f.service.request({ kind: 'open', ...f.selection }, 2)).rejects.toThrow(
      'another window',
    );
    await f.service.request({ kind: 'release', catalogID: f.catalog.id }, 2);
    expect((await f.service.request({ kind: 'open', ...f.selection }, 1)).kind).toBe('folder');
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 6 * 60_000);
    await expect(f.service.request({ kind: 'open', ...f.selection }, 1)).rejects.toThrow('expired');
    vi.restoreAllMocks();
    f.owners.set(1, 'replacement-window');
    await expect(f.service.request({ kind: 'open', ...f.selection }, 1)).rejects.toThrow(
      'another window',
    );
  });

  it('requires refreshed evidence after an external branch change or replaced checkout directory', async () => {
    const f = await fixture();
    await f.git(f.main, 'branch', 'other');
    await f.git(f.feature, 'switch', 'other');
    await expect(f.service.request({ kind: 'open', ...f.selection }, 1)).rejects.toThrow(
      'branch or revision changed',
    );
    const refreshed = await f.service.request({ kind: 'list', directory: f.main }, 1);
    const catalog = (refreshed as { kind: 'catalog'; catalog: WorktreeCatalog }).catalog;
    const row = catalog.worktrees.find((tree) => tree.branch === 'other')!;
    await rename(f.feature, f.feature + '.retained');
    await mkdir(f.feature);
    await writeFile(path.join(f.feature, 'replacement.txt'), 'Preserved replacement');
    await expect(
      f.service.request({ kind: 'open', catalogID: catalog.id, worktreeID: row.id }, 1),
    ).rejects.toThrow();
    expect(await readFile(path.join(f.feature + '.retained', 'notes.txt'), 'utf8')).toBe(
      'baseline\n',
    );
    expect(await readFile(path.join(f.feature, 'replacement.txt'), 'utf8')).toBe(
      'Preserved replacement',
    );
  });

  it('allows locked checkouts, marks missing ones unavailable, and offers no mutation or agent route', async () => {
    const f = await fixture();
    await f.git(f.main, 'worktree', 'lock', '--reason', 'Generated maintenance lock', f.feature);
    const locked = await f.service.request({ kind: 'list', directory: f.main }, 1);
    expect(locked).toMatchObject({
      kind: 'catalog',
      catalog: {
        worktrees: expect.arrayContaining([
          expect.objectContaining({
            branch: 'feature',
            locked: 'Generated maintenance lock',
            available: true,
          }),
        ]),
      },
    });
    for (const kind of ['create', 'remove', 'prune', 'switch'])
      expect(schemas.gitWorktrees.safeParse([{ kind, directory: f.main }]).success).toBe(false);
    expect(() => agentCommandID('git-worktrees', [])).toThrow('Agents cannot propose');
    await rename(f.feature, f.feature + '.retained');
    const missing = await f.service.request({ kind: 'list', directory: f.main }, 1);
    expect(missing).toMatchObject({
      kind: 'catalog',
      catalog: {
        worktrees: expect.arrayContaining([
          expect.objectContaining({ branch: 'feature', available: false }),
        ]),
      },
    });
  });

  it('does no probes or filesystem work in an unavailable build', async () => {
    const access = vi.fn();
    const run = vi.fn();
    const service = new GitWorktrees({
      available: () => false,
      access,
      run,
      owner: () => 'window',
    });
    services.push(service);
    await expect(service.request({ kind: 'list', directory: '/not/probed' }, 1)).rejects.toThrow(
      'direct build',
    );
    expect(access).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});
