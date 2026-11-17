/** Settings: one scene for each section the catalog lists. */
import { categories } from '../../../src/domain/preferences/catalog';
import { sampleFolders } from '../samples';
import type { ReviewArea, Scene } from '../types';

/** The Shared Edge Rule and the owner's standards for a Settings page. */
const settingsPage = [
  'The section list keeps one line per section; the selected one is filled.',
  'Each row keeps its label left and its control at the shared edge; below 540 px the control goes under the label.',
  'No label, button or choice wraps; details may wrap under their label.',
  'The window keeps its size when the section changes.',
  'Paths show from ~.',
];

const section = (category: string): Scene => ({
  id: 'settings-' + category.toLowerCase(),
  title: 'Settings: ' + category,
  mustBeTrue: settingsPage,
  setup: { folder: sampleFolders.samples, view: 'list' },
  covers: { commands: ['settings'], settings: [category] },
  async steps(page) {
    await page.settings(category);
  },
});

export const settings: ReviewArea = {
  id: 'settings',
  title: 'Settings',
  scenes: categories.map(section),
};
