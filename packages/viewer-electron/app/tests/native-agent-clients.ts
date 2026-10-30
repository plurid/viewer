/** Packaged per-client MCP authority using only an owned app and generated files. Agent access
 * needs the operator's native Allow: run with --interactive in a supervised terminal. */
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ownedApp, until } from './owned-app';
import { grantAgentAccess, operatorSession } from './native/runtime/agent-access';
import { countOf, exists } from './native/runtime/page';
import { pageCall } from './native/runtime/page-function';
import type { AgentClient, AgentClientInput, AgentClientReply } from '../src/domain/agents/clients';
import type { DrawingGeometryPage } from '../src/domain/previews/drawings/geometry';
import { panelDrawing } from './dxf-fixtures';
import { officeFixture } from './office-fixtures';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

operatorSession('native-agent-clients');
const root = await temporaryRoot('viewer-native-clients-');
const profile = path.join(root, 'Profile'),
  shared = path.join(root, 'Shared'),
  secret = path.join(root, 'Secret');
await Promise.all([profile, shared, secret].map((file) => mkdir(file)));
const file = path.join(shared, 'Résumé.txt');
await writeFile(file, 'Original generated passage with diacritics: ştiinţă.');
const drawing = path.join(shared, 'Panel.dxf');
await writeFile(drawing, panelDrawing);
const workbook = path.join(shared, 'Measurements.xlsx');
await writeFile(workbook, officeFixture('workbook'));
await writeFile(
  path.join(profile, 'viewer-state-v1.json'),
  JSON.stringify({
    version: 4,
    activeWorkspace: 'scope',
    look: 'dark',
    favorites: [],
    recents: [],
    workspaces: [
      {
        id: 'scope',
        name: 'Client checks',
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
  }),
);
const viewer = await ownedApp(
  process.env.VIEWER_TEST_BINARY ??
    path.resolve('out/Viewer-darwin-arm64/Viewer.app/Contents/MacOS/Viewer'),
  profile,
  { mode: 'foreground' },
);
let main: Awaited<ReturnType<typeof viewer.connect>> | undefined;
const evidence: string[] = [];
type CreatedClient = Extract<AgentClientReply, { token: string }>;
const listClients = () => window.viewer.agentClients({ kind: 'list' }) as Promise<AgentClient[]>;
/** The reply carries the new client's token, shown once. */
const createClient = (client: AgentClientInput) =>
  window.viewer.agentClients({ kind: 'create', client }) as Promise<CreatedClient>;
const revokeClient = (id: string, revision: number) =>
  window.viewer.agentClients({ kind: 'revoke', id, revision });
try {
  main = await viewer.connect();
  const evaluate = main.evaluate;
  await until(() => evaluate(exists('.folder-explorer')), Boolean, 'owned folder renderer');
  assert.match(
    await evaluate(
      pageCall(() =>
        window.viewer.agentClients({ kind: 'list' }).then(
          () => '',
          (error: Error) => error.message,
        ),
      ),
    ),
    /Manage credentials/,
  );
  await evaluate(pageCall(() => window.viewer.openSettings()));
  const settings = await viewer.connect(true);
  // Agent access starts only from Settings, with the operator's native Allow.
  await grantAgentAccess(settings, [shared]);
  const input: AgentClientInput = {
    name: 'Navigator',
    roots: [shared],
    capabilities: ['metadata', 'content', 'navigation'],
    budgets: { maxReadBytes: 1048576, maxTasks: 2 },
  };
  const reply = await settings.evaluate(pageCall(createClient, input));
  assert.ok(!Array.isArray(reply) && 'token' in reply);
  const client = reply.client,
    token = reply.token;
  assert.ok(reply.configuration?.includes('--mcp'));
  const metadata = await settings.evaluate(
    pageCall(createClient, { ...input, name: 'Metadata only', capabilities: ['metadata'] }),
  );
  const connection = JSON.parse(
    await readFile(path.join(profile, 'agent-connection-v1.json'), 'utf8'),
  ) as { socket: string };
  const call = (
    credential: string,
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const socket = net.createConnection(connection.socket);
      let buffer = '';
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('Owned MCP call timed out.'));
      }, 15000);
      socket.on('error', reject);
      socket.on('connect', () =>
        socket.write(
          JSON.stringify({
            id: 1,
            token: credential,
            request: { method: 'tools/call', params: { name, arguments: args } },
          }) + '\n',
        ),
      );
      socket.on('data', (chunk) => {
        buffer += String(chunk);
        if (!buffer.includes('\n')) return;
        const response = JSON.parse(buffer.split('\n')[0]);
        clearTimeout(timer);
        socket.destroy();
        if (response.error) reject(new Error(response.error));
        else resolve(JSON.parse(response.value.content[0].text));
      });
      socket.on('close', () => clearTimeout(timer));
    });
  await assert.rejects(call(metadata.token, 'read_content', { path: file }), /no content/);
  const read = (await call(token, 'read_content', { path: file })) as {
    evidence: { text: string }[];
    version: { size: number };
  };
  assert.equal(read.evidence[0].text, 'Original generated passage with diacritics: ştiinţă.');
  assert.ok(read.version.size > 0);
  await assert.rejects(
    call(metadata.token, 'read_drawing_geometry', { path: drawing }),
    /no content/,
  );
  const geometry = (await call(token, 'read_drawing_geometry', {
    path: drawing,
    points: true,
  })) as DrawingGeometryPage;
  assert.deepEqual(geometry.bounds, { min: { x: 0, y: 0 }, max: { x: 200, y: 100 } });
  assert.equal(geometry.units.symbol, 'mm');
  assert.equal(geometry.entities.find((entity) => entity.type === 'CIRCLE')?.radius, 10);
  assert.ok(
    Math.abs(geometry.entities.find((entity) => entity.type === 'CIRCLE')!.area! - 100 * Math.PI) <
      1e-8,
  );
  assert.equal(geometry.contentHash.length, 64);
  evidence.push(
    'The actual MCP broker reads shared DXF bounds, coordinates, declared units, measurements and byte hash through the packaged worker; metadata-only credentials cannot read geometry.',
  );
  await assert.rejects(call(metadata.token, 'query_table', { path: workbook }), /no content/);
  const sheet = (await call(token, 'query_table', {
    path: workbook,
    sheet: 'Measurements',
    offset: 1,
    limit: 1,
  })) as {
    coverage: string;
    rows: {
      row: number;
      cells: {
        value: string;
        formula?: string;
        cached?: boolean;
        anchor: { sheet: string; row: number; column: number };
      }[];
    }[];
  };
  assert.equal(sheet.coverage, 'partial');
  assert.equal(sheet.rows[0].row, 61);
  assert.equal(sheet.rows[0].cells[1].value, '20');
  assert.equal(sheet.rows[0].cells[1].formula, 'SUM(B1,7.5)');
  assert.equal(sheet.rows[0].cells[1].cached, true);
  assert.deepEqual(sheet.rows[0].cells[1].anchor, {
    kind: 'cells',
    sheet: 'Measurements',
    row: 61,
    column: 2,
  });
  assert.equal(sheet.rows[0].cells[2].cached, false);
  evidence.push(
    'The actual MCP broker and packaged Office worker return a named XLSX sheet window at source row 61 with saved/uncached formulas and original cell anchors; metadata-only credentials cannot read it.',
  );
  await assert.rejects(
    call(token, 'read_metadata', { path: path.join(profile, 'agent-clients-v1.json') }),
    /Private Viewer/,
  );
  await assert.rejects(call(token, 'read_metadata', { path: secret }), /outside/);
  evidence.push(
    'Separate named credentials enforce content capabilities, source versions, folder boundaries and private-profile exclusion.',
  );
  const navigation = (await call(token, 'propose_open_path', {
    path: file,
    placement: 'root',
  })) as { id: string; requiresUserReview: boolean };
  assert.equal(navigation.requiresUserReview, false);
  await until(
    () => evaluate(countOf('.preview')),
    (count) => count > 0,
    'granted automatic preview navigation',
  ).catch(async () => {
    const state = JSON.parse(await readFile(path.join(profile, 'viewer-state-v1.json'), 'utf8'));
    assert.ok(
      state.workspaces[0].panes.some(
        (pane: { path: string; type: string }) => pane.path === file && pane.type === 'preview',
      ),
    );
  });
  await assert.rejects(
    call(metadata.token, 'get_proposal', { id: navigation.id }),
    /another actor/,
  );
  evidence.push(
    'Saved navigation capability opens an actual independent preview without approval; another client cannot read the proposal.',
  );
  await settings.evaluate(pageCall(revokeClient, client.id, client.revision));
  await assert.rejects(call(token, 'read_content', { path: file }), /invalid/);
  assert.equal(
    (await settings.evaluate(pageCall(listClients))).find((item) => item.id === client.id)?.revoked,
    true,
  );
  assert.ok(!(await readFile(path.join(profile, 'agent-clients-v1.json'), 'utf8')).includes(token));
  evidence.push(
    'Settings-only revocation immediately invalidates the credential; private storage contains hashes and no plain client token.',
  );
  await settings.evaluate(
    pageCall(() =>
      [...document.querySelectorAll('button')]
        .find((button) => button.textContent.trim() === 'Agents')
        ?.click(),
    ),
  );
  const out = path.resolve('out/agent-client-acceptance');
  await mkdir(out, { recursive: true });
  const shot = await settings.command<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
  });
  await writeFile(path.join(out, 'clients.png'), Buffer.from(shot.data, 'base64'));
  await writeFile(
    path.join(out, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        evidence,
        scope: 'Owned direct package. No native picker, shell grant or Store qualification claim.',
      },
      null,
      2,
    ),
  );
  evidence.forEach((item) => process.stdout.write('PASS ' + item + '\n'));
} finally {
  await viewer.close(main);
  await trashTemporary(root);
}
