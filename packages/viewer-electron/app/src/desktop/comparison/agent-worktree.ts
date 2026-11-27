import { lstat } from '../files/stats';
import { sameItem } from '../files/item-identity';
import path from 'node:path';
import { constants } from 'node:fs';
import { mkdir, open, realpath, symlink } from 'node:fs/promises';
import { runGit } from './git';
import { gitBlobs } from './git-blobs';
import { assertNoGitFilters } from './git-filters';
import { commitPattern } from '../../domain/comparison/git';

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
  await assertNoGitFilters(runGit, repo, signal);
}

/** Checkout filters and post-checkout hooks are executable code. Agent worktrees
 * materialize raw blobs instead; Git LFS pointers remain pointers until a person fetches them. */
async function treeFiles(repo: string, commit: string, signal: AbortSignal): Promise<TreeFile[]> {
  if (!commitPattern.test(commit)) throw new Error('Invalid task revision.');
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
    if (mode === '120000' && size > 4096) throw new Error('The checkout link target is too long.');
    if (size > maximumFile || (total += size) > maximumTotal || files.length >= 20000)
      throw new Error(
        'Agent task checkout is limited to 20,000 files, 64 MiB per file and 512 MiB total. Use the human worktree dialog for this repository.',
      );
    files.push({ name: name!, mode: mode!, object: object!, size });
  }
  return files;
}

interface CheckoutLink {
  name: string;
  target: string;
}

// Expand each planned link before interpreting the next component, including "..".
// Only known directories may be traversed upwards. A dangling leaf is safe, but an
// unknown parent, an ambiguous filesystem spelling or a chain beyond the OS limit is not.
export function validateCheckoutLinks(
  names: readonly string[],
  links: readonly CheckoutLink[],
): void {
  if (!links.length) return;
  const key = (value: string) =>
    value
      .normalize('NFD')
      .toLowerCase()
      .replace(/\p{Default_Ignorable_Code_Point}/gu, '');
  const directories = new Set(['']);
  const spellings = new Map<string, string | null>();
  for (const name of names) {
    const parts = name.split('/');
    let prefix = '';
    for (const [index, part] of parts.entries()) {
      if (key(part) === '.git') throw new Error('An agent checkout cannot link to Git metadata.');
      prefix = prefix ? prefix + '/' + part : part;
      const folded = key(prefix);
      const known = spellings.get(folded);
      spellings.set(folded, known === undefined || known === prefix ? prefix : null);
      if (index < parts.length - 1) directories.add(prefix);
    }
  }
  const targets = new Map(links.map((link) => [link.name, link.target]));
  for (const link of links) {
    if (
      !link.target ||
      path.isAbsolute(link.target) ||
      link.target.includes('\0') ||
      Buffer.byteLength(link.target) > 4096
    )
      throw new Error('An agent checkout cannot create this link.');
  }
  for (const link of links) {
    const parts = link.name.split('/');
    let prefix = '';
    for (const part of parts) {
      prefix = prefix ? prefix + '/' + part : part;
      if (spellings.get(key(prefix)) !== prefix)
        throw new Error('The checkout has ambiguous link paths.');
    }
    parts.pop();
    const pending = link.target.split('/').reverse();
    let hops = 1;
    while (pending.length) {
      const part = pending.pop()!;
      if (!part || part === '.') continue;
      if (part === '..') {
        if (!parts.length || !directories.has(parts.join('/')))
          throw new Error('An agent checkout cannot create a link outside its working files.');
        parts.pop();
        continue;
      }
      if (key(part) === '.git') throw new Error('An agent checkout cannot link to Git metadata.');
      parts.push(part);
      const name = parts.join('/');
      const known = spellings.get(key(name));
      // A differently spelled dependency may resolve differently on another volume.
      if (known !== undefined && known !== name)
        throw new Error('The checkout has an ambiguous link target.');
      const target = targets.get(name);
      if (target !== undefined) {
        if (++hops > 40) throw new Error('The checkout link chain is cyclic or too long.');
        parts.pop();
        pending.push(...target.split('/').reverse());
      }
    }
  }
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
    if (!sameItem(info, identity) || (await realpath(destination)) !== root)
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
  const links: CheckoutLink[] = [];
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
      links.push({ name: file.name, target });
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
  validateCheckoutLinks(
    files.map((file) => file.name),
    links,
  );
  for (const link of links) {
    signal.throwIfAborted();
    const output = path.join(root, link.name);
    await check(path.dirname(output));
    await symlink(link.target, output);
  }
  signal.throwIfAborted();
  await check(root);
  await runGit(root, ['read-tree', branch.commit], 262144, signal);
}
