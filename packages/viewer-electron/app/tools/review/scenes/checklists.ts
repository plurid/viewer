/**
 * The reviewers' visual checklists as scenes. Lines a capture can measure are measured: boxes,
 * gaps and what stays still around a click. Features newer than the build under review report
 * "needs a newer build" through their requirements.
 */
import { planeInView } from '../checks';
import { NewerBuildNeeded } from '../page';
import type { ReviewPage } from '../page';
import { longStemPicture, sampleFolders, widePicture } from '../samples';
import type { ReviewArea, Scene, Variant } from '../types';
import { sized, variant } from '../variants';

const models = sampleFolders.models;
const cube = '.model-viewcube';
const rotateRight = 'button[aria-label="Rotate right" i]';

/** A plane of each width the preview checklist names, in dark. */
const planeWidths: Variant[] = [320, 480, 720, 1200].map((width) => sized(width, 720, 'dark'));

/** Opens a file as its own preview plane. */
async function openPlane(page: ReviewPage, ...file: string[]): Promise<void> {
  await page.select(page.path(...file));
  await page.palette('Open linked plane');
  await page.waitFor('.preview-host');
  await page.settle(1500);
}

const cubeCorner: Scene = {
  id: 'model-cube-corner',
  title: '3D: the view cube’s place and size',
  mustBeTrue: [
    'The cube sits in the lower-right corner of the model stage, 8 px from the right and bottom, in a 104 × 104 box, about 62 px across.',
    'It never overlaps the footer or the toolbar.',
    'At rest it is translucent and the model shows through; faces and edges read in dark and light.',
    'The Home view icon sits at the box’s top left, inside the box.',
    'STL: Top is +Z.',
  ],
  setup: { folder: models, view: 'list' },
  covers: { previews: ['model'] },
  focus: [planeInView],
  async steps(page) {
    await openPlane(page, models, 'Reference block.stl');
    await page.needs(cube, 'The model view cube.');
    await page.expectBox(
      cube,
      { width: 104, height: 104, right: 8, bottom: 8 },
      'The cube box is 104 × 104, 8 px from the stage’s right and bottom',
      { within: '.model-stage' },
    );
  },
};

const cubeHover: Scene = {
  id: 'model-cube-hover',
  title: '3D: the view cube under the pointer',
  mustBeTrue: [
    'On hover the cube is fully opaque and the hovered patch takes the selection colour.',
    'The caption chip sits to the left of the cube; the longest names fit a 260 px stage.',
    'Hovering the Home view icon shows “Home view” once, with no second tooltip.',
  ],
  setup: { folder: models, view: 'list' },
  focus: [planeInView],
  async steps(page) {
    await openPlane(page, models, 'Reference block.stl');
    await page.needs(cube, 'The model view cube.');
    await page.hover(cube);
  },
};

const yUp: Scene = {
  id: 'model-gltf-y-up',
  title: '3D: a glTF model is Y-up',
  mustBeTrue: [
    'glTF and OBJ: the cube’s Top is +Y; labels are upright.',
    'The canvas fills the stage, never collapsed.',
  ],
  setup: { folder: models, view: 'list' },
  variants: [variant('wide', 'dark'), variant('narrow', 'light')],
  covers: { previews: ['model'] },
  focus: [planeInView],
  async steps(page) {
    await openPlane(page, models, 'Reference block.gltf');
  },
};

const modelError: Scene = {
  id: 'model-error-card',
  title: '3D: a model that cannot be read',
  mustBeTrue: [
    'The card says “Can’t show this model” with Try Again, Open in Default App and Show as Hex.',
    'The cube is hidden on the error card.',
  ],
  setup: { folder: models, view: 'list' },
  variants: [variant('wide', 'dark'), variant('narrow', 'light')],
  focus: [planeInView],
  async steps(page) {
    await openPlane(page, models, 'Broken model.stl');
    await page.expectText('show this model', 'The error card says it can’t show this model');
    await page.expectText('Try Again', 'The error card offers Try Again');
    await page.expectNone(cube, 'The cube hides on the error card');
  },
};

const scrollDevice: Scene = {
  id: 'model-scroll-device-setting',
  title: 'Settings: 3D scroll device',
  mustBeTrue: ['Settings › Previews has a “3D scroll device” row: Automatic, Mouse, Trackpad.'],
  setup: { folder: sampleFolders.samples, view: 'list' },
  variants: [variant('wide', 'dark'), variant('narrow', 'light')],
  covers: { settings: ['Previews'] },
  async steps(page) {
    await page.settings('Previews');
    if (!(await page.shows('3D scroll device')))
      throw new NewerBuildNeeded('The 3D scroll device setting.');
  },
};

const pictureWidths: Scene = {
  id: 'picture-plane-widths',
  title: 'A 2400 × 900 picture in planes 320 to 1200 px wide',
  mustBeTrue: [
    'The header is one line; the title keeps 96 px; Image Tools… becomes an icon before anything spills.',
    'The zoom trio and the rotate pair stay whole.',
    'The footer is 31 px and one line; dimensions, kind and size give way in that order.',
  ],
  setup: { folder: 'Pictures', view: 'list' },
  variants: planeWidths,
  covers: { previews: ['image'] },
  focus: [planeInView],
  async steps(page) {
    await openPlane(page, widePicture);
    await page.expectBox(
      '[data-plane-in-view] footer.preview-info, footer.preview-info',
      { height: 31 },
      'The preview footer is 31 px tall',
    );
  },
};

const rotatePair: Scene = {
  id: 'rotate-pair-still',
  title: 'Rotate right leaves the rotate pair where it was',
  mustBeTrue: [
    'Clicking Rotate right moves neither rotate button.',
    'Save rotated copy never appears under the pointer.',
    'At 90 degrees the picture fits whole with its 20 px margin, never larger than its pixels.',
  ],
  setup: { folder: 'Pictures', view: 'list' },
  variants: [variant('wide', 'dark'), variant('narrow', 'light')],
  focus: [planeInView],
  async steps(page) {
    await openPlane(page, widePicture);
    await page.needs(rotateRight, 'The Rotate right button.');
    await page.expectStill(
      rotateRight,
      () => page.click(rotateRight),
      'Rotate right stays under the pointer after a click',
    );
  },
};

const quickBars: Scene = {
  id: 'quick-preview-bars',
  title: 'Quick Preview toolbar and footer at three widths',
  mustBeTrue: [
    'The toolbar is 44 px, the footer 56 px; the footer shows no file name.',
    'The dialog does not resize between files.',
  ],
  setup: { folder: 'Pictures', view: 'list' },
  variants: [sized(800, 600, 'dark'), sized(1100, 760, 'dark'), sized(1600, 1000, 'light')],
  covers: { commands: ['quick-preview'] },
  focus: ['dialog[open]'],
  async steps(page) {
    await page.select(page.path(widePicture));
    await page.key(' ', 'Space');
    await page.waitFor('.quick-preview-dialog[open]');
    await page.settle(800);
    await page.expectBox(
      '.quick-preview-dialog .preview-toolbar',
      { height: 44 },
      'The Quick Preview toolbar is 44 px',
    );
    await page.expectBox('.quick-preview-footer', { height: 56 }, 'The footer is 56 px');
    await page.expectNone(
      '.quick-preview-footer .preview-filename',
      'The footer leaves the name to the title',
    );
  },
};

const columnWidths: Scene = {
  id: 'columns-widths',
  title: 'Columns at 600, 900 and 1400 px',
  mustBeTrue: [
    'List columns are 250 to 280 px; the preview runs edge to edge with a visible divider.',
    'Selecting another file in the same column scrolls nothing and changes no width.',
  ],
  setup: { folder: sampleFolders.samples, view: 'columns' },
  variants: [sized(600, 560, 'dark'), sized(900, 640, 'dark'), sized(1400, 900, 'light')],
  async steps(page) {
    await page.select(page.path(sampleFolders.samples, 'Forest.jpg'));
    await page.expectWidth(
      '.columns-view > .file-column.is-active-column',
      250,
      280,
      'A list column is 250 to 280 px wide',
    );
    await page.layoutShift(() => page.select(page.path(sampleFolders.samples, 'Notes.txt')));
  },
};

const formatMenu: Scene = {
  id: 'format-menu-gap',
  title: 'Image Tools Format menu: below its button, 4 px apart',
  mustBeTrue: [
    'The menu opens below the button with a 4 px gap, right edges aligned, never overlapping.',
    'WebP is checked; four choices show with no search field.',
  ],
  setup: { folder: 'Pictures', view: 'list' },
  focus: ['dialog[open]', '.context-menu'],
  async steps(page) {
    await page.select(page.path(widePicture));
    await page.palette('Image tools…');
    const anchor = 'dialog[open].image-tools-dialog button[aria-label="Image output format"]';
    const menu = '.choice-menu[aria-label="Image output format"] .context-menu';
    await page.clickFirst(anchor);
    await page.waitFor(menu);
    await page.expectGap(menu, anchor, 4, 'The menu sits 4 px below its button');
    await page.expectAligned(
      menu,
      anchor,
      'right',
      'The menu’s right edge lines up with its button’s',
    );
  },
};

const metadataMenu: Scene = {
  id: 'metadata-menu-short-window',
  title: 'Image Tools Metadata menu in a window 540 px tall',
  mustBeTrue: ['The menu opens above the button with a 4 px gap when there is no room below.'],
  setup: { folder: 'Pictures', view: 'list' },
  variants: [sized(1000, 540, 'dark'), sized(1000, 540, 'light')],
  focus: ['dialog[open]', '.context-menu'],
  async steps(page) {
    await page.select(page.path(widePicture));
    await page.palette('Image tools…');
    const anchor = 'dialog[open].image-tools-dialog button[aria-label="Image metadata policy"]';
    const menu = '.choice-menu[aria-label="Image metadata policy"] .context-menu';
    await page.clickFirst(anchor);
    await page.waitFor(menu);
    await page.expectGap(menu, anchor, 4, 'The menu sits 4 px from its button');
  },
};

const viewMenuEdge: Scene = {
  id: 'view-menu-window-edge',
  title: 'The plane’s View menu at the window’s right edge',
  mustBeTrue: ['The menu opens under its button and stays 8 px inside the window.'],
  setup: { folder: sampleFolders.samples, view: 'list' },
  variants: [variant('wide', 'dark'), variant('narrow', 'light')],
  focus: ['.context-menu'],
  async steps(page) {
    await page.clickFirst('button[aria-label="View mode" i]');
    await page.waitFor('.context-menu');
    await page.expectInsideWindow('.context-menu', 8, 'The menu stays 8 px inside the window');
  },
};

const longSwitcher: Scene = {
  id: 'switcher-many-workspaces',
  title: 'Workspace switcher with many workspaces, 540 px tall',
  mustBeTrue: [
    'The menu opens under the switcher, scrolls, and ends 8 px above the window’s bottom.',
  ],
  setup: { folder: sampleFolders.samples, view: 'list', extraWorkspaces: 14 },
  variants: [sized(1000, 540, 'dark'), sized(1000, 540, 'light')],
  focus: ['.context-menu'],
  async steps(page) {
    await page.clickFirst('button[aria-label^="Workspace" i][aria-haspopup]');
    await page.waitFor('.context-menu');
    await page.expectInsideWindow('.context-menu', 8, 'The menu stays 8 px inside the window');
  },
};

const nameField: Scene = {
  id: 'output-name-field',
  title: 'Image Tools file name with a 200-character stem',
  mustBeTrue: [
    'The field fills its row; the end of the stem shows; .webp stays fixed at the right; it never wraps.',
    'Save in shows the folder’s name on the first line and ~/…/Pictures on the second, with Choose… at the right.',
  ],
  setup: { folder: 'Pictures', view: 'list' },
  focus: ['dialog[open]'],
  async steps(page) {
    await page.select(page.path(longStemPicture));
    await page.palette('Image tools…');
    const field = 'dialog[open].image-tools-dialog .file-name-control';
    await page.scrollIntoView(field);
    await page.expectFillsRow(field, '.dialog-field', 'The file name field fills its row');
  },
};

const speechLanguage: Scene = {
  id: 'speech-language-menu',
  title: 'Settings › Speech › Language menu',
  mustBeTrue: [
    'The menu opens with the chosen language highlighted and in view.',
    'Its search field is at the top, with the placeholder “Search”.',
  ],
  setup: { folder: sampleFolders.samples, view: 'list' },
  variants: [variant('wide', 'dark'), variant('narrow', 'light')],
  covers: { settings: ['Speech'] },
  async steps(page) {
    await page.settings('Speech');
    const language = 'button[aria-label="Speech language" i]:enabled';
    await page.needs(language, 'The enabled speech language choice.');
    await page.clickFirst(language);
    const menu = '.choice-menu[aria-label="Speech language" i]';
    await page.waitFor(menu + ' .context-menu');
    await page.expectPresent(
      menu + ' input[aria-label="Search Speech language" i][placeholder="Search"]',
      'The language search reads “Search”',
    );
  },
};

const foundBlocked = (id: string, title: string, lines: string[]): Scene => ({
  id,
  title,
  mustBeTrue: lines,
  setup: { folder: sampleFolders.samples, view: 'list' },
  blocked:
    'It needs a found workspace, a folder the app has learned from use; the sample home makes none yet.',
  async steps() {},
});

export const checklists: ReviewArea = {
  id: 'checklists',
  title: 'Reviewers’ checklists',
  scenes: [
    cubeCorner,
    cubeHover,
    yUp,
    modelError,
    scrollDevice,
    pictureWidths,
    rotatePair,
    quickBars,
    columnWidths,
    formatMenu,
    metadataMenu,
    viewMenuEdge,
    longSwitcher,
    nameField,
    speechLanguage,
    foundBlocked('found-manage-row', 'Manage Workspaces: a found row', [
      'Name, ~/… path showing its end, Found badge, Open, Not a Workspace and Forget on one line at the minimum dialog width.',
      'After Not a Workspace the footer shows Hid “name” and Undo in the count’s place, at the same height.',
    ]),
    foundBlocked('found-offer-card', 'The workspace offer card', [
      'The offer card comes first, at most 3; its title is one line; Open Workspace does not wrap.',
      'A second plane in the same root shows no card.',
    ]),
  ],
};
