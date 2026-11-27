import { deepFolder, longName, sampleFiles, sampleFolders } from '../samples';
import type { ReviewArea, Scene } from '../types';

const samples = { folder: sampleFolders.samples } as const;

const definedWorkspace = (open: boolean): Scene => ({
  id: open ? 'defined-terminal-folder-unavailable' : 'defined-workspace-search',
  title: open ? 'Command terminal with a missing folder' : 'Search defined workspaces',
  setup: { ...samples, missingTerminalFolder: true },
  mustBeTrue: open
    ? ['Enter opens Review service. Its terminal names the unavailable folder and disables Run.']
    : ['The search field reaches the sort control and the matching definition is visible.'],
  async steps(page) {
    await page.palette('Manage Workspaces…');
    await page.clickFirst('#workspace-tab-defined');
    const field = 'input[aria-label="Search definitions"]';
    await page.type(field, 'Review service');
    await page.expectText('Review service', 'The matching defined workspace appears.');
    if (open) {
      await page.key('Enter', 'Enter');
      await page.waitFor('.definition-start-panel .definition-run-command:disabled');
      await page.expectText(
        'Terminal folder unavailable',
        'The panel identifies the missing folder.',
      );
    } else {
      await page.expectFillsRow(field, '.workspace-catalog-search', 'The search fills its row.');
    }
  },
});

const views = ['grid', 'gallery', 'map'] as const;
export const wave4Explorer: ReviewArea = {
  id: 'explorer-workspaces',
  title: 'Search, collections, workspaces and tours',
  scenes: [
    definedWorkspace(false),
    definedWorkspace(true),
    ...views.map((view): Scene => ({
      id: 'explorer-cursor-' + view,
      title: 'Selected file in ' + view + ' view',
      setup: { ...samples, view },
      mustBeTrue: ['The selected file is visible and its option identifies the active cursor.'],
      async steps(page) {
        await page.select(page.path(samples.folder, sampleFiles.picture));
        await page.expectPresent(
          '.folder-explorer[aria-activedescendant] [role="option"][id][aria-selected="true"]',
          'The selected option has a cursor target.',
        );
      },
    })),
    {
      id: 'subfolder-search-incomplete-size',
      title: 'Incomplete size filter in subfolder search',
      mustBeTrue: ['The syntax hint appears without a filesystem read error.'],
      setup: samples,
      async steps(page) {
        await page.palette('Search This Folder…');
        await page.button('Subfolders');
        await page.type('input[aria-label="Find files"]', 'size>');
        await page.waitFor('.search-problem');
      },
    },
    {
      id: 'search-plane-change-query',
      title: 'Change a search with one result selected',
      mustBeTrue: ['The prior selection and its passage disappear when the search changes.'],
      setup: samples,
      async steps(page) {
        await page.palette('Find File…');
        await page.type('input[aria-label="Find file by name"]', sampleFiles.picture);
        await page.button('Open Results');
        await page.waitFor('.search-explorer [data-file-path]');
        await page.clickFirst('.search-explorer [data-file-path]');
        await page.type('.search-explorer input[aria-label="Search query"]', sampleFiles.text);
        await page.waitFor('.search-explorer [data-file-path$="' + sampleFiles.text + '"]');
        await page.expectNone(
          '.search-explorer [aria-selected="true"]',
          'The new search has no selection.',
        );
      },
    },
    {
      id: 'collection-check-and-select',
      title: 'Check basket files and select a collection row',
      setup: samples,
      mustBeTrue: ['The collection opens with its checked file and shows which row has focus.'],
      async steps(page) {
        await page.select(page.path(samples.folder, sampleFiles.picture));
        await page.palette('Add to Basket');
        await page.palette('Collections and Basket…');
        await page.button('Check Files Again');
        await page.type('.collections-body > .field-label input', 'Review pictures');
        await page.button('Save Basket as Collection');
        await page.button('Open Plane');
        await page.waitFor('.collection-explorer [data-file-path]');
        await page.clickFirst('.collection-explorer [data-file-path]');
        await page.expectPresent(
          '.collection-explorer[aria-activedescendant] [aria-selected="true"]',
          'The selected row is identified.',
        );
      },
    },
    {
      id: 'saved-view-cancel-rename',
      title: 'Cancel a saved view rename',
      setup: samples,
      mustBeTrue: ['Escape closes the name field and leaves the original view actions available.'],
      async steps(page) {
        await page.palette('Save View as 1');
        await page.palette('Views…');
        const rename = '.views-list button[aria-label^="Rename "]';
        await page.clickFirst(rename);
        await page.type('.views-list input', 'Test name');
        await page.key('Escape', 'Escape');
        await page.waitFor(rename);
      },
    },
    {
      id: 'overview-file-overview-label',
      title: 'Navigate to File Overview in space',
      setup: samples,
      mustBeTrue: ['The minimap names File Overview and choosing it focuses the plane.'],
      async steps(page) {
        await page.palette('Reveal Space');
        await page.palette('File Overview');
        await page.palette('Overview');
        const target = '[data-plurid-minimap-plane][aria-label="Go to File Overview"]';
        await page.waitFor(target);
        await page.clickFirst(target);
      },
    },
    {
      id: 'mixed-project-arrangement',
      title: 'Save an arrangement with a File Overview plane open',
      setup: { folder: samples.folder, project: { root: samples.folder, bindings: {} } },
      mustBeTrue: [
        'Saved Arrangements offers Save Current Arrangement with the folder and File Overview open together.',
      ],
      async steps(page) {
        await page.palette('File Overview');
        await page.palette('Saved Arrangements…');
        await page.button('Save Current Arrangement…');
        await page.waitFor('dialog[open] input');
      },
    },
    {
      id: 'tour-footer-long-file',
      title: 'Record a tour stop with a long file name',
      setup: { folder: deepFolder },
      mustBeTrue: ['The Add button keeps the file extension and fits beside the save controls.'],
      nameCells: ['.tour-stops-footer [data-file-name]'],
      async steps(page) {
        await page.select(page.path(deepFolder, longName('pdf')));
        await page.palette('Open Linked Plane');
        await page.waitFor('.preview-plane');
        await page.clickFirst('.preview-plane');
        await page.palette('Record a Tour');
        const name = '.tour-stops-footer [data-file-name]';
        await page.waitFor(name);
        await page.expectInsideWindow(name, 0, 'The file name stays inside the window.');
      },
    },
  ],
};
