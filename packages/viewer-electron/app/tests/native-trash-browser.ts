/** Isolated native renderer fixtures. Never lists, empties or modifies system Trash.
 * Empty/Restore UI calls are stubs; original generated files remain untouched. */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { SavedState } from '../src/domain/contracts';
import { ownedApp, until } from './owned-app';

const root = await mkdtemp(path.join(os.tmpdir(), 'viewer-trash-browser-'));
const profile = path.join(root, 'Profile'),
  files = path.join(root, 'Files');
await mkdir(profile);
await mkdir(files);
const note = path.join(files, 'Build notes.txt');
const contents =
  'Build notes\n\nRetain the original drawings and models.\nCheck the assembly clearance before printing.\n';
await writeFile(note, contents);
const state: SavedState = {
  version: 4,
  look: 'dark',
  activeWorkspace: 'trash',
  favorites: [],
  recents: [],
  workspaces: [
    {
      id: 'trash',
      name: 'Trash browser check',
      roots: ['folder'],
      activePane: 'folder',
      arrangement: {},
      panes: [
        {
          id: 'folder',
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
const output = await mkdtemp(path.resolve('out/trash-browser-acceptance-'));
const binary =
  process.env.VIEWER_TEST_BINARY ||
  path.resolve('out/Viewer-trash-folder-v1-darwin-arm64/Viewer.app/Contents/MacOS/Viewer');
const app = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
const evaluate = <T = unknown>(expression: string) => connection!.evaluate<T>(expression);
const evidence: string[] = [],
  captures: string[] = [];
try {
  connection = await app.connect();
  const methods = await evaluate<string[]>('Object.keys(window.viewerNative)');
  assert.equal(
    methods.some((method) => /empty|erase|approv.*trash/i.test(method)),
    false,
  );
  assert.ok(methods.includes('trashConfirmation'));
  // Test-only interception in the owned renderer. The installed native API stays
  // immutable. Do not add any fixture/bypass endpoint to production.
  await connection.command('Page.enable');
  await connection.command('Page.addScriptToEvaluateOnNewDocument', {
    source: `
    (()=>{ window.__trashFixtureReady=true; const original=Object.freeze; Object.freeze=(object)=>object&&typeof object.trashList==='function'&&typeof object.bootstrap==='function'?object:original(object); })();
  `,
  });
  await connection.command('Page.reload', { ignoreCache: true });
  await until(
    () =>
      evaluate<boolean>(
        'window.__trashFixtureReady===true && !!window.viewer && !!document.querySelector("[data-file-owner]")',
      ),
    Boolean,
    'fixture renderer',
  );
  assert.equal(
    await evaluate<boolean>('Object.isFrozen(window.viewer)'),
    false,
    'UI fixture interception must be installed before any Trash interaction',
  );
  await evaluate(`(() => {
    const api=window.viewer, resource=api.resource;
    window.__trashCalls={confirmation:0,restore:0,paths:0,preview:0};
    window.__trashMode='normal';
    const make=(digit,name,directory,originalPath)=>({id:digit.repeat(64),name,directory,previewable:!directory,size:directory?0:1040,location:'Home',modified:1791950400000,deleted:'2026-10-14T17:15:00',...(originalPath?{originalPath}:{})});
    const folder=make('1','Project archive',true,'/Users/Example/Documents/Project archive');
    const note=make('2','Build notes.txt',false,'/Users/Example/Documents/Build notes.txt');
    const loose=make('3','Unsorted notes — original location unavailable.txt',false);
    const long=make('4','00026295_T02.200.008_00A_Assembly-review-notes.txt',false,'/Users/Example/Documents/Engineering/Assembly/00026295_T02.200.008_00A_Assembly-review-notes.txt');
    window.__trashFixtureItems=[folder,note,loose,long];
    api.trashList=async(folderID)=>({revision:'a'.repeat(64),locations:[{id:'home',name:'Home',state:'ready'}],truncated:false,canEmpty:window.__trashMode!=='empty',totalItems:4,items:window.__trashMode==='empty'?[]:folderID?[make('5','Nested notes.txt',false,'/Users/Example/Documents/Project archive/Nested notes.txt')]:window.__trashFixtureItems,ancestors:folderID?[folder]:[]});
    api.trashConfirmation=async()=>{window.__trashCalls.confirmation++};
    api.trashRestore=async(ids,destination)=>{window.__trashCalls.restore++;window.__trashLastRestore={ids,destination};if(window.__trashMode==='collision')throw Error('“Build notes.txt” already exists. Use Restore to… to choose another folder.');window.__trashFixtureItems=window.__trashFixtureItems.filter(item=>!ids.includes(item.id));return {restored:ids.length,cancelled:false}};
    api.trashCopyPaths=async()=>{window.__trashCalls.paths++};
    api.trashPreview=async()=>{window.__trashCalls.preview++;return resource(${JSON.stringify(note)})};
  })()`);
  assert.match(
    await evaluate<string>('window.viewer.trashList.toString()'),
    /__trashMode/,
    'fixture must intercept the inventory',
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.location-sidebar button')).find(button=>button.textContent.trim()==='Trash').click()`,
  );
  await until(
    () => evaluate<number>('document.querySelectorAll("[data-trash-id]").length'),
    (value) => value === 4,
    'Trash fixture rows',
  );
  const click = async (selector: string, button = 'left', count = 1) => {
    const point = await evaluate<{ x: number; y: number }>(
      `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+Math.min(r.width/2,180),y:r.y+r.height/2}})()`,
    );
    for (const type of ['mousePressed', 'mouseReleased'])
      await connection!.command('Input.dispatchMouseEvent', {
        type,
        ...point,
        button,
        clickCount: count,
      });
  };
  const key = async (key: string, code: string, modifiers = 0) => {
    for (const type of ['keyDown', 'keyUp'])
      await connection!.command('Input.dispatchKeyEvent', {
        type,
        key,
        code,
        modifiers,
        windowsVirtualKeyCode:
          key === 'Escape'
            ? 27
            : key === 'Enter'
              ? 13
              : key === ' '
                ? 32
                : key === 'ArrowDown'
                  ? 40
                  : 65,
      });
  };
  const capture = async (name: string, width: number, height: number) => {
    await connection!.command('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate('document.fonts.ready');
    let previous = '',
      stable = 0;
    await until(
      () =>
        evaluate<string>(
          `JSON.stringify(Array.from(document.querySelectorAll('dialog[open]')).map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height,getComputedStyle(e).opacity]}))`,
        ).then((value) => {
          stable = previous === value ? stable + 1 : 0;
          previous = value;
          return value;
        }),
      () => stable >= 3,
      'settled capture',
    );
    const { data } = await connection!.command<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
    });
    const file = path.join(output, name + '.png');
    await writeFile(file, Buffer.from(data, 'base64'));
    captures.push(file);
  };
  await capture('desktop-dark', 1440, 940);
  const layout = await evaluate<{ centered: boolean; utilitiesRight: boolean }>(
    `(()=>{const f=document.querySelector('.trash-footer').getBoundingClientRect(),b=document.querySelector('.trash-empty').getBoundingClientRect(),u=document.querySelector('.trash-utility-actions').getBoundingClientRect();return {centered:Math.abs((b.x+b.width/2)-(f.x+f.width/2))<1,utilitiesRight:u.x>b.right}})()`,
  );
  assert.deepEqual(layout, { centered: true, utilitiesRight: true });
  assert.equal(
    await evaluate<boolean>('!!document.querySelector(".trash-footer [aria-haspopup=menu]")'),
    false,
  );
  await evaluate('document.querySelector(".trash-empty").click()');
  assert.equal(
    await evaluate<number>('window.__trashCalls.confirmation'),
    0,
    'synthetic empty click is ignored',
  );
  // This trusted button click can reach ONLY the stub above. No native dialog or
  // erasure routine is invoked, and no approval is supplied by this test.
  await click('.trash-empty');
  await until(
    () => evaluate<number>('window.__trashCalls.confirmation'),
    (value) => value === 1,
    'native-prompt presenter stub',
  );
  evidence.push(
    'Centered Empty Trash with right-aligned Refresh/Done; synthetic activation rejected; trusted activation reaches only the presenter stub. No native confirmation was invoked.',
  );
  await click('[data-trash-id="' + '2'.repeat(64) + '"]');
  await key('a', 'KeyA', 4);
  assert.equal(
    await evaluate<number>(
      'document.querySelectorAll("[data-trash-id][aria-selected=true]").length',
    ),
    4,
  );
  await capture('compact-dark-selection', 900, 640);
  await key('Escape', 'Escape');
  await click('[data-trash-id="' + '2'.repeat(64) + '"]', 'right');
  await until(
    () => evaluate<string>('document.activeElement?.getAttribute("aria-label")||""'),
    (value) => value === 'Search actions',
    'Trash menu focus',
  );
  await capture('compact-dark-context', 900, 640);
  assert.equal(
    await evaluate<boolean>('!!document.querySelector(".trash-context-menu .command-result")'),
    true,
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.trash-context-menu .command-result')).find(button=>button.textContent.includes('Quick Look')).click()`,
  );
  await until(
    () => evaluate<boolean>('!!document.querySelector(".trash-preview-dialog .preview-host")'),
    Boolean,
    'scoped Quick Look',
  );
  await capture('desktop-dark-preview', 1440, 940);
  assert.equal(
    await evaluate<number>('document.querySelectorAll(".trash-preview-dialog footer").length'),
    1,
    'preview has one metadata/actions footer',
  );
  await evaluate('document.querySelector(".trash-preview-dialog header button").click()');
  await until(
    () => evaluate<boolean>('!document.querySelector(".trash-preview-dialog")'),
    Boolean,
    'preview closes',
  );
  evidence.push(
    'Native renderer selection, Command-A, Escape and right-click Quick Look use the ordinary preview host on generated text.',
  );
  await click('[data-trash-id="' + '1'.repeat(64) + '"]', 'left', 2);
  await until(
    () => evaluate<number>('document.querySelectorAll("[data-trash-id]").length'),
    (value) => value === 1,
    'folder contents',
  );
  assert.match(
    await evaluate<string>('document.querySelector(".trash-breadcrumbs").textContent'),
    /Project archive/,
  );
  await evaluate(
    `window.viewer.settingsGet().then(s=>window.viewer.settingsPatch([{path:'settings.appearance',value:'light'}],s.revision))`,
  );
  await capture('compact-light-folder', 900, 640);
  await evaluate('document.querySelector(".trash-breadcrumbs button").click()');
  await until(
    () => evaluate<number>('document.querySelectorAll("[data-trash-id]").length'),
    (value) => value === 4,
    'back to Trash',
  );
  await click('[data-trash-id="' + '2'.repeat(64) + '"]', 'right');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".trash-context-menu")'),
    Boolean,
    'info context menu',
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.trash-context-menu .command-result')).find(button=>button.textContent.includes('Get Info')).click()`,
  );
  await until(
    () => evaluate<boolean>('!!document.querySelector(".trash-info-dialog")'),
    Boolean,
    'Get Info',
  );
  await capture('compact-light-info', 900, 640);
  assert.match(
    await evaluate<string>('document.querySelector(".trash-info-dialog").textContent'),
    /Original location/,
  );
  await evaluate(
    'Array.from(document.querySelectorAll(".trash-info-dialog footer button")).find(button=>button.textContent==="Done").click()',
  );

  await click('[data-trash-id="' + '2'.repeat(64) + '"]');
  await evaluate(
    'window.__trashMode="collision";document.querySelector(".trash-selection-actions button:not(.icon-button)").click()',
  );
  await until(
    () => evaluate<string>('document.querySelector(".trash-body [role=alert]")?.textContent||""'),
    (value) => value.includes('already exists'),
    'safe collision state',
  );
  await capture('compact-light-collision', 900, 640);
  await evaluate(
    'window.__trashMode="normal";document.querySelector(".trash-selection-actions button:not(.icon-button)").click()',
  );
  await until(
    () => evaluate<number>('document.querySelectorAll("[data-trash-id]").length'),
    (value) => value === 3,
    'restore stub result',
  );
  evidence.push(
    'Folder navigation/breadcrumbs and restore success/collision states render correctly. Restore calls are stubs; no physical restore is claimed by this UI test.',
  );
  await evaluate(
    'window.__trashMode="empty";Array.from(document.querySelectorAll(".trash-footer button")).find(button=>button.textContent==="Refresh").click()',
  );
  await until(
    () => evaluate<boolean>('!!document.querySelector(".trash-body .empty-state")'),
    Boolean,
    'empty state',
  );
  assert.equal(await evaluate<boolean>('document.querySelector(".trash-empty").disabled'), true);
  await capture('compact-light-empty', 900, 640);
  assert.equal(await readFile(note, 'utf8'), contents);
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
          'Owned macOS renderer with generated file preview and UI-only Trash stubs. No system Trash listing, confirmation, physical restore or erasure. All generated files retained.',
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS Trash folder interactions, preview, footer, collision/empty states and synthetic-click guard.',
  );
  console.log('Evidence:', output);
} catch (error) {
  if (connection) {
    console.log(
      'Failure state:',
      await evaluate(
        `JSON.stringify({text:document.querySelector('dialog[open]')?.textContent,fixture:window.__trashCalls,list:window.viewer.trashList.toString(),rects:Array.from(document.querySelectorAll('.trash-dialog,.trash-body,.trash-inventory,.trash-scroll')).map(e=>({class:e.className,height:e.clientHeight,width:e.clientWidth}))})`,
      ),
    );
    const shot = await connection.command<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(path.join(output, 'failure.png'), Buffer.from(shot.data, 'base64'));
    console.log('Failure evidence:', output);
  }
  throw error;
} finally {
  await app.close(connection);
  console.log('Generated fixtures preserved:', root);
}
