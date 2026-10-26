import type { FileEntry } from '../contracts';
import type { GitSnapshot } from './git';
import type { CapturedTarget } from '../automation/actions';

export const maximumWorktrees = 256;

/** Registry metadata, not an instruction to check out, create, prune or remove anything. */
export interface GitWorktreeRecord {
  path: string;
  commit?: string;
  branch?: string;
  detached: boolean;
  bare: boolean;
  locked?: string;
  prunable?: string;
}

export interface GitWorktree extends GitWorktreeRecord {
  id: string;
  available: boolean;
  problem?: string;
}

export interface WorktreeCatalog {
  id: string;
  repository: string;
  currentPath: string;
  worktrees: GitWorktree[];
  branches?: WorktreeBranch[];
  defaultBaseID?: string;
  creationProblem?: string;
}

export interface WorktreeBranch {
  id: string;
  name: string;
  commit: string;
  /** Undefined for the synthetic detached HEAD base, which is not an existing branch. */
  branch?: string;
  worktreeID?: string;
}

export type WorktreeCreation = {
  kind: 'create';
  catalogID: string;
  target: CapturedTarget;
  destination: string;
  checkout: { kind: 'new'; name: string; baseID: string } | { kind: 'existing'; branchID: string };
};

export interface WorktreeSelection {
  catalogID: string;
  worktreeID: string;
}

export type WorktreeRequest =
  | { kind: 'list'; directory: string }
  | ({ kind: 'inspect' | 'open' } & WorktreeSelection)
  | WorktreeCreation
  | { kind: 'release'; catalogID: string };

export type WorktreeReply =
  | { kind: 'catalog'; catalog: WorktreeCatalog }
  | { kind: 'status'; snapshot: GitSnapshot }
  | { kind: 'folder'; entry: FileEntry }
  | { kind: 'created'; catalog: WorktreeCatalog; worktreeID: string; entry: FileEntry }
  | { kind: 'released' };

export function validBranchName(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 200 &&
    value !== '@' &&
    !value.startsWith('-') &&
    !value.startsWith('/') &&
    !value.endsWith('/') &&
    !value.endsWith('.') &&
    !/[\x00-\x20\x7f~^:?*\\[\\]/.test(value) &&
    !value.includes('..') &&
    !value.includes('@{') &&
    !value.includes('//') &&
    value.split('/').every((part) => !part.startsWith('.') && !part.endsWith('.lock'))
  );
}

/** A sibling suggestion only; the desktop independently validates the selected destination. */
export function worktreeDestination(repository: string, branch: string): string {
  const separator = repository.includes('\\') ? '\\' : '/';
  const parts = repository.replace(/[\\/]+$/, '').split(/[\\/]/);
  const name = parts.pop() || 'repository';
  const suffix =
    branch
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'task';
  return parts.join(separator) + separator + name + '-' + suffix;
}

export function worktreeLabel(worktree: GitWorktreeRecord): string {
  if (worktree.bare) return 'Bare repository';
  if (worktree.branch) return worktree.branch;
  return worktree.commit ? `Detached · ${worktree.commit.slice(0, 8)}` : 'Unborn checkout';
}

/** `-z` keeps spaces, newlines and tabs in paths literal; blank NUL records delimit worktrees. */
export function parseGitWorktrees(output: string): GitWorktreeRecord[] {
  if (!output.endsWith('\0\0')) throw new Error('Incomplete Git worktree registry.');
  const records: GitWorktreeRecord[] = [];
  const paths = new Set<string>();
  for (const block of output.slice(0, -2).split('\0\0')) {
    if (!block || records.length >= maximumWorktrees)
      throw new Error(`Git worktree discovery is limited to ${maximumWorktrees} checkouts.`);
    const fields = new Map<string, string>();
    for (const field of block.split('\0')) {
      const space = field.indexOf(' ');
      const key = space < 0 ? field : field.slice(0, space);
      const value = space < 0 ? '' : field.slice(space + 1);
      if (
        !['worktree', 'HEAD', 'branch', 'bare', 'detached', 'locked', 'prunable'].includes(key) ||
        fields.has(key)
      )
        throw new Error('Unrecognised or repeated Git worktree field.');
      fields.set(key, value);
    }
    const location = fields.get('worktree');
    if (!location || location.length > 32768 || paths.has(location))
      throw new Error('Invalid or repeated Git worktree location.');
    const head = fields.get('HEAD');
    if (head && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head))
      throw new Error('Invalid Git worktree commit.');
    const branch = fields.get('branch');
    if (
      branch &&
      (!branch.startsWith('refs/heads/') ||
        branch.length <= 11 ||
        branch.length > 1024 ||
        /[\x00-\x20\x7f]/.test(branch))
    )
      throw new Error('Invalid Git worktree branch.');
    if (
      (fields.has('detached') && branch) ||
      (fields.has('bare') && (branch || fields.has('detached')))
    )
      throw new Error('Inconsistent Git worktree registry.');
    if (!fields.has('bare') && !head) throw new Error('Missing Git worktree HEAD.');
    paths.add(location);
    records.push({
      path: location,
      commit: head && !/^0+$/.test(head) ? head : undefined,
      branch: branch?.slice('refs/heads/'.length),
      detached: fields.has('detached'),
      bare: fields.has('bare'),
      ...(fields.has('locked') ? { locked: fields.get('locked')!.slice(0, 2000) } : {}),
      ...(fields.has('prunable') ? { prunable: fields.get('prunable')!.slice(0, 2000) } : {}),
    });
  }
  return records;
}
