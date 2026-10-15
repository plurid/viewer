import type { CommandDefinition } from '../registry';
import type { WindowScopes } from './scope';

/** Preview plane commands. */
export function previewsCommands({ actions, space, paneScope }: WindowScopes): CommandDefinition[] {
  const commands: CommandDefinition[] = [
    {
      id: 'open-default',
      label: 'Open in Default App',
      group: 'Preview',
      icon: 'external',
      when: (context) =>
        paneScope(context) &&
        space.panes.find((pane) => pane.id === context.paneID)?.type === 'preview',
      run: (context) =>
        window.viewer.openExternal(space.panes.find((pane) => pane.id === context.paneID)!.path),
    },
    {
      id: 'open-with',
      label: 'Open With…',
      group: 'Preview',
      icon: 'external',
      aliases: ['ow', 'application'],
      when: (context) =>
        paneScope(context) &&
        space.panes.find((pane) => pane.id === context.paneID)?.type === 'preview',
      run: (context) =>
        actions.openWith([space.panes.find((pane) => pane.id === context.paneID)!.path]),
    },
    {
      id: 'preview-reveal',
      label: 'Reveal in Finder',
      group: 'Preview',
      icon: 'folder',
      when: (context) =>
        paneScope(context) &&
        space.panes.find((pane) => pane.id === context.paneID)?.type === 'preview',
      run: (context) =>
        window.viewer.reveal(space.panes.find((pane) => pane.id === context.paneID)!.path),
    },
  ];
  return commands;
}
