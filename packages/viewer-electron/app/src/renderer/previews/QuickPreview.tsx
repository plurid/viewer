import { memo, useCallback, useContext, useEffect } from 'react';
import type { FileEntry, Resource } from '../../domain/contracts';
import { getState, quickPreview, report, stepQuickPreview } from '../state/store';
import { editable } from '../commands/editing';
import { useWorkspace } from '../workspace/context';
import { Dialog, IconButton } from '../ui/primitives';
import { OpenDefaultButton } from '../ui/navigation/OpenDefaultButton';
import { HeldPreview } from './HeldPreview';
import { PreviewSize } from './PreviewSize';
import type { PreviewModule } from './contracts';
import type { HexToggle } from './PreviewHost';
import { baseName } from '../../domain/workspaces/planes';
import { MAX_TEXT_BYTES } from '../../domain/editing/documents';
import { CommandsContext } from '../commands/context';
import { suggestionsFor } from '../commands/suggestions';

/** Quick Preview's Edit while it shows a text file: ⌘E reaches it through the window's commands. */
let editShown: (() => void) | undefined;
/** Edits the text file Quick Preview shows; false when it shows none. */
export function quickPreviewEdit(): boolean {
  if (!editShown) return false;
  editShown();
  return true;
}

/** The one action that fits the file best, such as Extract here for an archive; Edit has its own
 * button. Run from the plane the preview came from, as its menu would. */
function SuggestedAction({
  entry,
  paneID,
  workspaceID,
}: {
  entry: FileEntry;
  paneID?: string;
  workspaceID: string;
}) {
  // a preview shown outside a window's commands, as in a test, has none to suggest
  const registry = useContext(CommandsContext);
  const applicable =
    registry?.list({
      paneID,
      scope: 'files',
      context: {
        scope: 'files',
        workspaceID,
        paneID,
        directory: entry.parent,
        selection: [entry],
        jobs: getState().jobs,
        clipboard: getState().clipboard,
      },
    }) ?? [];
  const [suggestion] = suggestionsFor(
    applicable.filter((command) => command.id !== 'edit-selected'),
    [entry],
    1,
  );
  if (!registry || !suggestion) return null;
  return (
    <button
      title={suggestion.reason}
      onClick={() => {
        quickPreview(null);
        requestAnimationFrame(() => void registry.run(suggestion.command).catch(report));
      }}
    >
      {suggestion.command.label}
    </button>
  );
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
    (resource: Resource, module: PreviewModule, hex?: HexToggle) => {
      const editable = module.editing === 'text' && resource.entry.size <= MAX_TEXT_BYTES;
      editShown = editable ? () => open(resource.entry.path, true) : undefined;
      return (
        <footer className="quick-preview-footer">
          <span className="quick-preview-metadata">
            {module.label} <span className="separator">·</span>{' '}
            <PreviewSize entry={resource.entry} />
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
            {hex && (
              <button type="button" aria-pressed={hex.shown} onClick={hex.toggle}>
                {hex.shown ? 'Show preview' : 'Show as hex'}
              </button>
            )}
            <OpenDefaultButton path={resource.entry.path} />
            <SuggestedAction
              entry={resource.entry}
              paneID={session.paneID}
              workspaceID={session.workspaceID}
            />
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
        <HeldPreview path={path} renderFooter={footer} />
      </div>
    </Dialog>
  );
});
