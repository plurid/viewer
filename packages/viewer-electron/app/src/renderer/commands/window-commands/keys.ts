import { activeWorkspace, getState } from '../../state/store';
import { nearestPlane, nextPlane, visiblePlanes, type PlaneDirection } from '../../keys/planes';
import { startPlaneHints } from '../../keys/PlaneHints';
import { showKeymapHelp } from '../../keys/sequences';
import { macroRecording, startMacro, stopMacro } from '../../keys/macro';
import type { CommandDefinition } from '../registry';
import type { WindowScopes } from './scope';

/**
 * Moving the keys between planes without the pointer: hints, tmux's direction keys,
 * the next plane, and the workspaces in turn. A plane on screen becomes active where it is.
 */
export function keysCommands({ actions, state, windowScope }: WindowScopes): CommandDefinition[] {
  const activate = (paneID: string | undefined) => {
    if (paneID) actions.workspace.focusPane(paneID, { activate: true, frame: false });
  };
  const direction = (
    id: string,
    label: string,
    to: PlaneDirection,
    alias: string,
  ): CommandDefinition => ({
    id,
    label,
    group: 'Plane',
    icon: to === 'left' ? 'left' : to === 'right' ? 'right' : to === 'up' ? 'up' : 'down',
    aliases: [alias, 'pane', 'focus'],
    when: windowScope,
    run: () => activate(nearestPlane(visiblePlanes(), getState().activePane, to)),
  });
  const workspaces = state.saved.workspaces;
  const step = (delta: number) => {
    const index = workspaces.findIndex((workspace) => workspace.id === activeWorkspace().id);
    const next = workspaces[(index + delta + workspaces.length) % workspaces.length];
    return next && next.id !== activeWorkspace().id ? actions.switchWorkspace(next.id) : undefined;
  };
  return [
    {
      id: 'plane-hints',
      label: 'Jump to plane…',
      group: 'Plane',
      icon: 'frame',
      aliases: ['hints', 'jump', 'vimium', 'pick plane'],
      when: (context) => windowScope(context) && actions.ready,
      run: () => {
        startPlaneHints((paneID) => activate(paneID));
      },
    },
    direction('focus-left', 'Plane to the left', 'left', 'h'),
    direction('focus-right', 'Plane to the right', 'right', 'l'),
    direction('focus-up', 'Plane above', 'up', 'k'),
    direction('focus-down', 'Plane below', 'down', 'j'),
    {
      id: 'focus-next-plane',
      label: 'Next plane',
      group: 'Plane',
      icon: 'right',
      aliases: ['cycle', 'other plane'],
      when: windowScope,
      run: () => activate(nextPlane(visiblePlanes(), getState().activePane)),
    },
    {
      id: 'next-workspace',
      label: 'Next workspace',
      group: 'Workspaces',
      icon: 'right',
      aliases: ['nw', 'workspace'],
      when: (context) => windowScope(context) && workspaces.length > 1,
      run: () => step(1),
    },
    {
      id: 'previous-workspace',
      label: 'Previous workspace',
      group: 'Workspaces',
      icon: 'left',
      aliases: ['pw', 'workspace'],
      when: (context) => windowScope(context) && workspaces.length > 1,
      run: () => step(-1),
    },
    {
      id: 'record-macro',
      label: macroRecording() ? 'Stop recording macro' : 'Record macro',
      group: 'App',
      icon: 'play',
      aliases: ['macro', 'record', 'sequence', 'q'],
      when: windowScope,
      run: () => {
        if (!macroRecording()) {
          startMacro();
          return;
        }
        const commands = stopMacro();
        if (commands.length) actions.saveMacro(commands);
      },
    },
    {
      id: 'keymap-help',
      label: 'Show key sequences',
      group: 'App',
      icon: 'command',
      aliases: ['which key', 'keymap', 'prefix', 'tmux', 'keys'],
      when: windowScope,
      run: showKeymapHelp,
    },
  ];
}
