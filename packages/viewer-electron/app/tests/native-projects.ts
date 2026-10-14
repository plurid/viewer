/** Packaged project controls and worker inspection, using a hidden owned app. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { SavedState } from '../src/domain/contracts';
import type { ProjectDefinition, ProjectDocument } from '../src/domain/project';
import { ownedApp, until } from './owned-app';
import { decodeProject } from '../src/desktop/projects';
const root = await mkdtemp(path.join(os.tmpdir(), 'viewer-native-project-'));
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
try {
  connection = await viewer.connect();
  let evaluate = connection.evaluate;
  const click = async (label: string) => {
    assert.equal(
      await evaluate<boolean>(`(() => { const b = [...document.querySelectorAll('dialog button')]
      .find(b => b.textContent.trim() === ${JSON.stringify(label)}); b?.click(); return !!b; })()`),
      true,
    );
  };
  const dialog = (label: string) =>
    until(
      () =>
        evaluate<boolean>(
          `!!document.querySelector('dialog[aria-label=${JSON.stringify(label)}]')`,
        ),
      Boolean,
      label,
    );
  await until(
    () => evaluate<number>(`document.querySelectorAll('.folder-explorer').length`),
    Boolean,
    'project folder',
  );
  assert.equal(await evaluate(`document.querySelectorAll('.terminal-plane').length`), 0);
  const document = await evaluate<ProjectDocument>(
    `window.viewer.project({kind:'read',file:${JSON.stringify(projectFile)}})`,
  );
  assert.equal(document.definition.id, definition.id);
  checks.push('Project file read, root/child restoration and dormant imported terminal.');
  await evaluate(`window.dispatchEvent(new CustomEvent('viewer:notes',{detail:'preview'}))`);
  await dialog('Plane notes');
  await evaluate(`(() => { const input = document.querySelector('dialog textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Generated durable note.');
    input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await click('Save notes');
  await evaluate(`window.dispatchEvent(new CustomEvent('viewer:project',{detail:'save'}))`);
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
  await evaluate(
    `window.dispatchEvent(new CustomEvent('viewer:inspect',{detail:${JSON.stringify(file)}}))`,
  );
  await dialog('Inspect file');
  await until(
    () => evaluate<string>(`document.querySelector('dialog .inspection-facts')?.textContent || ''`),
    (value) => value.includes('bytes'),
    'metadata inspection',
  );
  await evaluate(`document.querySelector('dialog input[type=checkbox]').click()`);
  await until(
    () => evaluate<string>(`document.querySelector('dialog .inspection-facts')?.textContent || ''`),
    (value) => value.includes('characters'),
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
  await evaluate(`window.dispatchEvent(new CustomEvent('viewer:project',{detail:'arrangements'}))`);
  await dialog('Saved arrangements');
  await capture('arrangements');
  await click('Done');
  await evaluate(
    `window.viewer.settingsGet().then(s=>window.viewer.settingsPatch([{path:'settings.appearance',value:'light'}],s.revision))`,
  );
  await evaluate(`window.dispatchEvent(new CustomEvent('viewer:notes',{detail:'preview'}))`);
  await dialog('Plane notes');
  await capture('notes-light');
  await click('Cancel');
  await connection.command('Emulation.setDeviceMetricsOverride', {
    width: 900,
    height: 640,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate(`window.dispatchEvent(new CustomEvent('viewer:project',{detail:'arrangements'}))`);
  await dialog('Saved arrangements');
  await capture('arrangements-compact-light');
  await click('Done');
  await connection.command('Emulation.clearDeviceMetricsOverride');
  await evaluate(
    `window.viewer.settingsGet().then(s=>window.viewer.settingsPatch([{path:'settings.appearance',value:'dark'}],s.revision))`,
  );
  const changed = decodeProject(await readFile(projectFile, 'utf8'));
  changed.name = 'Reloaded project';
  await writeFile(
    projectFile,
    '// Native acceptance comment.\n' + JSON.stringify(changed, null, 2) + '\n',
  );
  await until(
    () => evaluate<string>(`document.querySelector('.project-file-notice')?.textContent||''`),
    (text) => text.includes('changed on disk'),
    'external definition edit notification',
  );
  await capture('project-file-notice');
  await evaluate(`document.querySelector('.project-file-notice button').click()`);
  await dialog('Reload project?');
  await click('Reload project');
  await until(
    () =>
      evaluate<string>(
        `document.querySelector('.workspace-button')?.textContent || document.body.textContent`,
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
  assert.equal(cold.version, 4);
  viewer = await ownedApp(binary, profile);
  connection = await viewer.connect();
  evaluate = connection.evaluate;
  await until(
    () => evaluate<number>(`document.querySelectorAll('.folder-explorer').length`),
    Boolean,
    'cold project',
  );
  await evaluate(`window.dispatchEvent(new CustomEvent('viewer:notes',{detail:'preview'}))`);
  await dialog('Plane notes');
  assert.equal(
    await evaluate(`document.querySelector('dialog textarea').value`),
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
  await rm(root, { recursive: true, force: true });
}
