import { useCallback, useState } from 'react';
import type { PluridPlaneChromeContext, TreePlane } from '@plurid/plurid-data';
import {
  activeWorkspace,
  refreshClipboard,
  report,
  setActivePane,
  useViewer,
} from '../state/store';
import { useCommands, useCommandRevision } from '../commands/context';
import type { CommandRequest } from '../commands/registry';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/primitives';
import { ContextMenu } from '../ui/ContextMenu';
import { setPreviewControlsSlot } from '../previews/controls';

export function PlaneHeader({ context }: { context: PluridPlaneChromeContext }) {
  const node = context.treePlane as TreePlane;
  const id = node.routeDivisions.plane.parameters.id || node.routeDivisions.path.parameters.id;
  const pane = useViewer((state) => activeWorkspace(state).panes.find((item) => item.id === id));
  const registry = useCommands();
  useCommandRevision();
  const [menu, setMenu] = useState<{ x: number; y: number; request: CommandRequest } | null>(null);
  const slot = useCallback(
    (element: HTMLDivElement | null) => setPreviewControlsSlot(id, element),
    [id],
  );
  const request: CommandRequest = {
    paneID: id,
    scope: pane?.type === 'folder' ? 'folder' : 'preview',
    context: { paneID: id, selection: [], path: pane?.path },
  };
  const available = registry.list(request);
  const run = (command: string) => {
    setActivePane(id);
    void registry.invoke(command, request).catch(report);
  };
  const openMenu = (event: React.MouseEvent<HTMLButtonElement>, ids?: string[]) => {
    setActivePane(id);
    void refreshClipboard().catch(report);
    const rect = event.currentTarget.getBoundingClientRect();
    const target = registry.context(id);
    setMenu({
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
      {pane?.type === 'folder' && (
        <div className="plane-navigation">
          <IconButton
            icon="left"
            label="Back"
            disabled={!available.some((item) => item.id === 'back')}
            onClick={() => run('back')}
          />
          <IconButton
            icon="right"
            label="Forward"
            disabled={!available.some((item) => item.id === 'forward')}
            onClick={() => run('forward')}
          />
        </div>
      )}
      <span
        className="plane-heading"
        data-plurid-drag-handle
        title={pane?.path}
        onDoubleClick={() => {
          if (pane?.type === 'folder') run('path');
        }}
      >
        <Icon name={pane?.type === 'folder' ? 'folder' : 'file'} size={16} />
        <span className="plane-title">
          {pane?.path.split(/[\\/]/).pop() || pane?.path || 'Plane'}
        </span>
      </span>
      {pane?.type === 'folder' ? (
        <>
          <button
            className="plane-view-button"
            aria-label="View mode"
            aria-haspopup="dialog"
            onClick={(event) =>
              openMenu(event, ['view-list', 'view-grid', 'view-columns', 'view-gallery'])
            }
          >
            <Icon name={pane.mode} size={17} />
            <Icon name="down" size={10} />
          </button>
          <IconButton icon="search" label="Search this folder" onClick={() => run('search')} />
        </>
      ) : (
        <div className="plane-module-controls" ref={slot} />
      )}
      <IconButton
        icon="more"
        label={pane?.type === 'folder' ? 'Folder actions' : 'Preview actions'}
        aria-haspopup="dialog"
        onClick={(event) => openMenu(event)}
      />
      <IconButton icon="close" label="Close plane" onClick={() => run('close-plane')} />
      {menu && (
        <ContextMenu
          position={menu}
          request={menu.request}
          onClose={() => setMenu(null)}
          label="Plane actions"
        />
      )}
    </div>
  );
}
