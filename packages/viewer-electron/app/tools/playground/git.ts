import { spawn } from 'node:child_process';
import path from 'node:path';
import type { PlaygroundFiles } from './files';
import type { PlaygroundReport } from './types';

/** Each command runs only while constructing a newly reserved scenario directory. */
function git(directory: string, hooks: string, args: string[], input?: string): Promise<string> {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  );
  Object.assign(environment, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_ATTR_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Viewer Playground',
    GIT_AUTHOR_EMAIL: 'playground@example.invalid',
    GIT_COMMITTER_NAME: 'Viewer Playground',
    GIT_COMMITTER_EMAIL: 'playground@example.invalid',
    GIT_AUTHOR_DATE: '2026-01-01T12:00:00Z',
    GIT_COMMITTER_DATE: '2026-01-01T12:00:00Z',
    LC_ALL: 'C',
  });
  const options = [
    '-c',
    `core.hooksPath=${hooks}`,
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.attributesFile=/dev/null',
    '-c',
    'core.excludesFile=/dev/null',
    '-c',
    'commit.gpgSign=false',
    '-c',
    'tag.gpgSign=false',
    '-c',
    'credential.helper=',
    '-c',
    'protocol.allow=never',
    '-c',
    'protocol.file.allow=always',
  ];
  return new Promise((resolve, reject) => {
    const child = spawn('git', [...options, ...args], {
      cwd: directory,
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const output: Buffer[] = [];
    let length = 0;
    let failure: Error | undefined;
    const timer = setTimeout(() => {
      failure = new Error(`Playground Git command timed out: ${args[0]}`);
      child.kill();
    }, 15_000);
    const collect = (chunk: Buffer) => {
      length += chunk.length;
      if (length > 1024 * 1024) {
        failure = new Error('Playground Git output exceeded its budget.');
        child.kill();
      } else output.push(chunk);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (error) => {
      failure = error;
    });
    child.stdin.on('error', (error) => {
      failure ??= error;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const text = Buffer.concat(output).toString('utf8').trim();
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`Git ${args[0]} failed (${code}): ${text}`));
      else resolve(text);
    });
    child.stdin.end(input);
  });
}

export async function seedGit(files: PlaygroundFiles): Promise<PlaygroundReport['git']> {
  const relative = 'git';
  const directory = path.join(files.root, relative);
  if (!(await files.reserveDirectory(relative)))
    return { state: 'preserved', directory, ready: !!(await files.read('git/READY.json')) };

  await files.reserveDirectory('git/empty-hooks');
  await files.reserveDirectory('git/empty-template');
  await files.reserveDirectory('git/main');
  const main = path.join(directory, 'main');
  const remote = path.join(directory, 'local-remote.git');
  const hooks = path.join(directory, 'empty-hooks');
  const template = path.join(directory, 'empty-template');
  const run = (cwd: string, args: string[], input?: string) => git(cwd, hooks, args, input);

  await files.put(
    'git/README.md',
    `# Git work areas

Open main in Viewer, then run **Open worktree…** to open feature, review or conflict beside it.

- **main:** clean, with a local origin and two initial commits.
- **feature:** one commit ahead and behind origin/feature; staged, modified,
  added, deleted and untracked files. Compare index.html against HEAD.
- **review:** a separate, clean branch with its own review checklist.
- **conflict:** an intentionally unmerged conflict.txt, isolated from the other views.
- **local-remote.git:** a bare local origin. Push/pull use this folder, not a network host.

Feature's divergent pull deliberately needs a strategy. Review the log/diff first.
Staging is shared by views of the same checkout; different worktrees have separate indices.
All identities are fictional. No credentials, hooks, signing or dependency install is configured.

The generator never repairs, resets, pulls or reinitializes an existing git directory.
Your commits and edits survive reruns. If first-time creation was interrupted,
inspect the retained directory and choose a new playground destination for a fresh scenario.
`,
  );
  await run(directory, [
    'init',
    '--bare',
    '--initial-branch=main',
    `--template=${template}`,
    remote,
  ]);
  await run(main, ['init', '--initial-branch=main', `--template=${template}`]);
  await run(main, ['config', 'user.name', 'Viewer Playground']);
  await run(main, ['config', 'user.email', 'playground@example.invalid']);
  await run(main, ['config', 'core.hooksPath', hooks]);
  await run(main, ['config', 'core.fsmonitor', 'false']);
  const initialFiles = {
    'README.md':
      '# Main work area\n\nCompare this branch with feature and review in separate planes.\n',
    'index.html': '<!doctype html>\n<title>Main work area</title>\n<h1>Main branch</h1>\n',
    'modified.txt': 'Working tree baseline.\n',
    'deleted.txt': 'The feature checkout demonstrates a staged deletion.\n',
    'staged.txt': 'Staging baseline.\n',
    'conflict.txt': 'Shared baseline.\n',
  };
  for (const [name, bytes] of Object.entries(initialFiles))
    await files.put(`git/main/${name}`, bytes);
  await run(main, ['add', '--', '.']);
  await run(main, ['commit', '-m', 'Create the playground project']);
  await files.put('git/main/notes.md', '# Review notes\n\nA second commit makes the log useful.\n');
  await run(main, ['add', '--', 'notes.md']);
  await run(main, ['commit', '-m', 'Add review notes']);
  await run(main, ['remote', 'add', 'origin', remote]);
  await run(main, ['push', '--set-upstream', 'origin', 'main']);

  for (const branch of ['feature', 'review', 'conflict']) {
    const checkout = path.join(directory, `${branch}-worktree`);
    await run(main, ['worktree', 'add', '--no-checkout', '--no-track', '-b', branch, checkout]);
    await run(checkout, ['read-tree', 'HEAD']);
    // A deleted example is never materialized in feature; no physical removal
    // is needed. Conflict markers are also created directly in their final form.
    const names = [...Object.keys(initialFiles), 'notes.md'].filter(
      (name) =>
        !(branch === 'feature' && name === 'deleted.txt') &&
        !(branch === 'conflict' && name === 'conflict.txt'),
    );
    await run(checkout, ['checkout-index', '--', ...names]);
  }
  const feature = path.join(directory, 'feature-worktree');
  const review = path.join(directory, 'review-worktree');
  const conflict = path.join(directory, 'conflict-worktree');
  await files.put('git/feature-worktree/feature.md', '# Feature\n\nAn independent checkout.\n');
  await run(feature, ['add', '--', 'feature.md']);
  await run(feature, ['commit', '-m', 'Describe the feature work area']);
  await run(feature, ['push', '--set-upstream', 'origin', 'feature']);
  const baseline = await run(feature, ['rev-parse', 'HEAD']);
  const tree = await run(feature, ['rev-parse', 'HEAD^{tree}']);
  await files.put('git/feature-worktree/local.md', '# Local change\n\nNot yet pushed.\n');
  await run(feature, ['add', '--', 'local.md']);
  await run(feature, ['commit', '-m', 'Add local feature notes']);
  const remoteCommit = await run(
    feature,
    ['commit-tree', tree, '-p', baseline],
    'Independent remote review\n',
  );
  await run(feature, ['push', 'origin', `${remoteCommit}:refs/heads/feature`]);

  // New files use the additive writer. Tracked-file variations are index objects,
  // then materialized by Git only inside these newly created checkouts.
  const modifiedIndex = await run(
    feature,
    ['hash-object', '-w', '--stdin'],
    '<!doctype html>\n<title>Feature work area</title>\n<h1>Feature branch</h1>\n',
  );
  await run(feature, ['update-index', '--cacheinfo', `100644,${modifiedIndex},index.html`]);
  await run(feature, ['checkout-index', '--force', '--', 'index.html']);
  await run(feature, ['restore', '--staged', '--', 'index.html']);
  const modifiedText = await run(
    feature,
    ['hash-object', '-w', '--stdin'],
    'Edited working tree content.\n',
  );
  await run(feature, ['update-index', '--cacheinfo', `100644,${modifiedText},modified.txt`]);
  await run(feature, ['checkout-index', '--force', '--', 'modified.txt']);
  await run(feature, ['restore', '--staged', '--', 'modified.txt']);
  await files.put('git/feature-worktree/added.txt', 'A staged new file.\n');
  await run(feature, ['add', '--', 'added.txt']);
  const stagedText = await run(
    feature,
    ['hash-object', '-w', '--stdin'],
    'Reviewed and staged content.\n',
  );
  await run(feature, ['update-index', '--cacheinfo', `100644,${stagedText},staged.txt`]);
  await run(feature, ['checkout-index', '--force', '--', 'staged.txt']);
  // --force-remove changes the index only; no working file is removed.
  await run(feature, ['update-index', '--force-remove', '--', 'deleted.txt']);
  await files.put('git/feature-worktree/untracked.txt', 'An untracked note.\n');

  await files.put(
    'git/review-worktree/review.md',
    '# Review\n\nThis clean branch is ready to inspect.\n',
  );
  await run(review, ['add', '--', 'review.md']);
  await run(review, ['commit', '-m', 'Add the independent review checklist']);

  const base = await run(conflict, ['hash-object', '-w', '--stdin'], 'Shared baseline.\n');
  const ours = await run(conflict, ['hash-object', '-w', '--stdin'], 'Our proposal.\n');
  const theirs = await run(conflict, ['hash-object', '-w', '--stdin'], 'Their proposal.\n');
  await files.put(
    'git/conflict-worktree/conflict.txt',
    '<<<<<<< ours\nOur proposal.\n=======\nTheir proposal.\n>>>>>>> theirs\n',
  );
  // Populate stages without a merge command or removal of working files.
  await run(
    conflict,
    ['update-index', '--index-info'],
    [
      '0 0000000000000000000000000000000000000000\tconflict.txt',
      `100644 ${base} 1\tconflict.txt`,
      `100644 ${ours} 2\tconflict.txt`,
      `100644 ${theirs} 3\tconflict.txt`,
      '',
    ].join('\n'),
  );
  await files.put(
    'git/READY.json',
    JSON.stringify({ version: 1, branches: ['main', 'feature', 'review', 'conflict'] }, null, 2) +
      '\n',
  );
  return { state: 'created', directory, ready: true };
}
