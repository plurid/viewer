import { useCallback, useSyncExternalStore } from 'react';
import type { FileEntry } from '../../domain/contracts';
import { gitBadge, type GitResult, type GitStatus } from '../../domain/comparison/git';
import type { GitSnapshot, KnownRepository } from '../../domain/comparison/git';
import { useViewer } from '../state/store';
import { useWorkspace } from '../workspace/context';
import { pathContains } from '../../domain/files/paths';
import { errorMessage } from '../../domain/errors';
import { baseName, parentPath } from '../../domain/workspaces/planes';
import { listedEntries } from '../explorer/useFolder';

interface GitView {
  result: GitResult;
  statuses: ReadonlyMap<string, GitStatus>;
}

interface Subscription {
  value: GitView | null;
  signature: string;
  listeners: Set<() => void>;
  loading: boolean;
}

const folders = new Map<string, Subscription>();

/** How often shown folders' Git status is read again, while the window is visible. */
const pollInterval = 5000;
let ticker: ReturnType<typeof setInterval> | undefined;

/**
 * Every shown folder is read at once: folders of one repository then share a single scan
 * in the desktop, which an independent timer for each folder never did.
 */
function refreshShown(): void {
  for (const [path, subscription] of folders)
    if (subscription.listeners.size) void refresh(path, subscription).catch(() => {});
}
function follow(): void {
  if (ticker) return;
  ticker = setInterval(() => {
    if (!document.hidden) refreshShown();
  }, pollInterval);
  window.addEventListener('focus', refreshShown);
}
function unfollowWhenUnused(): void {
  if ([...folders.values()].some((subscription) => subscription.listeners.size)) return;
  clearInterval(ticker);
  ticker = undefined;
  window.removeEventListener('focus', refreshShown);
}

function folder(path: string): Subscription {
  let subscription = folders.get(path);
  if (!subscription) {
    subscription = { value: null, signature: '', listeners: new Set(), loading: false };
    folders.set(path, subscription);
  }
  return subscription;
}

async function refresh(path: string, subscription: Subscription): Promise<void> {
  if (subscription.loading || !window.viewer.git) return;
  subscription.loading = true;
  try {
    const reply = await window.viewer.git({ kind: 'status', path, refresh: true });
    if (reply.kind === 'head' || !subscription.listeners.size) return;
    const signature = JSON.stringify(
      reply.kind === 'ready' ? { ...reply, snapshot: { ...reply.snapshot, updated: 0 } } : reply,
    );
    if (subscription.signature === signature) return;
    const statuses = new Map<string, GitStatus>();
    if (reply.kind === 'ready') {
      for (const change of reply.snapshot.changes) {
        const file = reply.snapshot.root.replace(/\/$/, '') + '/' + change.path;
        statuses.set(file, change.status);
        const names = [change.path, ...(change.original ? [change.original] : [])];
        for (const name of names) {
          const target = reply.snapshot.root.replace(/\/$/, '') + '/' + name;
          let parent = target.slice(0, target.lastIndexOf('/'));
          while (parent.length >= reply.snapshot.root.length) {
            if (!statuses.has(parent) || change.status === 'conflict')
              statuses.set(parent, change.status === 'conflict' ? 'conflict' : 'modified');
            parent = parent.slice(0, parent.lastIndexOf('/'));
          }
        }
      }
    }
    subscription.signature = signature;
    if (reply.kind === 'ready' && reply.canonical && reply.canonical !== path) {
      for (const [file, status] of [...statuses]) {
        if (pathContains(reply.canonical, file))
          statuses.set(path.replace(/\/$/, '') + file.slice(reply.canonical.length), status);
      }
    }
    subscription.value = { result: reply, statuses };
    for (const listener of subscription.listeners) listener();
  } catch (error) {
    if (!subscription.listeners.size) return;
    subscription.signature = '';
    subscription.value = {
      result: { kind: 'unavailable', message: errorMessage(error) },
      statuses: new Map(),
    };
    for (const listener of subscription.listeners) listener();
  } finally {
    subscription.loading = false;
  }
}

const known = (snapshot: GitSnapshot): KnownRepository => ({
  root: snapshot.root,
  branch: snapshot.branch,
  changes: snapshot.changes.length,
});
/**
 * A folder's repository as the window knows it already, for a menu that opens at once: the
 * folder's own Git status, a `.git` in its listing, or the status of the folder listing it, whose
 * working tree holds it. Nothing is read for the asking; none when it is not known to be in one.
 */
export function knownRepository(path: string): KnownRepository | undefined {
  const own = folders.get(path)?.value?.result;
  if (own?.kind === 'ready') return known(own.snapshot);
  if (own?.kind === 'outside' || baseName(path) === '.git') return undefined;
  // a worktree or submodule keeps a `.git` file, a repository a `.git` folder
  if (listedEntries(path)?.some((entry) => entry.name === '.git'))
    return { root: path, branch: '' };
  const parent = folders.get(parentPath(path))?.value?.result;
  return parent?.kind === 'ready' ? known(parent.snapshot) : undefined;
}

/** Rows share one subscription and one indexed snapshot for each displayed folder. */
function useGitStatus(path: string | undefined): GitView | null {
  const enabled = useViewer((state) => state?.settings.settings.git.enabled ?? false);
  return useSyncExternalStore(
    useCallback(
      (listener: () => void) => {
        if (!enabled || !path) return () => {};
        const subscription = folder(path);
        subscription.listeners.add(listener);
        if (subscription.listeners.size === 1) {
          void refresh(path, subscription).catch(() => {});
          follow();
        }
        return () => {
          subscription.listeners.delete(listener);
          if (subscription.listeners.size) return;
          if (folders.size > 64) folders.delete(path);
          unfollowWhenUnused();
        };
      },
      [enabled, path],
    ),
    () => (enabled && path ? folder(path).value : null),
  );
}

export function GitBadge({ entry }: { entry: FileEntry }) {
  const view = useGitStatus(entry.parent);
  const status = view?.statuses.get(entry.path);
  if (!status) return null;
  return (
    <span
      className={`git-badge git-${status}`}
      title={`Git: ${status}`}
      aria-label={`Git: ${status}`}
    >
      {gitBadge[status]}
    </span>
  );
}

export function GitColumn({ entry }: { entry: FileEntry }) {
  const view = useGitStatus(entry.parent);
  return <span className="file-git">{view?.statuses.get(entry.path) ?? ''}</span>;
}

export function GitBranch({ path, paneID }: { path: string; paneID?: string }) {
  const view = useGitStatus(path);
  const workspace = useWorkspace();
  if (!view || view.result.kind === 'outside' || view.result.kind === 'disabled') return null;
  if (view.result.kind !== 'ready')
    return (
      <span className="git-unavailable" title={view.result.message}>
        Git unavailable
      </span>
    );
  const { snapshot } = view.result;
  const label = [
    snapshot.branch,
    snapshot.ahead ? `↑${snapshot.ahead}` : '',
    snapshot.behind ? `↓${snapshot.behind}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const count = snapshot.changes.length;
  const changes = count ? `${count} ${count === 1 ? 'change' : 'changes'}` : 'Clean';
  return (
    <button
      className="git-branch"
      title={`Git changes · ${label} · ${changes}`}
      onClick={() => workspace.openGitChanges(snapshot.root, paneID)}
    >
      {label} · {changes}
    </button>
  );
}
