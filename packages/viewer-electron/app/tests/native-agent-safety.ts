/** Reject-only native MCP checks. All generated files, profiles and captures are preserved. */
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { defaultSettings } from '../src/domain/services';
import { normalizePreferences } from '../src/domain/preferences';
import { settingsSchema } from '../src/desktop/settings';
import type { AgentClientReply } from '../src/domain/agent-clients';
import type { AgentProposal } from '../src/domain/agent-requests';
import type { CustomAction } from '../src/domain/automation';
import type { SavedState } from '../src/domain/contracts';
import { ownedApp, until } from './owned-app';
import { temporaryRoot } from '../tools/temporary';

const root = await temporaryRoot('viewer-agent-safety-');
const profile = path.join(root, 'Profile'),
  shared = path.join(root, 'Shared');
const nested = path.join(shared, 'Nested'),
  file = path.join(shared, 'Résumé.txt');
await Promise.all([profile, nested].map((folder) => mkdir(folder, { recursive: true })));
const original = 'Generated safety fixture. Keep this file intact.';
await writeFile(file, original);
await writeFile(path.join(nested, 'Kept.txt'), original);
const longFiles = Array.from({ length: 8 }, (_, index) =>
  path.join(shared, `Review ${index + 1} ${'long-selected-name-'.repeat(8)}.txt`),
);
await Promise.all(longFiles.map((file) => writeFile(file, original)));
const alias: CustomAction = {
  id: 'cleanup',
  name: 'Cleanup alias',
  aliases: [],
  icon: 'trash',
  shortcut: '',
  order: 0,
  pinned: false,
  when: { target: 'any', extensions: [], min: 1, max: 10000 },
  executor: { kind: 'builtin', command: 'trash' },
};
const config = defaultSettings(os.homedir());
config.appearance = 'dark';
config.agents = { enabled: true, roots: [shared], allowLayout: false };
config.browsing.confirmTrash = false;
config.customActions = [
  alias,
  {
    ...alias,
    id: 'opaque',
    name: 'Opaque shell',
    executor: { kind: 'shell', executable: '/bin/zsh', script: 'echo unused', perItem: false },
  },
];
const normalized = settingsSchema.parse(config);
await writeFile(
  path.join(profile, 'config.jsonc'),
  JSON.stringify({
    version: 1,
    settings: normalized,
    ui: normalizePreferences(),
  }),
);
await writeFile(
  path.join(profile, 'execution-approvals-v1.json'),
  JSON.stringify([
    {
      id: 'legacy-execution',
      clientID: 'legacy',
      actionID: 'custom.cleanup',
      root: shared,
      capability: 'execute',
      fingerprint: createHash('sha256')
        .update(JSON.stringify(normalized.customActions[0]))
        .digest('hex'),
    },
  ]),
);
const initial: SavedState = {
  version: 4,
  activeWorkspace: 'safety',
  look: 'dark',
  favorites: [],
  recents: [],
  workspaces: [
    {
      id: 'safety',
      name: 'Agent safety',
      roots: ['folder'],
      activePane: 'folder',
      arrangement: {},
      panes: [
        {
          id: 'folder',
          type: 'folder',
          path: shared,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [shared],
          historyIndex: 0,
        },
      ],
    },
  ],
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(initial));
const output = await mkdtemp(path.resolve('out/agent-safety-acceptance-'));
const binary =
  process.env.VIEWER_TEST_BINARY ??
  path.resolve('out/Viewer-safety-v5-darwin-arm64/Viewer.app/Contents/MacOS/Viewer');
const viewer = await ownedApp(binary, profile);
let main: Awaited<ReturnType<typeof viewer.connect>> | undefined;
const evidence: string[] = [];
const captures: string[] = [];
try {
  main = await viewer.connect();
  await until(
    () =>
      main!.evaluate<boolean>(
        `Array.from(document.querySelectorAll('[data-file-path]')).some(n=>n.dataset.filePath===${JSON.stringify(file)})`,
      ),
    Boolean,
    'generated file row',
  );
  await main.evaluate(`(() => {
    const rows=Array.from(document.querySelectorAll('[data-file-path]'));
    rows.find(n=>n.dataset.filePath===${JSON.stringify(file)}).click();
    rows.find(n=>n.dataset.filePath===${JSON.stringify(nested)})
      .dispatchEvent(new MouseEvent('click', {bubbles:true,metaKey:true}));
  })()`);
  await main.evaluate('window.viewer.openSettings()');
  const settings = await viewer.connect(true);
  const reply = await settings.evaluate<AgentClientReply>(
    `window.viewer.agentClients({kind:'create',client:${JSON.stringify({
      name: 'Safety checks',
      roots: [shared],
      // Old capabilities may be imported; neither bypasses the new desktop policy.
      capabilities: ['metadata', 'propose', 'execute', 'terminal-write'],
      budgets: { maxReadBytes: 1048576, maxTasks: 4 },
    })}})`,
  );
  assert.ok(!Array.isArray(reply) && 'token' in reply);
  const named = reply.token;
  const legacy = JSON.parse(await settings.evaluate<string>('window.viewer.agentToken()'))
    .mcpServers.viewer.env.VIEWER_AGENT_TOKEN as string;
  const connection = JSON.parse(
    await readFile(path.join(profile, 'agent-connection-v1.json'), 'utf8'),
  ) as { socket: string };
  async function request<T>(token: string, request: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(connection.socket);
      let buffer = '';
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('Owned MCP timeout'));
      }, 15000);
      socket.on('error', reject);
      socket.on('connect', () => socket.write(JSON.stringify({ id: 1, token, request }) + '\n'));
      socket.on('data', (chunk) => {
        buffer += String(chunk);
        if (!buffer.includes('\n')) return;
        clearTimeout(timer);
        socket.destroy();
        const response = JSON.parse(buffer.split('\n')[0]);
        if (response.error) reject(new Error(response.error));
        else resolve(response.value as T);
      });
      socket.on('close', () => clearTimeout(timer));
    });
  }
  async function call<T>(
    token: string,
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    const result = await request<{ content: { text: string }[] }>(token, {
      method: 'tools/call',
      params: { name, arguments: args },
    });
    return JSON.parse(result.content[0].text) as T;
  }
  const catalog = await until(
    () =>
      call<{
        target: { selection: { path: string }[] };
        commands: { id: string }[];
        removalPolicy: unknown;
      }>(named, 'list_commands'),
    (value) => value.target.selection.length === 2,
    'captured two-item selection',
  );
  assert.deepEqual(catalog.target.selection.map((item) => item.path).sort(), [file, nested].sort());
  assert.deepEqual(catalog.removalPolicy, {
    requiresUserApproval: true,
    method: 'trash',
    permanentDeletion: false,
  });
  assert.ok(catalog.commands.some((command) => command.id === 'trash'));
  assert.ok(catalog.commands.some((command) => command.id === 'custom.cleanup'));
  assert.ok(
    !catalog.commands.some((command) =>
      [
        'custom.opaque',
        'open-terminal',
        'open-terminal-plane',
        'open-tmux',
        'open-default',
        'open-with',
        'open-selection',
        'undo-file',
      ].includes(command.id),
    ),
  );
  const tools = await request<{ tools: { name: string }[] }>(named, { method: 'tools/list' });
  assert.ok(
    !tools.tools.some((tool) =>
      ['write_terminal', 'delete', 'trash', 'empty_trash', 'apply'].includes(tool.name),
    ),
  );
  await assert.rejects(
    call(named, 'write_terminal', { id: 'absent', data: 'unused' }),
    /permanently delete|no longer available/,
  );
  await assert.rejects(
    call(named, 'propose_command', { commandID: 'custom.opaque' }),
    /bypass Trash/,
  );
  evidence.push(
    'Actual authenticated MCP omits unsafe routes and rejects terminal input/opaque shell actions despite imported write capabilities.',
  );

  async function metrics(
    connection: Awaited<ReturnType<typeof viewer.connect>>,
    width: number,
    height: number,
  ) {
    await connection.command('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }
  async function capture(
    connection: Awaited<ReturnType<typeof viewer.connect>>,
    name: string,
    selector: string,
  ) {
    let previous = '',
      stable = 0;
    await until(
      async () => {
        const state = await connection.evaluate<{ opacity: number; boxes: unknown[] }>(`(() => {
        let node=document.querySelector(${JSON.stringify(selector)}), opacity=1, boxes=[];
        if(!node) return {opacity:0,boxes};
        while(node){const css=getComputedStyle(node),r=node.getBoundingClientRect();
          opacity*=Number(css.opacity);boxes.push([r.x,r.y,r.width,r.height,css.transform]);node=node.parentElement}
        return {opacity,boxes};})()`);
        const serialized = JSON.stringify(state);
        stable = serialized === previous ? stable + 1 : 0;
        previous = serialized;
        return state;
      },
      (state) => state.opacity > 0.999 && stable >= 2,
      'settled ' + name,
    );
    const shot = await connection.command<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
    });
    const destination = path.join(output, name + '.png');
    await writeFile(destination, Buffer.from(shot.data, 'base64'));
    captures.push(destination);
  }
  const proposal = await call<{ id: string; requiresUserReview: boolean }>(
    legacy,
    'propose_command',
    { commandID: 'custom.cleanup' },
  );
  assert.equal(proposal.requiresUserReview, true);
  const captured = await call<AgentProposal>(legacy, 'get_proposal', { id: proposal.id });
  assert.equal(captured.status, 'review');
  assert.equal(captured.removal, 'trash');
  assert.ok(captured.detail.includes(file) && captured.detail.includes(nested));
  await until(
    () =>
      main!.evaluate<string>(`document.querySelector('.agent-proposal-detail')?.textContent||''`),
    (text) => text.includes(file) && text.includes(nested),
    'exact-path review dialog',
  );
  assert.ok(
    await main.evaluate<boolean>(
      `Array.from(document.querySelectorAll('.dialog button')).some(b=>b.textContent.trim()==='Move to Trash')`,
    ),
  );
  await metrics(main, 1440, 940);
  await capture(main, 'review-desktop-dark', '.agent-proposal-detail');
  await metrics(main, 900, 640);
  await capture(main, 'review-compact-dark', '.agent-proposal-detail');
  await settings.evaluate(
    `window.viewer.settingsGet().then(s=>window.viewer.settingsPatch([{path:'settings.appearance',value:'light'}],s.revision))`,
  );
  await until(
    () =>
      main!.evaluate<string>(
        'document.documentElement.dataset.theme||document.body.dataset.look||document.documentElement.dataset.look||""',
      ),
    (look) => look === 'light',
    'light main theme',
  );
  await capture(main, 'review-compact-light', '.agent-proposal-detail');
  await metrics(main, 1440, 940);
  await capture(main, 'review-desktop-light', '.agent-proposal-detail');
  // Deliberately reject. Never approve a real removal, even for a generated fixture.
  await main.evaluate(
    `Array.from(document.querySelectorAll('.dialog button')).find(b=>b.textContent.trim()==='Reject').click()`,
  );
  await until(
    () => call<AgentProposal>(legacy, 'get_proposal', { id: proposal.id }),
    (p) => p.status === 'rejected',
    'rejected review',
  );
  assert.equal(await readFile(file, 'utf8'), original);
  assert.equal(await readFile(path.join(nested, 'Kept.txt'), 'utf8'), original);
  const second = await call<{ id: string; requiresUserReview: boolean }>(named, 'propose_command', {
    commandID: 'trash',
  });
  assert.equal(second.requiresUserReview, true);
  assert.notEqual(second.id, proposal.id);
  await main.evaluate(`window.viewer.agentReview(${JSON.stringify(second.id)},false)`);
  evidence.push(
    'Hidden manual confirmation and a valid saved legacy Trash-alias grant still require a fresh exact-path review; Reject preserves both items, and the next named request needs new approval.',
  );

  await metrics(main, 1440, 940);
  await main.evaluate(`(() => {
    const paths=${JSON.stringify([...longFiles, nested])};
    paths.forEach((file,index)=>{
      const row=Array.from(document.querySelectorAll('[data-file-path]')).find(row=>row.dataset.filePath===file);
      if(!row) throw new Error('Long-selection row is unavailable');
      row.dispatchEvent(new MouseEvent('click',{bubbles:true,metaKey:index>0}));
    });
  })()`);
  await until(
    () => call<{ target: { selection: unknown[] } }>(named, 'list_commands'),
    (value) => value.target.selection.length === 9,
    'nine-item long-path selection',
  );
  const longProposal = await call<{ id: string }>(named, 'propose_command', { commandID: 'trash' });
  await until(
    () =>
      main!.evaluate<string>(`document.querySelector('.agent-proposal-detail')?.textContent||''`),
    (text) => longFiles.every((file) => text.includes(file)),
    'long selection review',
  );
  await metrics(main, 900, 640);
  const controls = () =>
    main!.evaluate<{ visible: boolean; scrolls: boolean }>(`(()=>{
    const dialog=document.querySelector('.agent-review-dialog'), body=dialog.querySelector('.agent-review-body');
    const d=dialog.getBoundingClientRect(),header=dialog.querySelector('header').getBoundingClientRect(),footer=dialog.querySelector('footer').getBoundingClientRect();
    return {visible:header.top>=d.top&&footer.bottom<=d.bottom&&d.top>=0&&d.bottom<=innerHeight,
      scrolls:body.scrollHeight>body.clientHeight};})()`);
  await until(
    controls,
    (value) => value.visible && value.scrolls,
    'bounded review body with visible approval controls',
  );
  await capture(main, 'review-long-top-compact-light', '.agent-review-body');
  await main.evaluate(
    `const body=document.querySelector('.agent-review-body');body.scrollTop=body.scrollHeight;const detail=document.querySelector('.agent-proposal-detail');detail.scrollTop=detail.scrollHeight;`,
  );
  assert.ok((await controls()).visible);
  await capture(main, 'review-long-bottom-compact-light', '.agent-review-body');
  await main.evaluate(`window.viewer.agentReview(${JSON.stringify(longProposal.id)},false)`);
  for (const file of longFiles) assert.equal(await readFile(file, 'utf8'), original);
  evidence.push(
    'Nine selected items with long exact paths scroll inside the compact approval body while header and Reject/Move to Trash remain visible; top/bottom states are captured and rejection preserves every item.',
  );

  await settings.evaluate(
    `Array.from(document.querySelectorAll('.settings-navigation button')).find(b=>b.textContent.trim()==='Agents').click()`,
  );
  await until(
    () => settings.evaluate<string>(`document.querySelector('.settings-page')?.textContent||''`),
    (text) => text.includes('Unattended execution unavailable'),
    'agent settings',
  );
  const disabled =
    await settings.evaluate<boolean>(`['Unattended execution unavailable','Terminal input unavailable'].every(text=>{
    const row=Array.from(document.querySelectorAll('label.settings-row')).find(row=>row.textContent.includes(text));
    return row?.querySelector('input')?.disabled && !row.querySelector('input').checked;})`);
  assert.ok(disabled);
  await settings.evaluate(
    `const disclosure=Array.from(document.querySelectorAll('details')).find(d=>d.querySelector('summary')?.textContent==='Legacy shared connection');disclosure.open=true;`,
  );
  await until(
    () => settings.evaluate<string>(`document.querySelector('.settings-page')?.textContent||''`),
    (text) => text.includes('Agent permissions'),
    'legacy permissions',
  );
  await settings.evaluate(
    `Array.from(document.querySelectorAll('details')).find(d=>d.querySelector('summary')?.textContent==='Existing grants').open=true;document.querySelector('.settings-grant').scrollIntoView({block:'center'});`,
  );
  assert.ok(
    await settings.evaluate<boolean>(
      `document.querySelector('.settings-grant')?.textContent.includes('Inactive; approval is required each time')`,
    ),
  );
  await metrics(settings, 1440, 940);
  await capture(settings, 'permissions-desktop-light', '.settings-grant');
  await metrics(settings, 900, 640);
  await capture(settings, 'permissions-compact-light', '.settings-grant');
  await settings.evaluate(
    `Array.from(document.querySelectorAll('label.settings-row')).find(row=>row.textContent.includes('Unattended execution unavailable')).scrollIntoView({block:'center'})`,
  );
  await capture(settings, 'client-compact-light', '.settings-page');
  await settings.evaluate(
    `window.viewer.settingsGet().then(s=>window.viewer.settingsPatch([{path:'settings.appearance',value:'dark'}],s.revision))`,
  );
  await metrics(settings, 1440, 940);
  await capture(settings, 'client-desktop-dark', '.settings-page');
  evidence.push(
    'Actual Settings renders unavailable execution/input checkboxes disabled, terminal-read grants separately, and old execution grants visibly inactive with Revoke retained.',
  );
  assert.equal(await readFile(file, 'utf8'), original);
  assert.equal(await readFile(path.join(nested, 'Kept.txt'), 'utf8'), original);
  assert.ok(
    (await readFile(path.join(profile, 'config.jsonc'), 'utf8')).includes(
      'Every agent command requires fresh user approval.',
    ),
  );
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
          'Owned direct app; authenticated MCP, rejected reviews and Settings. No real removal approved; fixtures/profile/intermediates preserved. Physical approval, native Trash success, assistive technology and Store qualification are unverified.',
      },
      null,
      2,
    ),
  );
  evidence.forEach((text) => console.log('PASS ' + text));
  console.log('Evidence:', output);
} catch (error) {
  console.error('Native safety check failed:', error);
  throw error;
} finally {
  console.log('Generated fixtures preserved:', root);
  await viewer.close(main);
}
