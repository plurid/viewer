/** Owned project/permission UI regression; generated files are never removed. */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SavedState } from '../src/domain/contracts';
import type { ProjectAssociation } from '../src/domain/project';
import { ownedApp, until } from './owned-app';
import { temporaryRoot } from '../tools/temporary';

const root = await temporaryRoot('viewer-project-exit-');
const profile = path.join(root, 'profile'),
  folder = path.join(root, 'Project');
await mkdir(profile);
await mkdir(folder);
const file = path.join(folder, 'viewer.project.jsonc');
// The missing-file scenario requires no deletion: this definition never existed.
const project: ProjectAssociation = {
  file,
  root: folder,
  revision: 'remembered-definition',
  bindings: {},
  folders: {},
  dirty: true,
  definition: {
    version: 1,
    id: 'project-exit',
    name: 'Project exit',
    bindings: [],
    planes: [{ id: 'folder', type: 'folder', target: { path: '.' } }],
    folders: [],
    arrangements: {},
    layout: {
      placements: [
        {
          id: 'folder',
          width: 900,
          height: 600,
          show: true,
          location: { translateX: 0, translateY: 0, translateZ: 0, rotateX: 0, rotateY: 0 },
        },
      ],
      active: 'folder',
      docked: 'folder',
    },
  },
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
      name: 'Project exit',
      roots: ['folder'],
      activePane: 'folder',
      arrangement: {},
      layout: project.definition.layout,
      project,
      panes: [
        {
          id: 'folder',
          type: 'folder',
          path: folder,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [folder],
          historyIndex: 0,
        },
      ],
    },
  ],
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));
const output = await mkdtemp(path.resolve('out/project-exit-acceptance-'));
const binary =
  process.env.VIEWER_TEST_BINARY ||
  path.resolve(
    process.argv.includes('--reproduce')
      ? 'out/Viewer-model-navigation-trash-v3-darwin-arm64/Viewer.app/Contents/MacOS/Viewer'
      : 'out/Viewer-project-recovery-v2-darwin-arm64/Viewer.app/Contents/MacOS/Viewer',
  );
let app = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
const evidence: string[] = [],
  captures: string[] = [];
const evaluate = <T = unknown>(expression: string) => connection!.evaluate<T>(expression);
const notice = () =>
  evaluate<string>(`document.querySelector('.project-file-notice')?.textContent || ''`);
async function capture(name: string) {
  await evaluate(`new Promise((resolve, reject) => {
    let previous = '', stable = 0, frames = 0;
    function check() {
      const surface = document.querySelector('dialog') || document.querySelector('.project-file-notice') || document.querySelector('.folder-explorer');
      const rect = surface?.getBoundingClientRect();
      let opaque = true, transforms = [];
      for (let node = surface; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (Number(style.opacity) < .999) opaque = false;
        transforms.push(style.transform);
      }
      const next = JSON.stringify([rect?.x, rect?.y, rect?.width, rect?.height, transforms]);
      stable = opaque && next === previous ? stable + 1 : 0;
      previous = next;
      if (stable >= 4) resolve(true);
      else if (++frames > 240) reject(new Error('Capture did not settle'));
      else requestAnimationFrame(check);
    }
    requestAnimationFrame(check);
  })`);
  const shot = await connection!.command<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
  });
  const destination = path.join(output, name + '.png');
  await writeFile(destination, Buffer.from(shot.data, 'base64'));
  captures.push(destination);
}
async function click(label: string) {
  assert.equal(
    await evaluate<boolean>(`(() => {
    const button = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(label)});
    button?.click(); return !!button;
  })()`),
    true,
    'Visible button ' + label,
  );
}
async function settleProjectRead() {
  await evaluate(
    `window.viewer.project({ kind: 'read', file: ${JSON.stringify(file)} }).catch(() => null)`,
  );
  await evaluate(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
}
try {
  connection = await app.connect();
  await until(notice, Boolean, 'missing project notice');
  await capture('missing-project-before-dismiss');
  await click('Dismiss');
  await until(notice, (text) => !text, 'notice dismissed');
  await evaluate(`window.__projectFolderEvents = 0; window.viewer.onEvent(event => {
    if (event.type === 'folder-changed' && event.path === ${JSON.stringify(folder)}) window.__projectFolderEvents++;
  })`);
  await writeFile(path.join(folder, 'Unrelated.txt'), 'Generated unrelated change.\n');
  await until(
    () => evaluate<number>('window.__projectFolderEvents'),
    Boolean,
    'real folder notification',
  );
  await settleProjectRead();
  if (process.argv.includes('--reproduce')) {
    assert.match(await notice(), /No project definition was found/);
    await capture('recurring-notice-original');
    evidence.push(
      'Reproduced: Dismiss hides the missing-file warning only until an unrelated real folder change.',
    );
  } else {
    assert.equal(
      await notice(),
      '',
      'Dismiss must suppress the unchanged problem on later folder notifications',
    );
    evidence.push(
      'Dismiss survives an unrelated real folder notification for the same missing definition.',
    );
    // Remount the same saved association to show the recovery action in a fresh session.
    await app.close(connection);
    connection = undefined;
    app = await ownedApp(binary, profile);
    connection = await app.connect();
    await until(
      notice,
      (text) => text.includes('Project file is missing'),
      'clear missing-file recovery',
    );
    await evaluate(`document.querySelector('.folder-explorer').focus()`);
    await capture('missing-project-dark');
    assert.equal(
      await evaluate<boolean>(`(() => {
      const warning = document.querySelector('.project-file-notice').getBoundingClientRect();
      const toolbar = document.querySelector('.plane-controls').getBoundingClientRect();
      return warning.bottom <= toolbar.top + 1;
    })()`),
      true,
      'Project warning must not cover the docked plane toolbar',
    );
    await connection.command('Emulation.setDeviceMetricsOverride', {
      width: 900,
      height: 640,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate(
      `window.viewer.settingsGet().then(s => window.viewer.settingsPatch([{path:'settings.appearance',value:'light'}],s.revision))`,
    );
    await capture('missing-project-compact-light');
    await evaluate(`document.querySelector('[aria-label="Commands (⌘K)"]').click()`);
    await until(
      () => evaluate<string>('document.activeElement?.getAttribute("aria-label") || ""'),
      (value) => value === 'Search commands',
      'command focus',
    );
    await connection.command('Input.insertText', { text: 'Close project' });
    await until(
      () =>
        evaluate<string>(
          `document.querySelector('.command-result[aria-selected="true"]')?.textContent || ''`,
        ),
      (text) => text.includes('Close project'),
      'Close project command',
    );
    await capture('close-project-command-compact-light');
    for (const type of ['keyDown', 'keyUp'])
      await connection.command('Input.dispatchKeyEvent', {
        type,
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
        ...(type === 'keyDown' ? { text: '\r', unmodifiedText: '\r' } : {}),
      });
    await until(notice, (text) => !text, 'project closed');
    const savedFile = path.join(profile, 'viewer-state-v1.json');
    const detached = await until(
      async () => JSON.parse(await readFile(savedFile, 'utf8')) as SavedState,
      (value) => !value.workspaces[0].project,
      'detached association persisted',
    );
    assert.deepEqual(
      detached.workspaces[0].panes.map((pane) => ({ id: pane.id, path: pane.path })),
      [{ id: 'folder', path: folder }],
    );
    assert.deepEqual(detached.workspaces[0].roots, ['folder']);
    assert.equal(detached.workspaces[0].activePane, 'folder');
    await writeFile(path.join(folder, 'AfterClose.txt'), 'Generated change after closing.\n');
    await until(
      () => evaluate<number>('document.querySelectorAll(".folder-explorer").length'),
      Boolean,
      'folder remains open',
    );
    assert.equal(await notice(), '');
    await capture('closed-project-compact-light');
    evidence.push(
      'The visible Close project command detaches the project, persists it and keeps the folder/root/active plane.',
    );
    await app.close(connection);
    connection = undefined;
    app = await ownedApp(binary, profile);
    connection = await app.connect();
    await until(
      () => evaluate<number>('document.querySelectorAll(".folder-explorer").length'),
      Boolean,
      'cold ordinary workspace',
    );
    assert.equal(await notice(), '');
    evidence.push(
      'A cold restart keeps the ordinary workspace and does not reattach the missing project.',
    );
    await evaluate(
      `Array.from(document.querySelectorAll('.location-sidebar button')).find(b => b.textContent.trim() === 'Trash').click()`,
    );
    await until(
      () => evaluate<boolean>(`!!document.querySelector('dialog[aria-label="Trash"]')`),
      Boolean,
      'native Trash dialog',
    );
    const trash = await until(
      () => evaluate<string>(`document.querySelector('dialog[aria-label="Trash"]').textContent`),
      (text) =>
        text.includes('unavailable') || text.includes('empty') || text.includes('Trash location'),
      'Trash read complete',
    );
    if (trash.includes('Full Disk Access')) {
      assert.ok(trash.includes('Privacy Settings'));
      assert.ok(!trash.includes('EPERM'));
      assert.ok(!trash.includes('Allow access…'));
      await evaluate(
        `window.viewer.settingsGet().then(s => window.viewer.settingsPatch([{path:'settings.appearance',value:'dark'}],s.revision))`,
      );
      await capture('trash-permission-dark');
      await connection.command('Emulation.setDeviceMetricsOverride', {
        width: 900,
        height: 640,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await evaluate(
        `window.viewer.settingsGet().then(s => window.viewer.settingsPatch([{path:'settings.appearance',value:'light'}],s.revision))`,
      );
      await capture('trash-permission-compact-light');
      evidence.push(
        'Actual macOS denial explains Full Disk Access and offers Privacy Settings; erasure stays disabled.',
      );
    }
  }
  await writeFile(
    path.join(output, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        binary,
        root,
        evidence,
        captures,
        scope:
          'Owned hidden native app. No deletion, permission grant, native erasure menu or approval.',
      },
      null,
      2,
    ),
  );
  for (const entry of evidence) console.log('PASS', entry);
  console.log('Evidence:', output);
} finally {
  await app.close(connection);
  console.log('Fixtures preserved:', root);
}
