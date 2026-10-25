import { gitBadge } from '../../domain/comparison/git';
import { Empty, Loading } from '../ui/primitives';
import { useWorkspace } from '../workspace/context';
import { useGitStatus } from './status';
import { report, useViewer } from '../state/store';

export default function GitChanges({ path, paneID }: { path: string; paneID?: string }) {
  const view = useGitStatus(path);
  const workspace = useWorkspace();
  const enabled = useViewer((state) => state.settings.settings.git.enabled);
  const scroll = useRef<HTMLDivElement>(null);
  const changes = view?.result.kind === 'ready' ? view.result.snapshot.changes : [];
  const virtual = useVirtualizer({
    count: changes.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 54,
    overscan: 8,
  });
  if (!enabled)
    return <Empty title="Git is off" detail="Enable Git in Settings → Browsing → Git." />;
  if (!view) return <Loading label="Reading Git status…" />;
  if (view.result.kind !== 'ready')
    return <Empty title="Git status unavailable" detail={view.result.message} />;
  const { snapshot } = view.result;
  if (!snapshot.changes.length) return <Empty title="No Git changes" detail={snapshot.branch} />;
  return (
    <div className="git-changes" role="list" aria-label="Git changes" ref={scroll}>
      <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
        {virtual.getVirtualItems().map((item) => {
          const change = changes[item.index]!;
          return (
            <div
              className="git-change"
              role="listitem"
              key={change.path}
              aria-posinset={item.index + 1}
              aria-setsize={changes.length}
              style={{ position: 'absolute', top: item.start, height: item.size, width: '100%' }}
            >
              <span className={`git-badge git-${change.status}`} title={change.status}>
                {gitBadge[change.status]}
              </span>
              <span className="git-change-path">
                {change.path}
                {change.original && <small>From {change.original}</small>}
              </span>
              <button
                onClick={() =>
                  void workspace
                    .openGitDiff(snapshot.root + '/' + change.path, paneID)
                    .catch(report)
                }
              >
                Open diff
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
