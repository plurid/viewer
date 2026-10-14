import { useCallback, useState, type RefObject } from 'react';
import type { PluridApplicationHandle } from '@plurid/plurid-react';
import type { PluridPlaneChromeContext, TreePlane } from '@plurid/plurid-data';
import {
  activeWorkspace,
  refreshClipboard,
  report,
  setActivePane,
  useViewer,
} from '../state/store';
import { focusFiles } from './sessions';
import { useCommands, useCommandRevision } from '../commands/context';
import type { CommandRequest } from '../commands/registry';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/primitives';
import { ContextMenu } from '../ui/ContextMenu';
import { setPreviewControlsSlot } from '../previews/controls';

export function PlaneHeader({
  context,
  engine,
}: {
  context: PluridPlaneChromeContext;
  engine: RefObject<PluridApplicationHandle | null>;
}) {
  const node = context.treePlane as TreePlane;
  const id = node.routeDivisions.plane.parameters.id || node.routeDivisions.path.parameters.id;
  const pane = useViewer((state) => activeWorkspace(state).panes.find((item) => item.id === id));
  const collection = useViewer((state) =>
    activeWorkspace(state).collections?.find(
      (value) => pane?.type === 'collection' && value.id === pane.collectionID,
    ),
  );
  const dragging = useViewer((state) => state.saved.ui.space.dragging);
  const controls = useViewer((state) => state.saved.ui.space.headerControls);
  const registry = useCommands();
  useCommandRevision(id);
  const [menu, setMenu] = useState<{
    kind: 'view' | 'actions';
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
        if (!['search', 'close-plane'].includes(command)) focusFiles(id);
      })
      .catch(report);
  };
  const openMenu = (event: React.MouseEvent<HTMLButtonElement>, ids?: string[]) => {
    const kind = ids ? 'view' : 'actions';
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
    <div className="plane-controls" data-viewer-plane={id} onPointerDown={() => setActivePane(id)}>
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
          const api = engine.current;
          if (api && !api.selection.get().includes(node.planeID)) api.selection.set([node.planeID]);
          setActivePane(id);
        }}
        title={pane?.path}
        onDoubleClick={() => {
          if (pane?.type === 'folder') run('path');
        }}
      >
        <Icon
          name={
            pane?.type === 'folder' ? 'folder' : pane?.type === 'terminal' ? 'terminal' : 'file'
          }
          size={16}
        />
        <span className="plane-title">
          {pane?.type === 'collection'
            ? (collection?.name ?? 'Collection')
            : pane?.type === 'search'
              ? pane.name
              : pane?.type === 'terminal'
                ? 'Terminal · ' + (pane.path.split(/[\\/]/).pop() || pane.path)
                : pane?.path.split(/[\\/]/).pop() || pane?.path || 'Plane'}
        </span>
      </span>
      {pane?.type === 'folder' ? (
        <>
          {controls.view && (
            <button
              className="plane-view-button"
              aria-label="View mode"
              aria-haspopup="dialog"
              aria-expanded={menu?.kind === 'view'}
              onClick={(event) =>
                openMenu(event, ['view-list', 'view-grid', 'view-columns', 'view-gallery'])
              }
            >
              <Icon name={pane.mode} size={17} />
              <Icon name="down" size={10} />
            </button>
          )}
          {controls.search && (
            <IconButton
              icon="search"
              label={registry.context(id)?.searchOpen ? 'Close search' : 'Search this folder'}
              aria-pressed={!!registry.context(id)?.searchOpen}
              onClick={() => run('search')}
            />
          )}
        </>
      ) : (
        <div className="plane-module-controls" ref={slot} />
      )}
      {(controls.frame || controls.dock) && (
        <div className="plane-spatial-controls">
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
          label="Plane actions"
        />
      )}
    </div>
  );
}
