import { usePluridApi } from '@plurid/plurid-react';
import type { PluridPinnedChromeContext } from '@plurid/plurid-data';
import { paneTitle } from '../../domain/workspaces/planes';
import { activeWorkspace, report, setActivePane, useViewer } from '../state/store';
import { IconButton } from '../ui/primitives';
import { useWorkspace } from './context';
import { flattenTree, hostID } from './tree';

/** A pinned view has the same identity and close policy as its spatial plane. */
export function PinnedHeader({ context }: { context: PluridPinnedChromeContext }) {
  const api = usePluridApi();
  const workspace = useWorkspace();
  const node = flattenTree(api.getSnapshot().space.tree).find(
    (item) => item.planeID === context.planeID,
  );
  const id = node ? hostID(node) : '';
  const pane = useViewer((state) => activeWorkspace(state).panes.find((item) => item.id === id));
  const title = pane ? paneTitle(pane) : context.title;
  return (
    <div
      className="pinned-plane-controls"
      data-viewer-pane={id}
      onPointerDown={() => setActivePane(id)}
    >
      <span className="plane-title" title={title}>
        {title}
      </span>
      <IconButton
        icon={context.collapsed ? 'down' : 'up'}
        label={context.collapsed ? 'Expand pinned plane' : 'Collapse pinned plane'}
        aria-expanded={!context.collapsed}
        data-plurid-control="pinned-collapse"
        onClick={() => context.collapse()}
      />
      <IconButton
        icon="planes"
        label="Place plane in space"
        data-plurid-control="pinned-place"
        onClick={() => {
          void workspace
            .placePane(id)
            .then((result) => {
              if (result === 'refused') throw new Error('The plane could not be placed in space.');
            })
            .catch(report);
        }}
      />
      <IconButton
        icon="close"
        label="Close plane"
        data-plurid-control="pinned-close"
        onClick={() => {
          try {
            workspace.closePane(id);
          } catch (error) {
            report(error);
          }
        }}
      />
    </div>
  );
}
