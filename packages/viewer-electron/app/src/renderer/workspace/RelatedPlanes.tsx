import { useSyncExternalStore } from 'react';
import { ChoiceButton } from '../ui/ChoiceMenu';
import { activeWorkspace, useViewer } from '../state/store';
import { baseName } from '../../domain/workspaces/planes';
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
  const parent = workspace.parentPaneID(id);
  const ids = [...(parent ? [parent] : []), ...related.split('\n').filter(Boolean)];
  const choices = ids.flatMap((value) => {
    const pane = panes.find((pane) => pane.id === value);
    return pane
      ? [
          {
            value,
            label: `${value === parent ? 'Parent' : pane.type === 'server' ? 'Server' : 'Child'} · ${baseName(pane.path)}`,
          },
        ]
      : [];
  });
  if (!choices.length) return null;
  return (
    <ChoiceButton
      label="Related planes"
      value=""
      choices={choices}
      placeholder={`Related (${choices.length})`}
      onChoose={(id) => workspace.focusPane(id, { activate: true })}
    />
  );
}
