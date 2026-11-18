import { Menu, app, BrowserWindow, shell } from 'electron';
import { showViewerMessage } from '../native/native-confirmation';
import type { MenuItemConstructorOptions } from 'electron';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { ApplicationSettings } from '../../domain/services';
import type { UIPreferences } from '../../domain/contracts';
import { accelerator, resolvedShortcut, shortcutFor } from '../../domain/preferences/shortcuts';
import { planeAlignments, planeSizePresets } from '../../domain/workspaces/plane-layout';
import type { InstalledRelease } from '../../domain/updates/feed';
import { installedRelease } from './about';

/** Development runs have no release tag, so their guides follow the default branch. */
export function guide(page: string, release: InstalledRelease = installedRelease()): string {
  const ref = release.build === undefined ? 'master' : `v${release.version}`;
  return `https://github.com/plurid/viewer/blob/${ref}/docs/${page}`;
}

/** The window chrome the View menu names by its state, as the focused window has it. */
export interface MenuChrome {
  windowNavigation: boolean;
  titleBar: boolean;
  spaceToolbar: boolean;
  minimap: boolean;
  viewcube: boolean;
  grid: boolean;
}
/** The focused window's chrome; none before a window opens, when the menu names the defaults. */
export function menuChrome(ui: UIPreferences | undefined): MenuChrome | undefined {
  return (
    ui && {
      windowNavigation: ui.sidebar.visible,
      titleBar: ui.titlebar.visible,
      spaceToolbar: ui.space.toolbar,
      minimap: ui.space.minimap,
      viewcube: ui.space.viewcube,
      grid: ui.space.grid,
    }
  );
}
// a Mac menu says what choosing the item does: Hide Sidebar while it shows, Show Sidebar while not
const showOrHide = (shown: boolean | undefined, name: string) =>
  `${shown === false ? 'Show' : 'Hide'} ${name}`;

/**
 * Build native menus from the same command IDs and shortcuts as the renderer. `quit` learns
 * whether ⌘Q or a click chose Quit: the key asks for a second press (quit-shortcut.ts).
 */
export function installApplicationMenu(
  settings: ApplicationSettings | undefined,
  command: (id: string) => () => void,
  diagnosticFile: string,
  quit: (byShortcut: boolean) => void,
  licenseVisible = false,
  copyReport: () => void = () => {},
  chrome?: MenuChrome,
): void {
  // each item's key as the keymap has it: as the person set it, else as shipped, unless they gave
  // the shipped key to something else; before settings are read, as shipped
  const keyOf = (id: string) =>
    accelerator(settings ? resolvedShortcut(settings, id) : shortcutFor(undefined, id));
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
                { label: 'Acknowledgments', click: command('acknowledgements') },
                // the App Store updates its edition
                ...(process.mas
                  ? []
                  : [{ label: 'Check for Updates…', click: command('check-for-updates') }]),
                ...(licenseVisible && !process.mas
                  ? [{ label: 'License Key…', click: command('license-key') }]
                  : []),
                { type: 'separator' as const },
                {
                  label: 'Settings…',
                  accelerator: keyOf('settings'),
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
          {
            label: 'New Window',
            accelerator: keyOf('new-native-window'),
            click: command('new-native-window'),
          },
          {
            label: 'New Files Plane',
            accelerator: keyOf('new-root-folder'),
            click: command('new-root-folder'),
          },
          {
            label: 'New Scratch Plane',
            accelerator: keyOf('new-scratch-plane'),
            click: command('new-scratch-plane'),
          },
          {
            label: 'New Terminal Plane',
            accelerator: keyOf('new-terminal-plane'),
            click: command('new-terminal-plane'),
          },
          { label: 'Start Local Server', click: command('start-local-server') },
          {
            label: 'Open Folder…',
            accelerator: keyOf('choose-folder'),
            click: command('choose-folder'),
          },
          {
            label: 'New Folder…',
            accelerator: keyOf('new-folder'),
            click: command('new-folder'),
          },
          {
            label: 'Open Selection',
            accelerator: keyOf('open-selection'),
            click: command('open-selection'),
          },
          { label: 'Open in Default App', click: command('open-default') },
          { label: 'Open With…', click: command('open-with') },
          { label: 'Quick Preview', click: command('quick-preview') },
          {
            label: 'Get Info…',
            accelerator: keyOf('info'),
            click: command('info'),
          },
          { label: 'Calculate Size', click: command('calculate-size') },
          { type: 'separator' },
          {
            label: 'Edit Text',
            accelerator: keyOf('edit-file'),
            click: command('edit-file'),
          },
          {
            label: 'Save',
            accelerator: keyOf('save-file'),
            click: command('save-file'),
          },
          {
            label: 'Save As…',
            accelerator: keyOf('save-file-as'),
            click: command('save-file-as'),
          },
          { label: 'Revert to Saved…', click: command('revert-file') },
          { type: 'separator' },
          { label: 'Create Project…', click: command('project-create') },
          { label: 'Workflows…', click: command('workflows') },
          { label: 'Open Project…', click: command('project-open') },
          { label: 'Save Project', click: command('project-save') },
          { label: 'Reload Project…', click: command('project-reload') },
          { type: 'separator' },
          {
            label: 'Duplicate',
            accelerator: keyOf('duplicate'),
            click: command('duplicate'),
          },
          { label: 'Copy To…', click: command('copy-to') },
          { label: 'Move To…', click: command('move-to') },
          {
            label: settings?.browsing.confirmTrash === false ? 'Move to Trash' : 'Move to Trash…',
            accelerator: keyOf('trash'),
            click: command('trash'),
          },
          { type: 'separator' },
          { label: 'File Operations', click: command('recent-operations') },
          { type: 'separator' },
          { role: 'close' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          {
            label: 'Undo',
            accelerator: keyOf('undo-file'),
            click: command('undo-file'),
          },
          {
            label: 'Redo',
            accelerator: keyOf('redo-file'),
            click: command('redo-file'),
          },
          { type: 'separator' },
          {
            label: 'Cut',
            accelerator: keyOf('cut'),
            click: command('cut'),
          },
          {
            label: 'Copy',
            accelerator: keyOf('copy'),
            click: command('copy'),
          },
          {
            label: 'Paste',
            accelerator: keyOf('paste'),
            click: command('paste'),
          },
          {
            label: 'Move Copied Items Here',
            accelerator: keyOf('paste-move'),
            click: command('paste-move'),
          },
          {
            label: 'Select All',
            accelerator: keyOf('select-all'),
            click: command('select-all'),
          },
        ],
      },
      {
        label: 'View',
        submenu: [
          {
            label: 'Commands…',
            accelerator: keyOf('palette'),
            click: command('palette'),
          },
          {
            label: 'Overview',
            click: command('overview'),
          },
          {
            label: 'Find File…',
            accelerator: keyOf('find-file'),
            click: command('find-file'),
          },
          {
            label: 'Go to Folder…',
            accelerator: keyOf('go-to'),
            click: command('go-to'),
          },
          {
            label: showOrHide(chrome?.windowNavigation, 'Window Navigation'),
            accelerator: keyOf('toggle-sidebar'),
            click: command('toggle-sidebar'),
          },
          {
            label: showOrHide(chrome?.titleBar, 'Title Bar'),
            accelerator: keyOf('toggle-titlebar'),
            click: command('toggle-titlebar'),
          },
          // every setting is a command: the space's own chrome, here too
          {
            label: showOrHide(chrome?.spaceToolbar, 'Space Toolbar'),
            accelerator: keyOf('setting.ui.space.toolbar'),
            click: command('setting.ui.space.toolbar'),
          },
          {
            label: showOrHide(chrome?.minimap, 'Minimap'),
            accelerator: keyOf('setting.ui.space.minimap'),
            click: command('setting.ui.space.minimap'),
          },
          {
            label: showOrHide(chrome?.viewcube, 'Viewcube'),
            accelerator: keyOf('setting.ui.space.viewcube'),
            click: command('setting.ui.space.viewcube'),
          },
          {
            label: showOrHide(chrome?.grid, 'Background Grid'),
            accelerator: keyOf('setting.ui.space.grid'),
            click: command('setting.ui.space.grid'),
          },
          // a plane's and a folder's own state lives in the window: the menu names both ways
          { label: 'Show or Hide Plane Navigation', click: command('plane-sidebar') },
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
                  label: `${preset.label} ${axis === 'width' ? 'Width' : 'Height'}`,
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
            label: 'Show or Hide Hidden Files',
            accelerator: keyOf('toggle-hidden'),
            click: command('hidden'),
          },
          { type: 'separator' },
          {
            label: 'Frame All Planes',
            accelerator: keyOf('frame-all'),
            click: command('frame-all'),
          },
          {
            label: 'Dock Plane or Reveal Space',
            accelerator: keyOf('dock'),
            click: command('dock'),
          },
          {
            label: 'Undo Arrangement',
            accelerator: keyOf('undo-arrangement'),
            click: command('undo-arrangement'),
          },
          {
            label: 'Redo Arrangement',
            accelerator: keyOf('redo-arrangement'),
            click: command('redo-arrangement'),
          },
          { label: 'Arrange Planes Horizontally', click: command('arrange-horizontal') },
          { label: 'Arrange Planes Vertically', click: command('arrange-vertical') },
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
          { label: 'Change Workspace…', click: command('change-workspace') },
          { label: 'New Workspace…', click: command('new-workspace') },
          { label: 'Close Workspace', click: command('close-workspace') },
          { label: 'Reset to Definition…', click: command('reset-workspace') },
          { label: 'Save to Definition', click: command('save-workspace-definition') },
          { label: 'Save as Definition…', click: command('save-workspace-as-definition') },
          { label: 'Edit Workspace Definitions', click: command('edit-workspace-definitions') },
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
          { label: 'Copy Report…', click: copyReport },
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
                void showViewerMessage(BrowserWindow.getFocusedWindow() ?? undefined, {
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
                void showViewerMessage(BrowserWindow.getFocusedWindow() ?? undefined, {
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
