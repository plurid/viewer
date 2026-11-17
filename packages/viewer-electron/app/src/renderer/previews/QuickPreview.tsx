import { memo, useCallback, useContext, useEffect, useMemo } from 'react';
import type { FileEntry, Resource } from '../../domain/contracts';
import {
  activeWorkspace,
  followQuickPreview,
  getState,
  quickPreview,
  report,
  stepQuickPreview,
} from '../state/store';
import { folderPresentation } from '../state/presentation';
import { editable } from '../commands/editing';
import { useWorkspace } from '../workspace/context';
import { selectedFiles, selectionCursor } from '../workspace/sessions';
import { routeFileKeyboard } from '../explorer/selection';
import { AppIcon, hasBundleIcon } from '../explorer/app-icon';
import { Dialog, IconButton } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { OpenDefaultButton } from '../ui/navigation/OpenDefaultButton';
import { HeldPreview } from './HeldPreview';
import { PreviewFacts, PreviewFileInfo } from './PreviewFileInfo';
import type { PreviewModule } from './contracts';
import type { HexToggle } from './PreviewHost';
import { baseName } from '../../domain/workspaces/planes';
import { MAX_TEXT_BYTES } from '../../domain/editing/documents';
import { CommandsContext } from '../commands/context';
import { suggestionsFor } from '../commands/suggestions';
import { transformableImage } from '../../domain/operations/image-conversions';
import { kindLabel } from '../../domain/files/entries';

const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

/** Whether the focused part of the preview scrolls with this arrow itself, as a long text does. */
function scrollsWith(event: KeyboardEvent): boolean {
  const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
  let element = event.target instanceof Element ? event.target : null;
  for (; element && !element.matches('dialog'); element = element.parentElement) {
    const style = getComputedStyle(element);
    if (!['auto', 'scroll'].includes(vertical ? style.overflowY : style.overflowX)) continue;
    if (
      vertical
        ? element.scrollHeight > element.clientHeight
        : element.scrollWidth > element.clientWidth
    )
      return true;
  }
  return false;
}
/** Whether Left and Right move a plane's selection: in Grid and Gallery they do. */
function movesSideways(paneID?: string): boolean {
  const pane = activeWorkspace().panes.find((item) => item.id === paneID);
  return (
    pane?.type === 'folder' && ['grid', 'gallery'].includes(folderPresentation(pane.path).mode)
  );
}

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
  excluded,
}: {
  entry: FileEntry;
  paneID?: string;
  workspaceID: string;
  excluded: readonly string[];
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
    applicable.filter((command) => !excluded.includes(command.id)),
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
    // Space closes, Escape closes and the arrows move, once the key has bubbled: what has the focus
    // answers first. Taken at the window while capturing, they stepped a focused drawing to
    // another file instead of panning it, and Escape in the shading panel closed Quick Preview.
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || editable(event.target) || event.isComposing) return;
      if (event.key === ' ' || event.key === 'Escape') {
        if (event.repeat) return;
        event.preventDefault();
        quickPreview(null);
        return;
      }
      const quick = getState().quickPreview;
      if (
        !quick ||
        !arrows.includes(event.key) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        scrollsWith(event)
      )
        return;
      event.preventDefault();
      // Several selected: the side arrows step through them, as before. Otherwise the arrows move
      // the plane's selection as they would there, Left and Right only where they move it.
      const sideways = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
      if (sideways && (quick.paths.length > 1 || !movesSideways(quick.paneID))) {
        stepQuickPreview(event.key === 'ArrowLeft' ? -1 : 1);
        return;
      }
      if (!quick.paneID) return;
      routeFileKeyboard(quick.paneID, {
        key: event.key,
        code: event.code,
        shiftKey: event.shiftKey,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        target: document.body,
        preventDefault: () => {},
        stopPropagation: () => {},
        fromQuickPreview: true,
      });
      followQuickPreview(selectedFiles(quick.paneID), selectionCursor(quick.paneID));
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
  const count = session.paths.length;
  const navigation = useMemo(
    () =>
      count > 1 && (
        <div className="quick-preview-navigation">
          <IconButton icon="left" label="Previous file" onClick={() => stepQuickPreview(-1)} />
          <span>
            {session.index + 1} / {count}
          </span>
          <IconButton icon="right" label="Next file" onClick={() => stepQuickPreview(1)} />
        </div>
      ),
    [count, session.index],
  );
  // a folder the plane's selection moved to has no preview of its own: Quick Preview names it
  const folder = session.folders?.find((entry) => entry.path === path);
  const footer = useCallback(
    (resource: Resource, module: PreviewModule, hex?: HexToggle, details?: readonly string[]) => {
      const editable = module.editing === 'text' && resource.entry.size <= MAX_TEXT_BYTES;
      editShown = editable ? () => open(resource.entry.path, true) : undefined;
      return (
        <footer className="quick-preview-footer">
          {/* the dialog's title names the file */}
          <PreviewFileInfo
            entry={resource.entry}
            kind={module.label}
            details={details}
            named={false}
          />
          <div className="quick-preview-actions">
            {navigation}
            {hex && (
              <button type="button" aria-pressed={hex.shown} onClick={hex.toggle}>
                {hex.shown ? 'Show preview' : 'Show as hex'}
              </button>
            )}
            <OpenDefaultButton path={resource.entry.path} />
            <SuggestedAction
              excluded={[
                'edit-selected',
                ...(['image', 'rendered-image'].includes(module.id) &&
                transformableImage(resource.entry)
                  ? ['image-tools']
                  : []),
              ]}
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
    [open, navigation, session.paneID, session.workspaceID],
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
        {folder ? (
          <div className="quick-preview-folder-view">
            <div className="quick-preview-folder">
              {hasBundleIcon(folder) ? (
                <AppIcon entry={folder} size={128} fallback={<Icon name="folder" size={96} />} />
              ) : (
                <Icon name="folder" size={96} />
              )}
              <strong>{folder.name}</strong>
            </div>
            <footer className="quick-preview-footer">
              <PreviewFacts kind={kindLabel(folder)} size="" />
              <div className="quick-preview-actions">
                {navigation}
                <button className="primary" onClick={() => open(folder.path, false)}>
                  Open linked plane
                </button>
              </div>
            </footer>
          </div>
        ) : (
          <HeldPreview path={path} renderFooter={footer} />
        )}
      </div>
    </Dialog>
  );
});
