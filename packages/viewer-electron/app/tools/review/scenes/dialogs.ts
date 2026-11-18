/**
 * Every dialog a command opens, each on the sample folder. Dialogs that would reach outside the
 * run (the microphone, a native confirmation, your mounted volumes) are listed with the reason
 * they are not captured.
 */
import { pageCall } from '../../../tests/native/runtime/page-function';
import { NewerBuildNeeded } from '../page';
import { deepFolder, longName, sampleFiles, sampleFolders } from '../samples';
import type { ReviewArea, Scene } from '../types';
import { coverageVariants } from '../variants';

/** The Window Dialog Rule and the owner's standards, for any dialog. */
const dialogRules = [
  'The title is one line; long names lose their middle; the close button stays inside.',
  'The keyboard starts on the default action, Cancel or the first field, never on the title’s ×.',
  'The dialog fits the window with its actions in reach; only its body scrolls.',
  'No label, button or tab wraps; fields fill their row.',
  'Paths start from ~ and show the folder’s own name.',
  'Help text states facts only; nothing reads “unavailable” without a reason.',
];

interface DialogScene {
  id: string;
  title: string;
  /** The palette label that opens it, in any letter case. */
  command: string;
  /** The component coverage.ts names it by. */
  dialog: string;
  /** The command's id in the registry, for coverage. */
  commandID?: string;
  /** A file to select first, in the samples folder. */
  select?: string;
  /** Set when the scene must not run, with the reason. */
  blocked?: string;
  setup?: Scene['setup'];
}

const samples = sampleFolders.samples;

const dialogs: DialogScene[] = [
  {
    id: 'capabilities',
    title: 'What can I do here?',
    command: 'What Can I Do Here?',
    dialog: 'CapabilitiesDialog',
    select: sampleFiles.picture,
  },
  {
    id: 'go-to-folder',
    title: 'Go to Folder',
    command: 'Go to Folder…',
    dialog: 'GoToFolderDialog',
  },
  {
    id: 'backup',
    title: 'Backup and Restore',
    command: 'Backup and Restore…',
    dialog: 'BackupDialog',
  },
  {
    id: 'checkpoints',
    title: 'Content Checkpoints',
    command: 'Content Checkpoints…',
    dialog: 'CheckpointControls',
  },
  {
    id: 'collections',
    title: 'Collections and Basket',
    command: 'Collections and Basket…',
    dialog: 'CollectionControls',
  },
  {
    id: 'compare-locations',
    title: 'Compare Locations',
    command: 'Compare Locations…',
    dialog: 'ComparisonControls',
  },
  {
    id: 'find-duplicates',
    title: 'Find Duplicates',
    command: 'Find Duplicates…',
    dialog: 'DuplicateControls',
  },
  {
    id: 'related-files',
    title: 'Related Files',
    command: 'Related Files…',
    dialog: 'RelationshipControls',
    select: sampleFiles.pdf,
  },
  {
    id: 'plane-notes',
    title: 'Plane Notes',
    command: 'Plane Notes…',
    dialog: 'InspectionControls',
  },
  {
    id: 'inspect-file',
    title: 'Inspect File',
    command: 'Inspect File…',
    dialog: 'InspectionControls: Inspect File',
    select: sampleFiles.text,
  },
  { id: 'notes', title: 'Notes', command: 'Notes…', dialog: 'NotesDialog' },
  {
    id: 'open-with',
    title: 'Open With',
    command: 'Open With…',
    dialog: 'OpenWithDialog',
    select: sampleFiles.pdf,
  },
  { id: 'run-command', title: 'Run Command', command: 'Run Command…', dialog: 'RunCommandDialog' },
  {
    id: 'local-servers',
    title: 'Local servers',
    command: 'Local servers…',
    dialog: 'ServersDialog',
  },
  {
    id: 'agent-sessions',
    title: 'Agent Sessions',
    command: 'Agent Sessions…',
    dialog: 'SessionsDialog',
  },
  { id: 'tasks', title: 'Tasks', command: 'Tasks…', dialog: 'TasksDialog' },
  { id: 'views', title: 'Views', command: 'Views…', dialog: 'ViewsDialog' },
  { id: 'workflows', title: 'Workflows', command: 'Workflows…', dialog: 'WorkflowControls' },
  {
    id: 'workspace-look',
    title: 'Workspace Look',
    command: 'Workspace Look…',
    dialog: 'WorkspaceBackgroundDialog',
  },
  {
    id: 'save-definition',
    title: 'Save as definition',
    command: 'Save as definition…',
    dialog: 'DefinitionDialog',
  },
  {
    id: 'task-from-branch',
    title: 'New Task from Branch',
    command: 'New Task from Branch…',
    dialog: 'TaskRequestDialog',
  },
  {
    id: 'share',
    title: 'Share',
    command: 'Share…',
    dialog: 'NetworkSharingDialog',
    blocked: 'Share… opens the macOS share panel, outside the hidden window.',
  },
  {
    id: 'delete-workspace',
    title: 'Delete workspace (the question, not the deletion)',
    command: 'Delete Workspace…',
    dialog: 'WindowDialogs',
    setup: { folder: samples, view: 'list', otherWorkspace: 'Projects' },
  },
  {
    id: 'rename-long-name',
    title: 'Rename a file with a long name',
    command: 'Rename…',
    dialog: 'NameDialog',
    select: longName('pdf'),
  },
  {
    id: 'move-to-folder',
    title: 'Move to Folder from a deep folder, long name',
    command: 'Move To…',
    dialog: 'DestinationDialog',
    select: longName('txt'),
    setup: { folder: deepFolder, view: 'list' },
  },
  {
    id: 'dictate',
    title: 'Dictate',
    command: 'Ask Viewer by Voice…',
    dialog: 'DictationDialog',
    blocked: 'It asks for the microphone, which could show a macOS prompt on the screen.',
  },
  {
    id: 'move-to-trash',
    title: 'Move to Trash question',
    command: 'Move to Trash…',
    dialog: 'TrashConfirmation',
    blocked: 'macOS draws this confirmation natively, outside the hidden window.',
  },
  {
    id: 'volumes',
    title: 'Volumes',
    command: 'Volumes…',
    dialog: 'Volumes',
    blocked: 'It lists the disks mounted on this Mac, which are not the run’s.',
  },
];

const dialogScene = (item: DialogScene): Scene => ({
  id: 'dialog-' + item.id,
  title: item.title,
  mustBeTrue: dialogRules,
  setup: item.setup ?? { folder: samples, view: 'list' },
  variants: coverageVariants,
  covers: { dialogs: [item.dialog], ...(item.commandID ? { commands: [item.commandID] } : {}) },
  focus: ['dialog[open]'],
  ...(item.blocked ? { blocked: item.blocked } : {}),
  async steps(page) {
    if (item.select) await page.select(page.path(item.setup?.folder ?? samples, item.select));
    if (!(await page.offers(item.command)))
      throw new NewerBuildNeeded('The command “' + item.command + '”.');
    await page.palette(item.command);
    await page.waitFor('dialog[open]');
    await page.settle(800);
  },
});

/** Opens the window's own folder chooser on the deep folder, as Choose… does. */
function chooseFolder(folder: string): void {
  void window.viewer.chooseFolder(folder);
}

/** Opens the window's own save-changes question, as closing an edited file does. */
function askToSave(): void {
  void window.viewer.textPrompt('close', 'Report.txt');
}

const chooser: Scene = {
  id: 'dialog-file-chooser',
  title: 'Viewer’s folder chooser in the deep folder',
  mustBeTrue: [
    ...dialogRules,
    'The path field shows the end of the path; Locations, Favorites and Recent sit beside the list.',
    'The footer stays put while the list scrolls; System dialog… is in reach.',
  ],
  setup: { folder: samples, view: 'list' },
  covers: { dialogs: ['FilePicker'] },
  focus: ['dialog[open]'],
  async steps(page) {
    await page.evaluate(pageCall(chooseFolder, page.path(deepFolder)));
    await page.waitFor('.viewer-file-picker[open]');
    await page.settle(800);
  },
};

const saveQuestion: Scene = {
  id: 'dialog-save-changes',
  title: 'Save changes question',
  mustBeTrue: [
    'The question sizes to its text and shows once; Save is the one accent action, Don’t Save in the danger ink.',
    'Don’t Save sits apart at the far left; Cancel, then Save at the far right, as on a Mac.',
    'The actions stay on one line.',
  ],
  setup: { folder: samples, view: 'list' },
  variants: coverageVariants,
  covers: { dialogs: ['MessagePrompt'] },
  focus: ['dialog[open]'],
  async steps(page) {
    await page.evaluate(pageCall(askToSave));
    await page.waitFor('.viewer-message-dialog[open]');
    await page.settle(500);
  },
};

/** What Can I Do Here? with the keys moving its active row. */
const capabilitiesKeys: Scene = {
  id: 'dialog-capabilities-keys',
  title: 'What Can I Do Here? after ↓ ↓ in its search field',
  mustBeTrue: [
    ...dialogRules,
    'The third action row has the selection fill; the search field keeps the caret.',
    'Each row’s Pin is a pin icon, filled with the accent where the action is pinned.',
    'Row borders and the selection run to the list’s right edge: no empty scroll track.',
  ],
  setup: { folder: samples, view: 'list' },
  variants: coverageVariants,
  covers: { dialogs: ['CapabilitiesDialog'] },
  focus: ['dialog[open]'],
  async steps(page) {
    await page.select(page.path(samples, sampleFiles.picture));
    await page.palette('What Can I Do Here?');
    await page.waitFor('.capabilities-dialog[open]');
    await page.key('ArrowDown', 'ArrowDown');
    await page.key('ArrowDown', 'ArrowDown');
    await page.settle(400);
  },
};

export const dialogScenes: ReviewArea = {
  id: 'dialogs',
  title: 'Dialogs',
  scenes: [...dialogs.map(dialogScene), chooser, saveQuestion, capabilitiesKeys],
};
