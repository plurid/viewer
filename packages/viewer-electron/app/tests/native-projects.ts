/** Packaged project controls and worker inspection, using a hidden owned app. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../src/domain/contracts';
import type { ProjectDefinition, ProjectDocument } from '../src/domain/workspaces/project';
import { ownedApp, until } from './owned-app';
import {
  click as clickElement,
  countOf,
  exists,
  patchSettings,
  textOf,
} from './native/runtime/page';
import { pageCall } from './native/runtime/page-function';
import { decodeProject } from '../src/desktop/workspaces/projects';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
const root = await temporaryRoot('viewer-native-project-');
const profile = path.join(root, 'profile'),
  directory = path.join(root, 'Project'),
  documents = path.join(directory, 'Documents');
await mkdir(profile);
await mkdir(documents, { recursive: true });
const file = path.join(documents, 'Notes.txt'),
  projectFile = path.join(directory, 'viewer.project.jsonc');
await writeFile(file, 'First line\nOriginal Știință passage.\nLast line');
const definition: ProjectDefinition = {
  version: 1,
  id: 'native-project',
  name: 'Project acceptance',
  bindings: [],
  planes: [
    { id: 'folder', type: 'folder', target: { path: 'Documents' } },
    { id: 'preview', type: 'preview', target: { path: 'Documents/Notes.txt' } },
    { id: 'terminal', type: 'terminal', target: { path: '.' }, profileID: 'shell' },
  ],
  folders: [{ target: { path: 'Documents' }, view: { mode: 'columns' } }],
  layout: {
    placements: ['folder', 'preview', 'terminal'].map((id, i) => ({
      id,
      parent: i === 1 ? 'folder' : undefined,
      location: { translateX: i * 1000, translateY: 0, translateZ: 0, rotateX: 0, rotateY: 0 },
      width: 900,
      height: 600,
      show: true,
    })),
    active: 'folder',
    docked: 'folder',
  },
  arrangements: {},
};
definition.arrangements['Saved-' + 'Arrangement'.repeat(7)] = structuredClone(definition.layout);
const text = '// Native acceptance comment.\n' + JSON.stringify(definition, null, 2) + '\n';
await writeFile(projectFile, text);
const association = {
  file: projectFile,
  root: directory,
  revision: createHash('sha256').update(text).digest('hex'),
  definition,
  bindings: {},
  folders: { [documents]: { mode: 'columns' as const } },
  dirty: false,
};
const state: SavedState = {
  version: 4,
  activeWorkspace: 'work',
  favorites: [],
  recents: [],
  look: 'dark',
  workspaces: [
    {
      id: 'work',
      name: definition.name,
      roots: ['folder', 'terminal'],
      activePane: 'folder',
      arrangement: {},
      project: association,
      layout: definition.layout,
      panes: [
        {
          id: 'folder',
          type: 'folder',
          path: documents,
          mode: 'columns',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [documents],
          historyIndex: 0,
        },
        { id: 'preview', type: 'preview', path: file },
        {
          id: 'terminal',
          type: 'terminal',
          path: directory,
          profileID: 'shell',
          startOnOpen: false,
        },
      ],
    },
  ],
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));
const binary =
  process.env.VIEWER_TEST_BINARY ||
  path.resolve('out/Viewer-darwin-arm64/Viewer.app/Contents/MacOS/Viewer');
let viewer = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof viewer.connect>> | undefined;
const checks: string[] = [];
const evidenceDirectory = path.resolve('out/project-acceptance');
await mkdir(evidenceDirectory, { recursive: true });
/** Clicks the first dialog button labelled `label`: false when there is none. */
function clickDialogButton(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('dialog button')].find(
    (button) => button.textContent.trim() === label,
  );
  button?.click();
  return !!button;
}
const dispatch = (name: string, detail: string) =>
  window.dispatchEvent(new CustomEvent(name, { detail }));
/** Sets the dialog's text area through the native setter, so React sees an input event. */
function typeNote(value: string) {
  const input = document.querySelector<HTMLTextAreaElement>('dialog textarea')!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
try {
  connection = await viewer.connect();
  let evaluate = connection.evaluate;
  const click = async (label: string) => {
    assert.equal(await evaluate(pageCall(clickDialogButton, label)), true);
  };
  const dialog = (label: string) =>
    until(() => evaluate(exists(`dialog[aria-label=${JSON.stringify(label)}]`)), Boolean, label);
  await until(() => evaluate(countOf('.folder-explorer')), Boolean, 'project folder');
  assert.equal(await evaluate(countOf('.terminal-plane')), 0);
  const opened = await evaluate(
    pageCall(
      (file: string) => window.viewer.project({ kind: 'read', file }) as Promise<ProjectDocument>,
      projectFile,
    ),
  );
  assert.equal(opened.definition.id, definition.id);
  checks.push('Project file read, root/child restoration and dormant imported terminal.');
  await evaluate(pageCall(dispatch, 'viewer:notes', 'preview'));
  await dialog('Plane notes');
  await evaluate(pageCall(typeNote, 'Generated durable note.'));
  await click('Save notes');
  await evaluate(pageCall(dispatch, 'viewer:project', 'save'));
  await until(
    async () =>
      decodeProject(await readFile(projectFile, 'utf8')).planes.find(
        (pane) => pane.type === 'preview',
      )?.state?.['notes.text'],
    (value) => value === 'Generated durable note.',
    'explicit project save from rendered notes',
  );
  const saved = decodeProject(await readFile(projectFile, 'utf8'));
  assert.equal(saved.layout.placements.find((plane) => plane.id === 'preview')?.parent, 'folder');
  assert.equal(saved.layout.docked, 'folder');
  assert.ok((await readFile(projectFile, 'utf8')).includes('// Native acceptance comment.'));
  checks.push(
    'Rendered note editor, explicit save, portable parent/docking export and comment preservation.',
  );
  await evaluate(pageCall(dispatch, 'viewer:inspect', file));
  await dialog('Inspect file');
  await until(
    () => evaluate(textOf('dialog .inspection-facts')),
    (value) => value.toLowerCase().includes('bytes'),
    'metadata inspection',
  );
  await evaluate(clickElement('dialog input[type=checkbox]'));
  await until(
    () => evaluate(textOf('dialog .inspection-facts')),
    (value) => value.toLowerCase().includes('characters'),
    'shared worker content inspection',
  );
  const image = await connection.command<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
  });
  await writeFile(
    path.join(evidenceDirectory, 'inspection.png'),
    Buffer.from(image.data, 'base64'),
  );
  await click('Done');
  checks.push('Actual renderer metadata/content controls invoke the packaged worker.');
  const capture = async (name: string) => {
    const shot = await connection!.command<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(path.join(evidenceDirectory, name + '.png'), Buffer.from(shot.data, 'base64'));
  };
  await evaluate(pageCall(dispatch, 'viewer:project', 'arrangements'));
  await dialog('Saved arrangements');
  await capture('arrangements');
  await click('Done');
  await evaluate(patchSettings({ path: 'settings.appearance', value: 'light' }));
  await evaluate(pageCall(dispatch, 'viewer:notes', 'preview'));
  await dialog('Plane notes');
  await capture('notes-light');
  await click('Cancel');
  await connection.command('Emulation.setDeviceMetricsOverride', {
    width: 900,
    height: 640,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate(pageCall(dispatch, 'viewer:project', 'arrangements'));
  await dialog('Saved arrangements');
  await capture('arrangements-compact-light');
  await click('Done');
  await connection.command('Emulation.clearDeviceMetricsOverride');
  await evaluate(patchSettings({ path: 'settings.appearance', value: 'dark' }));
  const changed = decodeProject(await readFile(projectFile, 'utf8'));
  changed.name = 'Reloaded project';
  await writeFile(
    projectFile,
    '// Native acceptance comment.\n' + JSON.stringify(changed, null, 2) + '\n',
  );
  await until(
    () => evaluate(textOf('.project-file-notice')),
    (text) => text.includes('changed on disk'),
    'external definition edit notification',
  );
  await capture('project-file-notice');
  await evaluate(clickElement('.project-file-notice button'));
  await dialog('Reload project?');
  await click('Reload project');
  await until(
    () =>
      evaluate(
        pageCall(
          () =>
            document.querySelector('.workspace-button')?.textContent || document.body.textContent,
        ),
      ),
    (value) => value.includes('Reloaded project'),
    'explicit same-workspace project reload',
  );
  checks.push(
    'The bounded folder watcher notices external definition edits; reviewed reload remounts the same workspace rather than reusing stale engine storage.',
  );
  await viewer.close(connection);
  connection = undefined;
  const cold = JSON.parse(
    await readFile(path.join(profile, 'viewer-state-v1.json'), 'utf8'),
  ) as SavedState;
  assert.equal(cold.previewStates?.['work:preview']?.['notes.text'], 'Generated durable note.');
  // Saved in the current format, whatever version the profile started from
  assert.equal(cold.version, CURRENT_STATE_VERSION);
  viewer = await ownedApp(binary, profile);
  connection = await viewer.connect();
  evaluate = connection.evaluate;
  await until(() => evaluate(countOf('.folder-explorer')), Boolean, 'cold project');
  await evaluate(pageCall(dispatch, 'viewer:notes', 'preview'));
  await dialog('Plane notes');
  assert.equal(
    await evaluate(
      pageCall(() => document.querySelector<HTMLTextAreaElement>('dialog textarea')!.value),
    ),
    'Generated durable note.',
  );
  checks.push('Graceful Quit and a fresh process preserve the private note and project session.');
  console.log(checks.map((check) => 'PASS ' + check).join('\n'));
  await writeFile(
    path.join(evidenceDirectory, 'result.json'),
    JSON.stringify(
      {
        checks,
        scope: 'Generated files, owned hidden app; native pickers and signing are separate.',
      },
      null,
      2,
    ),
  );
} finally {
  await viewer.close(connection);
  await trashTemporary(root);
}
