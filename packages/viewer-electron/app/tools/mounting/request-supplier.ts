/** Request the local simulation through a real Viewer browser plane. No external supplier. */
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { temporaryRoot } from '../temporary';
import { startSupplier } from './supplier';
import { ownedApp, until } from '../../tests/owned-app';
import { click, textOf } from '../../tests/native/runtime/page';
import { pageCall } from '../../tests/native/runtime/page-function';
import { screenshot } from '../docs/record';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { CURRENT_STATE_VERSION } from '../../src/domain/contracts';
import type { SavedState } from '../../src/domain/contracts';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const { values } = parseArgs({
  options: {
    binary: { type: 'string' },
    drawing: { type: 'string' },
    material: { type: 'string' },
    thickness: { type: 'string' },
    quantity: { type: 'string', default: '1' },
  },
});
assert.ok(values.binary && values.drawing && values.material && values.thickness);
const root = await realpath(await temporaryRoot('viewer-mounting-supplier-'));
const profile = path.join(root, 'Profile');
await mkdir(profile);
const settings = defaultSettings(root);
settings.providers = [];
settings.hotkey.enabled = false;
await writeFile(
  path.join(profile, 'config.jsonc'),
  JSON.stringify({ version: 1, settings, ui: normalizePreferences() }),
  { flag: 'wx' },
);
const replyFile = path.join(root, 'supplier-reply.json');
const supplier = await startSupplier({
  drawing: values.drawing,
  output: replyFile,
  material: values.material,
  thicknessMm: Number(values.thickness),
  quantity: Number(values.quantity),
});
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  activeWorkspace: 'supplier',
  favorites: [],
  recents: [],
  look: 'dark',
  workspaces: [
    {
      id: 'supplier',
      name: 'Cutting service',
      panes: [
        {
          id: 'supplier',
          type: 'browser',
          path: root,
          url: supplier.url,
          title: 'Demo cutting service',
        },
      ],
      roots: ['supplier'],
      activePane: 'supplier',
      arrangement: {},
    },
  ],
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), { flag: 'wx' });
const app = await ownedApp(values.binary, profile, {
  label: 'mounting-supplier',
  mode: 'hidden',
  mockKeychain: true,
});
const main = await app.connect();
try {
  const target = await until(
    async () =>
      (
        (await fetch(`http://127.0.0.1:${app.port}/json/list`).then((r) => r.json())) as {
          id: string;
          url: string;
        }[]
      ).find((t) => t.url === supplier.url),
    Boolean,
    'supplier browser target',
  );
  const { sessionId } = await main.command<{ sessionId: string }>('Target.attachToTarget', {
    targetId: target!.id,
    flatten: true,
  });
  await until(
    () => main.evaluate(textOf('#send'), { sessionId }),
    (text) => text === 'Request quote',
    'local supplier ready',
  );
  await main.evaluate(click('#send'), { sessionId });
  await until(
    () => main.evaluate(textOf('#status'), { sessionId }),
    (text) => text.startsWith('Saved supplier-reply.json'),
    'saved supplier reply',
  );
  await until(
    () =>
      main.evaluate(
        pageCall(() => {
          let node: Element | null = document.querySelector('.browser-plane');
          while (node) {
            if (Number(getComputedStyle(node).opacity) < 0.99) return false;
            node = node.parentElement;
          }
          return true;
        }),
      ),
    Boolean,
    'settled browser',
  );
  await screenshot(main, path.join(root, 'supplier-reply.png'));
  const reply = JSON.parse(await readFile(replyFile, 'utf8'));
  assert.deepEqual(reply, supplier.quote);
  console.log(
    JSON.stringify({
      root,
      replyFile,
      attachment: reply.attachment,
      stock: reply.stock,
      modelRequests: 0,
    }),
  );
} finally {
  await app.close(main);
  await supplier.close();
}
