import { memo, useCallback, useEffect } from 'react';
import type { Resource } from '../../domain/contracts';
import { formatBytes } from '../../domain/files';
import { getState, quickPreview, report, stepQuickPreview } from '../state/store';
import { editable } from '../commands/editing';
import { useWorkspace } from '../workspace/context';
import { Dialog, IconButton } from '../ui/primitives';
import { OpenDefaultButton } from '../ui/OpenDefaultButton';
import { PreviewHost } from './PreviewHost';
import type { PreviewModule } from './contracts';
import { baseName } from '../../domain/planes';
import { MAX_TEXT_BYTES } from '../../domain/text-documents';

/** Quick Preview's Edit while it shows a text file: ⌘E reaches it through the window's commands. */
let editShown: (() => void) | undefined;
/** Edits the text file Quick Preview shows; false when it shows none. */
export function quickPreviewEdit(): boolean {
  if (!editShown) return false;
  editShown();
  return true;
}

export const QuickPreview = memo(function QuickPreview({
  session,
}: {
  session: NonNullable<ReturnType<typeof getState>['quickPreview']>;
}) {
  const workspace = useWorkspace();
  // Quick Look opens with at least one path, and stepping wraps within them.
  const path = session.paths[session.index] ?? session.paths[0] ?? '';
  useEffect(() => {
    // Space closes, Escape closes and the side arrows step, once the key has bubbled: what has the
    // focus answers first. Taken at the window while capturing, they stepped a focused drawing to
    // another file instead of panning it, and Escape in the shading panel closed Quick Preview.
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        editable(event.target) ||
        event.isComposing ||
        event.repeat ||
        ![' ', 'Escape', 'ArrowLeft', 'ArrowRight'].includes(event.key)
      )
        return;
      event.preventDefault();
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
        stepQuickPreview(event.key === 'ArrowLeft' ? -1 : 1);
      else quickPreview(null);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);
  /** Opens the file as its plane, as Open linked plane does; `edit` starts its editor there. */
  const open = useCallback(
    (file: string, edit: boolean) => {
      void workspace
        .openPath(file, {
          workspaceID: session.workspaceID,
          paneID: session.paneID,
          linked: true,
          ...(edit ? { activate: true, edit: true } : {}),
        })
        .then(() => {
          const opened = getState().activePane;
          quickPreview(null);
          // Closing a native <dialog> restores focus to its source row.
          // Focus the destination after that restoration has completed.
          requestAnimationFrame(() => {
            if (opened) workspace.focusPane(opened, edit ? { activate: true } : undefined);
          });
        })
        .catch(report);
    },
    [session, workspace],
  );
  const footer = useCallback(
    (resource: Resource, module: PreviewModule) => {
      const editable = module.id === 'text' && resource.entry.size <= MAX_TEXT_BYTES;
      editShown = editable ? () => open(resource.entry.path, true) : undefined;
      return (
        <footer className="quick-preview-footer">
          <span className="quick-preview-metadata">
            {module.label} <span className="separator">·</span> {formatBytes(resource.entry.size)}
          </span>
          <div className="quick-preview-actions">
            {session.paths.length > 1 && (
              <div className="quick-preview-navigation">
                <IconButton
                  icon="left"
                  label="Previous file"
                  onClick={() => stepQuickPreview(-1)}
                />
                <span>
                  {session.index + 1} / {session.paths.length}
                </span>
                <IconButton icon="right" label="Next file" onClick={() => stepQuickPreview(1)} />
              </div>
            )}
            <OpenDefaultButton path={resource.entry.path} />
            {editable && (
              <button title="Edit (⌘E)" onClick={() => open(resource.entry.path, true)}>
                Edit
              </button>
            )}
            <button className="primary" onClick={() => open(resource.entry.path, false)}>
              Open linked plane
            </button>
          </div>
        </footer>
      );
    },
    [session, open],
  );
  useEffect(
    () => () => {
      editShown = undefined;
    },
    [],
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
