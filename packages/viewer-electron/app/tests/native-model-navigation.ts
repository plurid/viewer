/** Owned native UI checks. Source STEP is read-only; all generated fixtures are preserved. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import type { SavedState } from '../src/domain/contracts';
import { cadMeshes, type ImportedCad } from '../src/renderer/previews/model/cad-data';
import { ownedApp, until } from './owned-app';
import { temporaryRoot } from '../tools/temporary';
const source =
  process.env.VIEWER_TEST_STEP_FILE ??
  '/Users/ly3xqhl8g9/Downloads/Neuer ZIP-komprimierter Ordner (2)/2026-10-08_16-38-44/00026295_T02.200.008_00A_Festteil.step';
const original = await readFile(source),
  hash = createHash('sha256').update(original).digest('hex');
const root = await temporaryRoot('viewer-model-navigation-');
const profile = path.join(root, 'Profile'),
  files = path.join(root, 'Files'),
  folder = path.join(files, 'Engineering');
await Promise.all([profile, folder].map((file) => mkdir(file, { recursive: true })));
const step = path.join(folder, 'Part.step'),
  stl = path.join(folder, 'Part.stl');
await writeFile(step, original);
const require = createRequire(import.meta.url);
const create = require('occt-import-js') as () => Promise<{
  ReadStepFile(data: Uint8Array, params: { linearUnit: string }): ImportedCad;
}>;
const occt = await create(),
  meshes = cadMeshes(occt.ReadStepFile(original, { linearUnit: 'millimeter' }));
const facets = ['solid Fixture'];
for (const mesh of meshes)
  for (let i = 0; i < mesh.indices.length; i += 3) {
    facets.push('facet normal 0 0 0', 'outer loop');
    for (let j = 0; j < 3; j++) {
      const n = mesh.indices[i + j] * 3;
      facets.push(`vertex ${mesh.positions[n]} ${mesh.positions[n + 1]} ${mesh.positions[n + 2]}`);
    }
    facets.push('endloop', 'endfacet');
  }
facets.push('endsolid Fixture');
await writeFile(stl, facets.join('\n'));
const state: SavedState = {
  version: 4,
  activeWorkspace: 'test',
  look: 'dark',
  favorites: [],
  recents: [],
  workspaces: [
    {
      id: 'test',
      name: 'Model and links',
      roots: ['parent'],
      activePane: 'parent',
      arrangement: {},
      panes: [
        {
          id: 'parent',
          type: 'folder',
          path: files,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [files],
          historyIndex: 0,
        },
      ],
    },
  ],
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));
const output = await mkdtemp(path.resolve('out/model-navigation-acceptance-'));
const binary =
  process.env.VIEWER_TEST_BINARY ??
  path.resolve('out/Viewer-model-navigation-darwin-arm64/Viewer.app/Contents/MacOS/Viewer');
let viewer = await ownedApp(binary, profile),
  main: Awaited<ReturnType<typeof viewer.connect>> | undefined;
const evidence: string[] = [],
  captures: string[] = [];
const evaluate = <T = unknown>(expression: string) => main!.evaluate<T>(expression);
const button = (label: string) =>
  `Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(label)})`;
async function click(label: string) {
  await evaluate(`${button(label)}.click()`);
}
async function key(key: string, code = key) {
  for (const type of ['keyDown', 'keyUp'])
    await main!.command('Input.dispatchKeyEvent', {
      type,
      key,
      code,
      ...(key === 'Enter'
        ? {
            windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13,
            ...(type === 'keyDown' ? { text: '\r', unmodifiedText: '\r' } : {}),
          }
        : {}),
    });
}
async function palette(label: string) {
  await evaluate(`document.querySelector('[aria-label="Commands (⌘K)"]').click()`);
  await until(
    () => evaluate<string>('document.activeElement?.getAttribute("aria-label")||""'),
    (value) => value === 'Search commands',
    'palette focus',
  );
  await main!.command('Input.insertText', { text: label });
  await until(
    () =>
      evaluate<string>(
        `document.querySelector('.command-result[aria-selected="true"]')?.textContent||''`,
      ),
    (text) => text.includes(label),
    'command ' + label,
  );
  await key('Enter');
  await until(
    () => evaluate<boolean>(`!!document.querySelector('[aria-label="Search commands"]')`),
    (value) => !value,
    'palette closed',
  );
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
}
async function select(file: string) {
  await until(
    () =>
      evaluate<boolean>(
        `Array.from(document.querySelectorAll('[data-file-path]')).some(n=>n.dataset.filePath===${JSON.stringify(file)})`,
      ),
    Boolean,
    'visible source',
  );
  await evaluate(
    `Array.from(document.querySelectorAll('[data-file-path]')).find(n=>n.dataset.filePath===${JSON.stringify(file)}).click()`,
  );
}
async function models() {
  await until(
    () => evaluate<string>(`document.querySelector('.model-statistics')?.textContent||''`),
    (text) => text.includes('meshes'),
    'loaded model',
  );
}
async function metrics(width: number, height: number) {
  await main!.command('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
}
async function capture(name: string, selector = '.model-stage') {
  let previous = '',
    stable = 0;
  await until(
    async () => {
      const value = await evaluate<{ opacity: number; geometry: unknown[] }>(
        `(()=>{let n=document.querySelector(${JSON.stringify(selector)}),opacity=1,geometry=[];if(!n)return{opacity:0,geometry};while(n){const s=getComputedStyle(n),r=n.getBoundingClientRect();opacity*=Number(s.opacity);geometry.push([r.x,r.y,r.width,r.height,s.transform]);n=n.parentElement}return{opacity,geometry}})()`,
      );
      const serialized = JSON.stringify(value);
      stable = previous === serialized ? stable + 1 : 0;
      previous = serialized;
      return value;
    },
    (value) => value.opacity > 0.999 && stable >= 3,
    'settled capture ' + name,
  );
  const shot = await main!.command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  const file = path.join(output, name + '.png');
  await writeFile(file, Buffer.from(shot.data, 'base64'));
  captures.push(file);
}
async function theme(look: 'dark' | 'light') {
  await evaluate(
    `window.viewer.settingsGet().then(s=>window.viewer.settingsPatch([{path:'settings.appearance',value:${JSON.stringify(look)}}],s.revision))`,
  );
  await until(
    () => evaluate<string>('document.documentElement.dataset.look'),
    (value) => value === look,
    'theme',
  );
  if (await evaluate<boolean>('!!document.querySelector(".model-viewer")')) await models();
}
/** Chooses in a choice menu (ui/ChoiceMenu.tsx) as a person does: its button, then the value's row. */
async function choose(label: string, value: string) {
  const row = JSON.stringify(`.choice-menu [data-menu-id=${JSON.stringify('choice:' + value)}]`);
  await evaluate(`document.querySelector('button[aria-label=${JSON.stringify(label)}]').click()`);
  await until(
    () => evaluate<boolean>(`!!document.querySelector(${row})`),
    Boolean,
    label + ' menu',
  );
  await evaluate(`document.querySelector(${row}).click()`);
}
async function surface(value: string) {
  await choose('Model surface', value);
}
async function lighting(value: string) {
  await choose('Model lighting', value);
}
async function saved() {
  return JSON.parse(
    await readFile(path.join(profile, 'viewer-state-v1.json'), 'utf8'),
  ) as SavedState;
}
async function active(id: string) {
  await until(saved, (s) => s.workspaces[0].activePane === id, 'active ' + id);
}
async function engine() {
  assert.ok(
    await evaluate<boolean>(
      `(()=>{const n=document.querySelector('[data-viewer-plane]'),key=Object.keys(n).find(k=>k.startsWith('__reactFiber'));for(let f=n[key];f;f=f.return)for(let h=f.memoizedState;h;h=h.next){const api=h.memoizedState?.current;if(api?.camera?.frame&&api?.tree?.get){window.__modelQA=api;return true;}}return false;})()`,
    ),
  );
}
async function settle() {
  let previous = '',
    stable = 0;
  await until(
    async () => {
      const s = await evaluate<string>('JSON.stringify(window.__modelQA.camera.get())');
      stable = previous === s ? stable + 1 : 0;
      previous = s;
      return s;
    },
    () => stable >= 4,
    'settled space camera',
  );
}
try {
  main = await viewer.connect();
  await metrics(1440, 940);
  await select(folder);
  await palette('Open linked plane');
  await until(
    () =>
      evaluate<boolean>(
        `!!document.querySelector('[data-file-owner] [aria-label="View linked plane for Engineering"]')`,
      ),
    Boolean,
    'folder link marker',
  );
  await engine();
  await settle();
  const folderID = await evaluate<string>(
    'window.__modelQA.tree.get()[0].children[0].routeDivisions.plane.parameters.id',
  );
  assert.ok(
    await evaluate<boolean>(
      `!!document.querySelector('[data-viewer-plane="'+${JSON.stringify(folderID)}+'"] [aria-label="Back to parent plane"]')`,
    ),
  );
  await select(step);
  await palette('Quick preview');
  await models();
  if (process.argv.includes('--baseline')) {
    await capture('original-step-dark');
    evidence.push('Read-only source STEP renders in the original package.');
  } else {
    await capture('step-contrast-dark');
    await click('Shading');
    await until(
      () => evaluate<boolean>('!!document.querySelector(".model-shading-panel")'),
      Boolean,
      'shading controls',
    );
    const canvas = await evaluate<boolean>(
      '(()=>{window.__modelCanvas=document.querySelector(".model-stage canvas");return true;})()',
    );
    assert.ok(canvas);
    await lighting('studio');
    await capture('step-studio-controls-dark');
    await lighting('soft');
    await capture('step-soft-dark');
    await surface('clay');
    await lighting('contrast');
    await capture('step-clay-dark');
    await evaluate(
      `Array.from(document.querySelectorAll('.model-shading-panel label')).find(n=>n.textContent.includes('Show edges')).querySelector('input').click()`,
    );
    await capture('step-clay-edges-dark');
    await surface('normals');
    assert.ok(
      await evaluate<boolean>(`document.querySelector('[aria-label="Model lighting"]').disabled`),
    );
    await capture('step-normals-dark');
    await surface('clay');
    await evaluate(
      `(()=>{const input=document.querySelector('[aria-label="Model brightness"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'0.65');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await until(
      () => evaluate<string>('document.querySelector(".model-brightness output").textContent'),
      (text) => text === '65%',
      'brightness',
    );
    assert.ok(
      await evaluate<boolean>(
        'window.__modelCanvas===document.querySelector(".model-stage canvas")',
      ),
      'shading does not recreate the canvas',
    );
    await main.command('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
    });
    await until(
      () => evaluate<boolean>('!!document.querySelector(".model-shading-panel")'),
      (v) => !v,
      'Escape closes shading',
    );
    assert.ok(
      await evaluate<boolean>('!!document.querySelector("dialog .model-stage canvas")'),
      'Escape leaves Quick Preview open',
    );
    await click('Shading');
    await click('Reset shading');
    await metrics(900, 640);
    await theme('light');
    await capture('step-controls-compact-light');
    await evaluate(`document.querySelector('[aria-label="Close shading controls"]').click()`);
    await evaluate(`document.querySelector('dialog[open] > header [aria-label="Close"]').click()`);
    await select(stl);
    await palette('Quick preview');
    await models();
    await click('Shading');
    await surface('clay');
    await capture('stl-clay-compact-light');
    await evaluate(`document.querySelector('dialog[open] > header [aria-label="Close"]').click()`);
    await theme('dark');
    await select(step);
    await palette('Quick preview');
    await models();
    await evaluate(`${button('Open linked plane')}.click()`);
    await models();
    await engine();
    await settle();
    const modelID = await evaluate<string>(
      'window.__modelQA.tree.get()[0].children[0].children[0].routeDivisions.plane.parameters.id',
    );
    await active(modelID);
    assert.ok(
      await evaluate<boolean>(
        `!!document.querySelector('[data-viewer-plane="'+${JSON.stringify(modelID)}+'"] [aria-label="Back to parent plane"]')`,
      ),
    );
    await palette('Dock plane');
    await settle();
    // Orbit once so this check compares a user camera pose, rather than an
    // absent default camera record (initial framing is deliberately unsaved).
    const canvasBounds = await evaluate<{ x: number; y: number }>(
      `(()=>{const r=document.querySelector('.model-stage canvas').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    await main.command('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      button: 'left',
      buttons: 1,
      x: canvasBounds.x,
      y: canvasBounds.y,
      clickCount: 1,
    });
    await main.command('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      button: 'left',
      buttons: 1,
      x: canvasBounds.x + 35,
      y: canvasBounds.y + 12,
    });
    await main.command('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      button: 'left',
      buttons: 0,
      x: canvasBounds.x + 35,
      y: canvasBounds.y + 12,
      clickCount: 1,
    });
    await click('Shading');
    await surface('clay');
    await lighting('contrast');
    await capture('linked-model-docked-compact-dark');
    await evaluate(`document.querySelector('[aria-label="Close shading controls"]').click()`);
    let previousCamera = '',
      stableCamera = 0;
    const before = await until(
      saved,
      (s) => {
        const value = JSON.stringify(s.previewStates?.['test:' + modelID]?.['model.camera']);
        stableCamera = value && value === previousCamera ? stableCamera + 1 : 0;
        previousCamera = value;
        return !!value && stableCamera >= 12;
      },
      'saved stable model camera',
    );
    const camera = JSON.stringify(before.previewStates?.['test:' + modelID]?.['model.camera']);
    await click('Shading');
    await lighting('soft');
    await surface('shaded');
    assert.equal(
      JSON.stringify((await saved()).previewStates?.['test:' + modelID]?.['model.camera']),
      camera,
    );
    await evaluate(`document.querySelector('[aria-label="Close shading controls"]').click()`);
    await evaluate(
      `document.querySelector('[data-viewer-plane="'+${JSON.stringify(modelID)}+'"] [aria-label="Back to parent plane"]').click()`,
    );
    await active(folderID);
    await settle();
    assert.equal(
      await evaluate<string>('window.__modelQA.camera.docked()'),
      await evaluate<string>(`window.__modelQA.tree.get()[0].children[0].planeID`),
    );
    const marker = `document.querySelector('[aria-label="View linked plane for Part.step"]')`;
    await until(() => evaluate<boolean>(`!!${marker}`), Boolean, 'model link marker');
    await metrics(1440, 940);
    await capture('parent-link-markers-dark', '[data-viewer-plane]');
    const count = (await saved()).workspaces[0].panes.length;
    await select(step);
    await palette('View open plane');
    await active(modelID);
    await settle();
    assert.equal((await saved()).workspaces[0].panes.length, count, 'View open plane never spawns');
    await palette('Back to parent plane');
    await active(folderID);
    await settle();
    await evaluate(`${marker}.focus()`);
    assert.equal(
      await evaluate<string>('document.activeElement?.getAttribute("aria-label")'),
      'View linked plane for Part.step',
      'link marker receives actual DOM focus',
    );
    await key('Enter');
    await active(modelID);
    await settle();
    assert.equal((await saved()).workspaces[0].panes.length, count, 'link marker never spawns');
    await palette('Back to parent plane');
    await active(folderID);
    await settle();
    await evaluate(
      `window.viewer.settingsGet().then(s=>window.viewer.settingsPatch([{path:'ui.space.headerControls.parent',value:false}],s.revision))`,
    );
    await until(
      () =>
        evaluate<number>(
          `document.querySelectorAll('[data-viewer-plane] [aria-label="Back to parent plane"]').length`,
        ),
      (count) => count === 0,
      'hidden parent buttons',
    );
    await evaluate(
      `window.viewer.settingsGet().then(s=>window.viewer.settingsPatch([{path:'ui.space.headerControls.parent',value:true}],s.revision))`,
    );
    await until(
      () =>
        evaluate<boolean>(
          `!!document.querySelector('[data-viewer-plane="'+${JSON.stringify(folderID)}+'"] [aria-label="Back to parent plane"]')`,
        ),
      Boolean,
      'restored parent buttons',
    );
    await palette('Back to parent plane');
    await active('parent');
    await settle();
    assert.ok(
      !(await evaluate<boolean>(
        `!!document.querySelector('[data-viewer-plane=parent] [aria-label="Back to parent plane"]')`,
      )),
    );
    await evaluate(
      `document.querySelector('[aria-label="View linked plane for Engineering"]').click()`,
    );
    await active(folderID);
    await settle();
    await palette('Grid view');
    await capture('grid-link-marker-dark', '[data-file-owner]');
    await palette('Columns view');
    await capture('column-link-marker-dark', '[data-file-owner]');
    await palette('Gallery view');
    await capture('gallery-link-marker-dark', '[data-file-owner]');
    await palette('List view');
    await select(step);
    await palette('View open plane');
    await active(modelID);
    await settle();
    await click('Shading');
    await surface('clay');
    await lighting('contrast');
    await until(
      saved,
      (s) =>
        (s.previewStates?.['test:' + modelID]?.['model.appearance'] as { shading?: string })
          ?.shading === 'clay',
      'retained appearance',
    );
    await evaluate(`document.querySelector('[aria-label="Close shading controls"]').click()`);
    await viewer.close(main);
    main = undefined;
    viewer = await ownedApp(binary, profile);
    main = await viewer.connect();
    await engine();
    await models();
    await metrics(900, 640);
    await click('Shading');
    assert.equal(
      await evaluate<string>(`document.querySelector('[aria-label="Model surface"]').textContent`),
      'Clay',
    );
    await capture('restored-shading-compact-dark');
    evidence.push(
      'STEP and STL use Contrast by default; Studio/Soft, clay/normals, edges, shadows and brightness update the live canvas with unchanged dimensions and source bytes.',
    );
    evidence.push(
      'Shading controls work in Quick Preview and linked headers; Escape closes the controls, and linked appearance survives cold restart without resetting the camera.',
    );
    evidence.push(
      'Back to parent returns to the immediate parent, retains docking, is configurable, and is absent on root planes.',
    );
    evidence.push(
      'Parent file/folder markers and View open plane reuse the live plane without increasing pane count; marker activation works by keyboard and all four file views render it.',
    );
  }
  assert.equal(
    createHash('sha256')
      .update(await readFile(source))
      .digest('hex'),
    hash,
    'source STEP unchanged',
  );
  await writeFile(
    path.join(output, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        binary,
        root,
        sourceHash: hash,
        evidence,
        captures,
        scope:
          'Owned direct native app. Source model read-only; all fixtures preserved. No user deletion, physical accessibility or Store qualification.',
      },
      null,
      2,
    ),
  );
  evidence.forEach((text) => console.log('PASS ' + text));
  console.log('Evidence:', output);
} catch (error) {
  console.error('Native model/navigation check failed:', error);
  throw error;
} finally {
  console.log('Generated fixtures preserved:', root);
  await viewer.close(main);
}
