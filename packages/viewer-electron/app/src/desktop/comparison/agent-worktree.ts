import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, symlink } from 'node:fs/promises';
import { runGit } from './git';
import { gitBlobs } from './git-blobs';

interface TreeFile {
  name: string;
  mode: string;
  object: string;
  size: number;
}
const maximumFile = 64 * 1024 * 1024;
const maximumTotal = 512 * 1024 * 1024;

/** Automatic folder badges also ask Git for status, which may invoke clean filters. */
export async function assertAgentCheckoutSafe(repo: string, signal: AbortSignal): Promise<void> {
  const config = (await runGit(repo, ['config', '--null', '--list'], 1024 * 1024, signal)).toString(
    'utf8',
  );
  for (const row of config.split('\0')) {
    const newline = row.indexOf('\n');
    if (newline < 0) continue;
    const key = row.slice(0, newline),
      value = row.slice(newline + 1);
    if (/^filter\..+\.(?:clean|smudge|process)$/i.test(key) && value.trim())
      throw new Error(
        'This repository configures executable Git filters. Use the human worktree dialog to create its task. CLI task creation never runs repository filters.',
      );
  }
}

/** Checkout filters and post-checkout hooks are executable code. Agent worktrees
 * materialize raw blobs instead; Git LFS pointers remain pointers until a person fetches them. */
async function treeFiles(repo: string, commit: string, signal: AbortSignal): Promise<TreeFile[]> {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit)) throw new Error('Invalid task revision.');
  const bytes = await runGit(
    repo,
    ['ls-tree', '-rz', '-l', '--full-tree', commit],
    8 * 1024 * 1024,
    signal,
  );
  const rows = new TextDecoder('utf-8', { fatal: true }).decode(bytes).split('\0');
  const files: TreeFile[] = [];
  let total = 0;
  for (const row of rows) {
    if (!row) continue;
    const match =
      /^(100644|100755|120000|160000) (blob|commit) ([0-9a-f]{40}|[0-9a-f]{64}) +([0-9]+|-)\t([\s\S]+)$/.exec(
        row,
      );
    if (!match) throw new Error('This repository has an unsupported tree entry.');
    const [, mode, , object, length, name] = match;
    const parts = name!.split('/');
    if (
      parts.some(
        (part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.git',
      ) ||
      name!.includes('\\')
    )
      throw new Error('This repository contains an unsafe checkout path.');
    const size = length === '-' ? 0 : Number(length);
    if (size > maximumFile || (total += size) > maximumTotal || files.length >= 20000)
      throw new Error(
        'Agent task checkout is limited to 20,000 files, 64 MiB per file and 512 MiB total. Use the human worktree dialog for this repository.',
      );
    files.push({ name: name!, mode: mode!, object: object!, size });
  }
  return files;
}

/** Fixed writes only: no shell, hook, filter, credential helper, submodule command or network. */
export async function addAgentWorktree(
  repo: string,
  destination: string,
  branch: { name: string; commit: string; fresh: boolean },
  signal: AbortSignal,
): Promise<void> {
  await assertAgentCheckoutSafe(repo, signal);
  const files = await treeFiles(repo, branch.commit, signal);
  await runGit(
    repo,
    [
      'worktree',
      'add',
      '--no-checkout',
      ...(branch.fresh ? ['-b', branch.name] : []),
      '--',
      destination,
      branch.fresh ? branch.commit : branch.name,
    ],
    262144,
    signal,
  );
  const root = await realpath(destination),
    identity = await lstat(root);
  if (!identity.isDirectory() || identity.isSymbolicLink())
    throw new Error('The new worktree folder changed.');
  const check = async (folder: string) => {
    const info = await lstat(root);
    if (
      info.dev !== identity.dev ||
      info.ino !== identity.ino ||
      (await realpath(destination)) !== root
    )
      throw new Error('The new worktree folder was replaced.');
    let directory = root;
    for (const part of path.relative(root, folder).split(path.sep).filter(Boolean)) {
      directory = path.join(directory, part);
      try {
        await mkdir(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      const entry = await lstat(directory);
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        (await realpath(directory)) !== directory
      )
        throw new Error('A checkout directory was replaced or linked.');
    }
  };
  const links: { file: string; target: string }[] = [];
  for (const file of files.filter((file) => file.mode === '160000')) {
    signal.throwIfAborted();
    await check(path.dirname(path.join(root, file.name)));
    await mkdir(path.join(root, file.name));
  }
  const blobs = files.filter((file) => file.mode !== '160000');
  let index = 0;
  for await (const bytes of gitBlobs(repo, blobs, signal)) {
    const file = blobs[index++]!;
    signal.throwIfAborted();
    const output = path.join(root, file.name);
    await check(path.dirname(output));
    if (bytes.length !== file.size) throw new Error('A checkout blob has an unexpected size.');
    if (file.mode === '120000') {
      const target = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const relative = path.relative(root, path.resolve(path.dirname(output), target));
      if (
        !target ||
        target.includes('\0') ||
        path.isAbsolute(target) ||
        relative === '..' ||
        relative.startsWith('..' + path.sep) ||
        path.isAbsolute(relative) ||
        relative.split(path.sep).some((part) => part.toLowerCase() === '.git')
      )
        throw new Error('An agent checkout cannot create a link outside its working files.');
      links.push({ file: output, target });
      continue;
    }
    const handle = await open(
      output,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      file.mode === '100755' ? 0o755 : 0o644,
    );
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
  }
  // Links are created last, so no subsequent materialization traverses a checkout link.
  for (const link of links) {
    signal.throwIfAborted();
    await check(path.dirname(link.file));
    await symlink(link.target, link.file);
  }
  signal.throwIfAborted();
  await check(root);
  await runGit(root, ['read-tree', branch.commit], 262144, signal);
}
