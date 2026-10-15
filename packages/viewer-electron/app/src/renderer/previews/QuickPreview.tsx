import { memo, useCallback } from 'react';
import type { Resource } from '../../domain/contracts';
import { formatBytes } from '../../domain/files';
import { getState, quickPreview, report, stepQuickPreview } from '../state/store';
import { useWorkspace } from '../workspace/context';
import { Dialog, IconButton } from '../ui/primitives';
import { OpenDefaultButton } from '../ui/OpenDefaultButton';
import { PreviewHost } from './PreviewHost';
import type { PreviewModule } from './contracts';
import { baseName } from '../../domain/planes';

export const QuickPreview = memo(function QuickPreview({
  session,
}: {
  session: NonNullable<ReturnType<typeof getState>['quickPreview']>;
}) {
  const workspace = useWorkspace();
  const path = session.paths[session.index];
  const footer = useCallback(
    (resource: Resource, module: PreviewModule) => (
      <footer className="quick-preview-footer">
        <span className="quick-preview-metadata">
          {module.label} <span className="separator">·</span> {formatBytes(resource.entry.size)}
        </span>
        <div className="quick-preview-actions">
          {session.paths.length > 1 && (
            <div className="quick-preview-navigation">
              <IconButton icon="left" label="Previous file" onClick={() => stepQuickPreview(-1)} />
              <span>
                {session.index + 1} / {session.paths.length}
              </span>
              <IconButton icon="right" label="Next file" onClick={() => stepQuickPreview(1)} />
            </div>
          )}
          <OpenDefaultButton path={resource.entry.path} />
          <button
            className="primary"
            onClick={() => {
              void workspace
                .openPath(resource.entry.path, {
                  workspaceID: session.workspaceID,
                  paneID: session.paneID,
                  linked: true,
                })
                .then(() => {
                  const opened = getState().activePane;
                  quickPreview(null);
                  // Closing a native <dialog> restores focus to its source row.
                  // Focus the destination after that restoration has completed.
                  requestAnimationFrame(() => {
                    if (opened) workspace.focusPane(opened);
                  });
                })
                .catch(report);
            }}
          >
            Open linked plane
          </button>
        </div>
      </footer>
    ),
    [session, workspace],
  );
  return (
    <Dialog
      title={baseName(path)}
      wide
      className="quick-preview-dialog"
      onClose={() => quickPreview(null)}
    >
      <div className="quick-preview">
        <PreviewHost path={path} renderFooter={footer} />
      </div>
    </Dialog>
  );
});
