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
  'Number fields are plain fields with no spin arrows.',
  'Headings inside a page are smaller than the section’s title.',
];

/** What a section must also show, from the layout batch (audit section 5). */
const sectionRules: Record<string, readonly string[]> = {
  Models: [
    'Name, API key and Reasoning effort sit at the 180 px edge; Endpoint, Model and JSON fields take the full width with their labels above.',
    'The provider status is one line and its row keeps its height while it loads.',
  ],
  Shortcuts: [
    'Each shortcut button keeps its width; a “Used by …” message never grows its row.',
    'A recorded ⌘+ or ⌘ß displays the pressed key. An unsupported key keeps the recorder listening.',
  ],
  Speech: ['The hosted provider’s policy is one line; Name sits at the shared edge.'],
  Agents: ['A grant’s folder button shows the folder’s name, its path once below.'],
};

const section = (category: string): Scene => ({
  id: 'settings-' + category.toLowerCase(),
  title: 'Settings: ' + category,
  mustBeTrue: [...settingsPage, ...(sectionRules[category] ?? [])],
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
