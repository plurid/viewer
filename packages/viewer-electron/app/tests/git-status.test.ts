import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitReader, runGit } from '../src/desktop/comparison/git';
import { gitSourceSchema, parseGitStatus } from '../src/domain/comparison/git';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const execute = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await trashTemporary(root);
});

describe('read-only Git status', () => {
  it('does no filesystem work or executable probing while disabled', async () => {
    const access = vi.fn();
    const run = vi.fn();
    const git = new GitReader(() => false, access, run);
    expect(await git.status('/does/not/exist')).toMatchObject({ kind: 'disabled' });
    await expect(git.head('/does/not/exist')).rejects.toThrow('disabled');
    expect(access).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('parses NUL-delimited names, rename sources, conflicts and branch counts', () => {
    const oid = 'a'.repeat(40);
    const result = parseGitStatus(
      [
        '# branch.oid ' + oid,
        '# branch.head main',
        '# branch.ab +3 -2',
        '1 .M N... 100644 100644 100644 ' + oid + ' ' + oid + ' two words\nand a tab\t.txt',
        '2 R. N... 100644 100644 100644 ' + oid + ' ' + oid + ' R100 new.txt',
        'old name.txt',
        'u UU N... 100644 100644 100644 100644 ' + oid + ' ' + oid + ' ' + oid + ' conflict',
        '? new/untracked',
        '1 .D N... 100644 100644 000000 ' + oid + ' ' + oid + ' deleted',
        '',
      ].join('\0'),
      '/repo',
    );
    expect(result).toMatchObject({ branch: 'main', commit: oid, ahead: 3, behind: 2 });
    expect(
      result.changes.map(({ path, original, status }) => ({ path, original, status })),
    ).toEqual([
      { path: 'two words\nand a tab\t.txt', status: 'modified', original: undefined },
      { path: 'new.txt', original: 'old name.txt', status: 'renamed' },
      { path: 'conflict', status: 'conflict', original: undefined },
      { path: 'new/untracked', status: 'untracked', original: undefined },
      { path: 'deleted', status: 'deleted', original: undefined },
    ]);
    for (const output of ['? ../outside\0', '? /absolute\0', '? truncated', '1 missing\0'])
      expect(() => parseGitStatus(output, '/repo')).toThrow();
    expect(
      gitSourceSchema.safeParse({
        kind: 'git',
        repository: '/repo',
        commit: oid,
        path: '../outside',
      }).success,
    ).toBe(false);
  });

  it('ignores a repository fsmonitor hook and preserves the index while reading pinned blobs', async () => {
    const root = await temporaryRoot('viewer-git-');
    roots.push(root);
    const gitCommand = (...args: string[]) => execute('/usr/bin/git', ['-C', root, ...args]);
    await gitCommand('init', '--initial-branch=main');
    await writeFile(path.join(root, 'notes.txt'), 'before\n');
    await gitCommand('add', '--', 'notes.txt');
    await gitCommand(
      '-c',
      'user.name=Viewer test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-m',
      'Fixture',
    );
    const hook = path.join(root, '.git', 'monitor');
    const marker = path.join(root, 'hook-was-run');
    await writeFile(hook, `#!/bin/sh\nprintf unsafe > '${marker.replaceAll("'", "'\\''")}'\n`, {
      mode: 0o755,
    });
    await gitCommand('config', 'core.fsmonitor', hook);
    await gitCommand('config', 'core.hooksPath', path.join(root, '.git'));
    await writeFile(path.join(root, 'notes.txt'), 'after\n');
    await writeFile(path.join(root, 'new\nfile.txt'), 'untracked\n');
    const index = path.join(root, '.git', 'index');
    const before = await readFile(index);
    const modified = (await stat(index)).mtimeMs;
    const reader = new GitReader(
      () => true,
      async () => {},
      runGit,
    );
    try {
      const result = await reader.status(root);
      expect(result.kind).toBe('ready');
      if (result.kind !== 'ready') throw new Error(result.message);
      expect(result.snapshot.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'notes.txt', status: 'modified' }),
          expect.objectContaining({ path: 'new\nfile.txt', status: 'untracked' }),
        ]),
      );
      const head = await reader.head(path.join(root, 'notes.txt'));
      expect(head.source).not.toBeNull();
      expect((await reader.blob(head.source!)).toString()).toBe('before\n');
      expect(await reader.root(root)).toBe(await realpath(root));
      await gitCommand('config', 'diff.external', hook);
      const diff = await reader.diff(root, 'HEAD', AbortSignal.timeout(5000));
      expect(diff).toMatchObject({
        base: 'HEAD',
        commit: result.snapshot.commit,
        includesUntracked: false,
      });
      expect(diff.patch).toContain('-before\n+after');
      expect(diff.patch).not.toContain('untracked');
      await expect(
        reader.diff(root, '--output=escaped', AbortSignal.timeout(5000)),
      ).rejects.toThrow();
      expect(
        createHash('sha256')
          .update(await readFile(index))
          .digest('hex'),
      ).toBe(createHash('sha256').update(before).digest('hex'));
      expect((await stat(index)).mtimeMs).toBe(modified);
      await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      reader.close();
    }
  });
});
