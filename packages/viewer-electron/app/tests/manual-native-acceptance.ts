/** Human-assisted native PowerBox/Finder checks. No injected grants or UI
 * automation permission: the operator clicks the actual native pickers and
 * uses Finder's clipboard. Only newly generated folders and profiles are used.
 */
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import type {
  OperationJob,
  OperationRequest,
  SavedState,
  ViewerAPI,
} from '../src/domain/contracts';
import { stateSchema } from '../src/desktop/storage';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle =
  process.env.VIEWER_TEST_MAS_BUNDLE ||
  path.join(appRoot, 'out/mac-app-store/mas-dev', process.arch, 'Viewer.app');
const prepare = process.argv.includes('--prepare');
const finderOnly = process.argv.includes('--finder-only');
const revocationOnly = process.argv.includes('--revoke-only');
if (finderOnly && revocationOnly) throw new Error('Choose either --finder-only or --revoke-only.');
if (process.platform !== 'darwin') throw new Error('This native check requires macOS.');
if (!prepare && !process.stdin.isTTY)
  throw new Error('Run this interactive check from iTerm or Terminal.');
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'pipe' });
const bundleInfo = (key: string) =>
  execFileSync(
    '/usr/bin/plutil',
    ['-extract', key, 'raw', '-o', '-', path.join(bundle, 'Contents/Info.plist')],
    { encoding: 'utf8' },
  ).trim();
const candidate = {
  build: bundleInfo('CFBundleVersion'),
  bundleID: bundleInfo('CFBundleIdentifier'),
  macOSVersion: execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(),
  macOSBuild: execFileSync('/usr/bin/sw_vers', ['-buildVersion'], { encoding: 'utf8' }).trim(),
  contentHashes: Object.fromEntries(
    await Promise.all(
      ['Contents/MacOS/Viewer', 'Contents/Resources/app.asar', 'Contents/Info.plist'].map(
        async (file) => [
          file,
          createHash('sha256')
            .update(await readFile(path.join(bundle, file)))
            .digest('hex'),
        ],
      ),
    ),
  ),
};
const id = randomUUID();
const evidenceDirectory = path.join(appRoot, 'out/native-acceptance', id);
const source = path.join(
  os.homedir(),
  'Library/Mobile Documents/com~apple~CloudDocs',
  'Viewer-QA-' + id,
);
const local = await temporaryRoot('viewer-native-acceptance-', '/private/tmp');
const destination = path.join(local, 'Destination'),
  outside = path.join(local, 'Outside');
const profile = path.join(
  os.homedir(),
  'Library/Containers/com.pluridviewer.app/Data/Library/Application Support/Viewer',
  'native-acceptance-' + id,
);
const marker = '.viewer-generated-qa';
const generated = 'Generated Viewer native acceptance content.\n'.repeat(4096);
const checks: { id: string; result: 'passed'; detail: string }[] = [];
const observations: {
  stage: string;
  grants: Awaited<ReturnType<ViewerAPI['fileAccessList']>>;
  picker?: { requested: string; cancelExpected: boolean; result: string | null };
  clipboard?: { items: number; expectedSelection: boolean; cut?: boolean };
}[] = [];
await mkdir(evidenceDirectory, { recursive: true });
await mkdir(source, { mode: 0o700 });
await writeFile(path.join(source, marker), id, { flag: 'wx', mode: 0o600 });
await writeFile(path.join(local, marker), id, { flag: 'wx', mode: 0o600 });
await mkdir(path.join(source, 'Nested'));
await writeFile(path.join(source, 'Generated.txt'), generated, { flag: 'wx', mode: 0o600 });
await writeFile(path.join(source, 'Nested', 'Résumé.txt'), 'Generated nested Unicode content.\n', {
  flag: 'wx',
  mode: 0o600,
});
await mkdir(destination);
await mkdir(outside);
await writeFile(path.join(outside, 'Denied.txt'), 'Generated sibling permission fixture.\n', {
  flag: 'wx',
  mode: 0o600,
});
await mkdir(profile, { recursive: true, mode: 0o700 });
// Start inside the test profile so the window does not offer a separate
// "Allow folder access" action before the scripted cancellation picker.
const instructions = path.join(profile, 'Native acceptance');
await mkdir(instructions);
await writeFile(
  path.join(instructions, 'Read the test prompts.txt'),
  'Follow the terminal prompts. The script opens all three native folder pickers.\n' +
    'First picker: Cancel. Next two pickers: Open the exact printed folders.\n' +
    'Then use Finder copy/paste when prompted.\n',
  { flag: 'wx', mode: 0o600 },
);
const state = stateSchema.parse({
  version: 3,
  workspaces: [
    {
      id: 'native-qa',
      name: 'Native acceptance',
      panes: [
        {
          id: 'source',
          type: 'folder',
          path: instructions,
          mode: 'columns',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [instructions],
          historyIndex: 0,
        },
      ],
      roots: ['source'],
      activePane: 'source',
      arrangement: {},
    },
  ],
  activeWorkspace: 'native-qa',
  favorites: [],
  recents: [],
  look: 'dark',
}) as SavedState;
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state) + '\n', {
  mode: 0o600,
});
await writeFile(path.join(profile, marker), id, { flag: 'wx', mode: 0o600 });
const plan = {
  id,
  bundle,
  scope: revocationOnly ? 'revocation' : finderOnly ? 'finder' : 'full',
  candidate,
  source,
  destination,
  outside,
  profile,
  clipboard: 'Operator copies generated Finder items; clipboard contents are replaced.',
  checks,
  observations,
};
await writeFile(path.join(evidenceDirectory, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
if (prepare) {
  console.log(JSON.stringify({ prepared: true, ...plan }, null, 2));
  await cleanup();
  process.exit(0);
}
const input = createInterface({ input: process.stdin, output: process.stdout });
let child: ChildProcess | undefined,
  socket: WebSocket | undefined,
  next = 0;
let output = '';
let debuggerOrigin = '',
  workspaceDebugger = '';
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
async function cleanup() {
  for (const root of [source, local, profile]) {
    if (
      (await lstat(root)).isSymbolicLink() ||
      (await readFile(path.join(root, marker), 'utf8')) !== id
    )
      throw new Error('Generated folder ownership changed; manual cleanup is required: ' + root);
    await trashTemporary(root);
  }
}
async function wait<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  label: string,
  timeout = 30000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null)
      throw new Error('Owned Viewer exited: ' + output.slice(-1500));
    const value = await read();
    if (accept(value)) return value;
    await delay(100);
  }
  throw new Error('Timed out waiting for ' + label);
}
function command<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = ++next,
      timer = setTimeout(() => {
        pending.delete(request);
        reject(new Error('Timed out: ' + method));
      }, 300000);
    pending.set(request, {
      resolve(value) {
        clearTimeout(timer);
        resolve(value as T);
      },
      reject(error) {
        clearTimeout(timer);
        reject(error);
      },
    });
    socket!.send(JSON.stringify({ id: request, method, params }));
  });
}
async function evaluate<T>(expression: string): Promise<T> {
  const reply = await command<{ result: { value: T }; exceptionDetails?: unknown }>(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true, userGesture: true },
  );
  assert.equal(
    reply.exceptionDetails,
    undefined,
    'Renderer call failed: ' + JSON.stringify(reply.exceptionDetails),
  );
  return reply.result.value;
}
const call = <T>(method: string, ...args: unknown[]) =>
  evaluate<T>(`window.viewer[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
async function denied(method: string, ...args: unknown[]) {
  const value = await evaluate<string>(
    `(async()=>{try{await window.viewer[${JSON.stringify(method)}](...${JSON.stringify(args)});return 'unexpected success';}catch(error){return error.code;}})()`,
  );
  if (value !== 'FILE_ACCESS_REQUIRED') {
    observations.push({
      stage: 'unexpected-access:' + method,
      grants: await call('fileAccessList'),
    });
    await save();
  }
  assert.equal(
    value,
    'FILE_ACCESS_REQUIRED',
    `Expected denied access for ${method}(${JSON.stringify(args)}). This run cannot prove permission isolation. Use only the scripted picker/Finder steps until the check completes; other folder grants can change its preconditions.`,
  );
}
async function rendererTarget(settings = false) {
  const target = await wait(
    async () => {
      try {
        return (
          (await (await fetch(debuggerOrigin + '/json/list')).json()) as {
            url: string;
            webSocketDebuggerUrl: string;
          }[]
        ).find(
          (item) =>
            item.url.startsWith('viewer-app://app/') &&
            item.url.includes('window=settings') === settings,
        );
      } catch {
        return undefined;
      }
    },
    Boolean,
    settings ? 'the signed Settings window' : 'the signed workspace',
  );
  return target!.webSocketDebuggerUrl;
}
async function connectRenderer(url: string) {
  assert.equal(pending.size, 0, 'Finish debugger requests before changing renderers.');
  socket?.close();
  socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket!.addEventListener('open', () => resolve(), { once: true });
    socket!.addEventListener(
      'error',
      () => reject(new Error('Could not attach to the owned Viewer')),
      { once: true },
    );
  });
  socket.addEventListener('message', (event) => {
    const reply = JSON.parse(String(event.data)),
      request = pending.get(reply.id);
    if (!request) return;
    pending.delete(reply.id);
    if (reply.error) request.reject(new Error(reply.error.message));
    else request.resolve(reply.result);
  });
}
async function launch() {
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  debuggerOrigin = `http://127.0.0.1:${port}`;
  child = spawn(
    path.join(bundle, 'Contents/MacOS/Viewer'),
    [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'],
    { env: { ...process.env, VIEWER_DATA_DIRECTORY: profile }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout!.on('data', (value) => {
    output += String(value);
  });
  child.stderr!.on('data', (value) => {
    output += String(value);
  });
  workspaceDebugger = await rendererTarget();
  await connectRenderer(workspaceDebugger);
  await wait(
    () => evaluate<boolean>('typeof window.viewer?.bootstrap === "function"'),
    Boolean,
    'Viewer startup',
  );
  await wait(
    () =>
      evaluate<boolean>(
        'document.readyState === "complete" && !!document.querySelector(".workspace-main")',
      ),
    Boolean,
    'the rendered test workspace',
  );
  await command('Page.bringToFront');
}
async function revokeFromSettings(root: string) {
  const workspaceResult = await evaluate<{ blocked: boolean; code?: string }>(
    `(async()=>{try{await window.viewer.fileAccessRevoke(${JSON.stringify(root)});return {blocked:false};}catch(error){return {blocked:true,code:error.code};}})()`,
  );
  assert.deepEqual(workspaceResult, { blocked: true, code: 'VIEWER_ERROR' });
  await call('list', root);
  observations.push({ stage: 'workspace-revoke-rejected', grants: await call('fileAccessList') });
  await save();
  await call('openSettings');
  await connectRenderer(await rendererTarget(true));
  try {
    await wait(
      () =>
        evaluate<boolean>(
          'typeof window.viewer?.fileAccessRevoke === "function" && document.readyState === "complete"',
        ),
      Boolean,
      'Settings startup',
    );
    await call('fileAccessRevoke', root);
    observations.push({ stage: 'after-Settings-revoke', grants: await call('fileAccessList') });
    await save();
  } finally {
    await connectRenderer(workspaceDebugger);
  }
}
async function quit() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Owned Viewer did not quit.')), 15000);
    child!.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error('Owned Viewer exit ' + code));
    });
  });
  void command('Browser.close').catch(() => {});
  await exited;
  socket?.close();
  socket = undefined;
  for (const request of pending.values()) request.reject(new Error('Owned Viewer quit.'));
  pending.clear();
}
async function choose(root: string, cancel = false) {
  console.log(
    '\nNative folder picker: ' +
      (cancel
        ? 'click Cancel.'
        : 'select exactly this folder, then Open:\n' +
          root +
          '\nUse Command-Shift-G to paste the path.'),
  );
  observations.push({ stage: 'before-picker-prompt', grants: await call('fileAccessList') });
  await save();
  await input.question(
    cancel
      ? 'This first step tests cancellation: use the Cancel button or Escape, then the script opens two more pickers for grants. Press Enter to open this picker. '
      : 'Press Enter to open this picker. ',
  );
  if (cancel) await denied('list', root);
  observations.push({ stage: 'before-picker', grants: await call('fileAccessList') });
  await save();
  const result = await call<string | null>('chooseFolder', root);
  observations.push({
    stage: 'after-picker',
    grants: await call('fileAccessList'),
    picker: { requested: root, cancelExpected: cancel, result },
  });
  await save();
  if (cancel && result !== null)
    throw new Error(
      'The cancellation test received a selected folder. This run cannot prove Cancel. Rerun and use Cancel or Escape in the first picker; use Open in the next two. Selected folder: ' +
        result,
    );
  if (!cancel) {
    if (result === null)
      throw new Error(
        'This step requires a folder grant. Rerun and use Open for the two grant pickers.',
      );
    assert.equal(await realpath(result), await realpath(root));
  }
}
async function operation(request: OperationRequest) {
  const jobID = await call<string>('operate', request);
  const jobs = await wait(
    () => call<OperationJob[]>('jobs'),
    (value) =>
      value.some(
        (job) => job.id === jobID && ['completed', 'failed', 'cancelled'].includes(job.status),
      ),
    'file operation',
  );
  const result = jobs.find((job) => job.id === jobID)!;
  assert.equal(result.status, 'completed', JSON.stringify(result.errors));
  return result;
}
async function save() {
  await writeFile(
    path.join(evidenceDirectory, 'result.json'),
    JSON.stringify({ completed: false, environment: os.release(), ...plan, checks }, null, 2) +
      '\n',
  );
}
async function passed(checkID: string, detail: string) {
  checks.push({ id: checkID, result: 'passed', detail });
  await save();
  console.log('PASS ' + checkID + ' ' + detail);
}
try {
  console.log(
    'Viewer native acceptance. Real pickers and Finder copy/paste; generated files and an isolated profile. Clipboard contents will be replaced with the generated selection.\n',
  );
  console.log(
    'Use this Viewer instance only for the prompted steps until the test finishes. Do not grant other locations through its sidebar during these checks.',
  );
  if (finderOnly)
    console.log('Finder-only session: use Open in BOTH pickers. Cancellation is not repeated.');
  if (revocationOnly)
    console.log(
      'Revocation-only session: use Open in the single picker. The script then revokes that generated folder from the actual Settings window.',
    );
  await launch();
  await denied('list', source);
  await denied('list', destination);
  if (revocationOnly) {
    await choose(source);
    await call('list', source);
  } else {
    if (!finderOnly) {
      await choose(source, true);
      await denied('list', source);
      await passed('P01-cancel', 'Real native picker cancellation preserves denial.');
    }
    await choose(source);
    await choose(destination);
    await call('list', source);
    await call('list', destination);
    await denied('list', outside);
    await passed(
      'P02-grants',
      'Two actual native grants allow only the chosen roots; the generated sibling is denied.',
    );
    if (!finderOnly) {
      const resource = await call<{ id: string }>('resource', path.join(source, 'Generated.txt'));
      const content = await call<{ text?: string }>('read', resource.id);
      assert.equal(content.text, generated);
      await call('release', resource.id);
      await passed(
        'C01-read',
        'Signed native read returns exact content from the generated iCloud root. This alone does not prove placeholder/offline behavior.',
      );
      const copied = await operation({
        kind: 'copy',
        sources: [path.join(source, 'Nested')],
        destination,
      });
      assert.equal(
        await readFile(path.join(destination, 'Nested', 'Résumé.txt'), 'utf8'),
        'Generated nested Unicode content.\n',
      );
      await call('undo', copied.id);
      await assert.rejects(lstat(path.join(destination, 'Nested')), { code: 'ENOENT' });
      await passed(
        'P02-copy-undo',
        'Nested Unicode folder copy and guarded Undo across independently picker-granted roots.',
      );
      await quit();
      await launch();
      await call('list', source);
      await call('list', destination);
      await denied('list', outside);
      await passed(
        'P01-cold',
        'Ordinary native folder bookmarks restore after graceful Quit and a fresh process.',
      );
    }
    const expectedClipboard = (
      await Promise.all(
        [path.join(source, 'Generated.txt'), path.join(source, 'Nested')].map((file) =>
          realpath(file),
        ),
      )
    ).sort();
    let clipboard: Awaited<ReturnType<ViewerAPI['clipboardRead']>> = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      execFileSync('/usr/bin/open', ['-a', 'Finder', source]);
      await input.question(
        '\nIn Finder, select BOTH Generated.txt and Nested, then Command-C. Return to this terminal and press Enter only AFTER copying. ',
      );
      const selection =
        await call<Awaited<ReturnType<ViewerAPI['clipboardRead']>>>('clipboardRead');
      const paths = selection
        ? (await Promise.all(selection.paths.map((file) => realpath(file)))).sort()
        : [];
      const expectedSelection =
        selection?.cut === false && JSON.stringify(paths) === JSON.stringify(expectedClipboard);
      observations.push({
        stage: 'Finder-copy-attempt-' + attempt,
        grants: await call('fileAccessList'),
        clipboard: { items: paths.length, expectedSelection, cut: selection?.cut },
      });
      await save();
      if (expectedSelection) {
        clipboard = selection;
        break;
      }
      console.log(
        'The clipboard does not contain the two generated Finder items. Select both in Finder and use Command-C before returning here. This step has not passed.',
      );
    }
    assert.ok(
      clipboard,
      'No matching native Finder file selection after three attempts. Permission/clipboard observations are saved in result.json.',
    );
    await operation({ kind: 'copy', sources: clipboard.paths, destination });
    assert.equal(await readFile(path.join(destination, 'Generated.txt'), 'utf8'), generated);
    assert.equal(
      await readFile(path.join(destination, 'Nested', 'Résumé.txt'), 'utf8'),
      'Generated nested Unicode content.\n',
    );
    await passed(
      'F01-in',
      'Human Finder Command-C imports native multi-file/folder objects; signed Viewer copies exact contents. Viewer physical Paste remains separate.',
    );
    const finderDestination = path.join(destination, 'Finder paste');
    await mkdir(finderDestination);
    await call(
      'clipboardWrite',
      [path.join(source, 'Generated.txt'), path.join(source, 'Nested')],
      false,
    );
    let pasted = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      execFileSync('/usr/bin/open', ['-a', 'Finder', finderDestination]);
      await input.question(
        '\nIn Finder, press Command-V. Wait until BOTH Generated.txt and Nested appear, then return to this terminal and press Enter. ',
      );
      try {
        await wait(
          async () => {
            try {
              const [file, nested] = await Promise.all([
                readFile(path.join(finderDestination, 'Generated.txt'), 'utf8'),
                readFile(path.join(finderDestination, 'Nested', 'Résumé.txt'), 'utf8'),
              ]);
              return file === generated && nested === 'Generated nested Unicode content.\n';
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
              throw error;
            }
          },
          Boolean,
          'exact Finder paste contents',
          10000,
        );
        pasted = true;
        break;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== 'Timed out waiting for exact Finder paste contents'
        )
          throw error;
        console.log(
          'The two pasted items are not complete yet. Use Command-V in Finder and wait for both items before returning here. This step has not passed.',
        );
      }
    }
    assert.ok(
      pasted,
      'Finder paste did not produce the exact generated contents after three attempts.',
    );
    await passed(
      'F01-out',
      'Signed Viewer native file/folder clipboard is physically pasted by Finder with exact contents.',
    );
  }
  await revokeFromSettings(source);
  await denied('list', source);
  await denied('resource', path.join(source, 'Generated.txt'));
  await passed(
    'P03-revoke',
    'A genuine picker grant revokes through the actual Settings renderer; subsequent workspace folder/preview access is denied. This is not physical Settings interaction coverage.',
  );
  await quit();
  await save();
  await writeFile(
    path.join(evidenceDirectory, 'result.json'),
    JSON.stringify(
      {
        completed: true,
        environment: os.release(),
        ...plan,
        checks,
        remaining: [
          ...(revocationOnly
            ? ['Picker cancellation/cold restore/copy/Undo/Finder require separate evidence']
            : []),
          ...(finderOnly
            ? ['Cancellation/read/Undo/cold restore require separate full-scope evidence']
            : []),
          'Native drag/modifiers',
          'Physical Viewer keyboard navigation/Paste',
          'VoiceOver',
          'Cloud placeholder/offline/conflict/reconnect',
          'Other supported macOS versions',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log('\nNative checks complete. Evidence: ' + path.join(evidenceDirectory, 'result.json'));
} catch (error) {
  await save();
  await writeFile(
    path.join(evidenceDirectory, 'failure.txt'),
    (error instanceof Error ? error.stack : String(error)) + '\n' + output.slice(-2500),
  );
  throw error;
} finally {
  input.close();
  await quit().catch(() => {
    child?.kill('SIGTERM');
  });
  await cleanup();
}
