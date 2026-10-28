import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { GitReader, gitSafeOptions, gitEnvironment } from '../src/desktop/comparison/git';
import { runGitInspection } from '../src/desktop/comparison/git-inspection';
import { assertNoGitFilters } from '../src/desktop/comparison/git-filters';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string, repo: string, marker: string, script: string;
const signal = () => AbortSignal.timeout(10000);
const git = (args: string[], input?: string) =>
  execFileSync('/usr/bin/git', [...gitSafeOptions, '-C', repo, ...args], {
    env: gitEnvironment(),
    input,
    encoding: 'utf8',
  });
beforeEach(async () => {
  root = await temporaryRoot('viewer-git-inspection-');
  repo = path.join(root, 'repo');
  marker = path.join(root, 'filter-ran');
  script = path.join(root, 'fixture-filter.sh');
  await mkdir(repo);
  await writeFile(script, '#!/bin/sh\nprintf ran >> ' + JSON.stringify(marker) + '\n/bin/cat\n', {
    flag: 'wx',
    mode: 0o700,
  });
  git(['init', '-q']);
  await writeFile(path.join(repo, 'tracked.txt'), 'changed contents\n');
  const object = git(['hash-object', '-w', '--stdin'], 'original contents\n').trim();
  git(['update-index', '--add', '--cacheinfo', '100644,' + object + ',tracked.txt']);
  const tree = git(['write-tree']).trim();
  const commit = git(
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit-tree',
      tree,
    ],
    'Generated fixture\n',
  ).trim();
  git(['update-ref', 'HEAD', commit]);
  await writeFile(path.join(repo, '.gitattributes'), 'tracked.txt filter=fixture\n');
});
afterEach(async () => {
  await trashTemporary(root);
});

it.skipIf(process.platform !== 'darwin')(
  'reads status and patches in the contained process for an ordinary checkout',
  async () => {
    const reader = new GitReader(
      () => true,
      async () => {},
    );
    try {
      expect(await reader.inspectStatus(repo, signal())).toMatchObject({ kind: 'ready' });
      expect((await reader.inspectDiff(repo, 'HEAD', signal())).patch).toContain(
        '+changed contents',
      );
    } finally {
      reader.close();
    }
  },
);

it.skipIf(process.platform !== 'darwin').each(['clean', 'smudge', 'process'])(
  'refuses executable %s filters before agent status or diff',
  async (kind) => {
    git(['config', 'filter.fixture.' + kind, script]);
    const reader = new GitReader(
      () => true,
      async () => {},
    );
    try {
      expect(await reader.inspectStatus(repo, signal())).toMatchObject({
        kind: 'unavailable',
        message: expect.stringContaining('executable Git filters'),
      });
      await expect(reader.inspectDiff(repo, 'HEAD', signal())).rejects.toThrow(
        'executable Git filters',
      );
      await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      reader.close();
    }
  },
);

it.skipIf(process.platform !== 'darwin')(
  'blocks filter execution even when configuration changes after a successful preflight',
  async () => {
    await assertNoGitFilters(runGitInspection, repo, signal());
    git(['config', 'filter.fixture.clean', script]);
    git(['config', 'filter.fixture.required', 'true']);
    // Simulate the exact preflight/process gap without timing-dependent races.
    await runGitInspection(repo, ['status', '--porcelain=v2', '-z'], 1024 * 1024, signal()).catch(
      () => {},
    );
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(repo, 'tracked.txt'), 'utf8')).toBe('changed contents\n');
  },
);
