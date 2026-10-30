import { Menu, app, dialog, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { ApplicationSettings } from '../../domain/services';
import { defaultShortcuts, accelerator, menuShortcuts } from '../../domain/preferences/shortcuts';
import { planeAlignments, planeSizePresets } from '../../domain/workspaces/plane-layout';

/** A page of the guides as released with this version: the source at its tag, such as v1.0.0. */
const guide = (page: string) =>
  `https://github.com/plurid/viewer/blob/v${app.getVersion()}/docs/${page}`;

/**
 * Build native menus from the same command IDs and shortcuts as the renderer. `quit` learns
 * whether ⌘Q or a click chose Quit: the key asks for a second press (quit-shortcut.ts).
 */
export function installApplicationMenu(
  settings: ApplicationSettings | undefined,
  command: (id: string) => () => void,
  diagnosticFile: string,
  quit: (byShortcut: boolean) => void,
): void {
  const quitItem: MenuItemConstructorOptions = {
    label: 'Quit Viewer',
    accelerator: 'CmdOrCtrl+Q',
    click: (_item, _window, event) => quit(!!event.triggeredByAccelerator),
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin'
        ? [
            {
              role: 'appMenu' as const,
              submenu: [
                { role: 'about' as const },
                { label: 'Acknowledgements', click: command('acknowledgements') },
                // the App Store updates its edition
                ...(process.mas
                  ? []
                  : [{ label: 'Check for Updates…', click: command('check-for-updates') }]),
                { type: 'separator' as const },
                {
                  label: 'Settings…',
                  accelerator: accelerator(settings?.shortcuts['settings'] ?? 'Cmd+,'),
                  click: command('settings'),
                },
                { type: 'separator' as const },
                { role: 'services' as const },
                { type: 'separator' as const },
                { role: 'hide' as const },
                { role: 'hideOthers' as const },
                { role: 'unhide' as const },
                { type: 'separator' as const },
                quitItem,
              ],
            },
          ]
        : []),
      {
        label: 'File',
        submenu: [
          { label: 'New Window', click: command('new-native-window') },
          { label: 'Create Project…', click: command('project-create') },
          { label: 'Workflows…', click: command('workflows') },
          { label: 'Open Project…', click: command('project-open') },
          { label: 'Save Project', click: command('project-save') },
          { label: 'Reload Project…', click: command('project-reload') },
          { type: 'separator' },
          {
            label: 'New Folder Plane',
            accelerator: accelerator(settings?.shortcuts['new-root-folder'] ?? 'Cmd+N'),
            click: command('new-root-folder'),
          },
          {
            label: 'New Scratch Plane',
            accelerator: accelerator(
              settings?.shortcuts['new-scratch-plane'] ??
                defaultShortcuts['new-scratch-plane'] ??
                '',
            ),
            click: command('new-scratch-plane'),
          },
          {
            label: 'New Terminal Plane',
            accelerator: accelerator(settings?.shortcuts['new-terminal-plane'] ?? ''),
            click: command('new-terminal-plane'),
          },
          { label: 'Start Local Server', click: command('start-local-server') },
          {
            label: 'Open Folder…',
            accelerator: accelerator(
              settings?.shortcuts['choose-folder'] ?? menuShortcuts['choose-folder'] ?? '',
            ),
            click: command('choose-folder'),
          },
          {
            label: 'New Folder…',
            accelerator: accelerator(
              settings?.shortcuts['new-folder'] ?? defaultShortcuts['new-folder'] ?? 'Cmd+Shift+N',
            ),
            click: command('new-folder'),
          },
          {
            label: 'Open Selection',
            accelerator: accelerator(
              settings?.shortcuts['open-selection'] ??
                defaultShortcuts['open-selection'] ??
                'Cmd+O',
            ),
            click: command('open-selection'),
          },
          { label: 'Open in Default App', click: command('open-default') },
          { label: 'Open With…', click: command('open-with') },
          { label: 'Quick Preview', click: command('quick-preview') },
          {
            label: 'Get Info…',
            accelerator: accelerator(
              settings?.shortcuts['info'] ?? defaultShortcuts['info'] ?? 'Cmd+I',
            ),
            click: command('info'),
          },
          { label: 'Calculate Size', click: command('calculate-size') },
          { type: 'separator' },
          {
            label: 'Edit Text',
            accelerator: accelerator(
              settings?.shortcuts['edit-file'] ?? defaultShortcuts['edit-file'] ?? '',
            ),
            click: command('edit-file'),
          },
          {
            label: 'Save',
            accelerator: accelerator(
              settings?.shortcuts['save-file'] ?? defaultShortcuts['save-file'] ?? '',
            ),
            click: command('save-file'),
          },
          {
            label: 'Save As…',
            accelerator: accelerator(
              settings?.shortcuts['save-file-as'] ?? defaultShortcuts['save-file-as'] ?? '',
            ),
            click: command('save-file-as'),
          },
          { label: 'Revert to Saved…', click: command('revert-file') },
          { type: 'separator' },
          {
            label: 'Duplicate',
            accelerator: accelerator(
              settings?.shortcuts['duplicate'] ?? defaultShortcuts['duplicate'] ?? 'Cmd+D',
            ),
            click: command('duplicate'),
          },
          { label: 'Copy To…', click: command('copy-to') },
          { label: 'Move To…', click: command('move-to') },
          {
            label: settings?.browsing.confirmTrash === false ? 'Move to Trash' : 'Move to Trash…',
            accelerator: accelerator(
              settings?.shortcuts['trash'] ?? defaultShortcuts['trash'] ?? 'Cmd+Backspace',
            ),
            click: command('trash'),
          },
          { type: 'separator' },
          { label: 'Recent File Operations', click: command('recent-operations') },
          { type: 'separator' },
          { role: 'close' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          {
            label: 'Undo',
            accelerator: accelerator(
              settings?.shortcuts['undo-file'] ?? menuShortcuts['undo-file'] ?? '',
            ),
            click: command('undo-file'),
          },
          {
            label: 'Redo',
            accelerator: accelerator(
              settings?.shortcuts['redo-file'] ?? menuShortcuts['redo-file'] ?? '',
            ),
            click: command('redo-file'),
          },
          { type: 'separator' },
          {
            label: 'Cut',
            accelerator: accelerator(
              settings?.shortcuts['cut'] ?? defaultShortcuts['cut'] ?? 'Cmd+X',
            ),
            click: command('cut'),
          },
          {
            label: 'Copy',
            accelerator: accelerator(
              settings?.shortcuts['copy'] ?? defaultShortcuts['copy'] ?? 'Cmd+C',
            ),
            click: command('copy'),
          },
          {
            label: 'Paste',
            accelerator: accelerator(
              settings?.shortcuts['paste'] ?? defaultShortcuts['paste'] ?? 'Cmd+V',
            ),
            click: command('paste'),
          },
          {
            label: 'Move Copied Items Here',
            accelerator: accelerator(
              settings?.shortcuts['paste-move'] ?? defaultShortcuts['paste-move'] ?? '',
            ),
            click: command('paste-move'),
          },
          {
            label: 'Select All',
            accelerator: accelerator(
              settings?.shortcuts['select-all'] ?? defaultShortcuts['select-all'] ?? 'Cmd+A',
            ),
            click: command('select-all'),
          },
        ],
      },
      {
        label: 'View',
        submenu: [
          {
            label: 'Commands…',
            accelerator: accelerator(settings?.shortcuts['palette'] ?? 'Cmd+K'),
            click: command('palette'),
          },
          {
            label: 'Overview',
            click: command('overview'),
          },
          {
            label: 'Find File…',
            accelerator: accelerator(settings?.shortcuts['find-file'] ?? 'Cmd+F'),
            click: command('find-file'),
          },
          {
            label: 'Go to Folder…',
            accelerator: accelerator(settings?.shortcuts['go-to'] ?? 'Cmd+L'),
            click: command('go-to'),
          },
          {
            label: 'Show / Hide Window Navigation',
            accelerator: accelerator(settings?.shortcuts['toggle-sidebar'] ?? 'Cmd+Alt+S'),
            click: command('toggle-sidebar'),
          },
          {
            label: 'Show / Hide Title Bar',
            accelerator: accelerator(settings?.shortcuts['toggle-titlebar'] ?? 'Cmd+Alt+T'),
            click: command('toggle-titlebar'),
          },
          // every setting is a command: the space's own chrome, here too
          {
            label: 'Show / Hide Space Toolbar',
            accelerator: accelerator(settings?.shortcuts['setting.ui.space.toolbar'] ?? ''),
            click: command('setting.ui.space.toolbar'),
          },
          {
            label: 'Show / Hide Minimap',
            accelerator: accelerator(settings?.shortcuts['setting.ui.space.minimap'] ?? ''),
            click: command('setting.ui.space.minimap'),
          },
          {
            label: 'Show / Hide Viewcube',
            accelerator: accelerator(settings?.shortcuts['setting.ui.space.viewcube'] ?? ''),
            click: command('setting.ui.space.viewcube'),
          },
          {
            label: 'Show / Hide Background Grid',
            accelerator: accelerator(settings?.shortcuts['setting.ui.space.grid'] ?? ''),
            click: command('setting.ui.space.grid'),
          },
          { label: 'Show / Hide Plane Navigation', click: command('plane-sidebar') },
          { label: 'View Side by Side', click: command('view-side-by-side') },
          { label: 'View Stacked', click: command('view-stacked') },
          {
            label: 'Size & Position',
            submenu: [
              { label: 'Move Plane', click: command('plane-move') },
              { label: 'Resize Plane', click: command('plane-resize') },
              { label: 'Fill Workspace', click: command('plane-fill') },
              { type: 'separator' },
              ...(['width', 'height'] as const).map((axis) => ({
                label: axis === 'width' ? 'Width' : 'Height',
                submenu: planeSizePresets.map((preset) => ({
                  label: `${preset.label} ${axis}`,
                  click: command(`plane-${axis}-${preset.id}`),
                })),
              })),
              {
                label: 'Position',
                submenu: planeAlignments.map((alignment) => ({
                  label: alignment.label,
                  click: command(`plane-align-${alignment.id}`),
                })),
              },
            ],
          },
          {
            label: 'Show / Hide Hidden Files',
            accelerator: accelerator(
              settings?.shortcuts['toggle-hidden'] ?? defaultShortcuts['toggle-hidden'] ?? '',
            ),
            click: command('hidden'),
          },
          { type: 'separator' },
          {
            label: 'Frame All Planes',
            accelerator: accelerator(settings?.shortcuts['frame-all'] ?? 'Cmd+0'),
            click: command('frame-all'),
          },
          {
            label: 'Dock / Reveal',
            accelerator: accelerator(settings?.shortcuts['dock'] ?? 'Cmd+Return'),
            click: command('dock'),
          },
          {
            label: 'Undo Arrangement',
            accelerator: accelerator(
              settings?.shortcuts['undo-arrangement'] ?? menuShortcuts['undo-arrangement'] ?? '',
            ),
            click: command('undo-arrangement'),
          },
          {
            label: 'Redo Arrangement',
            accelerator: accelerator(
              settings?.shortcuts['redo-arrangement'] ?? menuShortcuts['redo-arrangement'] ?? '',
            ),
            click: command('redo-arrangement'),
          },
          { label: 'Arrange Horizontally', click: command('arrange-horizontal') },
          { label: 'Arrange Vertically', click: command('arrange-vertical') },
          { type: 'separator' },
          ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }]),
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: 'Actions',
        submenu: [
          ...(settings?.customActions || [])
            .toSorted((a, b) => a.order - b.order)
            .map((action) => ({
              label: action.name,
              accelerator: accelerator(action.shortcut),
              click: command('custom.' + action.id),
            })),
          ...(settings?.recipes || []).map((recipe) => ({
            label: recipe.name + '…',
            accelerator: accelerator(recipe.shortcut || ''),
            click: command('recipe.' + recipe.id),
          })),
          { type: 'separator' as const },
          { label: 'Action Tasks…', click: command('tasks') },
        ],
      },
      {
        label: 'Workspace',
        submenu: [
          { label: 'New Workspace…', click: command('new-workspace') },
          { label: 'Rename Workspace…', click: command('rename-workspace') },
          { label: 'Delete Workspace…', click: command('delete-workspace') },
          { label: 'Undo Workspace Deletion', click: command('restore-workspace') },
          { type: 'separator' },
          { label: 'Backup and Restore…', click: command('personal-backup') },
        ],
      },
      { role: 'windowMenu' },
      {
        role: 'help',
        submenu: [
          { label: 'What Can I Do Here?', click: command('capabilities') },
          { label: 'Commands…', click: command('palette') },
          { type: 'separator' },
          {
            label: 'Getting Started',
            click: () => void shell.openExternal(guide('guides/getting-started.md')),
          },
          {
            label: 'Keyboard Shortcuts',
            click: () => void shell.openExternal(guide('reference/shortcuts.md')),
          },
          { type: 'separator' },
          {
            label: 'Report an Issue…',
            click: () => void shell.openExternal('https://github.com/plurid/viewer/issues'),
          },
          {
            label: 'Viewer Website',
            click: () => void shell.openExternal('https://plurid.com/viewer'),
          },
          { type: 'separator' },
          {
            // A local file the person can attach to a support request if they choose.
            label: 'Show Diagnostic Log',
            click: () => {
              if (existsSync(diagnosticFile)) shell.showItemInFolder(diagnosticFile);
              else
                void dialog.showMessageBox({
                  type: 'info',
                  message: 'No problems have been recorded.',
                  detail: 'Viewer keeps a local log of errors here for support. It is never sent.',
                });
            },
          },
          {
            // Native crash reports stay on this Mac: the reporter never uploads them.
            label: 'Show Crash Reports',
            click: () => {
              const folder = app.getPath('crashDumps');
              if (crashReported(folder)) void shell.openPath(folder);
              else
                void dialog.showMessageBox({
                  type: 'info',
                  message: 'No crash reports have been recorded.',
                  detail:
                    'Viewer keeps reports of native crashes on this Mac. They are never sent.',
                });
            },
          },
        ],
      },
    ]),
  );
}
/** Whether Crashpad has written a report: its completed and pending folders hold the dumps. */
function crashReported(folder: string): boolean {
  return ['completed', 'pending'].some((name) => {
    try {
      return readdirSync(path.join(folder, name)).some((file) => file.endsWith('.dmp'));
    } catch {
      return false;
    }
  });
}
