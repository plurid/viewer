/** Real direct-build acceptance. Native approvals and physical keys belong to the operator. */
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings, type ModelProvider } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import type { ChatDocument, ChatSummary } from '../../src/domain/models/chat';
import type { AgentAccessState } from '../../src/domain/agents/clients';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { requestAgent } from './runtime/agent-client';

if (process.platform !== 'darwin') throw new Error('This acceptance requires macOS.');
const interactive = process.argv.includes('--interactive');
const skipTerminal = process.argv.includes('--skip-terminal');
if (skipTerminal && !interactive)
  throw new Error('Skipping the terminal is only supported when resuming operator checks.');
if (interactive && !process.stdin.isTTY)
  throw new Error('Interactive acceptance needs a terminal for operator acknowledgements.');
const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const binary = path.resolve(
  process.env.VIEWER_TEST_BINARY ??
    path.join(appRoot, 'out/Viewer-darwin-' + process.arch + '/Viewer.app/Contents/MacOS/Viewer'),
);
const root = await realpath(await temporaryRoot('viewer-power-acceptance-'));
const profile = path.join(root, 'Profile');
const files = path.join(root, 'Generated files');
const shellHome = path.join(profile, 'Shell home');
const file = path.join(files, 'Generated note.txt');
const acceptanceToken = randomUUID();
const contents = 'Generated acceptance token: ' + acceptanceToken + '\n';
await mkdir(shellHome, { recursive: true });
await mkdir(files);
await writeFile(file, contents, { flag: 'wx', mode: 0o600 });
const provider: ModelProvider = {
  id: 'native-gemini',
  kind: 'gemini',
  name: 'Gemini acceptance',
  endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
  model: process.env.VIEWER_TEST_GEMINI_MODEL ?? 'gemini-3.8-flash',
  allowContent: false,
};
const settings = defaultSettings(files);
settings.providers = [provider];
settings.agents.roots = [files];
settings.hotkey.enabled = true;
settings.hotkey.shortcut = 'Alt+Space';
settings.browsing.emptyWorkspaceLocation = 'custom';
settings.browsing.emptyWorkspacePath = files;
settings.terminals.profileID = 'acceptance';
settings.terminals.profiles = [
  {
    id: 'acceptance',
    name: 'Acceptance shell',
    executable: '/bin/sh',
    args: ['--noprofile', '--norc'],
    env: { ENV: '', BASH_ENV: '', PROMPT_COMMAND: '', HISTFILE: '' },
  },
];
await writeFile(
  path.join(profile, 'config.jsonc'),
  JSON.stringify({ version: 1, settings, ui: normalizePreferences() }, null, 2) + '\n',
  { flag: 'wx', mode: 0o600 },
);
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  activeWorkspace: 'power-acceptance',
  look: 'dark',
  favorites: [],
  recents: [],
  workspaces: [
    {
      id: 'power-acceptance',
      name: 'Native acceptance',
      activePane: 'generated-folder',
      roots: ['generated-folder'],
      arrangement: {},
      panes: [
        {
          id: 'generated-folder',
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
    { id: 'shell-target', name: 'Shell target', panes: [], roots: [], arrangement: {} },
  ],
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state) + '\n', {
  flag: 'wx',
  mode: 0o600,
});
process.env.VIEWER_TEST_SHELL_HOME = shellHome;
process.env.VIEWER_TEST_NO_REMOVAL = interactive ? '0' : '1';
const viewer = await ownedApp(binary, profile, { mode: interactive ? 'foreground' : 'hidden' });
const main = await viewer.connect();
const input = interactive
  ? createInterface({ input: process.stdin, output: process.stdout })
  : undefined;
let inputClosed = false;
input?.once('close', () => {
  inputClosed = true;
});
const checks: { id: string; result: 'passed'; detail: string }[] = [];
const operatorSteps: string[] = [];
const candidate = {
  binary,
  executableSha256: createHash('sha256')
    .update(await readFile(binary))
    .digest('hex'),
  archiveSha256: createHash('sha256')
    .update(await readFile(path.resolve(binary, '../../Resources/app.asar')))
    .digest('hex'),
  macOS: execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(),
  architecture: process.arch,
  mode: interactive ? 'foreground' : 'hidden',
};
const resultFile = path.join(viewer.evidenceDirectory, 'power-features.json');
async function save(failed?: string) {
  await writeFile(
    resultFile,
    JSON.stringify(
      {
        candidate,
        root,
        profile,
        files,
        shellHome,
        checks,
        operatorSteps,
        provider: { kind: provider.kind, model: provider.model, endpoint: provider.endpoint },
        requestLimit: 'At most two Chat sends; each uses the production eight-step budget.',
        unverified: [
          'shell-live-launch',
          'shell-new-window',
          'shell-terminal',
          'physical-hotkey',
          'native-window-recovery',
          'gemini-live-chat',
          'agent-native-consent',
          'shell-native-uninstall',
        ].filter((id) => !checks.some((check) => check.id === id)),
        failed,
        retained: true,
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
}
async function passed(id: string, detail: string) {
  checks.push({ id, result: 'passed', detail });
  await save();
  console.log('PASS ' + id + ': ' + detail);
}
async function operator(instruction: string) {
  assert.ok(input);
  console.log('\nOPERATOR: ' + instruction);
  await input.question('Press Enter here after completing that action. ');
  operatorSteps.push(instruction);
  await save();
}
async function nativeCall(connection: typeof main, method: string, args: unknown[], label: string) {
  // Start the real native dialog without a debugger RPC timing out while the person reads it.
  await connection.evaluate(`(() => {
    window.__nativeAcceptance = {status:'pending'};
    window.viewer[${JSON.stringify(method)}](...${JSON.stringify(args)}).then(
      value => {window.__nativeAcceptance = {status:'resolved',value};},
      error => {window.__nativeAcceptance = {status:'rejected',error:error.message};}
    );
  })()`);
  return until(
    () =>
      connection.evaluate<{ status: string; value?: unknown; error?: string }>(
        'window.__nativeAcceptance',
      ),
    (value) => value.status !== 'pending',
    label,
    300_000,
  );
}
async function palette(label: string) {
  await main.evaluate(`document.querySelector('[aria-label="Commands (⌘K)"]').click()`);
  await until(
    () => main.evaluate<string>('document.activeElement?.getAttribute("aria-label")'),
    (value) => value === 'Search commands',
    'command input',
  );
  await main.command('Input.insertText', { text: label });
  await until(
    () =>
      main.evaluate<string>(
        'document.querySelector(".command-result[aria-selected=true]")?.textContent ?? ""',
      ),
    (value) => value.includes(label),
    label,
  );
  await main.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter' });
  await main.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter' });
}
try {
  await until(
    () => main.evaluate<number>('document.querySelectorAll("[data-file-path]").length'),
    (count) => count > 0,
    'generated folder',
  );
  await main.evaluate('window.viewer.openSettings()');
  let preferences = await viewer.connect(true);
  const installed = await preferences.evaluate<{
    path: string;
    installed: boolean;
    executable: boolean;
  }>('window.viewer.shellCommand("install")');
  assert.equal(installed.path, path.join(shellHome, '.local/bin/viewer'));
  assert.ok(installed.installed && installed.executable);
  const invokeShell = (args: string[]) =>
    promisify(execFile)(installed.path, args, {
      cwd: files,
      env: {
        ...process.env,
        VIEWER_DATA_DIRECTORY: profile,
        VIEWER_RENDER_TEST: '1',
        VIEWER_BACKGROUND_TEST: interactive ? '0' : '1',
      },
      timeout: 15_000,
    });
  await Promise.all([
    invokeShell(['--workspace', 'Shell target', 'Generated note.txt']),
    invokeShell(['--workspace', 'Shell target', 'Generated note.txt']),
  ]);
  await until(
    async () => {
      const targets = (await (
        await fetch('http://127.0.0.1:' + viewer.port + '/json/list')
      ).json()) as { url: string }[];
      return targets.filter(
        (target) =>
          target.url.startsWith('viewer-app://app/') && !target.url.includes('window=settings'),
      ).length;
    },
    (count) => count === 2,
    'shell command workspace window',
  );
  await passed(
    'shell-live-launch',
    'Concurrent invocations of the actual script retain cwd and a spaced path and open one window for the named workspace.',
  );
  await invokeShell(['--new-window', files]);
  await until(
    async () =>
      JSON.parse(await readFile(path.join(profile, 'viewer-state-v1.json'), 'utf8')) as SavedState,
    (saved) =>
      saved.openWindows?.length === 3 &&
      new Set(saved.openWindows).size === 3 &&
      saved.workspaces.every((workspace) =>
        workspace.panes.every((pane) => pane.path.startsWith(root)),
      ),
    'shell new-window handoff retains independent owners and generated starting folders',
  );
  await passed(
    'shell-new-window',
    'The new-window flag opens an independent workspace using its configured generated starting folder.',
  );

  if (interactive) {
    if (!skipTerminal) {
      console.log(
        'OPERATOR: The terminal flag will request the Acceptance shell (/bin/sh --noprofile --norc), in the generated folder. Allow its native execution prompt if one appears.',
      );
      await invokeShell(['--terminal', files]);
      await until(
        async () =>
          JSON.parse(
            await readFile(path.join(profile, 'viewer-state-v1.json'), 'utf8'),
          ) as SavedState,
        (saved) =>
          saved.workspaces.some((workspace) =>
            workspace.panes.some((pane) => pane.type === 'terminal' && pane.path === files),
          ),
        'shell terminal handoff',
        300_000,
      );
      await operator(
        'Check that the Acceptance terminal plane opens a working shell in the generated folder.',
      );
      await passed(
        'shell-terminal',
        'The terminal flag opens the configured shell; operator confirms the native execution and terminal.',
      );
    }
    const status = await main.evaluate<{ registered: boolean }>('window.viewer.hotkeyStatus()');
    assert.ok(status.registered, 'The physical shortcut must actually be registered.');
    await operator(
      'Focus Viewer, press ⌥Space to drop it from the screen top, press it again to hide it, then once more to show it. Check that it toggles without another app receiving Space.',
    );
    await operator(
      'Hide the drop-down with ⌥Space, click Viewer in the Dock, then choose File → New Window. Check that the hidden workspace returns at its normal size and the menu opens an independent window.',
    );
    await passed(
      'native-window-recovery',
      'Operator confirmed Dock recovery of the hidden drop-down and independent New Window creation from the native menu.',
    );
    await operator(
      'Repeat the shortcut from a full-screen Viewer window. Check that hiding or restoring the drop-down preserves its original full-screen mode, then return Viewer to an ordinary window.',
    );
    await passed(
      'physical-hotkey',
      'Operator exercised the registered global shortcut and observed drop-down/show/hide.',
    );
    await main.evaluate('window.viewer.openSettings()');
    preferences = await viewer.connect(true);
    await preferences.evaluate(
      `Array.from(document.querySelectorAll('.settings-navigation button')).find(button =>
        button.textContent.trim() === 'Models').click()`,
    );
    await operator(
      'In Viewer Settings → Models, enter the Gemini API key privately for “Gemini acceptance”, then click outside the password field to save it. Leave the model field set to ' +
        provider.model +
        '. Do not paste the key into this terminal or chat.',
    );
    const configured = await preferences.evaluate<boolean>(
      `window.viewer.settingsGet().then(snapshot => snapshot.credentials.includes(${JSON.stringify(provider.id)}))`,
    );
    assert.ok(configured, 'The key must be saved privately through Viewer.');
    const models = await preferences.evaluate<string[]>(
      `window.viewer.providerModels(${JSON.stringify(provider.id)})`,
    );
    assert.ok(models.includes(provider.model), 'The selected Gemini model must be available.');
    console.log('OPERATOR: Cancel the next model-data permission dialog.');
    const denied = await nativeCall(
      preferences,
      'providerPermissionSet',
      [provider.id, provider.endpoint, 'excerpts'],
      'cancelled model-data consent',
    );
    assert.equal(denied.status, 'rejected');
    assert.equal(
      await preferences.evaluate(
        `window.viewer.providerPermissionGet(${JSON.stringify(provider.id)})`,
      ),
      null,
    );
    console.log(
      'OPERATOR: Allow the next dialog, which covers generated fixture excerpts at the displayed Google endpoint.',
    );
    const allowed = await nativeCall(
      preferences,
      'providerPermissionSet',
      [provider.id, provider.endpoint, 'excerpts'],
      'approved model-data consent',
    );
    assert.equal(allowed.status, 'resolved');

    await main.evaluate(
      `Array.from(document.querySelectorAll('[data-file-path]')).find(row =>
        row.getAttribute('data-file-path') === ${JSON.stringify(file)}).click()`,
    );
    await palette('Chat about files');
    await until(
      () => main.evaluate<boolean>('!!document.querySelector("[aria-label=\"Chat message\"]")'),
      Boolean,
      'actual Chat plane',
    );
    const history = await main.evaluate<ChatSummary[]>('window.viewer.chat({kind:"list"})');
    const conversation = history[0];
    assert.ok(conversation);
    await main.evaluate(
      `window.viewer.chat(${JSON.stringify({
        kind: 'send',
        id: conversation.id,
        providerID: provider.id,
        text: 'Read the attached generated note and quote its acceptance token. Reply briefly.',
      })})`,
    );
    const replied = await until(
      () =>
        main.evaluate<ChatDocument>(
          `window.viewer.chat({kind:'open',id:${JSON.stringify(conversation.id)}})`,
        ),
      (document) => document.status !== 'running',
      'live Gemini response',
      150_000,
    );
    assert.equal(replied.status, 'idle', replied.error ?? 'Gemini Chat must finish successfully.');
    assert.ok(
      replied.messages.some(
        (message) =>
          message.role === 'assistant' &&
          message.provider?.id === provider.id &&
          message.provider.model === provider.model &&
          message.text.includes(acceptanceToken),
      ),
    );
    assert.equal(await readFile(file, 'utf8'), contents);
    await passed(
      'gemini-live-chat',
      'Actual Gemini model list, native Cancel/Allow data consent, bounded file inspection, attributed reply and unchanged generated file.',
    );
    console.log('OPERATOR: Cancel the next shared agent access dialog.');
    await nativeCall(
      preferences,
      'agentAccess',
      [{ kind: 'enable', enabled: true }],
      'cancelled shared agent consent',
    );
    const access = () =>
      preferences.evaluate<AgentAccessState>('window.viewer.agentAccess({kind:"state"})');
    assert.equal((await access()).enabled, false);
    console.log(
      'OPERATOR: Allow the next shared-agent dialog; it grants only metadata, navigation and proposals. No file changes are applied.',
    );
    await nativeCall(
      preferences,
      'agentAccess',
      [{ kind: 'enable', enabled: true }],
      'approved shared agent consent',
    );
    assert.equal((await access()).enabled, true);
    console.log('OPERATOR: Allow only this generated folder in the next native dialog: ' + files);
    await nativeCall(
      preferences,
      'agentAccess',
      [{ kind: 'allow', roots: [files] }],
      'approved generated agent folder',
    );
    assert.deepEqual((await access()).roots, [files]);
    const connection = JSON.parse(
      await readFile(path.join(profile, 'agent-connection-v1.json'), 'utf8'),
    ) as { socket: string };
    const configuration = JSON.parse(
      await preferences.evaluate<string>('window.viewer.agentToken()'),
    ) as { mcpServers: { viewer: { env: { VIEWER_AGENT_TOKEN: string } } } };
    const token = configuration.mcpServers.viewer.env.VIEWER_AGENT_TOKEN;
    const metadata = await requestAgent<{ content: { text: string }[] }>(connection.socket, token, {
      method: 'tools/call',
      params: { name: 'read_metadata', arguments: { path: file } },
    });
    assert.equal(JSON.parse(metadata.content[0]!.text).path, file);
    await assert.rejects(
      requestAgent(connection.socket, token, {
        method: 'tools/call',
        params: { name: 'read_metadata', arguments: { path: root } },
      }),
      /outside|authorized|scope/i,
    );
    assert.equal(await readFile(file, 'utf8'), contents);
    await passed(
      'agent-native-consent',
      'Real Cancel/Allow access and exact generated-root consent; authenticated metadata read succeeds, outside-root read fails, and fixture remains unchanged.',
    );
    await operator(
      'The next step requests permission to move exactly ' +
        installed.path +
        ' to the operating system Trash. The script is generated for this session; its parent directories remain. Approve only if you agree to that removal.',
    );
    const uninstalled = await nativeCall(
      preferences,
      'shellCommand',
      ['uninstall'],
      'operator shell command uninstall',
    );
    assert.equal(uninstalled.status, 'resolved');
    assert.equal(
      await preferences.evaluate<boolean>(
        'window.viewer.shellCommand("status").then(value => value.installed)',
      ),
      false,
    );
    await passed(
      'shell-native-uninstall',
      'Operator approved this exact script in the native dialog; the ordinary coordinated operation service moved it to OS Trash.',
    );
  }
  await save();
  console.log('Evidence: ' + resultFile);
} catch (error) {
  await save(error instanceof Error ? error.message : String(error));
  if (interactive && !inputClosed) {
    console.error(error instanceof Error ? error.message : String(error));
    await operator(
      'A check failed. The acceptance windows will stay open for diagnosis until you tell the coding agent to continue.',
    );
  }
  throw error;
} finally {
  input?.close();
  await viewer.close(main);
  console.log('Generated data and evidence retained: ' + root);
}
