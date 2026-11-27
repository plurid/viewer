/** Settings: one scene for each section the catalog lists. */
import { categories } from '../../../src/domain/preferences/catalog';
import { pageCall } from '../../../tests/native/runtime/page-function';
import { NewerBuildNeeded } from '../page';
import { reviewActions, sampleFolders } from '../samples';
import type { ReviewArea, Scene } from '../types';
import { coverageVariants } from '../variants';

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
  Search: [
    'The exclusion editor shows home paths beginning with ~/ and keeps folder names as entered.',
  ],
  Agents: ['A grant’s folder button shows the folder’s name, its path once below.'],
};

const section = (category: string): Scene => ({
  id: 'settings-' + category.toLowerCase(),
  title: 'Settings: ' + category,
  mustBeTrue: [
    ...settingsPage,
    ...(sectionRules[category] ?? []),
    ...(category === 'Actions'
      ? ['Each of the seven sample commands has its own one-line disclosure row.']
      : []),
  ],
  setup: {
    folder: sampleFolders.samples,
    view: 'list',
    ...(category === 'Actions' ? { customActions: reviewActions } : {}),
  },
  covers: { commands: ['settings'], settings: [category] },
  async steps(page) {
    await page.settings(category);
    if (category === 'Actions') {
      const missingCommands = pageCall(
        (names: string[]) => {
          const summaries = document.querySelectorAll(
            '.settings-page details.settings-recipe:has(input[aria-label="Command name"]) > summary',
          );
          const present = new Set(
            [...summaries]
              .filter((row) =>
                row.checkVisibility({
                  opacityProperty: true,
                  visibilityProperty: true,
                }),
              )
              .map((row) => row.textContent.trim()),
          );
          return names.filter((name) => !present.has(name));
        },
        reviewActions.map((action) => action.name),
      );
      await page.until(
        () => page.evaluate(missingCommands),
        (missing) => !missing.length,
        'Missing custom command rows',
        4000,
      );
    }
  },
});

const shellCommand: Scene = {
  id: 'settings-shell-command',
  title: 'Settings › Actions › Shell command editor',
  mustBeTrue: [
    'Name, Execution and Executable use the shared Settings control edge, stacking below their labels in narrow space.',
    'Shell script fills its available width and the help names the arguments the script receives.',
    'Command and parameter labels stay on one line. The parameter name and label stay beside their fields.',
  ],
  setup: { folder: sampleFolders.samples, view: 'list', customActions: reviewActions },
  variants: coverageVariants,
  covers: { settings: ['Actions'] },
  focus: ['main.settings-page'],
  async steps(page) {
    await page.settings('Actions');
    await page.button('Print a Folder Label', '.settings-page');
    const script = 'details[open] textarea[aria-label="Command shell script"]';
    await page.scrollIntoView(script);
    await page.expectPresent(script, 'The Shell script field shows');
  },
};

const workflowEditor: Scene = {
  id: 'settings-workflow-editor',
  title: 'Settings › Actions › Workflow editor',
  mustBeTrue: [
    'The two steps show in order, with a full-width built-in line and a program choice.',
    'Step actions stay on one line. The first step cannot move up and the last cannot move down.',
    'Both add-step actions stay reachable below the steps. A second press closes the program menu.',
  ],
  setup: { folder: sampleFolders.samples, view: 'list', customActions: reviewActions },
  variants: coverageVariants,
  covers: { settings: ['Actions'] },
  focus: ['main.settings-page'],
  async steps(page) {
    await page.settings('Actions');
    await page.button('Review Workflow', '.settings-page');
    await page.scrollIntoView('.command-workflow-editor');
    const program = 'button[aria-label="Workflow step 2"]';
    const menu = '.choice-menu[aria-label="Workflow step 2"]';
    await page.click(program);
    await page.waitFor(menu);
    await page.expectGap(menu + ' .context-menu', program, 4, 'The menu clears its button');
    await page.pressAt(program);
    await page.gone(menu);
    await page.expectPresent('input[aria-label="Workflow line 1"]', 'The built-in line shows');
    await page.expectPresent(program, 'The program choice shows');
  },
};

const license: Scene = {
  id: 'settings-license',
  title: 'Settings › License',
  mustBeTrue: [
    ...settingsPage,
    'License shows the trial time or the saved license status. The key entry and its label are together.',
    'The key field fills its row. Buy Viewer and Save License Key stay reachable while the page scrolls.',
  ],
  setup: { folder: sampleFolders.samples, view: 'list' },
  variants: coverageVariants,
  covers: { settings: ['License'] },
  async steps(page) {
    await page.settings();
    try {
      await page.button('License', 'nav[aria-label="Settings categories"]');
    } catch {
      throw new NewerBuildNeeded('A direct build with License configured.');
    }
    await page.waitFor('.license-status');
    await page.expectFillsRow(
      '.license-key-field textarea',
      '.license-key-field',
      'The key fills its row',
    );
  },
};

export const settings: ReviewArea = {
  id: 'settings',
  title: 'Settings',
  scenes: [...categories.map(section), shellCommand, workflowEditor, license],
};
