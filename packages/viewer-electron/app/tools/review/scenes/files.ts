/** File windows: the Trash and file information. */
import { deepFolder, longName, sampleFiles, sampleFolders } from '../samples';
import type { ReviewArea, Scene } from '../types';

const trash: Scene = {
  id: 'trash',
  title: 'The Trash',
  mustBeTrue: [
    'One title; no Back button at the top level.',
    'Column headings line up with their rows and sort when pressed.',
    'A long name keeps its extension; original locations show from ~ with the folder’s own name.',
    'An unknown origin says so plainly.',
    'The count, Empty Trash in the centre and Refresh and Done at the right stay on one line.',
  ],
  setup: { folder: sampleFolders.samples, view: 'list' },
  covers: { dialogs: ['Trash'] },
  nameCells: ['.trash-filename > span:not(.file-icon)'],
  // The packaged app's API is frozen, so a run cannot answer Trash calls itself, and the real
  // Trash lists every mounted volume's Trash as well as the home folder's.
  blocked:
    'The Trash lists the system Trash of every mounted volume. It needs a review-run hook that ' +
    'limits Trash to the sample home’s generated .Trash before a run may open it.',
  async steps() {},
};

const info: Scene = {
  id: 'file-information',
  title: 'File information for a long name in a deep folder',
  mustBeTrue: [
    'The name keeps its extension; the full name is in the tooltip.',
    'The location shows the folder’s own name (3D) and its path from ~, shortened from the left.',
    'Labels and values line up in two columns; values may wrap, labels never do.',
  ],
  setup: { folder: deepFolder, view: 'list' },
  covers: { commands: ['info'], dialogs: ['FileInformation'] },
  focus: ['dialog[open]'],
  async steps(page) {
    await page.select(page.path(deepFolder, longName('txt')));
    await page.palette('Get info…');
    await page.waitFor('dialog[open]');
    await page.settle(800);
  },
};

const shortInfo: Scene = {
  id: 'file-information-short',
  title: 'File information for a short name',
  mustBeTrue: info.mustBeTrue,
  setup: { folder: sampleFolders.samples, view: 'list' },
  covers: { commands: ['info'], dialogs: ['FileInformation'] },
  focus: ['dialog[open]'],
  async steps(page) {
    await page.select(page.path(sampleFolders.samples, sampleFiles.picture));
    await page.palette('Get info…');
    await page.waitFor('dialog[open]');
    await page.settle(800);
  },
};

export const files: ReviewArea = {
  id: 'files',
  title: 'Trash and information',
  scenes: [trash, info, shortInfo],
};
