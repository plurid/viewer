import type { Pane } from '../../domain/contracts';
import { toolbarCommands } from '../../domain/preferences/toolbars';
import { useCommands, useCommandRevision } from './context';
import { report, setActivePane, useViewer } from '../state/store';
import { toolbarKind, toolbarRequest } from './toolbar';
import { IconButton } from '../ui/primitives';
import type { CommandRequest } from './registry';
import './capabilities.css';

export function PinnedTools({ pane, scope }: { pane: Pane; scope: CommandRequest['scope'] }) {
  const registry = useCommands();
  useCommandRevision(pane.id);
  const toolbars = useViewer((state) => state.settings.settings.toolbars);
  const kind = toolbarKind(pane)!;
  const target = registry.context(pane.id);
  const request = toolbarRequest(pane, target, scope);
  const pins = toolbarCommands(toolbars, kind);
  const commands = registry.discover({ ...request, ids: pins });
  return (
    <>
      {pins.length > 0 && (
        <div className="plane-pinned-tools" role="group" aria-label="Pinned tools">
          {pins.map((id) => {
            const command = commands.find((item) => item.id === id);
            const label = command?.label ?? `Missing action: ${id}`;
            return (
              <IconButton
                key={id}
                icon={command?.icon ?? 'command'}
                label={label}
                title={
                  command?.unavailable ??
                  (command
                    ? label
                    : 'Missing action. Open “What can I do here?” to repair this pin.')
                }
                disabled={!command?.available}
                onClick={() => {
                  if (command?.available) {
                    setActivePane(pane.id);
                    void registry.run(command).catch(report);
                  }
                }}
              />
            );
          })}
        </div>
      )}
      <IconButton
        icon="info"
        label="What can I do here?"
        onClick={() => {
          setActivePane(pane.id);
          void registry.invoke('capabilities', request).catch(report);
        }}
      />
    </>
  );
}
