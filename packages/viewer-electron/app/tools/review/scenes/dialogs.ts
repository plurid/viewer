/**
 * Every dialog a command opens, each on the sample folder. Dialogs that would reach outside the
 * run (the microphone, a native confirmation, your mounted volumes) are listed with the reason
 * they are not captured.
 */
import { exists } from '../../../tests/native/runtime/page';
import { pageCall } from '../../../tests/native/runtime/page-function';
import { NewerBuildNeeded } from '../page';
import type { ReviewPage } from '../page';
import {
  deepFolder,
  gitSample,
  journalSample,
  lensSample,
  longName,
  reviewActions,
  sampleFiles,
  sampleFolders,
  workspaceName,
} from '../samples';
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
  dialog?: string;
  /** The command's id in the registry, for coverage. */
  commandID?: string;
  /** A file to select first, in the samples folder. */
  select?: string;
  prepare?(page: ReviewPage): Promise<void>;
  selector?: string;
  rules?: readonly string[];
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
  {
    id: 'views',
    title: 'Views',
    command: 'Views…',
    dialog: 'ViewsDialog',
    selector: 'dialog[open].views-dialog',
    prepare: (page) => page.palette('Save View as 1'),
  },
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
    commandID: 'share',
    blocked: 'Share… opens the macOS share panel, outside the hidden window.',
  },
  {
    id: 'network-sharing',
    title: 'Network Sharing for a sample folder',
    command: 'Share on the Network…',
    dialog: 'NetworkSharingDialog',
    select: 'Clients and partners',
    selector: 'dialog[open].network-sharing-dialog',
    rules: [
      'The folder path is selectable and starts from ~.',
      'The sharing status is visible above the instructions. Refresh, Done and Open File Sharing Settings stay in reach.',
    ],
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
    id: 'move-to-trash',
    title: 'Move a sample folder to the Trash question',
    command: 'Move to Trash…',
    dialog: 'TrashConfirmation',
    select: 'Clients and partners',
    selector: 'dialog[open].trash-confirmation',
    rules: [
      'The message names the selected folder and includes its contents.',
      'The count can arrive without moving Cancel or Move to Trash.',
    ],
  },
  {
    id: 'volumes',
    title: 'Volumes',
    command: 'Volumes…',
    dialog: 'Volumes',
    blocked: 'It lists the disks mounted on this Mac, which are not the run’s.',
  },
  {
    id: 'run-action',
    title: 'Configure a batch rename',
    command: 'Batch Rename…',
    dialog: 'ConfigureTask',
    selector: 'dialog[open].action-config',
    select: sampleFiles.text,
    rules: [
      'The action choice, selected file and the filename template are in view.',
      'Prepare Changes is the primary action. Cancel stays beside it as fields scroll.',
    ],
  },
  {
    id: 'commit-staged-changes',
    title: 'Commit Staged Changes',
    command: 'Commit Staged Changes…',
    dialog: 'CommitDialog',
    setup: { folder: gitSample },
    selector: 'dialog[open].git-commit-dialog',
    rules: [
      'The current folder shows from ~, above a labeled commit message field that fills its row.',
      'The commit action requires a message. Cancel is reachable beside it.',
    ],
  },
  {
    id: 'worktrees',
    title: 'Open Worktree',
    command: 'Open Worktree…',
    dialog: 'WorktreesDialog',
    setup: { folder: gitSample },
    selector: 'dialog[open].worktrees-dialog',
    rules: [
      'The repository path shows from ~ and keeps the repository name.',
      'Search and Refresh stay together. The checkout list scrolls within the dialog.',
    ],
  },
  {
    id: 'move-to-group',
    title: 'Move a file to a lens group',
    command: 'Move to Group…',
    dialog: 'MoveDialog',
    setup: { folder: lensSample.folder },
    select: sampleFiles.text,
    prepare: openLens,
    selector: 'dialog[open].lens-move-dialog',
    rules: ['The title names the file. The group and Cancel stay reachable.'],
  },
  {
    id: 'trash-lens',
    title: 'Move a lens to the Trash question',
    command: 'Move Lens to Trash…',
    dialog: 'TrashLensDialog',
    setup: { folder: lensSample.folder },
    prepare: openLens,
    selector: 'dialog[open][aria-label="Move this lens to the Trash?" i]',
    rules: ['The message names the lens and what moves. Cancel and Move to Trash stay in view.'],
  },
  {
    id: 'command-parameters',
    title: 'A custom command’s parameter form',
    command: 'Print a Folder Label',
    dialog: 'Parameters',
    setup: { folder: samples, customActions: reviewActions },
    selector: 'dialog[open]:has(.command-parameters)',
    rules: [
      'The title names the command. Folder label stays above the field and its value is editable.',
      'Cancel and Run stay on one line.',
    ],
  },
  {
    id: 'reload-project',
    title: 'Reload a saved sample project',
    command: 'Reload Project…',
    dialog: 'ProjectControls',
    setup: { folder: samples, project: { root: sampleFolders.projects, bindings: {} } },
    selector: 'dialog[open][aria-label="Reload project?" i]',
    rules: [
      'The question names what reload replaces and warns about unsaved project changes.',
      'The project path starts from ~ and keeps its filename. Cancel stays in reach.',
    ],
  },
];

async function openLens(page: ReviewPage): Promise<void> {
  await page.palette('Group by “' + lensSample.name + '”');
  await page.waitFor('[data-lens-group="' + lensSample.groupID + '"]');
}

const dialogScene = (item: DialogScene): Scene => ({
  id: 'dialog-' + item.id,
  title: item.title,
  mustBeTrue:
    item.dialog === 'TaskRequestDialog'
      ? [...dialogRules, 'Create Task… opens the native confirmation with Create Task and Cancel.']
      : [...dialogRules, ...(item.rules ?? [])],
  setup: item.setup ?? { folder: samples, view: 'list' },
  variants: coverageVariants,
  covers: {
    dialogs: item.dialog ? [item.dialog] : [],
    ...(item.commandID ? { commands: [item.commandID] } : {}),
  },
  focus: ['dialog[open]'],
  ...(item.blocked ? { blocked: item.blocked } : {}),
  async steps(page) {
    await item.prepare?.(page);
    if (item.select) await page.select(page.path(item.setup?.folder ?? samples, item.select));
    if (!(await page.offers(item.command)))
      throw new NewerBuildNeeded('The command “' + item.command + '”.');
    await page.palette(item.command);
    await page.waitFor(item.selector ?? 'dialog[open]');
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

const actionReview: Scene = {
  id: 'dialog-action-review',
  title: 'Review a prepared batch rename',
  mustBeTrue: [
    ...dialogRules,
    'The old and proposed names keep their extensions. Inclusion and conflicts are visible per row.',
    'Discard opens with focus. Apply and Discard stay reachable as the rows scroll.',
  ],
  setup: { folder: samples, view: 'list' },
  variants: coverageVariants,
  covers: { dialogs: ['ActionHub'] },
  focus: ['dialog[open].task-dialog'],
  async steps(page) {
    await page.select(page.path(samples, sampleFiles.text));
    await page.palette('Batch Rename…');
    await page.type(
      'dialog[open].action-config .batch-fields label:nth-child(2) input',
      'Reviewed ',
    );
    await page.button('Prepare Changes', 'dialog[open].action-config');
    await page.waitFor('dialog[open].task-dialog footer button[data-autofocus]');
  },
};

const operationReview: Scene = {
  id: 'dialog-operation-review',
  title: 'Review copying sample files from the Basket',
  mustBeTrue: [
    ...dialogRules,
    'Each change shows its source, destination and inclusion checkbox.',
    'Cancel starts with focus and stays reachable beside Apply.',
  ],
  setup: { folder: samples, view: 'list' },
  variants: coverageVariants,
  covers: { dialogs: ['OperationReviewControls'] },
  focus: ['dialog[open].operation-review-dialog'],
  async steps(page) {
    await page.select(page.path(samples, sampleFiles.text));
    await page.palette('Add to Basket');
    await page.palette('Collections and Basket…');
    await page.button('Review Copy…', 'dialog[open]');
    const picker = 'dialog[open].viewer-file-picker';
    await page.type(picker + ' input[aria-label="Folder path"]', page.path(sampleFolders.projects));
    await page.button('Go', picker);
    await page.button('Choose folder', picker);
    await page.waitFor('dialog[open].operation-review-dialog .operation-review-row');
  },
};

const replaceExisting: Scene = {
  id: 'dialog-replace-existing',
  title: 'Replace existing item question',
  mustBeTrue: [
    ...dialogRules,
    'The message names the existing item and explains when it moves to the Trash.',
    'Cancel stays beside the danger action.',
  ],
  setup: { folder: samples, view: 'list' },
  variants: coverageVariants,
  covers: { dialogs: ['OperationsPanel'] },
  focus: ['dialog[open][aria-label="Replace existing item?" i]'],
  async steps(page) {
    const job = await page.evaluate(
      pageCall(
        (source: string, destination: string) => {
          return window.viewer.operate({ kind: 'copy', sources: [source], destination });
        },
        page.path(samples, sampleFiles.pdf),
        page.path(sampleFolders.copies),
      ),
    );
    // The copy waits for a collision decision. Cancel it before Quit can open a native question.
    page.afterCapture.push(async () => {
      await page.evaluate(pageCall((id: string) => window.viewer.cancelJob(id), job));
      await page.until(
        () => page.evaluate(pageCall(() => window.viewer.jobs())),
        (jobs) => jobs.some(({ id, status }) => id === job && status === 'cancelled'),
        'Sample copy cancelled',
      );
    });
    await page.button('Replace', '.operations-panel .collision-actions');
    await page.waitFor('dialog[open][aria-label="Replace existing item?" i]');
  },
};

const journalExport: Scene = {
  id: 'dialog-export-journal',
  title: 'Export Journal from the sample profile',
  mustBeTrue: [
    ...dialogRules,
    'The export scope and its preview stay readable while the preview scrolls.',
    'The save action and Cancel stay on one line.',
  ],
  setup: { folder: journalSample, view: 'list' },
  variants: coverageVariants,
  covers: { dialogs: ['ExportDialog'] },
  focus: ['dialog[open].journal-export'],
  async steps(page, variant) {
    await page.palette('New Folder…');
    const folderDialog = 'dialog[open][aria-label="New Folder" i]';
    const name = 'Workshop ' + variant.id;
    await page.type(folderDialog + ' input', name);
    await page.button('Create', folderDialog);
    await page.waitFor(page.row(page.path(journalSample, name)));
    await page.palette('Open Journal');
    await page.button('Export…', '.journal-plane');
    await page.waitFor('dialog[open].journal-export');
  },
};

const forgetPlanes: Scene = {
  id: 'dialog-forget-remembered-planes',
  title: 'Forget remembered planes question',
  mustBeTrue: [
    ...dialogRules,
    'The question names the workspace and says it opens from its definition next time.',
    'Cancel and Forget Remembered Planes stay in reach.',
  ],
  setup: { folder: samples, view: 'list', otherWorkspace: 'Projects' },
  variants: coverageVariants,
  covers: { dialogs: ['DefinedRows'] },
  focus: ['dialog[open][aria-label="Forget remembered planes?" i]'],
  async steps(page) {
    const manager = 'dialog[open].workspaces-dialog';
    await page.palette('Save as Definition…');
    const save = 'dialog[open][aria-label="Save as Definition" i]';
    await page.type(save + ' input[data-autofocus]', 'review-field-work');
    await page.button('Save Definition', save);
    await page.gone(save);
    await page.palette('Manage Workspaces…');
    await page.button('Close ' + workspaceName, manager);
    await page.waitFor('button[aria-label="Workspace: Projects"]');
    await page.gone('dialog[open].definition-dialog');
    // Closing the workspace can unmount its dialog before the save returns to Manage.
    if (!(await page.evaluate(exists(manager)))) await page.palette('Manage Workspaces…');
    await page.waitFor(manager);
    await page.gone(manager + ' [data-workspace-id="review"]');
    await page.click(manager + ' #workspace-tab-defined');
    await page.button('Forget remembered planes for ' + workspaceName, manager);
    await page.waitFor('dialog[open][aria-label="Forget remembered planes?" i]');
  },
};

const lensRules: Scene = {
  id: 'dialog-lens-rules',
  title: 'Edit the rules of a sample lens group',
  mustBeTrue: [
    ...dialogRules,
    'The title names the group. Its current rule appears with a labeled value field.',
    'Add Rule, Cancel and Save remain reachable while the rules scroll.',
  ],
  setup: { folder: lensSample.folder, view: 'list' },
  variants: coverageVariants,
  covers: { dialogs: ['RulesDialog'] },
  focus: ['dialog[open].lens-rules-dialog'],
  async steps(page) {
    await openLens(page);
    await page.evaluate(
      pageCall((id: string) => {
        const heading = document.querySelector('[data-lens-group=' + JSON.stringify(id) + ']')!;
        const { x, y } = heading.getBoundingClientRect();
        heading.dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, clientX: x + 8, clientY: y + 8 }),
        );
      }, lensSample.groupID),
    );
    await page.click('button[data-menu-id="lens.edit-rules"]');
    await page.waitFor('dialog[open].lens-rules-dialog');
  },
};

const dictate: Scene = {
  id: 'dialog-dictate',
  title: 'Dictate into a note before local speech is set up',
  mustBeTrue: [
    ...dialogRules,
    'The destination names the note. The setup error explains how to enable local transcription.',
    'Open Speech Settings and Cancel stay reachable.',
  ],
  setup: { folder: samples, view: 'list' },
  variants: coverageVariants,
  covers: { dialogs: ['DictationDialog'] },
  focus: ['dialog[open].speech-dialog'],
  async steps(page) {
    const status = await page.evaluate(pageCall(() => window.viewer.speech({ kind: 'status' })));
    if (
      !status ||
      !('models' in status) ||
      status.preferences.backend === 'hosted' ||
      status.models.models.some((model) => model.installed)
    )
      throw new Error('The Dictate fixture needs local speech with no installed model.');
    const runtime = status.models.runtime;
    const reason = runtime.recognitionAvailable
      ? 'Choose an installed speech model in Settings → Speech.'
      : runtime.reason;
    await page.palette('New Note Plane');
    await page.waitFor('.note-plane');
    await page.button('Dictate', '.preview-toolbar:has(button[aria-label="Dictate"])');
    await page.waitFor('dialog[open].speech-dialog [role="alert"]');
    await page.expectText('Append to Untitled note', 'The destination names the new note');
    await page.expectText(reason, 'The alert names the local speech setup problem');
    await page.expectText('Open Speech Settings', 'The setup recovery action shows');
  },
};

const noteTrash: Scene = {
  id: 'dialog-trash-note',
  title: 'Move a private sample note to the Trash question',
  mustBeTrue: [
    ...dialogRules,
    'The question names the note and says what will close.',
    'Cancel opens with focus. Move to Trash stays in reach and uses danger ink.',
  ],
  setup: { folder: samples, view: 'list' },
  variants: coverageVariants,
  covers: { dialogs: ['TrashNoteDialog'] },
  focus: ['dialog[open][aria-label="Move to Trash?" i]'],
  async steps(page) {
    await page.palette('New Note Plane');
    await page.palette('Notes…');
    await page.button('Move Untitled note to Trash', '.notes-list');
    await page.waitFor('dialog[open][aria-label="Move to Trash?" i]');
  },
};

const trashPreview: Scene = {
  id: 'dialog-trash-preview',
  title: 'Quick Look at a sample item in the Trash',
  mustBeTrue: [
    'The title names the file and keeps its extension. The footer keeps one fixed-height line.',
    'Preview controls stay on one line. Close returns to the Trash selection.',
  ],
  setup: { folder: samples, view: 'list' },
  variants: coverageVariants,
  covers: { dialogs: ['TrashPreview'] },
  requires: [{ qaHooks: true }],
  focus: ['dialog[open].trash-preview-dialog'],
  async steps(page) {
    await page.palette('Trash');
    await page.click('.trash-row[data-trash-id]:has([data-file-name="Notes.txt"])');
    await page.button('Quick Look', '.trash-selection-actions');
    await page.waitFor('dialog[open].trash-preview-dialog');
  },
};

const confirmSettings: Scene = {
  id: 'dialog-settings-confirmation',
  title: 'Remove a custom command question',
  mustBeTrue: [
    ...dialogRules,
    'The question names the command and says where it will be removed.',
    'Cancel opens with focus beside the danger action.',
  ],
  setup: { folder: samples, view: 'list', customActions: reviewActions },
  variants: coverageVariants,
  covers: { dialogs: ['useConfirmation'], settings: ['Actions'] },
  focus: ['dialog[open].confirm-dialog'],
  async steps(page) {
    await page.settings('Actions');
    await page.button('Print a Folder Label', '.settings-page');
    await page.button('Remove Command', 'details[open].settings-recipe');
    await page.waitFor('dialog[open].confirm-dialog');
  },
};

export const dialogScenes: ReviewArea = {
  id: 'dialogs',
  title: 'Dialogs',
  scenes: [
    ...dialogs.map(dialogScene),
    chooser,
    saveQuestion,
    capabilitiesKeys,
    actionReview,
    operationReview,
    replaceExisting,
    journalExport,
    forgetPlanes,
    lensRules,
    dictate,
    noteTrash,
    trashPreview,
    confirmSettings,
  ],
};
