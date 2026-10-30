/** Explicit live-provider acceptance. Native sharing approval belongs to the operator. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { CURRENT_STATE_VERSION } from '../../src/domain/contracts';
import type { SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import type { ApplicationSettings } from '../../src/domain/services';
import type { ProviderCheckResult } from '../../src/domain/models/provider-checks';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { hashFile } from '../../tools/qualification/source';
import { ownedApp, until } from '../owned-app';
import { NativeInteractions } from './runtime/interactions';
import { exists, textOf } from './runtime/page';
import { pageCall } from './runtime/page-function';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.equal(process.platform, 'darwin', 'This saved-profile acceptance targets macOS.');
assert.equal(
  process.env.VIEWER_TEST_LIVE_MODEL,
  '1',
  'Live provider calls require explicit opt-in.',
);
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const sourceProfile = path.join(os.homedir(), 'Library/Application Support/Viewer');
const source = parse(await readFile(path.join(sourceProfile, 'config.jsonc'), 'utf8')) as {
  settings: ApplicationSettings;
};
const original = source.settings.providers.find((provider) => provider.kind === 'gemini');
assert.ok(original, 'Configure Gemini in Viewer before this explicit live acceptance.');
const protectedFiles = [
  'config.jsonc',
  'credentials-v1.json',
  'credential-bindings-v1.json',
  'model-permissions-v1.json',
];
const originalHashes = new Map<string, string | null>();
for (const name of protectedFiles)
  originalHashes.set(
    name,
    await hashFile(path.join(sourceProfile, name)).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }),
  );
const encrypted = JSON.parse(
  await readFile(path.join(sourceProfile, 'credentials-v1.json'), 'utf8'),
) as Record<string, string>;
assert.ok(encrypted[original.id], 'The selected provider needs a stored API key.');
const bindings = JSON.parse(
  await readFile(path.join(sourceProfile, 'credential-bindings-v1.json'), 'utf8').catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '{}';
    throw error;
  }),
) as Record<string, string>;
// An anonymous temporary path avoids sending a personal home/project path in the test context.
const root = await temporaryRoot('viewer-live-model-', '/private/tmp');
const profile = path.join(root, 'Profile');
const files = path.join(root, 'Files');
await Promise.all([mkdir(profile, { mode: 0o700 }), mkdir(files, { mode: 0o700 })]);
const provider = { ...original, name: 'Live Gemini acceptance' };
const alternate = { ...original, id: randomUUID(), name: 'Default selection check' };
const settings = defaultSettings(files);
settings.providers = [provider, alternate];
settings.prompts.providerID = provider.id;
settings.hotkey.enabled = false;
const ui = normalizePreferences();
ui.space.opening = 'dock';
ui.sidebar.inNewPlanes = false;
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'live-model',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'live-model',
      name: 'Isolated live model acceptance',
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
for (const [index, name] of ['Alpha.txt', 'Beta.txt', 'Gamma.csv'].entries()) {
  const file = path.join(files, name);
  await writeFile(file, 'Generated live model acceptance fixture.\n', { flag: 'wx', mode: 0o600 });
  await utimes(file, new Date(2020, 0, index + 1), new Date(2020, 0, index + 1));
}
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
  mode: 0o600,
});
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), {
  flag: 'wx',
  mode: 0o600,
});
await writeFile(
  path.join(profile, 'credentials-v1.json'),
  JSON.stringify({ [provider.id]: encrypted[original.id], [alternate.id]: encrypted[original.id] }),
  { flag: 'wx', mode: 0o600 },
);
await writeFile(
  path.join(profile, 'credential-bindings-v1.json'),
  JSON.stringify(
    bindings[original.id]
      ? { [provider.id]: bindings[original.id], [alternate.id]: bindings[original.id] }
      : {},
  ),
  { flag: 'wx', mode: 0o600 },
);
// No private data permission, execution approval, agent token or user workspace is copied.
const checks: { name: string; detail: unknown }[] = [];
const stage = async (name: string, detail: unknown = {}) => {
  await writeFile(path.join(root, 'stage.json'), JSON.stringify({ name, detail }, null, 2) + '\n', {
    mode: 0o600,
  });
  console.log('Live model stage: ' + name);
};
type LiveCheck = { pending?: boolean; value?: ProviderCheckResult; error?: string };
type LiveCheckWindow = { __liveModelCheck: LiveCheck };

const permissionOf = (id: string) => window.viewer.providerPermissionGet(id);
const checkGeneration = (providerID: string) =>
  window.viewer.providerCheck({ providerID, kind: 'chat-schema' });

/** Starts a live structured-output check without waiting; the outcome lands on the window. */
function startProviderCheck(providerID: string): void {
  const page = window as unknown as LiveCheckWindow;
  page.__liveModelCheck = { pending: true };
  void window.viewer.providerCheck({ providerID, kind: 'chat-schema' }).then(
    (value) => {
      page.__liveModelCheck = { value };
    },
    (error: Error) => {
      page.__liveModelCheck = { error: error.message };
    },
  );
}

/** Changes one provider's model at the current settings revision. */
const setProviderModel = (id: string, model: string) =>
  window.viewer.settingsGet().then((snapshot) =>
    window.viewer.settingsPatch(
      [
        {
          path: 'settings.providers',
          value: snapshot.settings.providers.map((provider) =>
            provider.id === id ? { ...provider, model } : provider,
          ),
        },
      ],
      snapshot.revision,
    ),
  );

const proposedLine = () =>
  document.querySelector(
    '.prompt-finder .command-result[aria-selected=true] .command-result-text > span',
  )?.textContent ||
  document.querySelector('.prompt-finder .command-result[aria-selected=true]')?.textContent ||
  '';

const app = await ownedApp(binary, profile, { mode: 'foreground' });
let main: Awaited<ReturnType<typeof app.connect>> | undefined;
let passed = false;
try {
  main = await app.connect();
  const { evaluate, command } = main;
  const actions = new NativeInteractions({ evaluate, command, until });
  const checkProvider = async () => {
    await evaluate(pageCall(startProviderCheck, provider.id));
    const result = await until(
      () => evaluate(pageCall(() => (window as unknown as LiveCheckWindow).__liveModelCheck)),
      (result) => !result.pending,
      'Live provider check finished',
      30000,
    );
    if (result.error) throw new Error(result.error);
    assert.ok(result.value);
    return result.value;
  };
  await until(() => evaluate(exists('.folder-explorer')), Boolean, 'Generated folder ready');
  await evaluate(pageCall(() => window.viewer.openSettings('settings.providers')));
  const settingsWindow = await app.connect(true);
  const controls = new NativeInteractions({ ...settingsWindow, until });
  await until(
    () => settingsWindow.evaluate(exists('.settings-provider')),
    Boolean,
    'Models settings ready',
  );
  assert.equal(await evaluate(pageCall(permissionOf, provider.id)), null);
  await stage('discovering-models');
  await controls.button('Connect and load models', '.settings-provider[open]');
  const status = await until(
    () => settingsWindow.evaluate(textOf('.settings-provider[open] .model-summary')),
    (text) => text.includes('Connected') || text.includes('Connection failed'),
    'Live model discovery',
    30000,
  );
  assert.ok(
    status.includes('Connected'),
    'Stored provider connection failed; inspect the isolated Settings window.',
  );
  const models = await settingsWindow.evaluate(
    pageCall(() =>
      [
        ...document.querySelectorAll<HTMLOptionElement>('.settings-provider[open] datalist option'),
      ].map((option) => option.value),
    ),
  );
  assert.ok(models.length);
  checks.push({
    name: 'Live discovery',
    detail: { models: models.length, configuredModelListed: models.includes(provider.model) },
  });
  for (const id of [alternate.id, provider.id]) {
    await controls.click('[aria-label="Default model for Ask Viewer"]');
    await controls.click('[data-menu-id=' + JSON.stringify('choice:' + id) + ']');
    await until(
      () => evaluate(pageCall(() => window.viewer.settingsGet())),
      (value) => value.settings.prompts.providerID === id,
      'Default model saved',
    );
  }
  checks.push({
    name: 'Default selection',
    detail: 'Changed through the UI and restored to the live provider.',
  });
  await assert.rejects(
    () => evaluate(pageCall(checkGeneration, provider.id)),
    /Allow this provider/,
  );
  checks.push({
    name: 'Data sharing before approval',
    detail: 'Native service rejected generation.',
  });
  await controls.click('.settings-provider[open] .model-data-permission > summary');
  await stage('awaiting-native-model-consent', {
    provider: provider.name,
    endpoint: provider.endpoint,
    data: 'Generated folder path, filenames and metadata only. No file contents or agent access.',
  });
  await controls.button('Allow selected data', '.settings-provider[open]');
  const permission = await until(
    () => evaluate(pageCall(permissionOf, provider.id)),
    (value) => value?.level === 'names',
    'Operator model consent',
    600000,
  );
  assert.ok(!permission?.agents);
  checks.push({ name: 'Native consent', detail: { level: 'names', agentAccess: false } });
  await stage('testing-live-generation');
  const compatible = await checkProvider();
  checks.push({ name: 'Live structured output', detail: compatible });
  assert.equal(compatible.outcome, 'passed', compatible.detail);
  await actions.click('[aria-label="Commands (⌘K)"]');
  await actions.field('Search commands', '>sort by date modified, newest first');
  await until(() => evaluate(exists('[aria-label="Ask in words"]')), Boolean, 'Ask in words');
  await actions.key('Enter', 'Enter');
  await until(
    () => evaluate(exists('.prompt-finder.has-line')),
    Boolean,
    'Live command proposal',
    30000,
  );
  const line = await evaluate(pageCall(proposedLine));
  assert.match(line, /sort\.modified/, 'Model proposed the requested sort action.');
  await actions.key('Enter', 'Enter');
  await until(
    async () =>
      JSON.parse(await readFile(path.join(profile, 'viewer-state-v1.json'), 'utf8')) as SavedState,
    (value) => {
      const folder = value.workspaces[0]?.panes.find((pane) => pane.id === 'folder');
      return folder?.type === 'folder' && folder.sort === 'modified' && folder.descending;
    },
    'Natural-language action applied',
  );
  checks.push({ name: 'Ask Viewer', detail: { line, sort: 'modified', descending: true } });
  await actions.capture(path.join(root, 'asked-and-sorted.png'));
  await settingsWindow.evaluate(
    pageCall(setProviderModel, provider.id, 'viewer-unavailable-qualification-model'),
  );
  const failed = await checkProvider();
  assert.equal(failed.outcome, 'http-error');
  assert.ok([400, 404].includes(failed.httpStatus ?? 0));
  checks.push({ name: 'Unavailable remote model', detail: failed });
  await settingsWindow.evaluate(pageCall(setProviderModel, provider.id, provider.model));
  await stage('revoking-test-permission');
  await controls.button('Revoke access', '.settings-provider[open]');
  await until(
    () => evaluate(pageCall(permissionOf, provider.id)),
    (value) => value === null,
    'Sharing revoked',
  );
  await assert.rejects(
    () => evaluate(pageCall(checkGeneration, provider.id)),
    /Allow this provider/,
  );
  checks.push({ name: 'Revocation', detail: 'Subsequent native generation was rejected.' });
  assert.equal((await lstat(path.join(profile, 'model-permissions-v1.json'))).mode & 0o777, 0o600);
  passed = true;
} finally {
  if (main) {
    await main
      .evaluate(
        pageCall(
          (id: string, endpoint: string) => window.viewer.providerPermissionSet(id, endpoint, null),
          provider.id,
          provider.endpoint,
        ),
      )
      .catch(() => {});
    await app.close(main);
  }
  for (const [name, expected] of originalHashes) {
    const actual = await hashFile(path.join(sourceProfile, name)).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    assert.equal(actual, expected, 'Normal profile file remained unchanged: ' + name);
  }
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      {
        passed,
        model: provider.model,
        provider: provider.kind,
        checks,
        privateApprovalCopied: false,
        plaintextKeyExported: false,
        normalProfileUnchanged: true,
        fixtures: 'retained',
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  await stage(passed ? 'completed' : 'failed');
  console.log('Retained live model acceptance: ' + path.basename(root));
}
