/** A real normal Chromium window and semantic keyboard path; physical AT is qualified separately. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SavedState } from '../../src/domain/contracts';
import { CURRENT_STATE_VERSION } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { click, focus, textOf, valueOf } from './runtime/page';
import type { PageExpression } from './runtime/page-function';
import { pageCall } from './runtime/page-function';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await temporaryRoot('viewer-browser-semantic-');
const profile = path.join(root, 'Profile');
await mkdir(profile);
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end(
    "<!doctype html><title>Semantic page fixture</title><h1>Read this heading</h1><label>Page field<input></label><button onclick=\"document.querySelector('p').textContent='Submitted'\">Submit page</button><p>Ready</p>",
  );
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const url = `http://127.0.0.1:${address.port}/`;
const settings = defaultSettings(root);
settings.hotkey.enabled = false;
const ui = normalizePreferences();
ui.space.opening = 'dock';
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  ui,
  activeWorkspace: 'semantic',
  favorites: [],
  recents: [],
  workspaces: [
    {
      id: 'semantic',
      name: 'Generated semantic browser check',
      roots: ['browser'],
      activePane: 'browser',
      arrangement: {},
      panes: [{ id: 'browser', type: 'browser', path: root, url }],
    },
  ],
};
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
});
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), { flag: 'wx' });
const app = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
try {
  connection = await app.connect();
  const { command, evaluate } = connection;
  await until(
    () => evaluate(textOf('.browser-status')),
    (text) => text.includes('Semantic page fixture'),
    'spatial page ready',
  );
  const targets = async () =>
    (await fetch(`http://127.0.0.1:${app.port}/json/list`).then((response) => response.json())) as {
      id: string;
      url: string;
    }[];
  const original = new Set((await targets()).map((target) => target.id));
  await evaluate(click('.browser-status button'));
  const target = await until(
    async () => (await targets()).find((target) => target.url === url && !original.has(target.id)),
    Boolean,
    'normal page window',
  );
  assert.ok(target);
  const { sessionId } = await command<{ sessionId: string }>('Target.attachToTarget', {
    targetId: target.id,
    flatten: true,
  });
  await command('Accessibility.enable', {}, sessionId);
  const tree = await command<{
    nodes: { ignored?: boolean; role?: { value: string }; name?: { value: string } }[];
  }>('Accessibility.getFullAXTree', {}, sessionId);
  const nodes = tree.nodes
    .filter((node) => !node.ignored)
    .map((node) => ({ role: node.role?.value, name: node.name?.value }));
  for (const [role, name] of [
    ['heading', 'Read this heading'],
    ['textbox', 'Page field'],
    ['button', 'Submit page'],
  ])
    assert.ok(
      nodes.some((node) => node.role === role && node.name === name),
      `${role}: ${name}`,
    );
  const page = <R>(expression: PageExpression<R>) => evaluate(expression, { sessionId });
  const globals = () => [
    typeof window.viewer,
    typeof (window as unknown as { require?: unknown }).require,
  ];
  const activeTag = () => document.activeElement?.tagName;
  assert.deepEqual(await page(pageCall(globals)), ['undefined', 'undefined']);
  await command('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId);
  const key = async (key: string, code: string, windowsVirtualKeyCode: number) => {
    for (const type of ['keyDown', 'keyUp'])
      await command(
        'Input.dispatchKeyEvent',
        {
          type,
          key,
          code,
          windowsVirtualKeyCode,
          ...(type === 'keyDown' && key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}),
        },
        sessionId,
      );
  };
  // Seed document focus because hidden windows have no OS/compositor hit-test focus.
  // Text entry, Tab traversal and activation below still use Chromium input events.
  await page(focus('input'));
  await until(
    () => page(pageCall(activeTag)),
    (tag) => tag === 'INPUT',
    'page field focus',
  );
  assert.equal(await page(pageCall(activeTag)), 'INPUT');
  await command('Input.insertText', { text: 'Typed into the page' }, sessionId);
  assert.equal(await page(valueOf('input')), 'Typed into the page');
  await key('Tab', 'Tab', 9);
  await until(
    () => page(pageCall(activeTag)),
    (tag) => tag === 'BUTTON',
    'Tab to page button',
  );
  await key('Enter', 'Enter', 13);
  await until(
    () => page(textOf('p')),
    (text) => text === 'Submitted',
    'page button activation',
  );
  await command('Target.closeTarget', { targetId: target.id });
  assert.ok((await targets()).some((target) => target.url === url && original.has(target.id)));
  const result = {
    passed: true,
    semanticNodes: nodes,
    keyboard: ['Seed field focus for hidden QA', 'Type', 'Tab to button', 'Enter'],
    physicalScreenReader:
      'Not exercised; requires observed VoiceOver or other assistive technology qualification.',
  };
  await writeFile(path.join(root, 'result.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(
    JSON.stringify({
      passed: true,
      keyboard: result.keyboard,
      physicalScreenReader: 'unverified',
      fixture: path.basename(root),
    }),
  );
} finally {
  await app.close(connection);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
