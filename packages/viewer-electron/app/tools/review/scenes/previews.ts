/** Previews: the Columns preview's toolbar and footer, Quick Preview and the main preview kinds. */
import { planeInView } from '../checks';
import type { ReviewPage } from '../page';
import { longName, sampleFiles, sampleFolders } from '../samples';
import type { ReviewArea, Scene } from '../types';
import { across } from '../variants';

const samples = sampleFolders.samples;

/** The Columns preview column, by its role and name. */
const previewColumn = '[role="region"][aria-label="File preview" i]';

/** The preview bar and identity rules every preview keeps. */
const previewRules = [
  'The preview toolbar is one line of fixed height; labels never wrap, they turn into icons or go into “…”.',
  'Picture dimensions stay on one line.',
  'The footer is one line: the name loses its middle and keeps its extension, details give way first.',
];

/** Opens a file as its own preview plane, in view. */
async function openPreviewPlane(page: ReviewPage, file: string): Promise<void> {
  await page.select(file);
  await page.palette('Open linked plane');
  await page.waitFor('.preview-host');
  await page.settle(800);
}

const columnsPreview: Scene = {
  id: 'columns-preview-bar',
  title: 'Columns preview toolbar and footer, short and long names',
  mustBeTrue: [
    ...previewRules,
    'Selecting the file does not move the column strip or resize the preview column.',
  ],
  setup: { folder: samples, view: 'columns', sidebar: false },
  variants: across('name', ['short', 'long']),
  covers: { previews: ['image'] },
  focus: [previewColumn],
  async steps(page, variant) {
    const name = variant.data.name === 'long' ? longName('jpg') : sampleFiles.picture;
    await page.layoutShift(() => page.select(page.path(samples, name)));
    await page.waitFor(previewColumn + ' img, ' + previewColumn + ' canvas');
    await page.settle(600);
  },
};

const quickPreview: Scene = {
  id: 'quick-preview',
  title: 'Quick Preview of a picture',
  mustBeTrue: [
    'The window shows the picture whole, with the file name in its title.',
    'The title keeps the extension; Close is reachable.',
    ...previewRules.slice(0, 2),
  ],
  setup: { folder: samples, view: 'list' },
  variants: across('name', ['short', 'long']),
  covers: { commands: ['quick-preview'], previews: ['image'], dialogs: ['QuickPreview.tsx'] },
  focus: ['dialog[open]'],
  async steps(page, variant) {
    const name = variant.data.name === 'long' ? longName('jpg') : sampleFiles.picture;
    await page.select(page.path(samples, name));
    await page.key(' ', 'Space');
    const dialog = 'dialog[open][aria-label=' + JSON.stringify(name) + ']';
    await page.waitFor(dialog + ' img, ' + dialog + ' canvas');
    await page.settle(600);
  },
};

const picture: Scene = {
  id: 'picture-preview',
  title: 'A picture in its own plane',
  mustBeTrue: [...previewRules, 'The picture fits the plane and stays sharp.'],
  setup: { folder: samples, view: 'list' },
  covers: { previews: ['image'] },
  focus: [planeInView],
  async steps(page) {
    await openPreviewPlane(page, page.path(samples, sampleFiles.picture));
    await page.waitFor('.preview-body img, .preview-body canvas');
  },
};

const pdf: Scene = {
  id: 'pdf-preview',
  title: 'A PDF in its own plane',
  mustBeTrue: [
    ...previewRules,
    'Page number, page count and zoom stay together on one line.',
    'The page is centred and fits the plane.',
  ],
  setup: { folder: samples, view: 'list' },
  covers: { previews: ['pdf'] },
  focus: [planeInView],
  async steps(page) {
    await openPreviewPlane(page, page.path(samples, sampleFiles.pdf));
    await page.waitFor('.pdf-viewer canvas', 1, 30000);
    await page.settle(800);
  },
};

const text: Scene = {
  id: 'text-preview',
  title: 'A text file in its own plane',
  mustBeTrue: [
    ...previewRules,
    'Text uses the reading font and size; lines do not run under the plane edge.',
  ],
  setup: { folder: samples, view: 'list' },
  covers: { previews: ['text'] },
  focus: [planeInView],
  async steps(page) {
    await openPreviewPlane(page, page.path(samples, sampleFiles.text));
  },
};

const model: Scene = {
  id: 'model-preview',
  title: 'An STL model with the view cube',
  mustBeTrue: [
    ...previewRules,
    'The model is centred and lit; the view cube sits in a corner without covering the toolbar.',
    'Shading and view controls stay on one line.',
  ],
  setup: { folder: samples, view: 'list' },
  covers: { previews: ['model'] },
  focus: [planeInView],
  async steps(page) {
    await openPreviewPlane(page, page.path(samples, sampleFiles.model));
    await page.waitFor('.preview-body canvas', 1, 30000);
    await page.settle(1500);
  },
};

export const previews: ReviewArea = {
  id: 'previews',
  title: 'Previews',
  scenes: [columnsPreview, quickPreview, picture, pdf, text, model],
};
