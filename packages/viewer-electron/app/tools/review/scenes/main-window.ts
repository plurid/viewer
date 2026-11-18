/** The main window: each folder view, the sidebar and the title bar. */
import { deepFolder, longName, sampleFiles, sampleFolders } from '../samples';
import type { ReviewArea, Scene } from '../types';

const samples = sampleFolders.samples;

/** The Columns preview column's picture, found by the column's role and name. */
const previewImage =
  '[role="region"][aria-label="File preview" i] img, ' +
  '[role="region"][aria-label="File preview" i] canvas';

/** Rules every folder view keeps. */
const browsing = [
  'The title bar and the plane toolbar stay on one line at both widths.',
  'The plane title shows the folder’s own name.',
  'Long file names lose their middle and keep their extension.',
  'The footer is one line and keeps its height.',
];

const listView: Scene = {
  id: 'list-view',
  title: 'List view, selecting a long name',
  mustBeTrue: [
    ...browsing,
    'Selecting a file moves no toolbar, footer or column heading.',
    'The selection fill runs to the list’s right edge.',
    'Date, Kind and Size stay on one line in their columns.',
  ],
  setup: { folder: samples, view: 'list', sidebar: true },
  covers: { commands: ['view-*'] },
  async steps(page) {
    await page.layoutShift(() => page.select(page.path(samples, longName('pdf'))));
  },
};

const columnsView: Scene = {
  id: 'columns-view',
  title: 'Columns view with the preview column',
  mustBeTrue: [
    ...browsing,
    'Selecting a picture opens its preview in the last column without moving the other columns.',
    'The preview column fills the rest of the window.',
    'The selection fill runs to the column’s right edge, with no gap for a scroll bar.',
  ],
  setup: { folder: samples, view: 'columns', sidebar: true },
  covers: { commands: ['view-*'], previews: ['image'] },
  async steps(page) {
    await page.layoutShift(() => page.select(page.path(samples, sampleFiles.picture)));
    await page.waitFor(previewImage);
    await page.settle(600);
  },
};

const gridView: Scene = {
  id: 'grid-view',
  title: 'Grid view',
  mustBeTrue: [
    ...browsing,
    'Tiles line up in even rows; a long name takes at most two lines and keeps its extension.',
    'Selecting a tile moves no toolbar or footer.',
  ],
  setup: { folder: samples, view: 'grid', sidebar: false },
  covers: { commands: ['view-*'] },
  async steps(page) {
    await page.layoutShift(() => page.select(page.path(samples, sampleFiles.picture)));
  },
};

const galleryView: Scene = {
  id: 'gallery-view',
  title: 'Gallery view',
  mustBeTrue: [
    ...browsing,
    'The selected picture fills the stage; the strip below keeps one row.',
    'Selecting another file moves no toolbar or footer.',
  ],
  setup: { folder: samples, view: 'gallery', sidebar: false },
  covers: { commands: ['view-*'] },
  async steps(page) {
    await page.layoutShift(() => page.select(page.path(samples, sampleFiles.picture)));
    await page.settle(600);
  },
};

const recentUnfolded: Scene = {
  id: 'sidebar-recent',
  title: 'Sidebar with Recent unfolded',
  mustBeTrue: [
    'Each Recent folder shows its own name on one line.',
    'A long folder name keeps its start and is shortened, never wrapped.',
    'Section headings line up with their rows.',
  ],
  setup: {
    folder: samples,
    view: 'list',
    sidebar: true,
    recents: [sampleFolders.projects, samples, 'Documents'],
  },
  async steps() {},
};

const recentFolded: Scene = {
  id: 'sidebar-recent-folded',
  title: 'Sidebar with Recent folded',
  mustBeTrue: [
    'Folded Recent shows only its heading, with its chevron turned.',
    'Nothing below the heading moves when it folds.',
  ],
  setup: {
    folder: samples,
    view: 'list',
    sidebar: true,
    recentFolded: true,
    recents: [sampleFolders.projects, samples],
  },
  async steps() {},
};

const titlebarHidden: Scene = {
  id: 'titlebar-hidden',
  title: 'Title bar hidden',
  mustBeTrue: [
    'The plane starts at the window’s top edge; no empty band is left.',
    'The plane toolbar keeps its height and stays on one line.',
  ],
  setup: { folder: samples, view: 'list', sidebar: true, titlebar: false },
  async steps() {},
};

const insights: Scene = {
  id: 'folder-insights',
  title: 'A folder insight card naming long files',
  mustBeTrue: [
    'The card is one compact row above the list: its title, the names, its action and Dismiss.',
    'Names in the card keep their extension and never stack one word per line.',
    'The card takes the plane’s width, not a narrow column.',
  ],
  setup: { folder: sampleFolders.copies, view: 'list', sidebar: true },
  async steps(page) {
    await page.waitFor('.folder-insight', 1, 20000);
    await page.settle(600);
  },
};

/** List view's column headings pressed in turn: nothing in the header may move. */
const sortHeaders: Scene = {
  id: 'list-sort-headers',
  title: 'List view sorted by each column in turn',
  mustBeTrue: [
    ...browsing,
    'Pressing a heading moves no heading label: the sort chevron has its own slot at the end.',
    'Dates show a time, as “Today at 3:04 PM”; Kind reads in words, as “PDF document”.',
    'Rows show no tooltip unless a name is cut.',
  ],
  setup: { folder: samples, view: 'list', sidebar: false },
  async steps(page) {
    for (const index of [1, 2, 0])
      await page.layoutShift(() => page.clickNth('[role="columnheader"] > button', index));
    await page.settle(400);
  },
};

/** A plane on a folder whose own name is too long for its header. */
const longPlaneTitle: Scene = {
  id: 'plane-title-long',
  title: 'A files plane deep in folders with long names',
  mustBeTrue: [
    ...browsing,
    'The plane title loses its middle and keeps the end of the folder’s name; its tooltip is the whole name.',
    'The path bar shows its last folder, marked as the current location.',
    'The title bar’s File operations button is an icon with no text beside it.',
  ],
  setup: { folder: deepFolder, view: 'list', sidebar: true },
  async steps(page) {
    await page.settle(600);
  },
};

/** The palette's Find File with a long name typed, while the search may still run. */
const findLongName: Scene = {
  id: 'palette-find-file-long',
  title: 'Find File finding files with long names',
  mustBeTrue: [
    'Each found name loses its middle and keeps its extension; its folder shows from ~.',
    'The palette keeps its height while results arrive: the “Still searching…” line is reserved.',
    'Search scope, Document text, Open Results and Save Search… stay on one line.',
  ],
  setup: { folder: sampleFolders.samples, view: 'list' },
  focus: ['dialog[open]'],
  async steps(page) {
    await page.palette('Find File…');
    await page.waitFor('dialog[open] input');
    await page.type('dialog[open] input', longName('pdf').slice(0, 24));
    await page.settle(1200);
  },
};

export const mainWindow: ReviewArea = {
  id: 'main-window',
  title: 'Main window',
  scenes: [
    listView,
    columnsView,
    gridView,
    galleryView,
    recentUnfolded,
    recentFolded,
    titlebarHidden,
    insights,
    longPlaneTitle,
    findLongName,
    sortHeaders,
  ],
};
