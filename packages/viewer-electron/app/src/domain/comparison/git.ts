import { z } from 'zod';

export type GitStatus =
  'modified' | 'added' | 'deleted' | 'untracked' | 'conflict' | 'renamed' | 'copied';
export interface GitChange {
  path: string;
  original?: string;
  index: string;
  worktree: string;
  status: GitStatus;
}
export interface GitSnapshot {
  root: string;
  branch: string;
  commit?: string;
  ahead?: number;
  behind?: number;
  changes: GitChange[];
  updated: number;
}
export type GitResult =
  | { kind: 'ready'; snapshot: GitSnapshot; canonical?: string }
  | { kind: 'disabled' | 'outside' | 'unavailable' | 'limited'; message: string };
export const gitRelativePath = (value: string) =>
  value.length > 0 &&
  value.length <= 32768 &&
  !value.startsWith('/') &&
  !value.includes('\0') &&
  value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');

export const gitSourceSchema = z
  .object({
    kind: z.literal('git'),
    repository: z.string().min(1).max(32768),
    commit: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
    path: z.string().refine(gitRelativePath, 'Invalid repository path.'),
  })
  .strict();
export type GitSource = z.infer<typeof gitSourceSchema>;
export type GitRequest =
  { kind: 'status'; path: string; refresh?: boolean } | { kind: 'head'; path: string };
export type GitReply = GitResult | { kind: 'head'; source: GitSource | null; root: string };
export const gitBadge: Record<GitStatus, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  untracked: '?',
  conflict: '!',
  renamed: 'R',
  copied: 'C',
};
/** Filenames are NUL-delimited; spaces, tabs and newlines belong to the name. */
export function parseGitStatus(output: string, root: string): GitSnapshot {
  if (output && !output.endsWith('\0')) throw new Error('Incomplete Git status output.');
  const records = output.split('\0');
  if (records.length > 100001) throw new Error('Git status exceeded its record limit.');
  const result: GitSnapshot = { root, branch: '', changes: [], updated: Date.now() };
  const status = (xy: string): GitStatus => {
    if (xy.includes('U')) return 'conflict';
    if (xy.includes('D')) return 'deleted';
    if (xy.includes('A')) return 'added';
    if (xy.includes('R')) return 'renamed';
    if (xy.includes('C')) return 'copied';
    return 'modified';
  };
  const add = (change: GitChange) => {
    if (!gitRelativePath(change.path) || (change.original && !gitRelativePath(change.original)))
      throw new Error('Git returned a path outside the repository.');
    if (result.changes.length >= 50000) throw new Error('Git status exceeded its change limit.');
    result.changes.push(change);
  };
  for (let i = 0; i < records.length; i++) {
    const row = records[i]!;
    if (!row) continue;
    if (row.startsWith('# branch.head ')) result.branch = row.slice(14);
    else if (row.startsWith('# branch.oid ')) {
      const oid = row.slice(13);
      if (/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(oid)) result.commit = oid;
      else if (oid !== '(initial)') throw new Error('Invalid Git commit identifier.');
    } else if (row.startsWith('# branch.ab ')) {
      const match = /^# branch.ab \+(\d+) -(\d+)$/.exec(row);
      if (match) {
        result.ahead = Number(match[1]);
        result.behind = Number(match[2]);
        if (!Number.isSafeInteger(result.ahead) || !Number.isSafeInteger(result.behind))
          throw new Error('Invalid Git ahead/behind count.');
      }
    } else if (row.startsWith('? '))
      add({ path: row.slice(2), index: '?', worktree: '?', status: 'untracked' });
    else if (['1', '2', 'u'].includes(row[0] ?? '')) {
      const fields = row[0] === '1' ? 8 : row[0] === '2' ? 9 : 10;
      let at = 0;
      const parts: string[] = [];
      for (let n = 0; n < fields; n++) {
        const end = row.indexOf(' ', at);
        if (end < 0) throw new Error('Incomplete Git status record.');
        parts.push(row.slice(at, end));
        at = end + 1;
      }
      const xy = parts[1]!;
      const original = row[0] === '2' ? records[++i] : undefined;
      if (!/^[.MTADRCU]{2}$/.test(xy) || !row.slice(at) || (row[0] === '2' && !original))
        throw new Error('Invalid Git status record.');
      add({
        path: row.slice(at),
        ...(original ? { original } : {}),
        index: xy[0]!,
        worktree: xy[1]!,
        status: row[0] === 'u' ? 'conflict' : status(xy),
      });
    } else if (!row.startsWith('# ') && !row.startsWith('! '))
      throw new Error('Unrecognised Git status record.');
  }
  if (result.branch === '(detached)') result.branch = result.commit?.slice(0, 8) ?? 'Detached';
  return result;
}
