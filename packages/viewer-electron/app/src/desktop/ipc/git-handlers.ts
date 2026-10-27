import type { ApiHandlers } from './schemas';
import { bindGitTarget, type GitTargetWindow } from '../comparison/git-target';
import type { GitReader } from '../comparison/git';
import type { GitWorktrees } from '../comparison/worktrees';
import type { GitReviews } from '../comparison/review';
import type { GitActions } from '../comparison/git-actions';
import type { Resources } from '../previews/resources';
import type { JournalActivity } from '../journal/activity';

type GitHandlers = Pick<
  ApiHandlers,
  'git' | 'gitWorktrees' | 'gitReview' | 'gitAction' | 'gitResource'
>;
interface GitPorts {
  reader: Pick<GitReader, 'status' | 'head' | 'blob'>;
  worktrees: Pick<GitWorktrees, 'request'>;
  reviews: Pick<GitReviews, 'request'>;
  actions: Pick<GitActions, 'start'>;
  resources: Pick<Resources, 'grantBytes'>;
  activity: Pick<JournalActivity, 'at' | 'git'>;
  window(owner: number): GitTargetWindow | undefined;
  isAgent(owner: number): boolean;
  retainResource(id: string): void;
}

/** Human Git mutations bind their captured target before entering a feature service.
 * Snapshot resources retain their ordinary desktop-owned capability lifetime. */
export function createGitHandlers(ports: GitPorts): GitHandlers {
  return {
    git: ([request]) =>
      request.kind === 'status'
        ? ports.reader.status(request.path, request.refresh)
        : ports.reader.head(request.path),
    gitWorktrees: async ([request], owner) => {
      if (ports.isAgent(owner))
        throw new Error('Worktree browsing is available only to the person.');
      const bound =
        request.kind === 'create'
          ? { ...request, target: await bindGitTarget(request.target, ports.window(owner)) }
          : request;
      return ports.worktrees.request(bound, owner);
    },
    gitReview: async ([request], owner) => {
      if (ports.isAgent(owner)) throw new Error('Git review is available only to the person.');
      const bound =
        request.kind === 'open'
          ? {
              ...request,
              target: await bindGitTarget(request.target, ports.window(owner), undefined, [
                'folder',
                'git-changes',
              ]),
            }
          : request;
      return ports.reviews.request(bound, owner);
    },
    gitAction: async ([request], owner) => {
      if (ports.isAgent(owner)) throw new Error('Agents cannot run Git program actions.');
      const target = await bindGitTarget(request.target, ports.window(owner));
      return ports.activity.at({ workspaceID: target.workspaceID, planeID: target.paneID }, () =>
        ports.activity.git(request.id, request.kind, () =>
          ports.actions.start({ ...request, target }, owner),
        ),
      );
    },
    gitResource: async ([source]) => {
      const bytes = await ports.reader.blob(source);
      const resource = await ports.resources.grantBytes(source.repository, source.path, bytes);
      ports.retainResource(resource.id);
      return resource;
    },
  };
}
