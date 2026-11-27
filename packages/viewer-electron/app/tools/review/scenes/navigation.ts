/** Finding things: the command palette, menus and dropdowns, and workspaces. */
import { deepFolder, longName, sampleFolders } from '../samples';
import type { ReviewArea, Scene } from '../types';
import { variant } from '../variants';

/** A workspace name long enough to find where the switcher and lists cut it. */
/** The title bar's workspace button: named "Workspace", with the workspace's name in newer builds. */
const switcherButton = 'button[aria-label^="Workspace" i][aria-haspopup]';

const otherWorkspace = 'Northwind feeder line, revision 4 for the second production batch';

/** The Anchored Layer Rule (DESIGN.md). */
const anchored = [
  'The menu opens below its button, or above it when there is no room; it never covers the button.',
  'It stays 8 px inside the window; a long list scrolls inside it.',
  'A list of 8 choices or fewer has no search field.',
  'No item wraps; long names lose their end with an ellipsis.',
];

const paletteDeep: Scene = {
  id: 'palette-deep-folder',
  title: '⌘K inside the folder twenty levels deep',
  mustBeTrue: [
    'The search field stays at the top and keeps its height.',
    'The folder path shows the folder’s own name (3D) and starts from ~, shortened from the left.',
    'Results keep one line for the label and one for the detail; shortcuts line up at the right.',
  ],
  setup: { folder: deepFolder, view: 'list' },
  covers: { commands: ['palette'], dialogs: ['CommandPalette'] },
  focus: ['dialog[open]'],
  async steps(page) {
    await page.select(page.path(deepFolder, longName('pdf')));
    await page.openPalette();
    await page.settle(600);
  },
};

const switcher: Scene = {
  id: 'workspace-switcher',
  title: 'Workspace switcher menu',
  mustBeTrue: [
    ...anchored,
    'The current workspace is marked; a long workspace name is shortened, never wrapped.',
  ],
  setup: { folder: sampleFolders.samples, view: 'list', otherWorkspace },
  focus: ['.context-menu', switcherButton],
  async steps(page) {
    await page.clickFirst(switcherButton);
    await page.waitFor('[role="menu"]');
  },
};

const changeWorkspace: Scene = {
  id: 'change-workspace',
  title: 'Change workspace',
  mustBeTrue: [
    'The list shows each workspace on one line with its plane count as detail.',
    'Search stays at the top; the list scrolls under it.',
    'Counts agree with their nouns: 1 open plane, 2 open planes.',
  ],
  setup: { folder: sampleFolders.samples, view: 'list', otherWorkspace },
  covers: { commands: ['change-workspace'] },
  focus: ['dialog[open]'],
  async steps(page) {
    await page.palette('Change workspace…');
    await page.waitFor('dialog[open][aria-label="change workspace" i]');
    await page.settle(500);
  },
};

const manageWorkspaces: Scene = {
  id: 'manage-workspaces',
  title: 'Manage workspaces',
  mustBeTrue: [
    'Open and Defined tabs keep one line with their counts.',
    'Search fills its row beside the sort menu.',
    'Each row keeps its actions on one line; a long name is shortened, never wrapped.',
  ],
  setup: { folder: sampleFolders.samples, view: 'list', otherWorkspace },
  covers: { commands: ['manage-workspaces'], dialogs: ['WorkspacesDialog'] },
  focus: ['dialog[open]'],
  async steps(page) {
    await page.palette('Manage workspaces…');
    await page.waitFor('dialog[open][aria-label="workspaces" i]');
    await page.settle(500);
  },
};

const dialogDropdown: Scene = {
  id: 'dropdown-in-dialog',
  title: 'A dropdown open in a dialog (Image tools format)',
  mustBeTrue: [...anchored, 'The dialog behind it does not move or scroll.'],
  setup: { folder: deepFolder, view: 'list' },
  focus: ['dialog[open]', '.context-menu'],
  async steps(page) {
    await page.select(page.path(deepFolder, longName('jpg')));
    await page.palette('Image tools…');
    await page.clickFirst(
      'dialog[open].image-tools-dialog button[aria-label="Image output format"]',
    );
    await page.waitFor('.choice-menu[aria-label="Image output format"] .context-menu');
    await page.settle(500);
  },
};

const pageDropdown: Scene = {
  id: 'dropdown-on-page',
  title: 'A dropdown open on the page (the plane’s view menu)',
  mustBeTrue: [...anchored, 'The current view is marked.'],
  setup: { folder: sampleFolders.samples, view: 'list', sidebar: true },
  focus: ['.context-menu', '.plane-controls'],
  async steps(page) {
    await page.clickFirst('button[aria-label="View mode" i]');
    await page.waitFor('[role="menu"]');
  },
};

/** The palette with a query typed, as a person searches it. */
const paletteQuery = (id: string, query: string, title: string, select?: string): Scene => ({
  id: 'palette-query-' + id,
  title: 'Palette: ' + title,
  mustBeTrue: [
    'Results keep one line for the label and one for the detail; matches lead.',
    'Paths in results start from ~ and show the item’s own name.',
    'The search field keeps its place and height as results change.',
  ],
  setup: { folder: sampleFolders.samples, view: 'list' },
  variants: [variant('wide', 'dark'), variant('narrow', 'light')],
  covers: { commands: ['palette'] },
  focus: ['dialog[open]'],
  async steps(page) {
    if (select) await page.select(page.path(sampleFolders.samples, select));
    await page.openPalette(query);
    await page.settle(800);
  },
});

export const navigation: ReviewArea = {
  id: 'navigation',
  title: 'Palette, menus and workspaces',
  scenes: [
    paletteDeep,
    switcher,
    changeWorkspace,
    manageWorkspaces,
    dialogDropdown,
    pageDropdown,
    paletteQuery('image', 'image', 'a picture’s commands', 'Forest.jpg'),
    paletteQuery('places', 'review', 'folders and places'),
    paletteQuery('go-home', 'go ~/Downloads', 'Go to a folder under Home'),
    paletteQuery('settings', 'dark', 'settings by name'),
  ],
};
