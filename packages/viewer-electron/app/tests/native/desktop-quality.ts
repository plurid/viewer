/** Generated desktop tasks. Native pickers and observed human usability are separate. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { defaultSettings } from '../../src/domain/services';
import { temporaryRoot } from '../../tools/temporary';
import { hashFile } from '../../tools/qualification/source';
import { ownedApp, until } from '../owned-app';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await temporaryRoot('viewer-native-desktop-quality-');
const files = path.join(root, 'Files'),
  profile = path.join(root, 'Profile');
for (const directory of [
  files,
  profile,
  path.join(profile, 'notes'),
  path.join(profile, 'text-buffers'),
])
  await mkdir(directory);
for (let index = 0; index < 60; index++)
  await writeFile(
    path.join(files, 'Document ' + String(index).padStart(2, '0') + '.txt'),
    'Generated document ' + index,
    { flag: 'wx' },
  );
const noteID = randomUUID();
await writeFile(
  path.join(profile, 'notes', noteID + '.json'),
  JSON.stringify({
    id: noteID,
    kind: 'note',
    title: 'Generated retained note',
    directory: files,
    text: 'A private generated note.',
    revision: 1,
    updated: Date.now(),
  }),
  { flag: 'wx' },
);
const settings = defaultSettings(files);
settings.hotkey.enabled = false;
settings.providers = [];
settings.appearance = 'dark';
settings.browsing.scrollbars = 'always';
settings.toolbars = { folder: ['missing.extension', 'new-folder'] };
const ui = normalizePreferences();
ui.sidebar.inNewPlanes = false;
ui.space.headerControls.back = false;
ui.space.opening = 'dock';
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  ui,
  activeWorkspace: 'desktop',
  favorites: [],
  recents: [],
  workspaces: [
    {
      id: 'desktop',
      name: 'Generated desktop quality',
      roots: ['folder'],
      activePane: 'folder',
      arrangement: {},
      panes: [
        {
          id: 'folder',
          type: 'folder',
          path: files,
          history: [files],
          historyIndex: 0,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          sidebar: { visible: false, width: 210 },
        },
      ],
    },
  ],
};
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
});
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), { flag: 'wx' });
const observations: unknown[] = [];
let passed = false;
async function session(restart: boolean) {
  const app = await ownedApp(binary!, profile);
  let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
  try {
    connection = await app.connect();
    const { evaluate, command } = connection;
    await command('Performance.enable');
    const viewport = (width: number, height: number) =>
      command('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
    const appearance = (value: 'dark' | 'light') =>
      evaluate(
        'window.viewer.settingsGet().then(s=>window.viewer.settingsPatch([{path:"settings.appearance",value:' +
          JSON.stringify(value) +
          '}],s.revision))',
      );
    const click = (label: string, scope: string) =>
      evaluate(
        '(()=>{const b=[...document.querySelectorAll(' +
          JSON.stringify(scope + ' button') +
          ')].find(b=>b.textContent.trim()===' +
          JSON.stringify(label) +
          ");if(!b||b.disabled)throw new Error('Unavailable button');b.click()})()",
      );
    const field = async (value: string) => {
      await evaluate(
        '(()=>{const input=document.querySelector(\'[aria-label="Find an action"]\'); input.focus();input.select()})()',
      );
      if (value) await command('Input.insertText', { text: value });
      else {
        await command('Input.dispatchKeyEvent', {
          type: 'rawKeyDown',
          key: 'Backspace',
          code: 'Backspace',
          windowsVirtualKeyCode: 8,
        });
        await command('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Backspace',
          code: 'Backspace',
          windowsVirtualKeyCode: 8,
        });
      }
    };
    const settle = () =>
      evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const capture = async (name: string) => {
      await settle();
      const { data } = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
      await writeFile(path.join(root, name + '.png'), Buffer.from(data, 'base64'), { flag: 'wx' });
    };
    const geometry = async (name: string) => {
      const rect = await evaluate<{
        width: number;
        height: number;
        left: number;
        right: number;
        top: number;
        bottom: number;
        footer: number;
      }>(
        '(()=>{const d=document.querySelector("dialog[open]"),r=d.getBoundingClientRect(),f=d.querySelector("footer").getBoundingClientRect();return {width:innerWidth,height:innerHeight,left:r.left,right:r.right,top:r.top,bottom:r.bottom,footer:f.bottom}})()',
      );
      assert.ok(
        rect.left >= 0 &&
          rect.right <= rect.width + 1 &&
          rect.top >= 0 &&
          rect.bottom <= rect.height + 1,
        name + ' fits viewport',
      );
      assert.ok(rect.footer <= rect.height + 1, name + ' footer reachable');
      observations.push({ name, rect });
    };
    await viewport(1280, 900);
    await until(
      () => evaluate<boolean>('!!document.querySelector("[data-file-path]")'),
      Boolean,
      'folder rows',
    );
    await until(
      () => evaluate<boolean>('!!document.querySelector(\'[aria-label="What can I do here?"]\')'),
      Boolean,
      'contextual discovery',
    );
    assert.equal(await evaluate('document.documentElement.dataset.scrollbars'), 'always');
    assert.equal(await evaluate('!!document.querySelector(\'[aria-label="Back"]\')'), false);
    assert.equal(
      await evaluate(
        'document.querySelector(\'[aria-label="Missing action: missing.extension"]\').disabled',
      ),
      true,
    );
    if (!restart) {
      await until(
        () =>
          evaluate<boolean>(
            '(()=>{const h=document.querySelector(".plane-controls").getBoundingClientRect(),s=document.querySelector(".file-scroll").getBoundingClientRect();let el=document.querySelector(".folder-explorer"),opacity=1;while(el){opacity*=Number(getComputedStyle(el).opacity);el=el.parentElement}return h.left>=0&&h.right<=innerWidth+1&&s.bottom<=innerHeight+1&&opacity>.999&&!document.querySelector("[data-plurid-motion]")})()',
          ),
        Boolean,
        'fully framed folder',
      );
      await capture('folder-always-visible-scrollbars');
    }
    await evaluate(
      '(()=>{const b=document.querySelector(\'[aria-label="What can I do here?"]\');b.focus();b.click()})()',
    );
    await until(
      () => evaluate<boolean>('!!document.querySelector(".capabilities-dialog")'),
      Boolean,
      'discovery dialog',
    );
    if (!restart) {
      await field('New file');
      await until(
        () =>
          evaluate<boolean>(
            '[...document.querySelectorAll(".capabilities-results strong")].some(row=>row.textContent==="New file…")',
          ),
        Boolean,
        'new file action',
      );
      await evaluate(
        '(()=>{const row=[...document.querySelectorAll(".capabilities-results li")].find(row=>row.querySelector("strong").textContent==="New file…");[...row.querySelectorAll("button")].find(button=>button.textContent==="Pin").click()})()',
      );
      await until(
        () =>
          evaluate<boolean>('!!document.querySelector(\'[aria-label="Move New file… earlier"]\')'),
        Boolean,
        'saved pin',
      );
      await evaluate('document.querySelector(".capabilities-pins > summary").click()');
      for (let index = 0; index < 2; index++) {
        await evaluate('document.querySelector(\'[aria-label="Move New file… earlier"]\').click()');
        await until(
          () =>
            evaluate<number>(
              'document.querySelectorAll(".capabilities-pins button:disabled").length',
            ),
          (count) => count === 2,
          'reorder saved',
        );
      }
      await field('new floder');
      await until(
        () =>
          evaluate<boolean>(
            '[...document.querySelectorAll(".capabilities-results strong")].some(row=>row.textContent==="New folder…")',
          ),
        Boolean,
        'explicit typo suggestion',
      );
      assert.equal(await evaluate('document.querySelectorAll("dialog[open]").length'), 1);
      await field('');
      await evaluate('document.querySelector(".capabilities-search input[type=checkbox]").click()');
      await until(
        () =>
          evaluate<boolean>(
            'document.querySelector(".capabilities-dialog").textContent.includes("Select exactly one")',
          ),
        Boolean,
        'unavailable explanation',
      );
      await geometry('capabilities-dark-wide');
      await capture('capabilities-dark-wide');
      await evaluate('document.querySelector(".capabilities-pins > summary").click()');
      await evaluate(
        'window.viewer.settingsGet().then(s=>window.viewer.settingsPatch([{path:"settings.toolbars",value:{...s.settings.toolbars,folder:["new-file","missing.extension","new-folder","frame-plane","dock","close-plane","new-scratch-plane","new-terminal-plane"]}}],s.revision))',
      );
      await until(
        () =>
          evaluate<boolean>(
            'document.querySelector(".capabilities-pins > summary").textContent.includes("8/8")',
          ),
        Boolean,
        'eight-pin limit',
      );
      await viewport(760, 540);
      await appearance('light');
      await geometry('capabilities-light-minimum');
      const visibleRows = await evaluate<number>(
        '(()=>{const r=document.querySelector(".capabilities-action-scroll").getBoundingClientRect();return [...document.querySelectorAll(".capabilities-results li")].filter(row=>{const b=row.getBoundingClientRect();return b.top>=r.top&&b.bottom<=r.bottom}).length})()',
      );
      assert.ok(
        visibleRows >= 2,
        'At least two complete action rows fit at minimum height with eight pins',
      );
      const searchTop = await evaluate<number>(
        'document.querySelector(".capabilities-search").getBoundingClientRect().top',
      );
      await evaluate('document.querySelector(".capabilities-action-scroll").scrollTop=200');
      await settle();
      assert.equal(
        await evaluate(
          'document.querySelector(".capabilities-search").getBoundingClientRect().top',
        ),
        searchTop,
        'Search stays stationary',
      );
      await evaluate('document.querySelector(".capabilities-action-scroll").scrollTop=0');
      await capture('capabilities-light-minimum');
      await evaluate('document.querySelector(".capabilities-pins > summary").click()');
      await until(
        () => evaluate<boolean>('document.querySelector(".capabilities-pins").open'),
        Boolean,
        'expanded eight-pin editor',
      );
      await geometry('expanded-tools-light-minimum');
      assert.equal(
        await evaluate(
          '(()=>{const body=document.querySelector(".capabilities-body"),help=document.querySelector(".capabilities-help").getBoundingClientRect();return help.bottom<=body.getBoundingClientRect().bottom+1})()',
        ),
        true,
        'expanded tools do not clip lower controls',
      );
      await evaluate(
        'const pins=document.querySelector(".capabilities-pins");pins.scrollTop=pins.scrollHeight',
      );
      await capture('capabilities-tools-light-minimum');
      await evaluate('document.querySelector(".capabilities-help > summary").click()');
      await until(
        () =>
          evaluate<boolean>(
            'document.querySelector(".capabilities-help").open&&!document.querySelector(".capabilities-pins").open',
          ),
        Boolean,
        'one auxiliary disclosure at a time',
      );
      await geometry('expanded-help-light-minimum');
      assert.equal(
        await evaluate(
          '(()=>{const body=document.querySelector(".capabilities-body"),help=document.querySelector(".capabilities-help").getBoundingClientRect();return help.bottom<=body.getBoundingClientRect().bottom+1})()',
        ),
        true,
        'expanded help remains in the body',
      );
      await capture('capabilities-help-light-minimum');
      await evaluate('document.querySelector(".capabilities-help > summary").click()');
      await field('qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq');
      await until(
        () => evaluate<boolean>('!!document.querySelector(".capabilities-empty")'),
        Boolean,
        'empty-state recovery',
      );
      await capture('capabilities-empty-light-minimum');
      await click('Clear search', '.capabilities-empty');
      await until(
        () => evaluate<number>('document.querySelectorAll(".capabilities-results li").length'),
        (count) => count > 0,
        'search recovered',
      );
      await evaluate(
        'window.viewer.settingsGet().then(s=>window.viewer.settingsPatch([{path:"settings.toolbars",value:{...s.settings.toolbars,folder:["new-file","missing.extension","new-folder"]}}],s.revision))',
      );
    } else
      assert.equal(
        await evaluate(
          'document.querySelector(".capabilities-pins li span").firstChild.textContent',
        ),
        'New file…',
      );
    await click('Done', '.capabilities-dialog');
    await settle();
    assert.equal(
      await evaluate('document.activeElement?.getAttribute("aria-label")'),
      'What can I do here?',
      'focus returns to opener',
    );
    if (!restart) {
      await viewport(1280, 900);
      await appearance('dark');
      await evaluate('document.querySelector(\'[aria-label="Commands (⌘K)"]\').click()');
      await command('Input.insertText', { text: 'Backup and restore' });
      await until(
        () =>
          evaluate<boolean>(
            'document.querySelector(".command-result[aria-selected=true]")?.textContent.includes("Backup and restore")',
          ),
        Boolean,
        'backup command',
      );
      await evaluate('document.querySelector(".command-result[aria-selected=true]").click()');
      await until(
        () => evaluate<boolean>('!!document.querySelector(".backup-dialog")'),
        Boolean,
        'backup dialog',
      );
      await capture('backup-start-dark-wide');
      await click('Create backup…', '.backup-dialog');
      await until(
        () => evaluate<boolean>('!!document.querySelector(".backup-counts")'),
        Boolean,
        'prepared snapshot',
      );
      await geometry('backup-review-dark-wide');
      await capture('backup-review-dark-wide');
      await viewport(760, 540);
      await appearance('light');
      await geometry('backup-review-light-minimum');
      await capture('backup-review-light-minimum');
      await click('Cancel', '.backup-dialog');
      await viewport(1280, 900);
      for (let index = 0; index < 5; index++) {
        await evaluate('document.querySelector(\'[aria-label="What can I do here?"]\').click()');
        await until(
          () => evaluate<boolean>('!!document.querySelector(".capabilities-dialog")'),
          Boolean,
          'repeat discovery',
        );
        await click('Done', '.capabilities-dialog');
      }
    }
    observations.push({
      restart,
      pinned: await evaluate(
        '[...document.querySelectorAll(".plane-pinned-tools button")].map(button=>button.getAttribute("aria-label"))',
      ),
      metrics: await command('Performance.getMetrics'),
    });
  } finally {
    await app.close(connection);
  }
}
try {
  await session(false);
  await session(true);
  const config = parse(await readFile(path.join(profile, 'config.jsonc'), 'utf8'));
  assert.deepEqual(config.settings.toolbars.folder, [
    'new-file',
    'missing.extension',
    'new-folder',
  ]);
  assert.equal(config.settings.browsing.scrollbars, 'always');
  assert.equal(config.ui.space.headerControls.back, false);
  passed = true;
} finally {
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      {
        passed,
        capturedAt: new Date().toISOString(),
        candidate: await hashFile(path.resolve(path.dirname(binary), '../Resources/app.asar')),
        platform: process.platform,
        architecture: process.arch,
        observations,
        notObserved: ['native save/open picker acceptance', 'human usability', 'VoiceOver'],
      },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  console.log('Desktop quality evidence:', root);
}
