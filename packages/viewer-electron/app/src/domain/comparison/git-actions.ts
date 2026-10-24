import type { CapturedTarget } from '../automation/actions';

export const gitActionKinds = [
  'status',
  'log',
  'stage-selected',
  'stage-all',
  'commit',
  'pull',
  'push',
] as const;

export type GitActionKind = (typeof gitActionKinds)[number];
export const gitCommitMessageLimit = 16000;
export const gitTerminalProfileID = '@viewer-git';
export const gitActionLabels: Readonly<Record<GitActionKind, string>> = {
  status: 'Status',
  log: 'History',
  'stage-selected': 'Stage selected',
  'stage-all': 'Stage all in repository',
  commit: 'Commit staged changes',
  pull: 'Pull · Fast-forward only',
  push: 'Push upstream',
};

interface GitActionTarget {
  /** A fresh terminal session ID, allocated by the owning workspace window. */
  id: string;
  target: CapturedTarget;
  cols?: number;
  rows?: number;
}

/** A closed set of human Git actions; callers cannot supply programs, argv or environment. */
export type GitActionIntent =
  { kind: 'commit'; message: string } | { kind: Exclude<GitActionKind, 'commit'>; message?: never };
export type GitActionRequest = GitActionTarget & GitActionIntent;

export interface GitActionReply {
  id: string;
  root: string;
  title: string;
}

export const readOnlyGitAction = (kind: GitActionKind): boolean =>
  kind === 'status' || kind === 'log';

/** These program commands never become agent/model authority through aliases or macros. */
export function humanGitCommand(id: string): boolean {
  return id.startsWith('git-action.') || id.startsWith('git-action-');
}
