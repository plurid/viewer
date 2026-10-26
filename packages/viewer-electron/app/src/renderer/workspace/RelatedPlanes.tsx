import { useSyncExternalStore } from 'react';
import { ChoiceButton } from '../ui/ChoiceMenu';
import { activeWorkspace, useViewer } from '../state/store';
import { paneTitle } from '../../domain/workspaces/planes';
import { useWorkspace } from './context';

/** A route through related content without changing the authored arrangement. */
export function RelatedPlanes({ id }: { id: string }) {
  const workspace = useWorkspace();
  const related = useSyncExternalStore(workspace.subscribeLinks, () =>
    workspace
      .subtree(id)
      .filter((child) => child !== id && workspace.parentPaneID(child) === id)
      .join('\n'),
  );
  const panes = useViewer((state) => activeWorkspace(state).panes);
  const collections = useViewer((state) => activeWorkspace(state).collections);
  const parent = workspace.parentPaneID(id);
  const ids = [...(parent ? [parent] : []), ...related.split('\n').filter(Boolean)];
  const choices = ids.flatMap((value) => {
    const pane = panes.find((pane) => pane.id === value);
    return pane
      ? [
          {
            value,
            label: `${value === parent ? 'Parent' : 'Child'} · ${paneTitle(pane, pane.type === 'collection' ? collections?.find((item) => item.id === pane.collectionID)?.name : undefined)}`,
            detail: pane.type === 'browser' ? pane.url : pane.path,
          },
        ]
      : [];
  });
  if (!choices.length) return null;
  return (
    <ChoiceButton
      label="Related planes"
      icon="link"
      className="plane-related"
      value=""
      choices={choices}
      placeholder={String(choices.length)}
      onChoose={(id) => workspace.focusPane(id, { activate: true })}
    />
  );
}
