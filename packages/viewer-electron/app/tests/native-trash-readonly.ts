/** Owned native read-only checks. Never invokes Trash actions or approves deletion. */
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import type { SavedState } from '../src/domain/contracts';
import type { TrashSnapshot } from '../src/domain/trash';
import { ownedApp, until } from './owned-app';
const root = await mkdtemp(path.join(os.tmpdir(), 'viewer-trash-readonly-'));
const profile = path.join(root, 'Profile'),
  files = path.join(root, 'Files');
await Promise.all([profile, files].map((file) => mkdir(file, { recursive: true })));
const state: SavedState = {
  version: 4,
  look: 'dark',
  activeWorkspace: 'read',
  favorites: [],
  recents: [],
  workspaces: [
    {
      id: 'read',
      name: 'Trash read-only check',
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
const output = await mkdtemp(path.resolve('out/trash-readonly-acceptance-'));
const binary =
  process.env.VIEWER_TEST_BINARY ??
  path.resolve(
    'out/Viewer-model-navigation-trash-v3-darwin-arm64/Viewer.app/Contents/MacOS/Viewer',
  );
const viewer = await ownedApp(binary, profile);
let main: Awaited<ReturnType<typeof viewer.connect>> | undefined;
try {
  main = await viewer.connect();
  await until(
    () => main!.evaluate<boolean>(`!!document.querySelector('[data-file-owner]')`),
    Boolean,
    'folder',
  );
  const advertised = await main.evaluate<string[]>('Object.keys(window.viewerNative)');
  assert.equal(
    advertised.some((method) => /empty|erase|delete.*trash/i.test(method)),
    false,
  );
  const snapshot = await main.evaluate<TrashSnapshot>('window.viewer.trashList()');
  assert.equal(
    snapshot.canEmpty,
    snapshot.items.length > 0 &&
      !snapshot.truncated &&
      snapshot.locations.every((location) => location.state === 'ready'),
  );
  // Drive only the ordinary sidebar link. Never open or select the native menu.
  await main.evaluate(
    `Array.from(document.querySelectorAll('.location-sidebar button')).find(button=>button.textContent.trim()==='Trash').click()`,
  );
  await until(
    () =>
      main!.evaluate<boolean>(
        '!!document.querySelector(".trash-footer")&&!document.querySelector(".trash-body .loading")',
      ),
    Boolean,
    'Trash view',
  );
  const unavailable = await main.evaluate<boolean>('!!document.querySelector(".trash-access")');
  assert.equal(
    unavailable,
    snapshot.locations.some((location) => location.state === 'unavailable'),
  );
  const capture = async (name: string, width: number, height: number) => {
    await main!.command('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    let previous = '',
      stable = 0;
    await until(
      async () => {
        const value = await main!.evaluate<{ opacity: number; geometry: unknown[] }>(
          `(()=>{let n=document.querySelector('.trash-dialog')||document.querySelector('[data-file-owner]'),opacity=1,geometry=[];if(!n)return{opacity:0,geometry};while(n){const s=getComputedStyle(n),r=n.getBoundingClientRect();opacity*=Number(s.opacity);geometry.push([r.x,r.y,r.width,r.height,s.transform]);n=n.parentElement}return{opacity,geometry}})()`,
        );
        const serialized = JSON.stringify(value);
        stable = previous === serialized ? stable + 1 : 0;
        previous = serialized;
        return value;
      },
      (value) => value.opacity > 0.999 && stable >= 4,
      'settled native capture ' + name,
    );
    const shot = await main!.command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(output, name + '.png'), Buffer.from(shot.data, 'base64'));
  };
  await capture('native-trash-dark', 1440, 940);
  await capture('native-trash-compact-dark', 900, 640);
  await main.evaluate(
    `Array.from(document.querySelectorAll('.trash-footer button')).find(button=>button.textContent.trim()==='Done').click()`,
  );
  await main.evaluate(
    `Array.from(document.querySelectorAll('.location-sidebar button')).find(button=>button.textContent.trim()==='Applications').click()`,
  );
  await until(
    () =>
      main!.evaluate<string>(
        'document.querySelector("[data-file-owner]")?.getAttribute("aria-label")||""',
      ),
    (value) => value === 'Folder /Applications',
    'Applications shortcut',
  );
  await until(
    () => main!.evaluate<boolean>('!document.querySelector("[data-file-owner] .loading")'),
    Boolean,
    'Applications listing',
  );
  await capture('native-applications-compact-dark', 900, 640);
  await writeFile(
    path.join(output, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        binary,
        root,
        trash: {
          visibleItems: snapshot.items.length,
          canEmpty: snapshot.canEmpty,
          unavailableLocations: snapshot.locations.filter(
            (location) => location.state === 'unavailable',
          ).length,
        },
        evidence: [
          'No public erasure method exists; native Trash view reports actual readable/unavailable locations.',
          'Applications opens /Applications inside the existing folder plane.',
          'No native Trash menu, confirmation, erasure or grant picker was invoked. All fixtures preserved.',
        ],
        scope:
          'Direct native owned app; read-only. Positive emptying, Store sandbox permission grants and Windows/Linux execution remain unverified.',
      },
      null,
      2,
    ),
  );
  console.log('PASS native Trash read-only view, erasure API absence and Applications navigation.');
  console.log('Evidence:', output);
} finally {
  await viewer.close(main);
  console.log('Fixtures preserved:', root);
}
