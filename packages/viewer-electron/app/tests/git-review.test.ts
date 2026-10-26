import { execFile } from 'node:child_process';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitReviews } from '../src/desktop/comparison/review';
import { gitEnvironment, gitSafeOptions } from '../src/desktop/comparison/git';
import { parseReviewPatch, type ReviewMode } from '../src/domain/comparison/review';
import { temporaryRoot } from '../tools/temporary';

const execute = promisify(execFile);
const services: GitReviews[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
});

async function fixture() {
  const root = await realpath(await temporaryRoot('viewer-git-hunks-'));
  const templates = path.join(root, 'Empty templates');
  const repository = path.join(root, 'Repository');
  await Promise.all([mkdir(templates), mkdir(repository)]);
  const git = async (...args: string[]) =>
    (
      await execute('/usr/bin/git', [...gitSafeOptions, '-C', repository, ...args], {
        env: {
          ...gitEnvironment(),
          GIT_AUTHOR_NAME: 'Viewer fixture',
          GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
          GIT_COMMITTER_NAME: 'Viewer fixture',
          GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
        },
      })
    ).stdout;
  await git('init', '--initial-branch=main', '--template=' + templates);
  const file = path.join(repository, 'two changes.txt');
  const original = Array.from({ length: 30 }, (_, i) => 'line ' + (i + 1)).join('\n') + '\n';
  await writeFile(file, original);
  await git('add', '--', 'two changes.txt');
  await git('commit', '--no-verify', '--no-gpg-sign', '-m', 'Generated baseline');
  const changed = original
    .replace('line 2\n', 'first edit\n')
    .replace('line 27\n', 'second edit\n');
  await writeFile(file, changed);
  const owners = new Map([
    [1, 'origin'],
    [2, 'other'],
  ]);
  const validate = vi.fn(async () => {});
  const access = vi.fn(async (_paths: readonly string[]) => {});
  const service = new GitReviews({
    available: () => true,
    owner: (id) => owners.get(id),
    access,
    validate,
  });
  services.push(service);
  const opened = await service.request(
    {
      kind: 'open',
      target: {
        workspaceID: 'workspace',
        rootID: 'root',
        paneID: 'review',
        directory: repository,
        panePath: repository,
        selection: [],
      },
    },
    1,
  );
  if (opened.kind !== 'opened') throw new Error('Review did not open.');
  const snapshot = async (mode: ReviewMode, baseID?: string) => {
    const result = await service.request(
      { kind: 'read', reviewID: opened.reviewID, mode, baseID },
      1,
    );
    if (result.kind !== 'snapshot') throw new Error('Review snapshot unavailable.');
    return result.snapshot;
  };
  const read = async (mode: ReviewMode, baseID?: string) => {
    const list = await snapshot(mode, baseID);
    const result = await service.request(
      { kind: 'file', reviewID: opened.reviewID, snapshotID: list.id, fileID: list.files[0]!.id },
      1,
    );
    if (result.kind !== 'file') throw new Error('Review file unavailable.');
    return result.file;
  };
  return {
    root,
    repository,
    file,
    git,
    original,
    changed,
    owners,
    service,
    opened,
    read,
    snapshot,
    validate,
    access,
  };
}

describe('Git hunk review', () => {
  it('keeps the latest requested mode when an older read finishes last', async () => {
    const f = await fixture();
    await f.git('add', '--', 'two changes.txt');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.access.mockClear();
    f.access.mockImplementationOnce(async () => gate);
    const older = f.service.request(
      { kind: 'read', reviewID: f.opened.reviewID, mode: 'unstaged' },
      1,
    );
    const superseded = expect(older).rejects.toThrow('superseded');
    await vi.waitFor(() => expect(f.access).toHaveBeenCalled());
    const current = await f.snapshot('staged');
    release();
    await superseded;
    const file = await f.service.request(
      {
        kind: 'file',
        reviewID: f.opened.reviewID,
        snapshotID: current.id,
        fileID: current.files[0]!.id,
      },
      1,
    );
    expect(file.kind === 'file' && file.file.hunks).toHaveLength(2);
  });
  it('stages and unstages one exact hunk while preserving working bytes', async () => {
    const f = await fixture();
    const file = await f.read('unstaged');
    expect(file.hunks).toHaveLength(2);
    await f.service.request(
      { kind: 'apply', reviewID: f.opened.reviewID, fileID: file.id, hunks: [file.hunks[0]!.id] },
      1,
    );
    expect(await f.git('show', ':two changes.txt')).toBe(
      f.original.replace('line 2\n', 'first edit\n'),
    );
    expect(await readFile(f.file, 'utf8')).toBe(f.changed);
    const staged = await f.read('staged');
    expect(staged.hunks).toHaveLength(1);
    await f.service.request(
      {
        kind: 'apply',
        reviewID: f.opened.reviewID,
        fileID: staged.id,
        hunks: [staged.hunks[0]!.id],
      },
      1,
    );
    expect(await f.git('show', ':two changes.txt')).toBe(f.original);
    expect(await readFile(f.file, 'utf8')).toBe(f.changed);
  });

  it('rejects stale working bytes, stale index, another owner and changed origin', async () => {
    const f = await fixture();
    const file = await f.read('unstaged');
    const apply = {
      kind: 'apply' as const,
      reviewID: f.opened.reviewID,
      fileID: file.id,
      hunks: [file.hunks[0]!.id],
    };
    await expect(f.service.request(apply, 2)).rejects.toThrow('unavailable');
    await writeFile(f.file, f.changed + 'external edit\n');
    await expect(f.service.request(apply, 1)).rejects.toThrow('file changed');
    await writeFile(f.file, f.changed);
    await f.git('add', '--', 'two changes.txt');
    await expect(f.service.request(apply, 1)).rejects.toThrow('index changed');
    f.owners.set(1, 'new origin');
    await expect(
      f.service.request({ kind: 'read', reviewID: f.opened.reviewID, mode: 'staged' }, 1),
    ).rejects.toThrow('expired');
  });

  it('compares a chosen base and supports literal untracked names without executing file contents', async () => {
    const f = await fixture();
    const base = f.opened.branches.find((branch) => branch.name === 'main')!;
    const before = await readFile(path.join(f.repository, '.git/index'));
    const compared = await f.read('branch', base.id);
    expect(compared.hunks).toHaveLength(2);
    await expect(
      f.service.request(
        {
          kind: 'apply',
          reviewID: f.opened.reviewID,
          fileID: compared.id,
          hunks: [compared.hunks[0]!.id],
        },
        1,
      ),
    ).rejects.toThrow('stageable');
    expect(await readFile(path.join(f.repository, '.git/index'))).toEqual(before);
    await writeFile(f.file, f.original);
    const name = 'literal $(touch marker).txt';
    await writeFile(path.join(f.repository, name), 'new text\n');
    const file = await f.read('unstaged');
    expect(file.path).toBe(name);
    await f.service.request(
      {
        kind: 'apply',
        reviewID: f.opened.reviewID,
        fileID: file.id,
        hunks: file.hunks.map((hunk) => hunk.id),
      },
      1,
    );
    expect(await f.git('show', ':' + name)).toBe('new text\n');
    await expect(readFile(path.join(f.repository, 'marker'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await f.service.quiesce(f.repository);
    await expect(f.snapshot('staged')).rejects.toThrow('unavailable');
  });

  it('preserves no-newline markers and keeps patch headers outside opaque hunk choices', () => {
    const parsed = parseReviewPatch(
      'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file\n',
    );
    expect(parsed.header).toBe('diff --git a/x b/x\n--- a/x\n+++ b/x\n');
    expect(parsed.hunks[0]?.lines.at(-1)).toBe('\\ No newline at end of file');
    expect(() => parseReviewPatch('bad\0patch')).toThrow();
  });
});
