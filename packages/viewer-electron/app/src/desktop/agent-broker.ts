import type { CapturedTarget } from '../domain/automation';
import type {
  AgentNavigation,
  AgentPlane,
  AgentWorkspaceSnapshot,
  CommandDescriptor,
  AgentProposal,
} from '../domain/agent-requests';
import type { AgentRequests } from './agent-requests';
import type { SettingsService } from './settings';
import { createServer, type Server, type Socket } from 'node:net';
import { chmod, realpath, mkdtemp, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type {
  ActionContext,
  ActionRequest,
  ApplicationSettings,
  IndexedQuery,
} from '../domain/services';
import type { FileServices } from './file-services';
import type { ActionPlanner } from './actions/planner';
import { entry, absolute } from './filesystem';
import { DocumentStore } from './document-store';
import { AgentClients } from './agent-clients';
import {
  sharedClientID,
  type AgentCapability,
  type AgentClientRequest,
} from '../domain/agent-clients';
import { sourceVersion, sameSourceVersion } from '../domain/inspection';
import { parseDelimited } from '../domain/delimited';
import type { RelationshipsResult, FileRelation } from '../domain/relationships';
import { drawingGeometryOptionsSchema } from '../domain/drawing-geometry';
import { agentCommandID, agentRemovalPolicy } from '../domain/agent-safety';
import { discardOwnTemporaryFile, removeEmptyDirectory } from './removal';
import { agentTools } from './agent-tools';
const within = (file: string, root: string) =>
  file === root || file.startsWith(root.replace(/\/$/, '') + '/');
/** The person's Home folder; a Mac App Store build's os.homedir() is its container. */
const realHome = () => (process.mas ? os.userInfo().homedir : os.homedir());
/** Agents see the shape of execution settings, never secrets they may carry:
 * terminal environment values and shell scripts often hold tokens. */
export function redactedSettings(settings: ApplicationSettings): ApplicationSettings {
  const hidden = '[redacted]';
  return {
    ...settings,
    terminals: {
      ...settings.terminals,
      profiles: settings.terminals.profiles.map((profile) => ({
        ...profile,
        env: Object.fromEntries(Object.keys(profile.env).map((key) => [key, hidden])),
      })),
    },
    customActions: settings.customActions.map((action) =>
      action.executor.kind === 'shell'
        ? { ...action, executor: { ...action.executor, script: hidden } }
        : action,
    ),
  };
}
export class AgentBroker {
  private taskAdmissions: Promise<unknown> = Promise.resolve();
  private admitTask<T>(work: () => Promise<T>): Promise<T> {
    const task = this.taskAdmissions.catch(() => {}).then(work);
    this.taskAdmissions = task;
    return task;
  }
  readonly clients: AgentClients;
  private server?: Server;
  private starting?: Promise<void>;
  private socketDirectory?: string;
  private streams = new Set<Socket>();
  private token = randomBytes(32).toString('hex');
  private owned = new Map<string, string>();
  private activeCalls = new Map<string, number>();
  private connection: DocumentStore<{ socket: string; pid: number }>;
  private tokenStore: DocumentStore<string>;
  constructor(
    private dataPath: string,
    private settings: () => ApplicationSettings,
    private context: () => ActionContext | undefined,
    private files: FileServices,
    private actions: ActionPlanner,
    private extension?: {
      catalog(): { target: CapturedTarget; commands: CommandDescriptor[] } | undefined;
      requests: AgentRequests;
      config: SettingsService;
      access?(files: readonly string[]): Promise<void>;
      workspaceState?(): Promise<AgentWorkspaceSnapshot | undefined>;
      relationships?(file: string, content: boolean): Promise<RelationshipsResult>;
    },
  ) {
    this.clients = new AgentClients(dataPath, async (paths) => {
      await this.extension?.access?.(paths);
      for (const root of paths) {
        const actual = await realpath(absolute(root));
        if (!(await stat(actual)).isDirectory()) throw new Error('Choose a folder for the client.');
        if (within(actual, await realpath(dataPath).catch(() => path.resolve(dataPath))))
          throw new Error('Private Viewer data cannot be an agent folder.');
      }
    });
    this.connection = new DocumentStore(path.join(dataPath, 'agent-connection-v1.json'), (value) =>
      z.object({ socket: z.string(), pid: z.number() }).parse(value),
    );
    // Local agent authentication needs a private token, not a cloud credential.
    // Keep it in mode-0600 app metadata so launching agents never opens Keychain.
    this.tokenStore = new DocumentStore(path.join(dataPath, 'agent-token-v1.json'), (value) =>
      z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(value),
    );
  }
  async start(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.server || !this.settings().agents.enabled) return;
    this.starting = this.startNow().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }
  private async startNow(): Promise<void> {
    const stored = await this.tokenStore.load();
    if (stored) this.token = stored;
    else await this.tokenStore.save(this.token);
    // Darwin's sockaddr_un path is limited to 104 bytes. User-data paths can
    // exceed that on their own; keep the socket in an owned private directory.
    this.socketDirectory = await mkdtemp(
      path.join(
        process.platform === 'darwin' && !process.mas ? '/tmp' : os.tmpdir(),
        'viewer-agent-',
      ),
    );
    await chmod(this.socketDirectory, 0o700);
    const socket = path.join(this.socketDirectory, 'v.sock');
    this.server = createServer((stream) => {
      this.streams.add(stream);
      stream.on('close', () => this.streams.delete(stream));
      const decoder = new StringDecoder('utf8');
      let buffer = '';
      let requests = Promise.resolve();
      // Bound queued requests per connection: reading pauses until earlier ones finish.
      let pending = 0;
      stream.on('error', () => {});
      stream.on('data', (chunk) => {
        buffer += decoder.write(chunk);
        if (Buffer.byteLength(buffer) > 65536) {
          stream.destroy();
          return;
        }
        let index: number;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          if (++pending >= 16) stream.pause();
          requests = requests.then(async () => {
            let id: unknown = null;
            try {
              const input = JSON.parse(line);
              id = input.id;
              const value = await this.handle(input.token, input.request);
              stream.write(JSON.stringify({ id, value }) + '\n');
            } catch (error) {
              stream.write(
                JSON.stringify({
                  id,
                  error: error instanceof Error ? error.message : 'Agent request failed.',
                }) + '\n',
              );
            } finally {
              if (--pending < 16 && stream.isPaused()) stream.resume();
            }
          });
        }
      });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        this.server!.once('error', reject);
        this.server!.listen(socket, () => {
          this.server!.removeListener('error', reject);
          resolve();
        });
      });
      await chmod(socket, 0o600);
      await this.connection.save({ socket, pid: process.pid });
    } catch (error) {
      const server = this.server;
      this.server = undefined;
      if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      await this.removeSocketDirectory();
      throw error;
    }
  }
  async credential(): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await this.tokenStore.save(token);
    this.token = token;
    await this.stop(sharedClientID);
    for (const stream of this.streams) stream.destroy();
    return token;
  }
  async clientRequest(request: AgentClientRequest): Promise<unknown> {
    if (request.kind === 'list') return this.clients.list();
    if (request.kind === 'create')
      return this.clients.create({
        ...request.client,
        roots: await Promise.all(request.client.roots.map((root) => realpath(absolute(root)))),
      });
    const result = await this.clients.update(
      request.id,
      request.revision,
      request.kind === 'update'
        ? {
            ...request.client,
            roots: await Promise.all(request.client.roots.map((root) => realpath(absolute(root)))),
          }
        : undefined,
    );
    await this.stop(request.id);
    return result;
  }
  async stop(clientID: string): Promise<void> {
    this.extension?.requests.stop(clientID);
    for (const [id, owner] of this.owned)
      if (owner === clientID) {
        this.actions.cancel(id);
        this.owned.delete(id);
      }
    for (const plan of await this.actions.all())
      if (plan.context.actor === 'agent' && plan.context.clientID === clientID)
        this.actions.cancel(plan.id);
  }
  async authorizeProposal(proposal: AgentProposal): Promise<void> {
    await this.clients.context.run(proposal.clientID ?? sharedClientID, async () => {
      const capability =
        proposal.kind === 'navigation'
          ? 'navigation'
          : proposal.kind === 'terminal-write'
            ? 'terminal-write'
            : 'propose';
      await this.clients.require(capability);
      if (!this.settings().agents.enabled) throw new Error('Agent access is disabled.');
      if (proposal.target?.directory && proposal.target.paneID !== 'none')
        await this.authorize(proposal.target.directory);
      for (const file of proposal.target?.selection ?? []) await this.authorize(file.path);
      if (
        proposal.kind === 'command' &&
        agentCommandID(proposal.commandID!, this.settings().customActions) === 'trash'
      )
        await this.authorizeRemoval(proposal.target!.selection.map((file) => file.path));
      if (proposal.kind === 'terminal-write')
        await this.authorize(this.extension!.requests.terminalDirectory(proposal.terminalID!));
      if (proposal.navigation)
        await this.authorizeNavigation(proposal.navigation, proposal.target!);
    });
  }
  private async authorizeRemoval(files: readonly string[]): Promise<void> {
    const client = await this.clients.get();
    const roots = await Promise.all(
      [...(client?.roots ?? this.settings().agents.roots), realHome()].map((root) =>
        realpath(absolute(root)).catch(() => absolute(root)),
      ),
    );
    for (const file of files) {
      const actual = await this.authorize(file);
      const trash =
        within(actual, path.join(realHome(), '.Trash')) ||
        within(actual, path.join(realHome(), '.local/share/Trash')) ||
        (process.platform === 'linux' &&
          process.env.XDG_DATA_HOME &&
          path.isAbsolute(process.env.XDG_DATA_HOME) &&
          within(actual, path.join(process.env.XDG_DATA_HOME, 'Trash'))) ||
        actual
          .split(path.sep)
          .some(
            (part) =>
              ['.Trash', '.Trashes', '$Recycle.Bin'].includes(part) || /^\.Trash-\d+$/.test(part),
          );
      if (
        trash ||
        actual === path.parse(actual).root ||
        roots.includes(actual) ||
        (process.platform !== 'win32' &&
          [
            '/Users',
            '/System',
            '/Library',
            '/Applications',
            '/Volumes',
            '/private',
            '/usr',
            '/bin',
            '/sbin',
            '/etc',
            '/tmp',
            '/var',
          ].includes(actual))
      )
        throw new Error(
          'Agents cannot remove Trash contents, a granted root, Home, a whole disk or a system folder. Select individual items inside a granted folder.',
        );
    }
  }
  async authorize(file: string): Promise<string> {
    if (!this.settings().agents.enabled) throw new Error('Agent access is disabled.');
    if (within(absolute(file), path.resolve(this.dataPath)))
      throw new Error(
        'Private Viewer credentials, grants and recovery data are unavailable to generic agent file tools.',
      );
    const client = await this.clients.get();
    const configured = client?.roots ?? this.settings().agents.roots;
    const roots = await Promise.all(configured.map((root) => realpath(root).catch(() => '')));
    let actual: string;
    try {
      await this.extension?.access?.([file]);
      actual = await realpath(absolute(file));
    } catch (error) {
      // Outside the agent's folders, missing, denied and out-of-scope paths answer alike,
      // so agents cannot probe the disk. Inside them, the actual reason is shown.
      const lexical = absolute(file);
      if (
        [...roots, ...configured.map((root) => absolute(root))].some(
          (root) => root && within(lexical, root),
        )
      )
        throw error;
      throw new Error('This file is outside the agent’s authorized folders.');
    }
    const privateRoot = await realpath(this.dataPath).catch(() => path.resolve(this.dataPath));
    if (within(actual, privateRoot))
      throw new Error('Private Viewer data is unavailable to generic agent file tools.');
    if (!this.settings().agents.enabled) throw new Error('Agent access is disabled.');
    const latest = await this.clients.get();
    if (client && latest?.revision !== client.revision)
      throw new Error('Client folder permissions changed. Try again.');
    if (!roots.some((root) => root && within(actual, root)))
      throw new Error('This file is outside the agent’s authorized folders.');
    return actual;
  }
  /** Rechecked by the desktop executor after review; neither review nor layout prefs grant paths. */
  async authorizeNavigation(request: AgentNavigation, target: CapturedTarget): Promise<void> {
    if (target.paneID === 'none' && target.rootID === 'none') {
      const state = await this.extension?.workspaceState?.();
      const origin = state?.workspaces.find((space) => space.id === target.workspaceID);
      if (!origin || origin.panes.length || state?.activeWorkspace !== origin.id)
        throw new Error('The originating workspace changed. Request a new proposal.');
      if (
        request.kind === 'select-files' ||
        (request.kind === 'open-path' && request.placement === 'linked')
      )
        throw new Error('Focus a folder plane first.');
      if (!this.settings().agents.enabled) throw new Error('Agent access is disabled.');
    } else await this.authorize(target.directory);
    if (request.kind === 'open-path') await this.authorize(request.path);
    else if (request.kind === 'focus-plane') {
      if (request.pane.type === 'search' && request.pane.allLocations)
        throw new Error('This plane searches outside the agent folder scope.');
      await this.authorize(request.pane.path);
    } else if (request.kind === 'select-files') {
      const directory = await this.authorize(target.directory);
      for (const file of request.files) {
        await this.authorize(file.path);
        const actual = await entry(file.path);
        if (actual.identity !== file.identity || (await realpath(actual.parent)) !== directory)
          throw new Error('Selection changed. Ask the agent for a new proposal.');
      }
    } else {
      for (const pane of request.workspace.panes) {
        if (pane.type === 'search' && pane.allLocations)
          throw new Error('This workspace searches outside the agent folder scope.');
        await this.authorize(pane.path);
      }
    }
  }
  async handle(token: unknown, request: unknown): Promise<unknown> {
    if (!this.settings().agents.enabled || typeof token !== 'string' || token.length !== 64)
      throw new Error('Agent access is disabled or its token is invalid.');
    const shared =
      Buffer.byteLength(token) === Buffer.byteLength(this.token) &&
      timingSafeEqual(Buffer.from(token), Buffer.from(this.token));
    const actor = shared ? sharedClientID : await this.clients.authenticate(token);
    if (!actor) throw new Error('Agent access is disabled or its token is invalid.');
    return this.clients.context.run(actor, async () => {
      const client = await this.clients.get();
      const policy = JSON.stringify(this.settings().agents);
      const active = this.activeCalls.get(actor) ?? 0;
      if (active >= (client?.budgets.maxTasks ?? 20))
        throw new Error('This client has reached its concurrent request budget.');
      this.activeCalls.set(actor, active + 1);
      const parsed = z
        .object({ method: z.string(), params: z.unknown().optional() })
        .safeParse(request);
      const tool =
        parsed.success && parsed.data.method === 'tools/call'
          ? z
              .object({ name: z.string().max(200) })
              .passthrough()
              .safeParse(parsed.data.params)
          : undefined;
      try {
        const result = await this.handleAuthenticated(request);
        const latest = await this.clients.get();
        if (
          (client && latest?.revision !== client.revision) ||
          policy !== JSON.stringify(this.settings().agents)
        )
          throw new Error('Agent permissions changed while this request was running. Try again.');
        if (tool?.success)
          await this.clients
            .audit(tool.data.name, 'completed', 'Request completed.')
            .catch(() => {});
        return result;
      } catch (error) {
        if (tool?.success)
          await this.clients.audit(tool.data.name, 'failed', 'Request failed.').catch(() => {});
        throw error;
      } finally {
        this.activeCalls.set(actor, (this.activeCalls.get(actor) ?? 1) - 1);
      }
    });
  }
  private async handleAuthenticated(request: unknown): Promise<unknown> {
    const message = z.object({ method: z.string(), params: z.unknown().optional() }).parse(request);
    if (message.method === 'initialize') {
      const params = z.object({ protocolVersion: z.string() }).passthrough().parse(message.params);
      return {
        protocolVersion: ['2026-07-28', '2025-11-25', '2025-06-18'].includes(params.protocolVersion)
          ? params.protocolVersion
          : '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'viewer', version: '0.1.0' },
      };
    }
    if (message.method === 'ping') return {};
    if (message.method.startsWith('notifications/')) return {};
    if (message.method === 'tools/list') return { tools: agentTools };
    if (message.method !== 'tools/call') throw new Error('Unsupported MCP method.');
    const call = z
      .object({ name: z.string(), arguments: z.record(z.string(), z.unknown()).optional() })
      .parse(message.params);
    const args = call.arguments || {};
    const capability: AgentCapability | undefined = [
      'get_task',
      'cancel_task',
      'get_proposal',
    ].includes(call.name)
      ? undefined
      : ['read_terminal'].includes(call.name)
        ? 'terminal-read'
        : ['write_terminal'].includes(call.name)
          ? 'terminal-write'
          : ['inspect_file', 'read_content', 'query_table', 'read_drawing_geometry'].includes(
                call.name,
              )
            ? 'content'
            : [
                  'propose_open_path',
                  'propose_selection',
                  'propose_focus_plane',
                  'propose_workspace_switch',
                ].includes(call.name)
              ? 'navigation'
              : call.name.startsWith('propose_') || call.name === 'run_action'
                ? 'propose'
                : 'metadata';
    if (capability) await this.clients.require(capability);
    else await this.clients.get();
    let value: unknown;
    if (['list_workspaces', 'list_planes'].includes(call.name)) {
      const input =
        call.name === 'list_planes'
          ? z
              .object({ workspaceID: z.string().min(1).max(200).optional() })
              .strict()
              .parse(args)
          : (z.object({}).strict().parse(args), { workspaceID: undefined });
      const state = await this.extension?.workspaceState?.();
      if (!state) throw new Error('Workspace state is unavailable.');
      const workspaces = [];
      for (const workspace of state.workspaces) {
        if (
          call.name === 'list_planes' &&
          workspace.id !== (input.workspaceID || state.activeWorkspace)
        )
          continue;
        const panes: AgentPlane[] = [];
        for (const pane of workspace.panes) {
          if (pane.type === 'search' && pane.allLocations) continue;
          try {
            await this.authorize(pane.path);
            panes.push({
              id: pane.id,
              type: pane.type,
              path: pane.path,
              ...(pane.type === 'folder' ? { mode: pane.mode } : {}),
            });
          } catch {
            /* Omit inaccessible plane paths and their history/layout. */
          }
        }
        if (panes.length || !workspace.panes.length)
          workspaces.push({
            id: workspace.id,
            name: workspace.name,
            active: workspace.id === state.activeWorkspace,
            panes,
            roots: workspace.roots.filter((id) => panes.some((pane) => pane.id === id)),
          });
      }
      value = call.name === 'list_workspaces' ? workspaces : workspaces[0]?.panes || [];
    } else if (
      [
        'propose_open_path',
        'propose_selection',
        'propose_focus_plane',
        'propose_workspace_switch',
      ].includes(call.name)
    ) {
      const extension = this.extension,
        catalog = extension?.catalog();
      if (!extension || !catalog) throw new Error('Focus a granted folder plane in Viewer first.');
      let request: AgentNavigation;
      let target: CapturedTarget = structuredClone({ ...catalog.target, selection: [] });
      if (call.name === 'propose_open_path') {
        const input = z
          .object({
            path: z.string().min(1).max(32768),
            placement: z.enum(['current', 'root', 'linked']).default('current'),
          })
          .strict()
          .parse(args);
        await this.authorize(input.path);
        request = { kind: 'open-path', ...input };
      } else if (call.name === 'propose_selection') {
        const input = z
          .object({ paths: z.array(z.string().min(1).max(32768)).max(2000) })
          .strict()
          .parse(args);
        const files = [];
        const directory = await this.authorize(target.directory);
        for (const file of new Set(input.paths)) {
          await this.authorize(file);
          const selected = await entry(file);
          if ((await realpath(selected.parent)) !== directory)
            throw new Error('Select files from the captured folder. Open their folder first.');
          files.push(selected);
        }
        request = { kind: 'select-files', files };
        target = { ...target, selection: files };
      } else if (call.name === 'propose_focus_plane') {
        const input = z
          .object({ paneID: z.string().min(1).max(200) })
          .strict()
          .parse(args);
        const state = await extension.workspaceState?.();
        const pane = state?.workspaces
          .find((space) => space.id === target.workspaceID)
          ?.panes.find((pane) => pane.id === input.paneID);
        if (!pane) throw new Error('Choose a plane in the active workspace from list_planes.');
        request = { kind: 'focus-plane', pane: structuredClone(pane) };
      } else {
        const input = z
          .object({
            workspaceID: z.string().min(1).max(200).optional(),
            name: z.string().min(1).max(200).optional(),
          })
          .strict()
          .refine(
            (input) => !!input.workspaceID !== !!input.name,
            'Provide one workspace ID or name.',
          )
          .parse(args);
        const state = await extension.workspaceState?.();
        const matches =
          state?.workspaces.filter((space) =>
            input.workspaceID
              ? space.id === input.workspaceID
              : space.name.normalize('NFC') === input.name!.normalize('NFC'),
          ) || [];
        const [match] = matches;
        if (matches.length !== 1 || !match)
          throw new Error('Choose a unique workspace ID from list_workspaces.');
        for (const pane of match.panes) {
          if (pane.type === 'search' && pane.allLocations)
            throw new Error('This workspace searches outside the agent folder scope.');
          await this.authorize(pane.path);
        }
        request = { kind: 'switch-workspace', workspace: structuredClone(match) };
      }
      await this.authorizeNavigation(request, target);
      value = extension.requests.navigation(request, target);
      this.own((value as { id: string }).id);
      if (await this.clients.get()) {
        await extension.requests.review((value as { id: string }).id, true);
        value = { ...(value as object), requiresUserReview: false };
      }
    } else if (['list_commands', 'explain_command', 'propose_command'].includes(call.name)) {
      const extension = this.extension;
      const catalog = extension?.catalog();
      if (!extension || !catalog) throw new Error('Focus a folder plane in Viewer first.');
      await this.authorize(catalog.target.directory);
      for (const file of catalog.target.selection) await this.authorize(file.path);
      const commands = catalog.commands.filter((command) => {
        try {
          agentCommandID(command.id, this.settings().customActions);
          return true;
        } catch {
          return false;
        }
      });
      if (call.name === 'list_commands')
        value = {
          target: catalog.target,
          commands,
          reviewByDefault: true,
          removalPolicy: agentRemovalPolicy,
        };
      else {
        const input = z
          .object({ commandID: z.string().max(200) })
          .strict()
          .parse(args);
        const command = catalog.commands.find((command) => command.id === input.commandID);
        if (!command) throw new Error('Command is unavailable in the captured context.');
        const resolved = agentCommandID(command.id, this.settings().customActions);
        if (resolved === 'trash')
          await this.authorizeRemoval(catalog.target.selection.map((file) => file.path));
        if (call.name === 'explain_command')
          value = {
            ...command,
            target: catalog.target,
            reviewByDefault: true,
            removalPolicy: agentRemovalPolicy,
            customAction: this.settings().customActions.find(
              (action) => 'custom.' + action.id === command.id,
            ),
            cwdIsNotASandbox: true,
          };
        else {
          value = await extension.requests.command(command.id, catalog.target, command.label);
          this.own((value as { id: string }).id);
        }
      }
    } else if (call.name === 'read_config') {
      if (!this.extension) throw new Error('Configuration API is unavailable.');
      const snapshot = this.extension.config.snapshot();
      value = {
        version: 1,
        settings: redactedSettings(snapshot.settings),
        ui: snapshot.ui,
        revision: snapshot.revision,
      };
    } else if (['validate_config', 'propose_config'].includes(call.name)) {
      if (!this.extension) throw new Error('Configuration API is unavailable.');
      const input = z
        .object({
          patches: z
            .array(
              z
                .object({
                  path: z.string().max(200),
                  keys: z.array(z.string().max(32768)).max(10).optional(),
                  value: z.unknown(),
                })
                .strict(),
            )
            .max(100),
        })
        .strict()
        .parse(args);
      if (call.name === 'validate_config') value = this.extension.config.preview(input.patches);
      else {
        value = this.extension.requests.configuration(input.patches);
        this.own((value as { id: string }).id);
      }
    } else if (['read_terminal', 'write_terminal'].includes(call.name)) {
      if (!this.extension) throw new Error('Terminal API is unavailable.');
      const input = z
        .object({ id: z.string(), data: z.string().max(65536).optional() })
        .strict()
        .parse(args);
      const terminal = this.extension.requests;
      await this.authorize(terminal.terminalDirectory(input.id));
      if (call.name === 'read_terminal') {
        const output = await terminal.readTerminal(input.id);
        await this.authorize(output.cwd);
        value = output;
      } else {
        if (input.data === undefined) throw new Error('Provide terminal input.');
        value = await terminal.writeTerminal(input.id, input.data);
        this.own((value as { id: string }).id);
      }
    } else if (call.name === 'get_proposal') {
      if (!this.extension) throw new Error('Proposal API is unavailable.');
      const input = z.object({ id: z.string() }).strict().parse(args);
      if (this.owned.get(input.id) !== this.clients.actor())
        throw new Error('Proposal belongs to another actor.');
      value = this.extension.requests.get(input.id);
    } else if (call.name === 'get_relationships') {
      const input = z
        .object({ path: z.string().min(1).max(32768), content: z.boolean().default(false) })
        .strict()
        .parse(args);
      await this.authorize(input.path);
      const client = await this.clients.get();
      if (input.content) {
        await this.clients.require('content');
        if (!client) throw new Error('Use a named client for content reference scans.');
      }
      if (!this.extension?.relationships) throw new Error('Relationship services are unavailable.');
      const result = await this.extension.relationships(input.path, input.content),
        relations: FileRelation[] = [];
      const allowed = new Set<string>();
      for (const relation of result.relations) {
        if (relation.basis === 'reported') continue;
        try {
          await this.authorize(relation.from.path);
          await this.authorize(relation.to.path);
          relations.push({ ...relation, note: undefined });
          allowed.add(relation.from.path);
          allowed.add(relation.to.path);
        } catch {
          /* Inaccessible endpoints and their private paths are omitted. */
        }
      }
      await this.authorize(input.path);
      value = {
        file: input.path,
        relations,
        files: result.files
          .filter((file) => allowed.has(file.path))
          .map(({ path, status, version }) => ({ path, status, version })),
        coverage:
          relations.length ===
          result.relations.filter((relation) => relation.basis !== 'reported').length
            ? result.coverage
            : 'partial',
      };
      if (
        Buffer.byteLength(JSON.stringify(value)) > (client?.budgets.maxReadBytes ?? 4 * 1024 ** 2)
      )
        throw new Error('The relationship result exceeds the client read budget.');
    } else if (call.name === 'get_context') {
      const context = this.context();
      const sources: string[] = [];
      for (const file of context?.sources || []) {
        try {
          await this.authorize(file);
          sources.push(file);
        } catch {
          /* Omit inaccessible context. */
        }
      }
      value = context ? { ...context, actor: 'agent', sources } : null;
    } else if (call.name === 'list_actions')
      value = this.settings().recipes.map((recipe) => ({
        id: recipe.id,
        name: recipe.name,
        formats: recipe.formats,
        data: recipe.data,
        kind: recipe.kind,
      }));
    else if (call.name === 'read_metadata') {
      const input = z.object({ path: z.string() }).strict().parse(args);
      await this.authorize(input.path);
      value = await entry(input.path);
    } else if (call.name === 'read_drawing_geometry') {
      const input = drawingGeometryOptionsSchema
        .extend({ path: z.string().min(1).max(32768) })
        .strict()
        .parse(args);
      const client = await this.clients.get();
      if (!client)
        throw new Error('Use a named client with content permission for drawing geometry.');
      await this.authorize(input.path);
      const before = await entry(input.path);
      const { path: file, ...options } = input;
      value = await this.files.drawingGeometry(file, options);
      await this.authorize(file);
      if (!sameSourceVersion(sourceVersion(before), sourceVersion(await entry(file))))
        throw new Error('The drawing changed. Read its geometry again.');
      if (Buffer.byteLength(JSON.stringify(value)) > client.budgets.maxReadBytes)
        throw new Error(
          'Geometry exceeds the client read budget. Request fewer entities or omit points.',
        );
    } else if (['inspect_file', 'read_content', 'query_table'].includes(call.name)) {
      const input = z
        .object({
          path: z.string().min(1).max(32768),
          ...(call.name === 'inspect_file'
            ? { ocr: z.boolean().default(false) }
            : call.name === 'query_table'
              ? {
                  offset: z.number().int().min(0).max(100000).default(0),
                  limit: z.number().int().min(1).max(200).default(100),
                  sheet: z.string().min(1).max(200).optional(),
                }
              : {}),
        })
        .strict()
        .parse(args);
      const client = await this.clients.get();
      if (!client)
        throw new Error(
          'Create a named agent client with explicit content permission in Settings.',
        );
      await this.authorize(input.path);
      const before = await entry(input.path);
      if (before.directory) throw new Error('Choose a file.');
      if (call.name === 'inspect_file')
        value = await this.files.inspect(input.path, true, 'ocr' in input && Boolean(input.ocr));
      else {
        const document = await this.files.extract(input.path);
        if (call.name === 'query_table') {
          const offset = 'offset' in input ? Number(input.offset) : 0,
            limit = 'limit' in input ? Number(input.limit) : 100;
          if (before.extension === 'xlsx' && document.office?.kind === 'workbook') {
            const sheets = document.office.sheets;
            const name = 'sheet' in input ? input.sheet : undefined;
            const sheet = name
              ? sheets.find((sheet) => sheet.name === name)
              : sheets.find((sheet) => !sheet.hidden) || sheets[0];
            if (!sheet)
              throw new Error('Requested worksheet is not in the available reader output.');
            value = {
              path: input.path,
              version: sourceVersion(before),
              sheets: sheets.map((sheet) => ({ name: sheet.name, hidden: sheet.hidden })),
              sheet: sheet.name,
              rows: sheet.rows.slice(offset, offset + limit).map((row) => ({
                row: row.row,
                cells: row.cells.map((cell) => ({
                  ...cell,
                  anchor: { kind: 'cells', sheet: sheet.name, row: row.row, column: cell.column },
                })),
              })),
              more: sheet.rows.length > offset + limit,
              truncated: document.truncated || sheet.truncated,
              coverage: 'partial',
              reason: document.coverageReason,
            };
          } else {
            if (!['csv', 'tsv'].includes(before.extension))
              throw new Error('Choose a CSV, TSV or XLSX table.');
            if ('sheet' in input && input.sheet)
              throw new Error('CSV and TSV tables have no named worksheets.');
            const table = parseDelimited(
              document.evidence.find((item) => item.source === 'text')?.text ?? document.text,
              before.extension === 'tsv' ? '\t' : ',',
            );
            value = {
              path: input.path,
              version: sourceVersion(before),
              headers: table.rows[0] ?? [],
              rows: table.rows.slice(offset + 1, offset + 1 + limit).map((cells, index) => ({
                cells,
                anchor: { kind: 'cells', row: offset + index + 2, column: 1 },
              })),
              more: table.rows.length > offset + 1 + limit,
              coverage: document.truncated || table.malformed ? 'partial' : 'complete',
            };
          }
        } else
          value = {
            path: input.path,
            version: sourceVersion(before),
            metadata: document.metadata,
            evidence: document.evidence,
            coverage: document.truncated || document.coverageReason ? 'partial' : 'complete',
            ...(document.coverageReason ? { reason: document.coverageReason } : {}),
          };
      }
      await this.authorize(input.path);
      if (!sameSourceVersion(sourceVersion(before), sourceVersion(await entry(input.path))))
        throw new Error('The source changed. Read it again.');
      if (Buffer.byteLength(JSON.stringify(value)) > client.budgets.maxReadBytes)
        throw new Error(
          'This result exceeds the client read budget. Request a smaller table window or increase its budget in Settings.',
        );
    } else if (call.name === 'search_files') {
      const input = z
        .object({
          query: z.string().max(300),
          root: z.string(),
          offset: z.number().int().min(0).optional(),
        })
        .strict()
        .parse(args);
      await this.authorize(input.root);
      const client = await this.clients.get();
      const result = await this.files.query({
        ...input,
        content: client ? client.capabilities.includes('content') : true,
      } as IndexedQuery);
      const entries = [];
      for (const item of result.entries) {
        try {
          await this.authorize(item.path);
          entries.push(item);
        } catch {
          /* Filter symlinks crossing grants. */
        }
      }
      value = {
        entries,
        more: result.more,
        indexed: result.indexed,
        running: result.status.running,
      };
    } else if (call.name === 'run_action') {
      value = await this.admitTask(async () => {
        await this.clients.require('propose');
        const input = z
          .object({
            recipeID: z.string(),
            sources: z.array(z.string()).min(1).max(2000),
            instructions: z.string().max(12000).optional(),
            recursive: z.boolean().optional(),
          })
          .strict()
          .parse(args);
        for (const file of input.sources) await this.authorize(file);
        const recipe = this.settings().recipes.find((recipe) => recipe.id === input.recipeID);
        if (recipe?.data !== 'names') await this.clients.require('content');
        const client = await this.clients.get();
        if (client) {
          const running = (await this.actions.all()).filter(
            (task) =>
              task.context.actor === 'agent' &&
              task.context.clientID === client.id &&
              ['planning', 'review', 'applying'].includes(task.status),
          ).length;
          if (running >= client.budgets.maxTasks)
            throw new Error('Review or stop a task before starting another.');
        }
        const context = this.context();
        if (!context) throw new Error('Open Viewer to review this task.');
        const request: ActionRequest = {
          recipeID: input.recipeID,
          instructions: input.instructions,
          context: {
            ...context,
            actor: 'agent',
            clientID: this.clients.actor(),
            sources: input.sources,
            recursive: input.recursive,
          },
        };
        const id = await this.actions.start(request);
        this.own(id);
        return { id, applyRequiresUserReview: true };
      });
    } else if (call.name === 'get_task' || call.name === 'cancel_task') {
      const input = z.object({ id: z.string() }).strict().parse(args);
      const plan = await this.actions.get(input.id);
      if (
        this.owned.get(input.id) !== this.clients.actor() &&
        !(plan.context.actor === 'agent' && plan.context.clientID === this.clients.actor())
      )
        throw new Error('This task belongs to another actor.');
      if (
        call.name === 'get_task' &&
        this.settings().recipes.find((recipe) => recipe.id === plan.recipeID)?.data !== 'names'
      )
        await this.clients.require('content');
      for (const file of plan.context.sources) await this.authorize(file);
      if (call.name === 'cancel_task') {
        this.actions.cancel(input.id);
        value = { cancelled: true };
      } else value = plan;
    } else
      throw new Error(
        'Unknown agent tool. Commands require review or an explicit execution grant.',
      );
    if (capability) await this.clients.require(capability);
    else await this.clients.get();
    return { content: [{ type: 'text', text: JSON.stringify(value) }] };
  }
  /** Records which client may read a proposal or task; bounded like the requests it tracks. */
  private own(id: string): void {
    this.owned.set(id, this.clients.actor());
    if (this.owned.size <= 1000) return;
    for (const key of this.owned.keys()) {
      if (this.owned.size <= 500) break;
      this.owned.delete(key);
    }
  }
  /** The private socket folder holds only the socket; it is never removed recursively. */
  private async removeSocketDirectory(): Promise<void> {
    const directory = this.socketDirectory;
    if (!directory) return;
    this.socketDirectory = undefined;
    await discardOwnTemporaryFile(path.join(directory, 'v.sock'));
    await removeEmptyDirectory(directory).catch(() => {});
  }
  async close(): Promise<void> {
    await this.clients.close();
    await this.starting?.catch(() => {});
    for (const stream of this.streams) stream.destroy();
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
    this.server = undefined;
    await this.removeSocketDirectory();
  }
}
