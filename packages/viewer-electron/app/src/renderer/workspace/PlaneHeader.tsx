import { useCallback, useState, useSyncExternalStore } from 'react';
import { gitActionLabels } from '../../domain/comparison/git-actions';
import type { PluridPlaneChromeContext, TreePlane } from '@plurid/plurid-data';
import {
  activeWorkspace,
  refreshClipboard,
  report,
  setActivePane,
  useFolderPresentation,
  useViewer,
} from '../state/store';
import { activeLens, useLenses } from '../state/lenses';
import { lensMenuIDs } from '../commands/lenses';
import { planeLayoutCommandIDs } from '../../domain/workspaces/plane-layout';
import { focusFiles } from './sessions';
import { useCommands, useCommandRevision } from '../commands/context';
import type { CommandRequest } from '../commands/registry';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/primitives';
import { ContextMenu } from '../ui/ContextMenu';
import { setPreviewControlsSlot } from '../previews/controls';
import { useWorkspace } from './context';
import { baseName } from '../../domain/workspaces/planes';
import { hostID } from './tree';
import { buffersGeneration, heldBuffer, subscribeBuffers } from '../editing/buffers';
import { GitBranch } from '../git/status';
import { RelatedPlanes } from './RelatedPlanes';

/** Chooses and edits a folder's lenses; shown once the folder has one, and on the Map. */
function LensButton({
  path,
  map,
  open,
  onOpen,
}: {
  path: string;
  map: boolean;
  open: boolean;
  onOpen(event: React.MouseEvent<HTMLButtonElement>, ids: string[]): void;
}) {
  const { data } = useLenses(path);
  const presentation = useFolderPresentation(path);
  if (!data?.lenses.length && !map) return null;
  const current = activeLens(data, {
    group: map ? 'lens' : presentation.group,
    lens: presentation.lens,
  });
  return (
    <button
      className="plane-view-button plane-lens-button"
      aria-label={current ? `Lens: ${current.lens.name}` : 'Lenses'}
      title={current ? `Lens: ${current.lens.name}` : 'Lenses'}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={(event) => onOpen(event, lensMenuIDs(data))}
    >
      <Icon name="lens" size={15} />
      {current && <span>{current.lens.name}</span>}
      <Icon name="down" size={10} />
    </button>
  );
}
export function PlaneHeader({ context }: { context: PluridPlaneChromeContext }) {
  const workspace = useWorkspace();
  const node = context.treePlane as TreePlane;
  const id = hostID(node);
  const pane = useViewer((state) => activeWorkspace(state).panes.find((item) => item.id === id));
  const partner = useViewer((state) => {
    const panes = activeWorkspace(state).panes;
    const other =
      pane?.type === 'folder' && pane.pair
        ? panes.find((item) => item.id === pane.pair)
        : undefined;
    return other?.type === 'folder' && other.pair === id ? other : undefined;
  });
  const collection = useViewer((state) =>
    activeWorkspace(state).collections?.find(
      (value) => pane?.type === 'collection' && value.id === pane.collectionID,
    ),
  );
  // a dot for text not saved: a file's edits, or a scratch plane's text
  useSyncExternalStore(subscribeBuffers, buffersGeneration);
  const unsaved =
    pane?.type === 'scratch'
      ? !!heldBuffer(pane.bufferID)?.text
      : (pane?.type === 'preview' || pane?.type === 'diff') && !!pane.bufferID;
  const dragging = useViewer((state) => state.saved.ui.space.dragging);
  const controls = useViewer((state) => state.saved.ui.space.headerControls);
  const registry = useCommands();
  useCommandRevision(id);
  const [menu, setMenu] = useState<{
    kind: 'view' | 'actions' | 'lens' | 'layout';
    anchor: HTMLButtonElement;
    x: number;
    y: number;
    request: CommandRequest;
  } | null>(null);
  const slot = useCallback(
    (element: HTMLDivElement | null) => setPreviewControlsSlot(id, element),
    [id],
  );
  const request: CommandRequest = {
    paneID: id,
    scope:
      pane?.type === 'folder'
        ? 'folder'
        : pane?.type === 'search' || pane?.type === 'collection'
          ? 'files'
          : 'preview',
    context: { paneID: id, selection: [], path: pane?.path },
  };
  const available = registry.list(request);
  const run = (command: string) => {
    setActivePane(id);
    void registry
      .invoke(command, request)
      .then(() => {
        // text commands leave the focus in the editor
        if (
          ![
            'search',
            'close-plane',
            'parent-plane',
            'edit-file',
            'save-file',
            'save-file-as',
            'revert-file',
            'done-editing',
          ].includes(command)
        )
          focusFiles(id);
      })
      .catch(report);
  };
  const openMenu = (
    event: React.MouseEvent<HTMLButtonElement>,
    ids?: string[],
    kind: 'view' | 'actions' | 'lens' | 'layout' = ids ? 'view' : 'actions',
  ) => {
    if (menu?.kind === kind) {
      setMenu(null);
      return;
    }
    setActivePane(id);
    void refreshClipboard(true);
    const rect = event.currentTarget.getBoundingClientRect();
    const target = registry.context(id);
    setMenu({
      kind,
      anchor: event.currentTarget,
      x: rect.left,
      y: rect.bottom + 5,
      request: {
        ...request,
        context: target ?? request.context,
        scope: target?.selection.length ? 'files' : request.scope,
        ids,
      },
    });
  };
  return (
    <div
      className="plane-controls"
      data-viewer-plane={id}
      data-scroll-selected={context.scrollSelected || undefined}
      onPointerDown={() => setActivePane(id)}
    >
      {controls.parent && available.some((item) => item.id === 'parent-plane') && (
        <IconButton
          icon="parent-plane"
          label="Back to parent plane"
          onClick={() => run('parent-plane')}
        />
      )}
      <RelatedPlanes id={id} />
      {pane?.type === 'folder' && (controls.sidebar || controls.back || controls.forward) && (
        <div className="plane-navigation">
          {controls.sidebar && (
            <IconButton
              icon="sidebar"
              label={
                pane.sidebar?.visible !== false ? 'Hide plane navigation' : 'Show plane navigation'
              }
              aria-pressed={pane.sidebar?.visible !== false}
              onClick={() => run('plane-sidebar')}
            />
          )}
          {controls.back && (
            <IconButton
              icon="left"
              label="Back"
              disabled={!available.some((item) => item.id === 'back')}
              onClick={() => run('back')}
            />
          )}
          {controls.forward && (
            <IconButton
              icon="right"
              className="plane-forward"
              label="Forward"
              disabled={!available.some((item) => item.id === 'forward')}
              onClick={() => run('forward')}
            />
          )}
        </div>
      )}
      <span
        className="plane-heading"
        data-plurid-drag-handle={dragging ? '' : undefined}
        data-dragging={dragging}
        onPointerDownCapture={(event) => {
          if (event.button !== 0 || !dragging) return;
          // The engine evaluates this press on its native bubble listener. Select first,
          // keeping a deliberate multi-selection when this plane already belongs to it.
          workspace.selectForDrag(id);
          setActivePane(id);
        }}
        title={pane?.path}
        onDoubleClick={() => {
          if (pane?.type === 'folder') run('path');
        }}
      >
        <Icon
          name={
            pane?.type === 'folder'
              ? 'folder'
              : pane?.type === 'terminal'
                ? 'terminal'
                : pane?.type === 'server'
                  ? 'code'
                  : 'file'
          }
          size={16}
        />
        <span className="plane-title">
          {pane?.type === 'media'
            ? 'Edit media · ' + baseName(pane.path)
            : pane?.type === 'browser'
              ? pane.title || new URL(pane.url).hostname
              : pane?.type === 'scratch'
                ? (pane.title ?? 'Untitled')
                : pane?.type === 'journal'
                  ? 'Journal'
                  : pane?.type === 'chat'
                    ? 'Chat'
                    : pane?.type === 'server'
                      ? 'Server · ' + baseName(pane.path)
                      : pane?.type === 'diff'
                        ? 'Compare · ' + baseName(pane.path)
                        : pane?.type === 'git-changes'
                          ? 'Git changes · ' + baseName(pane.path)
                          : pane?.type === 'collection'
                            ? (collection?.name ?? 'Collection')
                            : pane?.type === 'search'
                              ? pane.name
                              : pane?.type === 'terminal'
                                ? (pane.gitAction
                                    ? 'Git ' + gitActionLabels[pane.gitAction]
                                    : 'Terminal') +
                                  ' · ' +
                                  baseName(pane.path)
                                : (pane && baseName(pane.path)) || 'Plane'}
        </span>
        {unsaved && (
          <span className="plane-unsaved" role="img" aria-label="Unsaved" title="Unsaved" />
        )}
        {partner && (
          // a commander's pair (2026-10-24): which plane ⌃⌘C copies to
          <span
            className="plane-pair"
            role="img"
            aria-label={`Paired with ${baseName(partner.path)}`}
            title={`Paired with ${baseName(partner.path)}: ⌃⌘C copies there, ⌃⌘X moves${
              pane?.type === 'folder' && pane.pairSync ? '; they follow each other' : ''
            }`}
          >
            {pane?.type === 'folder' && pane.pairSync ? '⇉' : '⇄'}
          </span>
        )}
      </span>
      {pane?.type === 'folder' ? (
        <>
          <GitBranch path={pane.path} paneID={pane.id} />
          {controls.view && (
            <button
              className="plane-view-button"
              aria-label="View mode"
              aria-haspopup="dialog"
              aria-expanded={menu?.kind === 'view'}
              onClick={(event) =>
                openMenu(event, [
                  'view-list',
                  'view-grid',
                  'view-columns',
                  'view-gallery',
                  'view-map',
                  'view-side-by-side',
                  'view-stacked',
                ])
              }
            >
              <Icon name={pane.mode} size={17} />
              <Icon name="down" size={10} />
            </button>
          )}
          <LensButton
            path={pane.path}
            map={pane.mode === 'map'}
            open={menu?.kind === 'lens'}
            onOpen={(event, ids) => openMenu(event, ids, 'lens')}
          />
          {controls.search && (
            <IconButton
              icon="search"
              className="plane-search-button"
              label={registry.context(id)?.searchOpen ? 'Close search' : 'Search this folder'}
              aria-pressed={!!registry.context(id)?.searchOpen}
              onClick={() => run('search')}
            />
          )}
        </>
      ) : (
        <div className="plane-module-controls" ref={slot} />
      )}
      {(controls.frame || controls.dock || controls.actions) && (
        <div className="plane-spatial-controls">
          {controls.actions && (
            <IconButton
              icon="resize"
              label="Size & position"
              aria-haspopup="dialog"
              aria-expanded={menu?.kind === 'layout'}
              onClick={(event) => openMenu(event, planeLayoutCommandIDs, 'layout')}
            />
          )}
          {controls.frame && (
            <IconButton icon="frame" label="Frame plane" onClick={() => run('frame-plane')} />
          )}
          {controls.dock && (
            <IconButton
              icon="dock"
              label={available.find((item) => item.id === 'dock')?.label ?? 'Dock plane'}
              onClick={() => run('dock')}
            />
          )}
        </div>
      )}
      {controls.actions && (
        <IconButton
          icon="more"
          label={
            pane?.type === 'folder'
              ? 'Folder actions'
              : pane?.type === 'search'
                ? 'Search actions'
                : pane?.type === 'terminal'
                  ? 'Terminal actions'
                  : pane?.type === 'journal'
                    ? 'Journal actions'
                    : pane?.type === 'server'
                      ? 'Server actions'
                      : 'Preview actions'
          }
          aria-haspopup="dialog"
          aria-expanded={menu?.kind === 'actions'}
          onClick={(event) => openMenu(event)}
        />
      )}
      {controls.close && (
        <IconButton icon="close" label="Close plane" onClick={() => run('close-plane')} />
      )}
      {menu && (
        <ContextMenu
          key={menu.kind}
          position={menu}
          request={menu.request}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          label={menu.kind === 'layout' ? 'Size & position' : 'Plane actions'}
        />
      )}
    </div>
  );
}
