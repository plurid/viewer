import { effectiveWindowUI } from '../../state/effective-ui';
import { changeSetting } from './settings';
import { activeWorkspace, announce, changeWorkspace, getState } from '../../state/store';
import { copyPathCommand } from '../copy-path';
import type { CommandDefinition } from '../registry';
import { requestProject, type ProjectCommand } from '../../workspace/projects';
import type { WindowScopes } from './scope';

/** Projects, opening places, the palette, settings and navigation chrome. */
export function navigationCommands({
  actions,
  state,
  space,
  windowScope,
  paneScope,
  sidebar,
}: WindowScopes): CommandDefinition[] {
  const ui = effectiveWindowUI(state);
  const commands: CommandDefinition[] = [
    {
      id: 'new-native-window',
      label: 'New window',
      group: 'Window',
      icon: 'plus',
      aliases: ['independent window'],
      when: windowScope,
      run: () => window.viewer.newWindow(),
    },
    {
      id: 'restore-window',
      label: 'Restore normal window placement',
      group: 'Window',
      icon: 'frame',
      aliases: ['drop down', 'hotkey window'],
      when: windowScope,
      run: () => window.viewer.restoreWindow(),
    },
    ...(
      [
        ['create', 'Create project…'],
        ['open', 'Open project…'],
        ['save', 'Save project'],
        ['reload', 'Reload project…'],
        ['close', 'Close project'],
        ['arrangements', 'Saved arrangements…'],
        ['bindings', 'Project folders…'],
      ] as [ProjectCommand, string][]
    ).map(([command, label]) => ({
      id: 'project-' + command,
      label,
      group: 'Project',
      icon: 'folder' as const,
      aliases:
        command === 'close'
          ? ['close project', 'exit project', 'leave project']
          : ['project', command],
      when: () => actions.ready && (['create', 'open'].includes(command) || !!space.project),
      run: () => requestProject(command),
    })),
    {
      id: 'volumes',
      label: 'Volumes…',
      group: 'Navigation',
      icon: 'drive',
      aliases: ['disks', 'drives', 'eject', 'mounts'],
      when: () => state.bootstrap.platform === 'darwin',
      run: () => {
        window.dispatchEvent(new Event('viewer:volumes'));
      },
    },
    {
      ...copyPathCommand,
      when: (context) =>
        ['preview', 'sidebar'].includes(context.scope) && copyPathCommand.when(context),
    },
    {
      id: 'new-root-folder',
      label: 'New folder plane',
      group: 'Plane',
      icon: 'plus',
      aliases: ['np', 'new plane', 'add plane', 'root'],
      shortcut: '⌘N',
      primary: true,
      when: (context) =>
        ['window', 'workspace', 'folder', 'files', 'preview'].includes(context.scope) &&
        actions.ready &&
        space.panes.length < 200,
      run: (context) =>
        actions.workspace.newRootFolder({
          paneID: context.paneID,
          workspaceID: context.workspaceID,
        }),
    },
    {
      id: 'palette',
      label: 'Commands…',
      group: 'App',
      icon: 'command',
      shortcut: '⌘K',
      when: windowScope,
      run: () => actions.palette('commands'),
    },
    {
      id: 'command-line',
      label: 'Command line…',
      group: 'App',
      icon: 'command',
      aliases: [':', 'ex', 'vim', 'command prompt'],
      when: windowScope,
      run: () => actions.palette('line'),
    },
    {
      id: 'ask-in-words',
      label: 'Ask in words…',
      group: 'App',
      icon: 'command',
      aliases: ['>', 'prompt', 'ai', 'model', 'natural language'],
      when: windowScope,
      run: () => actions.palette('prompt'),
    },
    {
      id: 'palette-settings',
      label: 'Search settings…',
      group: 'App',
      icon: 'settings',
      aliases: ['settings', 'preferences', 'options', 'configure'],
      when: windowScope,
      run: () => actions.palette('settings'),
    },
    {
      id: 'find-file',
      label: 'Find file…',
      group: 'Navigation',
      icon: 'search',
      aliases: ['ff', 'find'],
      shortcut: '⌘F',
      primary: true,
      when: windowScope,
      run: () => actions.palette('files'),
    },
    {
      id: 'choose-folder',
      label: 'Open folder…',
      group: 'Navigation',
      icon: 'folder',
      aliases: ['of'],
      shortcut: '⇧⌘O',
      primary: true,
      when: windowScope,
      run: async () => {
        const path = await window.viewer.chooseFolder();
        if (path) await actions.workspace.openPath(path);
      },
    },
    {
      id: 'settings',
      label: 'Settings…',
      group: 'App',
      icon: 'settings',
      aliases: ['st', 'preferences', 'appearance', 'minimap', 'viewcube'],
      shortcut: '⌘,',
      when: windowScope,
      run: actions.settings,
    },
    {
      id: 'install-viewer-cli',
      label: 'Install Viewer CLI',
      group: 'App',
      icon: 'terminal',
      aliases: ['install viewer', 'install cli', 'shell command', 'terminal launcher', 'PATH'],
      detail: 'Create ~/.local/bin/viewer to open files and folders from your terminal.',
      when: windowScope,
      run: async () => {
        const status = await window.viewer.shellCommand('install');
        if (status.problem) throw new Error(status.problem);
        if (!status.installed) throw new Error('The Viewer CLI could not be installed.');
        if (status.executable === false)
          throw new Error(
            'The Viewer CLI exists but is not executable. Open Settings → Navigation to review it.',
          );
        announce(
          'Viewer CLI is ready. Run viewer . in your terminal, or ~/.local/bin/viewer . if it is not on PATH.',
        );
      },
    },
    {
      id: 'toggle-sidebar',
      label: ui.sidebar.visible ? 'Hide window navigation' : 'Show window navigation',
      group: 'View',
      icon: 'sidebar',
      aliases: ['sb', 'window sidebar'],
      shortcut: '⌥⌘S',
      when: (context) => windowScope(context) || (sidebar(context) && !context.paneID),
      run: () =>
        changeSetting('ui.sidebar.visible', !effectiveWindowUI(getState()).sidebar.visible),
    },
    {
      id: 'toggle-titlebar',
      label: ui.titlebar.visible ? 'Hide title bar' : 'Show title bar',
      group: 'View',
      icon: 'frame',
      aliases: ['title bar', 'titlebar', 'chrome', 'toolbar', 'tb'],
      shortcut: '⌥⌘T',
      when: windowScope,
      run: () =>
        changeSetting('ui.titlebar.visible', !effectiveWindowUI(getState()).titlebar.visible),
    },
    {
      id: 'plane-sidebar',
      label: (context) =>
        context.folder?.sidebar?.visible !== false
          ? 'Hide plane navigation'
          : 'Show plane navigation',
      group: 'Plane',
      icon: 'sidebar',
      aliases: ['ps', 'sidebar', 'navigation'],
      when: (context) => paneScope(context) && !!context.folder,
      run: async (context) => {
        const pane = activeWorkspace().panes.find((pane) => pane.id === context.paneID);
        if (pane?.type !== 'folder') return;
        const owner = activeWorkspace().id;
        const visible = pane.sidebar?.visible === false;
        await changeSetting('ui.sidebar.inNewPlanes', visible);
        if (activeWorkspace().id !== owner) return;
        changeWorkspace((space) => ({
          ...space,
          panes: space.panes.map((pane) =>
            pane.type === 'folder'
              ? { ...pane, sidebar: { visible, width: pane.sidebar?.width ?? 210 } }
              : pane,
          ),
        }));
      },
    },
  ];
  commands.push({
    id: 'connect-server',
    label: 'Connect to server…',
    group: 'Navigation',
    icon: 'folder',
    aliases: ['smb', 'network share', 'mount server'],
    when: windowScope,
    run: actions.connectServer,
  });
  commands.push({
    id: 'find-tagged',
    label: 'Find files with tag…',
    group: 'Navigation',
    icon: 'search',
    aliases: ['tags', 'tagged files', 'finder tag', 'label'],
    when: (context) =>
      windowScope(context) && actions.ready && state.bootstrap.platform === 'darwin',
    run: actions.findTagged,
  });
  if (!space.panes.some((pane) => pane.id === state.activePane && pane.type === 'folder'))
    commands.push({
      id: 'go-to',
      label: 'Go to folder…',
      group: 'Navigation',
      icon: 'folder',
      shortcut: '⌘L',
      when: windowScope,
      run: actions.goTo,
    });
  return commands;
}
