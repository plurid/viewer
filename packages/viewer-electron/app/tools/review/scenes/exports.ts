/**
 * The six output dialogs, each opened on a 180-character name inside the folder twenty levels
 * deep, so the name field and the destination meet their hardest case.
 */
import { planeInView } from '../checks';
import { deepFolder, deepLevels, longName, sampleFolders } from '../samples';
import type { ReviewArea, Scene } from '../types';

/** The Output Form Rule (DESIGN.md) and the owner's standards for every output form. */
const outputForm = [
  'Labels sit above their fields; fields fill their row to the dialog’s edge.',
  'The file name field shows the end of the long name and keeps its fixed format suffix visible.',
  'Save in leads with the folder’s own name (3D), then its path from ~ shortened from the left.',
  'No label or button wraps; the footer actions stay on one line and in reach.',
  'Help text states facts about this export only.',
];

const deep = (...parts: string[]) => [deepFolder, ...parts];

const imageTools: Scene = {
  id: 'image-tools',
  title: 'Image tools with a long name and a deep folder',
  mustBeTrue: [...outputForm, 'Source dimensions sit beside the size fields on one line.'],
  setup: { folder: deepFolder, view: 'list' },
  covers: { commands: ['image-tools'], dialogs: ['ImageToolsDialog'] },
  focus: ['dialog[open]'],
  async steps(page) {
    await page.select(page.path(...deep(longName('jpg'))));
    await page.palette('Image tools…');
    await page.waitFor('.image-tools-dialog[open]');
    await page.settle(800);
  },
};

const optimize: Scene = {
  id: 'optimize',
  title: 'Optimize with a long name and a deep folder',
  mustBeTrue: [
    ...outputForm,
    'The header and the footer stay fixed while the work area scrolls.',
    'The target size sits beside the preset.',
  ],
  setup: { folder: deepFolder, view: 'list' },
  covers: { commands: ['optimize-files'], dialogs: ['OptimizeDialog'] },
  focus: ['dialog[open]'],
  async steps(page) {
    await page.select(page.path(...deep(longName('jpg'))));
    await page.palette('Optimize…');
    await page.waitFor('.optimize-dialog[open]');
    await page.settle(800);
  },
};

const mediaExport: Scene = {
  id: 'media-export',
  title: 'Media export with a long name and a deep folder',
  mustBeTrue: [
    ...outputForm,
    'Checkbox text stays beside its checkbox.',
    'Counts agree with their nouns: 1 segment, 2 segments.',
  ],
  setup: { folder: deepFolder, view: 'list' },
  covers: { commands: ['edit-media'], previews: ['media'] },
  focus: [planeInView],
  async steps(page) {
    await page.select(page.path(...deep(longName('mp4'))));
    await page.palette('Edit media…');
    await page.waitFor('[role="group"][aria-label^="/media/"]');
    await page.settle(1500);
  },
};

const pdfTools: Scene = {
  id: 'pdf-tools',
  title: 'PDF tools with a long name and a deep folder',
  mustBeTrue: [...outputForm, 'Page thumbnails line up; page controls stay on one line.'],
  setup: { folder: deepFolder, view: 'list' },
  covers: { commands: ['pdf-tools'], dialogs: ['PDFToolsDialog'] },
  focus: ['dialog[open]'],
  async steps(page) {
    await page.select(page.path(...deep(longName('pdf'))));
    await page.palette('PDF tools…');
    await page.waitFor('.pdf-tools-dialog[open]');
    await page.settle(1200);
  },
};

const projectFolders: Scene = {
  id: 'project-folders',
  title: 'Project folders with a deep outside folder',
  mustBeTrue: [
    'Each folder choice leads with the folder’s own name, then its path from ~, beside Choose….',
    'Rows fill the dialog’s width; nothing wraps.',
    'The note under the title states what choosing a folder does, once.',
  ],
  setup: {
    folder: sampleFolders.samples,
    view: 'list',
    project: {
      root: sampleFolders.samples,
      bindings: { 'external-1': deepFolder, 'external-2': sampleFolders.projects },
    },
  },
  covers: { commands: ['project-*'], dialogs: ['ProjectControls: *'] },
  focus: ['dialog[open]'],
  async steps(page) {
    await page.palette('Project folders…');
    await page.waitFor('dialog[open] .project-controls');
    await page.settle(600);
  },
};

const copyTo: Scene = {
  id: 'copy-to-folder',
  title: 'Copy to folder from a deep folder, long name (Move to folder is the same dialog)',
  mustBeTrue: [
    'The name of what is copied keeps its extension.',
    'The destination leads with the folder’s own name (' +
      deepLevels.at(-1) +
      ') and its path from ~.',
    'Place buttons wrap as whole buttons; their labels never break.',
    'Copy and Cancel stay on one line.',
  ],
  setup: { folder: deepFolder, view: 'list' },
  covers: { commands: ['copy-to', 'move-to'], dialogs: ['DestinationDialog'] },
  focus: ['dialog[open]'],
  async steps(page) {
    await page.select(page.path(...deep(longName('txt'))));
    await page.palette('Copy to…');
    await page.waitFor('dialog[open]');
    await page.settle(600);
  },
};

export const exports: ReviewArea = {
  id: 'exports',
  title: 'Output dialogs',
  scenes: [imageTools, optimize, mediaExport, pdfTools, projectFolders, copyTo],
};
