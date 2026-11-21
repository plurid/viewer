import { sameCapturedItem } from '../../domain/files/entries';
import { agentPlaneCopy, agentWorkspaceCopy } from '../../domain/agents/requests';
import type { CapturedTarget } from '../../domain/automation/actions';
import { isTourFile } from '../../domain/tours/tour';
import {
  namesWorkspaceDismissal,
  withoutWorkspaceDismissals,
} from '../../domain/suggestions/insights';
import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  AgentNavigation,
  AgentPlane,
  AgentWorkspaceSnapshot,
  CommandDescriptor,
  AgentProposal,
} from '../../domain/agents/requests';
import type { AgentRequests } from './agent-requests';
import type { SettingsService } from '../preferences/settings';
import { createServer, type Server, type Socket } from 'node:net';
import { chmod, realpath, mkdtemp, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { UIPreferences } from '../../domain/contracts';
import type { JSONValue } from '../../domain/workspaces/project';
import { z } from 'zod';
import type { AgentTaskSetup } from '../../domain/agents/task-workflow';
import {
  recipeReadsContent,
  type ActionContext,
  type ActionRequest,
  type ApplicationSettings,
  type IndexedQuery,
} from '../../domain/services';
import type { FileServices } from '../files/file-services';
import type { ActionPlanner } from '../actions/planner';
import { entry, absolute } from '../files/filesystem';
import { DocumentStore } from '../persistence/document-store';
import { AgentClients } from './agent-clients';
import { AgentAccess } from './agent-access';
import {
  agentConnectionSchema,
  defaultAgentReadBytes,
  maxAgentReplyBytes,
  readBudgetError,
  sharedClientID,
} from '../../domain/agents/clients';
import type {
  AgentCapability,
  AgentClient,
  AgentClientRequest,
  AgentClientReply,
  AgentConnection,
  AgentConnectionEnd,
} from '../../domain/agents/clients';
import { sourceVersion, sameSourceVersion } from '../../domain/files/inspection';
import { parseDelimited } from '../../domain/previews/data/delimited';
import type { RelationshipsResult, FileRelation } from '../../domain/files/relationships';
import { agentCommandID, agentRemovalPolicy } from '../../domain/agents/safety';
import { isEmptyAgentOrigin } from '../../domain/agents/origin';
import { serviceToolNames } from './service-catalog';
import type { AgentServiceTools, AgentServiceContext } from './service-tools';
import type { WorkflowRun } from '../../domain/automation/workflows';
import { discardOwnTemporaryFile, removeEmptyDirectory } from '../operations/removal';
import { nativeTestRemovalsBlocked } from '../native/test-removal-policy';
import { agentTools } from './agent-tools';
import { isToolIn, parseToolInput, toolCapability, writeTerminalInput } from './tool-catalog';
import type { AgentSessions } from './sessions';
import { containsPath } from '../files/containment';
import { realHome } from '../native/home';
import { officeFamily, readsOfficeContent } from '../../domain/previews/documents/layout';
import { sqliteRequestSchema } from '../../domain/previews/data/sqlite';
/** Agents see the shape of execution settings, never secrets they may carry:
 * terminal environment values, shell scripts and program arguments (`--token=…`, which were
 * shown as they were until 2026-10-20) often hold tokens. */
export function redactedSettings(settings: ApplicationSettings): ApplicationSettings {
  const hidden = '[redacted]';
  return {
    ...settings,
    terminals: {
      ...settings.terminals,
      profiles: settings.terminals.profiles.map((profile) => ({
        ...profile,
        args: profile.args.map(() => hidden),
        env: Object.fromEntries(Object.keys(profile.env).map((key) => [key, hidden])),
      })),
    },
    customActions: settings.customActions.map((action) =>
      action.executor.kind === 'shell'
        ? { ...action, executor: { ...action.executor, script: hidden } }
        : action.executor.kind === 'executable'
          ? {
              ...action,
              executor: { ...action.executor, args: action.executor.args.map(() => hidden) },
            }
          : action,
    ),
  };
}
const isPathLike = (value: string): boolean =>
  value.startsWith('/') || value === '~' || value.startsWith('~/') || /^[A-Za-z]:[\\/]/.test(value);
async function filterPaths(
  items: readonly string[],
  allow: (file: string) => Promise<boolean>,
): Promise<string[]> {
  const kept: string[] = [];
  for (const item of items) if (await allow(item)) kept.push(item);
  return kept;
}
async function filterPathRecord<Value>(
  record: Readonly<Record<string, Value>>,
  allow: (file: string) => Promise<boolean>,
): Promise<Record<string, Value>> {
  const kept: Record<string, Value> = {};
  for (const [key, value] of Object.entries(record)) if (await allow(key)) kept[key] = value;
  return kept;
}
const profilePathPrefixes = new Set(['ui', 'ui.sidebar', 'settings', 'settings.browsing']);
async function filterProfileEntry(
  fieldPath: string,
  value: JSONValue,
  allow: (file: string) => Promise<boolean>,
): Promise<JSONValue> {
  if (
    (fieldPath === 'ui.sidebar.locations' || fieldPath === 'ui.sidebar.hidden') &&
    Array.isArray(value) &&
    value.every((item): item is string => typeof item === 'string')
  )
    return filterPaths(value, allow);
  if (
    fieldPath === 'ui.sidebar.labels' &&
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  )
    return filterPathRecord(value as Record<string, JSONValue>, allow);
  if (
    (fieldPath === 'settings.browsing.newPlanePath' ||
      fieldPath === 'settings.browsing.emptyWorkspacePath') &&
    typeof value === 'string'
  )
    return value && (await allow(value)) ? value : '';
  if (
    profilePathPrefixes.has(fieldPath) &&
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    const filtered: Record<string, JSONValue> = {};
    for (const [child, next] of Object.entries(value as Record<string, JSONValue>))
      filtered[child] = await filterProfileEntry(`${fieldPath}.${child}`, next, allow);
    return filtered;
  }
  return value;
}
async function filterProfileValues(
  values: Readonly<Record<string, JSONValue>>,
  allow: (file: string) => Promise<boolean>,
): Promise<Record<string, JSONValue>> {
  const kept: Record<string, JSONValue> = {};
  for (const [key, value] of Object.entries(values))
    kept[key] = await filterProfileEntry(key, value, allow);
  return kept;
}
/** One reply to an `--mcp` relay. A result within its client's budget always fits the relay's
 * bound (`maxAgentReplyBytes`); anything longer comes back as an error, never a dropped line. */
export function replyLine(id: unknown, value: unknown): string {
  const line = JSON.stringify({ id, value });
  const bytes = Buffer.byteLength(line);
  if (bytes <= maxAgentReplyBytes) return line + '\n';
  const error =
    `The reply is ${bytes.toLocaleString('en-US')} bytes, over the ` +
    `${maxAgentReplyBytes.toLocaleString('en-US')} one reply to an agent may take. ` +
    'Ask for a smaller range, fewer files or a summary.';
  return JSON.stringify({ id, error }) + '\n';
}
export class AgentBroker {
  private lifetime = new AbortController();
  private closed = false;
  private closing?: Promise<void>;
  private admissions = new AsyncLocalStorage<AbortSignal>();
  private clientLifetimes = new Map<string, AbortController>();
  private taskAdmissions: Promise<unknown> = Promise.resolve();
  private admitTask<T>(work: () => Promise<T>): Promise<T> {
    const task = this.taskAdmissions
      .catch(() => {})
      .then(() => {
        this.admissions.getStore()?.throwIfAborted();
        return work();
      });
    this.taskAdmissions = task;
    return task;
  }
  readonly clients: AgentClients;
  /** The shared connection's switch and folders: config.jsonc's, as far as the person approved them. */
  readonly access: AgentAccess;
  private server?: Server;
  private starting?: Promise<void>;
  private socketDirectory?: string;
  private streams = new Map<Socket, Set<string>>();
  private token = randomBytes(32).toString('hex');
  private owned = new Map<string, string>();
  private activeCalls = new Map<string, number>();
  private connection: DocumentStore<AgentConnection>;
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
      agentAccess?: AgentAccess;
      sessions?: AgentSessions;
      services?: AgentServiceTools;
      authorizeTask?(setup: AgentTaskSetup): Promise<void>;
      /** The app version agent clients see in `serverInfo`. */
      version?: string;
    },
  ) {
    this.access = extension?.agentAccess ?? new AgentAccess(dataPath, () => this.settings().agents);
    this.access.onWithdrawal?.(() => this.stopAll());
    this.clients = new AgentClients(
      dataPath,
      (paths) => this.checkFolders(paths),
      () => this.access.capabilities(),
    );
    this.connection = new DocumentStore(path.join(dataPath, 'agent-connection-v1.json'), (value) =>
      agentConnectionSchema.parse(value),
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
  /** A folder an agent may be given: a folder, readable, outside Viewer's private data. */
  async checkFolders(paths: readonly string[]): Promise<void> {
    await this.extension?.access?.(paths);
    for (const root of paths) {
      const actual = await realpath(absolute(root));
      if (!(await stat(actual)).isDirectory()) throw new Error('Choose a folder for the client.');
      if (
        containsPath(await realpath(this.dataPath).catch(() => path.resolve(this.dataPath)), actual)
      )
        throw new Error('Private Viewer data cannot be an agent folder.');
    }
  }
  async start(): Promise<void> {
    while (this.closing) await this.closing;
    if (this.starting) return this.starting;
    if (this.server) return;
    this.closed = false;
    this.starting = (async () => {
      if ((await this.access.state()).enabled && !this.closed) {
        await this.startNow();
      }
    })().finally(() => {
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
      const actors = new Set<string>();
      this.streams.set(stream, actors);
      const lifetime = new AbortController();
      const activeRequests = new Map<string, AbortController>();
      const cancelled = new Set<string>();
      stream.on('close', () => {
        this.streams.delete(stream);
        lifetime.abort();
        for (const controller of activeRequests.values()) controller.abort();
        activeRequests.clear();
        cancelled.clear();
      });
      // Lines are cut at newline bytes so two valid requests in one chunk never trip a buffer cap,
      // and the per-line bound leaves room for the relay's id and token wrapper.
      const maxWrappedLineBytes = 65536 + 512;
      const maxPendingRequests = 100;
      let parts: Buffer[] = [];
      let arriving = 0;
      let requests = Promise.resolve();
      // Keep reading so {cancel:id} frames arrive immediately; reject excess non-cancel requests.
      let pending = 0;
      stream.on('error', () => {});
      const enqueue = (line: string) => {
        let cancelID: string | undefined;
        let wireID: string | undefined;
        try {
          const probe = JSON.parse(line) as { id?: unknown; cancel?: unknown; request?: unknown };
          if (probe && typeof probe === 'object') {
            if (typeof probe.cancel === 'string' && probe.request === undefined)
              cancelID = probe.cancel;
            else if (typeof probe.id === 'string') wireID = probe.id;
          }
        } catch {
          /* Malformed lines are answered in order by the request queue. */
        }
        if (cancelID !== undefined) {
          const controller = activeRequests.get(cancelID);
          if (controller) controller.abort(new Error('Viewer request timed out.'));
          else {
            cancelled.add(cancelID);
            if (cancelled.size > 1000) cancelled.delete(cancelled.values().next().value!);
          }
          return;
        }
        if (wireID !== undefined && cancelled.delete(wireID)) return;
        if (pending >= maxPendingRequests) {
          if (!stream.destroyed)
            stream.write(
              JSON.stringify({ id: wireID ?? null, error: 'Too many pending requests.' }) + '\n',
            );
          return;
        }
        const requestController = wireID !== undefined ? new AbortController() : undefined;
        if (wireID !== undefined && requestController)
          activeRequests.set(wireID, requestController);
        const requestSignal = requestController
          ? AbortSignal.any([lifetime.signal, requestController.signal])
          : lifetime.signal;
        pending++;
        requests = requests.then(async () => {
          let id: unknown = null;
          try {
            if (requestSignal.aborted) return;
            const input = JSON.parse(line);
            id = input.id;
            const value = await this.handle(input.token, input.request, requestSignal, (actor) =>
              actors.add(actor),
            );
            if (!requestSignal.aborted && !stream.destroyed) stream.write(replyLine(id, value));
          } catch (error) {
            if (!requestSignal.aborted && !stream.destroyed)
              stream.write(
                JSON.stringify({
                  id,
                  error: error instanceof Error ? error.message : 'Agent request failed.',
                }) + '\n',
              );
          } finally {
            if (wireID !== undefined) activeRequests.delete(wireID);
            pending--;
          }
        });
      };
      stream.on('data', (chunk: Buffer) => {
        let start = 0;
        for (let end = chunk.indexOf(10); ; end = chunk.indexOf(10, start)) {
          const piece = chunk.subarray(start, end < 0 ? chunk.length : end);
          arriving += piece.length;
          if (arriving > maxWrappedLineBytes) {
            stream.destroy();
            return;
          }
          parts.push(piece);
          if (end < 0) break;
          const line = Buffer.concat(parts).toString('utf8');
          parts = [];
          arriving = 0;
          enqueue(line);
          start = end + 1;
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
      await this.connection.save({ socket, pid: process.pid, executable: process.execPath });
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
    await this.extension?.requests.revokeGrants(sharedClientID);
    for (const [stream, actors] of this.streams) if (actors.has(sharedClientID)) stream.destroy();
    return token;
  }
  async clientRequest(request: AgentClientRequest): Promise<AgentClientReply> {
    if (request.kind === 'list') return this.clients.list();
    if (request.kind === 'remove') return this.clients.remove(request.id, request.revision);
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
    // a revoked client's grants could never be used again
    if (request.kind === 'revoke') await this.extension?.requests.revokeGrants(request.id);
    return result;
  }
  async stop(clientID: string): Promise<void> {
    this.clientLifetimes.get(clientID)?.abort();
    this.clientLifetimes.delete(clientID);
    const failures: unknown[] = [];
    try {
      this.extension?.requests.stop(clientID);
    } catch (error) {
      failures.push(error);
    }
    for (const [id, owner] of this.owned)
      if (owner === clientID) {
        try {
          this.actions.cancel(id);
        } catch (error) {
          failures.push(error);
        }
        this.owned.delete(id);
      }
    const results = await Promise.allSettled([
      this.extension?.services?.stop(clientID),
      this.actions.all().then((plans) => {
        for (const plan of plans)
          if (plan.context.actor === 'agent' && plan.context.clientID === clientID)
            try {
              this.actions.cancel(plan.id);
            } catch (error) {
              failures.push(error);
            }
      }),
    ]);
    for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
    if (failures.length)
      throw new AggregateError(failures, 'Some agent work could not be stopped.');
  }
  private async stopAll(): Promise<void> {
    this.lifetime.abort();
    this.lifetime = new AbortController();
    const actors = new Set([
      sharedClientID,
      ...this.clientLifetimes.keys(),
      ...this.owned.values(),
    ]);
    // Start each cancellation before awaiting any owner that may be slow or unavailable.
    const failures: unknown[] = [];
    const stop = (actor: string) =>
      this.stop(actor).catch((error) => {
        failures.push(error);
      });
    // Observe each rejection immediately, while client storage may still be loading.
    const stopping = [...actors].map(stop);
    try {
      for (const client of await this.clients.list())
        if (!actors.has(client.id)) stopping.push(stop(client.id));
    } catch (error) {
      failures.push(error);
    }
    await Promise.all(stopping);
    if (failures.length)
      throw new AggregateError(failures, 'Some agent work could not be stopped.');
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
      if (!(await this.access.state()).enabled) throw new Error('Agent access is disabled.');
      if (proposal.kind === 'task-workflow') {
        await this.clients.require('navigation');
        if (!proposal.taskSetup || !this.extension?.authorizeTask)
          throw new Error('Task creation is unavailable.');
        await this.extension.authorizeTask(proposal.taskSetup);
      }
      if (proposal.kind === 'speech' && proposal.speech?.kind === 'import') {
        await this.clients.require('content');
        await this.authorize(proposal.speech.source);
      }
      if (proposal.target) await this.authorizeTarget(proposal.target);
      if (proposal.kind === 'transform') {
        await this.clients.require('content');
        if (!proposal.transform) throw new Error('The transform plan is unavailable.');
        await this.authorize(proposal.transform.destination);
      }
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
  /** Placeholder Home is never a grant. Empty origins must still match the live desktop catalog. */
  private async authorizeTarget(target: CapturedTarget): Promise<void> {
    if (target.paneID === 'none' || target.rootID === 'none') {
      const state = await this.extension?.workspaceState?.();
      if (!isEmptyAgentOrigin(target, state))
        throw new Error('The workspace this started from changed. Ask for the change again.');
      return;
    }
    await this.authorize(target.directory);
    for (const file of target.selection) await this.authorize(file.path);
  }
  private async authorizeRemoval(files: readonly string[]): Promise<void> {
    const client = await this.clients.get();
    const roots = await Promise.all(
      [...(client?.roots ?? (await this.access.state()).protectedRoots), realHome()].map((root) =>
        realpath(absolute(root)).catch(() => absolute(root)),
      ),
    );
    for (const file of files) {
      const actual = await this.authorize(file);
      const trash =
        containsPath(path.join(realHome(), '.Trash'), actual) ||
        containsPath(path.join(realHome(), '.local/share/Trash'), actual) ||
        (process.platform === 'linux' &&
          process.env.XDG_DATA_HOME &&
          path.isAbsolute(process.env.XDG_DATA_HOME) &&
          containsPath(path.join(process.env.XDG_DATA_HOME, 'Trash'), actual)) ||
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
  /** Returns settings and UI preferences stripped of secrets and paths outside the client's folders. */
  private async scopedConfiguration(
    snapshot: { settings: ApplicationSettings; ui: UIPreferences; home?: string },
    mode: 'read' | 'validate',
  ): Promise<{ settings: ApplicationSettings; ui: UIPreferences }> {
    const access = await this.access.state();
    if (!access.enabled) throw new Error('Agent access is disabled.');
    const client = await this.clients.get();
    const configured = client?.roots ?? access.roots;
    const roots = await Promise.all(
      configured.map(async (root) => {
        const resolved = await realpath(root).catch(() => '');
        if (client && resolved !== absolute(root)) return '';
        return resolved;
      }),
    );
    const dataRoot = path.resolve(this.dataPath);
    const privateRoot = await realpath(this.dataPath).catch(() => dataRoot);
    const home = snapshot.home || realHome();
    const allow = async (raw: string): Promise<boolean> => {
      if (!raw) return false;
      const expanded = raw === '~' || raw.startsWith('~/') ? home + raw.slice(1) : raw;
      if (!path.isAbsolute(expanded)) return false;
      let normalized: string;
      try {
        normalized = absolute(expanded);
      } catch {
        return false;
      }
      if (containsPath(dataRoot, normalized)) return false;
      let actual = await realpath(normalized).catch(() => '');
      if (!actual) {
        // Resolve the deepest existing ancestor so missing subfolders inside granted roots stay
        // visible while links escaping a granted root are still refused.
        let cursor = normalized;
        const tail: string[] = [];
        for (;;) {
          const parent = path.dirname(cursor);
          if (parent === cursor) break;
          tail.unshift(path.basename(cursor));
          cursor = parent;
          const resolvedParent = await realpath(cursor).catch(() => '');
          if (resolvedParent) {
            actual = path.join(resolvedParent, ...tail);
            break;
          }
        }
      }
      if (!actual || containsPath(privateRoot, actual)) return false;
      return roots.some((root) => root && containsPath(root, actual));
    };
    const redacted = redactedSettings(snapshot.settings);
    const hiddenCustomPath = () => `/viewer-redacted-${randomUUID()}`;
    const newPlanePath =
      redacted.browsing.newPlanePath && (await allow(redacted.browsing.newPlanePath))
        ? redacted.browsing.newPlanePath
        : mode === 'validate' &&
            redacted.browsing.newPlaneLocation === 'custom' &&
            redacted.browsing.newPlanePath
          ? hiddenCustomPath()
          : '';
    const emptyWorkspacePath =
      redacted.browsing.emptyWorkspacePath && (await allow(redacted.browsing.emptyWorkspacePath))
        ? redacted.browsing.emptyWorkspacePath
        : mode === 'validate' &&
            redacted.browsing.emptyWorkspaceLocation === 'custom' &&
            redacted.browsing.emptyWorkspacePath
          ? hiddenCustomPath()
          : '';
    const exclusions: string[] = [];
    for (const item of redacted.search.exclusions)
      if (!isPathLike(item) || (await allow(item))) exclusions.push(item);
    const savedSearches: ApplicationSettings['savedSearches'] = [];
    for (const item of redacted.savedSearches)
      if (!item.root || (await allow(item.root))) savedSearches.push(item);
    const scopedExecutable = async (value: string): Promise<string> =>
      isPathLike(value) && !(await allow(value)) ? '[redacted]' : value;
    const customActions: ApplicationSettings['customActions'] = [];
    for (const item of redacted.customActions) {
      const executor =
        item.executor.kind === 'executable' || item.executor.kind === 'shell'
          ? { ...item.executor, executable: await scopedExecutable(item.executor.executable) }
          : item.executor;
      customActions.push(
        item.when.directories
          ? {
              ...item,
              executor,
              when: {
                ...item.when,
                directories: await filterPaths(item.when.directories, allow),
              },
            }
          : { ...item, executor },
      );
    }
    const layouts: ApplicationSettings['layouts'] = [];
    for (const layout of redacted.layouts) {
      const planes: typeof layout.planes = [];
      for (const plane of layout.planes) {
        if (plane.kind === 'scratch') planes.push(plane);
        else if (plane.kind === 'search') {
          if (!plane.root || (await allow(plane.root))) planes.push(plane);
        } else if (!plane.path || (await allow(plane.path))) planes.push(plane);
      }
      if (planes.length) layouts.push({ ...layout, planes });
    }
    const profiles: ApplicationSettings['profiles'] = [];
    for (const profile of redacted.profiles)
      profiles.push({ ...profile, values: await filterProfileValues(profile.values, allow) });
    const terminalProfiles: ApplicationSettings['terminals']['profiles'] = [];
    for (const profile of redacted.terminals.profiles)
      terminalProfiles.push({
        ...profile,
        executable: await scopedExecutable(profile.executable),
      });
    const application =
      isPathLike(redacted.terminals.application) && !(await allow(redacted.terminals.application))
        ? ''
        : redacted.terminals.application;
    const tmuxExecutable = await scopedExecutable(redacted.terminals.tmux.executable);
    const socket =
      redacted.terminals.tmux.socket && !(await allow(redacted.terminals.tmux.socket))
        ? ''
        : redacted.terminals.tmux.socket;
    const settings: ApplicationSettings = {
      ...redacted,
      browsing: { ...redacted.browsing, newPlanePath, emptyWorkspacePath },
      folders: await filterPathRecord(redacted.folders, allow),
      customActions,
      terminals: {
        ...redacted.terminals,
        application,
        profiles: terminalProfiles,
        tmux: { ...redacted.terminals.tmux, executable: tmuxExecutable, socket },
      },
      search: {
        ...redacted.search,
        roots: await filterPaths(redacted.search.roots, allow),
        contentRoots: await filterPaths(redacted.search.contentRoots, allow),
        exclusions,
      },
      agents: {
        ...redacted.agents,
        roots: await filterPaths(redacted.agents.roots, allow),
      },
      savedSearches,
      layouts,
      profiles,
    };
    const dismissed = withoutWorkspaceDismissals(snapshot.ui.insightsDismissed);
    const ui: UIPreferences = {
      ...snapshot.ui,
      sidebar: {
        ...snapshot.ui.sidebar,
        locations: await filterPaths(snapshot.ui.sidebar.locations, allow),
        hidden: await filterPaths(snapshot.ui.sidebar.hidden, allow),
        labels: await filterPathRecord(snapshot.ui.sidebar.labels, allow),
      },
      insightsDismissed: dismissed ? await filterPathRecord(dismissed, allow) : undefined,
    };
    return { settings, ui };
  }
  async authorize(file: string): Promise<string> {
    this.admissions.getStore()?.throwIfAborted();
    const access = await this.access.state();
    if (!access.enabled) throw new Error('Agent access is disabled.');
    if (containsPath(path.resolve(this.dataPath), absolute(file)))
      throw new Error(
        'Private Viewer credentials, grants and recovery data are unavailable to generic agent file tools.',
      );
    const client = await this.clients.get();
    const configured = client?.roots ?? access.roots;
    let replaced = false;
    const roots = await Promise.all(
      configured.map(async (root) => {
        const resolved = await realpath(root).catch(() => '');
        // Named clients keep canonical roots; a root later replaced by a link is unavailable.
        if (client && resolved !== absolute(root)) {
          if (resolved) replaced = true;
          return '';
        }
        return resolved;
      }),
    );
    const outsideError = () =>
      new Error(
        replaced
          ? 'This file is outside the agent’s authorized folders. A granted folder moved behind a link; save the client’s folders again in Settings.'
          : 'This file is outside the agent’s authorized folders.',
      );
    let actual: string;
    try {
      await this.extension?.access?.([file]);
      actual = await realpath(absolute(file));
    } catch (error) {
      // Outside the agent's folders, missing, denied and out-of-scope paths answer alike,
      // so agents cannot probe the disk. Inside them, the actual reason is shown.
      const lexical = absolute(file);
      const validConfigured = configured
        .filter((_root, index) => !client || Boolean(roots[index]))
        .map((root) => absolute(root));
      if ([...roots, ...validConfigured].some((root) => root && containsPath(root, lexical)))
        throw error;
      throw outsideError();
    }
    const privateRoot = await realpath(this.dataPath).catch(() => path.resolve(this.dataPath));
    if (containsPath(privateRoot, actual))
      throw new Error('Private Viewer data is unavailable to generic agent file tools.');
    if (!(await this.access.state()).enabled) throw new Error('Agent access is disabled.');
    const latest = await this.clients.get();
    if (client && latest?.revision !== client.revision)
      throw new Error('Client folder permissions changed. Try again.');
    if (!roots.some((root) => root && containsPath(root, actual))) throw outsideError();
    this.admissions.getStore()?.throwIfAborted();
    return actual;
  }
  /** Rechecked by the desktop executor after review; neither review nor layout prefs grant paths. */
  async authorizeNavigation(request: AgentNavigation, target: CapturedTarget): Promise<void> {
    await this.authorizeTarget(target);
    if (target.paneID === 'none' && target.rootID === 'none') {
      if (
        request.kind === 'select-files' ||
        (request.kind === 'open-path' && request.placement === 'linked')
      )
        throw new Error('Focus a files plane first.');
      if (!(await this.access.state()).enabled) throw new Error('Agent access is disabled.');
    }
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
        if (!sameCapturedItem(actual, file) || (await realpath(actual.parent)) !== directory)
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
  private serviceContext(signal: AbortSignal): AgentServiceContext {
    return {
      clientID: this.clients.actor(),
      signal,
      authorize: (file) => this.authorize(file),
      require: async (capability) => {
        signal.throwIfAborted();
        const client = await this.clients.require(capability);
        signal.throwIfAborted();
        if (capability === 'content' && !client)
          throw new Error('Use a named client with content permission.');
      },
      catalog: () => this.extension?.catalog(),
      workspaceState: async () => this.extension?.workspaceState?.(),
      own: (id) => this.own(id, signal),
    };
  }
  async authorizeWorkflow(run: WorkflowRun): Promise<void> {
    if (run.context.actor !== 'agent') return;
    if (!this.extension?.services || !run.context.clientID)
      throw new Error('The workflow client is unavailable.');
    await this.clients.context.run(run.context.clientID, () =>
      this.extension!.services!.authorizeWorkflow(
        run,
        this.serviceContext(AbortSignal.timeout(30000)),
      ),
    );
  }
  async handle(
    token: unknown,
    request: unknown,
    signal: AbortSignal = AbortSignal.timeout(120000),
    onAuthenticated?: (actor: string) => void,
  ): Promise<unknown> {
    if (this.closed) throw new Error('Agent access is disabled.');
    const lifetime = this.lifetime.signal;
    signal.throwIfAborted();
    if (typeof token !== 'string' || token.length !== 64 || !(await this.access.state()).enabled)
      throw new Error('Agent access is disabled or its token is invalid.');
    const shared =
      Buffer.byteLength(token) === Buffer.byteLength(this.token) &&
      timingSafeEqual(Buffer.from(token), Buffer.from(this.token));
    const actor = shared ? sharedClientID : await this.clients.authenticate(token);
    if (!actor) throw new Error('Agent access is disabled or its token is invalid.');
    onAuthenticated?.(actor);
    let clientLifetime = this.clientLifetimes.get(actor);
    if (!clientLifetime) this.clientLifetimes.set(actor, (clientLifetime = new AbortController()));
    const authority = AbortSignal.any([lifetime, clientLifetime.signal]);
    signal = AbortSignal.any([signal, authority]);
    signal.throwIfAborted();
    return this.admissions.run(authority, () =>
      this.clients.context.run(actor, async () => {
        const client = await this.clients.get();
        const policy = this.policy();
        const active = this.activeCalls.get(actor) ?? 0;
        if (active >= (client?.budgets.maxTasks ?? 20))
          throw new Error(
            'This client already runs as many requests as it may. Wait for one to finish.',
          );
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
          const result = await this.handleAuthenticated(request, signal);
          signal.throwIfAborted();
          const latest = await this.clients.get();
          if (
            (client && latest?.revision !== client.revision) ||
            (await policy) !== (await this.policy())
          )
            throw new Error('Agent permissions changed while this request was running. Try again.');
          if (tool?.success)
            void this.clients
              .audit(tool.data.name, 'completed', 'Request completed.', actor, false)
              .catch(() => {});
          return result;
        } catch (error) {
          if (tool?.success)
            void this.clients
              .audit(tool.data.name, 'failed', 'Request failed.', actor, false)
              .catch(() => {});
          throw error;
        } finally {
          const remaining = (this.activeCalls.get(actor) ?? 1) - 1;
          if (remaining) this.activeCalls.set(actor, remaining);
          else this.activeCalls.delete(actor);
        }
      }),
    );
  }
  /** What a request ran under: a change while it ran fails it. */
  private async policy(): Promise<string> {
    const { enabled, roots, capabilities } = await this.access.state();
    return JSON.stringify({
      enabled,
      roots,
      capabilities,
      allowLayout: this.settings().agents.allowLayout,
    });
  }
  private async handleAuthenticated(request: unknown, signal: AbortSignal): Promise<unknown> {
    const message = z.object({ method: z.string(), params: z.unknown().optional() }).parse(request);
    if (message.method === 'initialize') {
      const params = z.object({ protocolVersion: z.string() }).passthrough().parse(message.params);
      return {
        protocolVersion: ['2026-07-28', '2025-11-25', '2025-06-18'].includes(params.protocolVersion)
          ? params.protocolVersion
          : '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'viewer', version: this.extension?.version ?? '0.0.0' },
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
    const capability = toolCapability(call.name);
    if (capability) await this.clients.require(capability);
    else await this.clients.get();
    let value: unknown;
    if (serviceToolNames.has(call.name)) {
      if (!this.extension?.services)
        throw new Error('This service is unavailable in the running app.');
      const context = this.serviceContext(signal),
        required = new Set<AgentCapability>();
      const require = context.require;
      context.require = async (capability) => {
        required.add(capability);
        await require(capability);
      };
      value = await this.extension.services.call(call.name, args, context);
      for (const capability of required) await require(capability);
    } else if (call.name === 'report_session') {
      if (!this.extension?.sessions) throw new Error('Session reporting is unavailable.');
      const client = await this.clients.get();
      value = await this.extension.sessions.report(
        this.clients.actor(),
        client?.name ?? 'Shared local client',
        parseToolInput('report_session', args),
        (file) => this.authorize(file),
      );
    } else if (isToolIn(call.name, ['list_workspaces', 'list_planes'])) {
      const input =
        call.name === 'list_planes'
          ? parseToolInput('list_planes', args)
          : (parseToolInput('list_workspaces', args), { workspaceID: undefined });
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
      if (call.name === 'list_planes') {
        if (!workspaces.length)
          throw new Error(
            'Workspace not found or outside the agent’s authorized folders. Call list_workspaces to see visible workspaces.',
          );
        value = workspaces[0]!.panes;
      } else value = workspaces;
    } else if (
      isToolIn(call.name, [
        'propose_open_path',
        'propose_selection',
        'propose_focus_plane',
        'propose_workspace_switch',
      ])
    ) {
      const extension = this.extension,
        catalog = extension?.catalog();
      if (!extension || !catalog) throw new Error('Focus a granted files plane in Viewer first.');
      let request: AgentNavigation;
      let target: CapturedTarget = structuredClone({ ...catalog.target, selection: [] });
      if (call.name === 'propose_open_path') {
        const input = parseToolInput('propose_open_path', args);
        await this.authorize(input.path);
        request = { kind: 'open-path', ...input };
      } else if (call.name === 'propose_selection') {
        const input = parseToolInput('propose_selection', args);
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
        const input = parseToolInput('propose_focus_plane', args);
        const state = await extension.workspaceState?.();
        const pane = state?.workspaces
          .find((space) => space.id === target.workspaceID)
          ?.panes.find((pane) => pane.id === input.paneID);
        if (!pane) throw new Error('Choose a plane in the active workspace from list_planes.');
        request = { kind: 'focus-plane', pane: agentPlaneCopy(pane) };
      } else {
        const input = parseToolInput('propose_workspace_switch', args);
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
        request = { kind: 'switch-workspace', workspace: agentWorkspaceCopy(match) };
      }
      await this.authorizeNavigation(request, target);
      signal.throwIfAborted();
      value = extension.requests.navigation(request, target);
      this.own((value as { id: string }).id, signal);
      // A named client's navigation runs at once, but a project file opened installs a whole
      // workspace from it, and a tour file opens every file it stops at: the person reviews those.
      const name = request.kind === 'open-path' ? path.basename(request.path) : '';
      const reviewed = name === 'viewer.project.jsonc' || isTourFile(name);
      if (!reviewed && (await this.clients.get())) {
        await extension.requests.review((value as { id: string }).id, true);
        value = { ...(value as object), requiresUserReview: false };
      }
    } else if (call.name === 'propose_transform') {
      const extension = this.extension,
        catalog = extension?.catalog();
      if (!extension || !catalog) throw new Error('Open a workspace in Viewer first.');
      const input = parseToolInput('propose_transform', args);
      await this.clients.require('content');
      await this.authorizeTarget(catalog.target);
      await this.authorize(input.destination);
      const selection = [];
      for (const file of input.sources) {
        await this.authorize(file);
        selection.push(await entry(file));
      }
      signal.throwIfAborted();
      value = extension.requests.transform(input.plan, input.destination, input.name, {
        ...catalog.target,
        selection,
      });
      this.own((value as { id: string }).id, signal);
    } else if (isToolIn(call.name, ['list_commands', 'explain_command', 'propose_command'])) {
      const extension = this.extension;
      const catalog = extension?.catalog();
      if (!extension || !catalog) throw new Error('Open a workspace in Viewer first.');
      await this.authorizeTarget(catalog.target);
      const commands = catalog.commands.filter((command) => {
        try {
          agentCommandID(command.id, this.settings().customActions);
          return true;
        } catch {
          return false;
        }
      });
      if (call.name === 'list_commands') {
        parseToolInput('list_commands', args);
        value = {
          target: catalog.target,
          commands,
          reviewByDefault: true,
          removalPolicy: agentRemovalPolicy,
        };
      } else {
        const input = parseToolInput(call.name, args);
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
          signal.throwIfAborted();
          value = await extension.requests.command(command.id, catalog.target, command.label);
          this.own((value as { id: string }).id, signal);
        }
      }
    } else if (call.name === 'read_config') {
      if (!this.extension) throw new Error('Configuration API is unavailable.');
      parseToolInput('read_config', args);
      const snapshot = this.extension.config.snapshot();
      const scoped = await this.scopedConfiguration(snapshot, 'read');
      value = {
        version: 1,
        settings: scoped.settings,
        ui: scoped.ui,
        revision: snapshot.revision,
      };
    } else if (isToolIn(call.name, ['validate_config', 'propose_config'])) {
      if (!this.extension) throw new Error('Configuration API is unavailable.');
      const input = parseToolInput(call.name, args);
      if (call.name === 'validate_config') {
        const snapshot = this.extension.config.snapshot();
        const scoped = await this.scopedConfiguration(snapshot, 'validate');
        const preview = this.extension.config.preview(input.patches, scoped);
        value = {
          ...preview,
          changes: preview.changes.filter(
            (key) => !namesWorkspaceDismissal(key, snapshot.ui.insightsDismissed),
          ),
        };
      } else {
        const snapshot = this.extension.config.snapshot();
        const scoped = await this.scopedConfiguration(snapshot, 'validate');
        signal.throwIfAborted();
        value = this.extension.requests.configuration(input.patches, undefined, scoped);
        this.own((value as { id: string }).id, signal);
      }
    } else if (['read_terminal', 'write_terminal'].includes(call.name)) {
      if (!this.extension) throw new Error('Terminal API is unavailable.');
      const input =
        call.name === 'read_terminal'
          ? parseToolInput('read_terminal', args)
          : writeTerminalInput.parse(args);
      const terminal = this.extension.requests;
      await this.authorize(terminal.terminalDirectory(input.id));
      if (call.name === 'read_terminal') {
        const output = await terminal.readTerminal(input.id);
        await this.authorize(output.cwd);
        value = output;
      } else {
        if (input.data === undefined) throw new Error('Provide terminal input.');
        signal.throwIfAborted();
        value = await terminal.writeTerminal(input.id, input.data);
        this.own((value as { id: string }).id, signal);
      }
    } else if (call.name === 'list_proposals') {
      if (!this.extension) throw new Error('Proposal API is unavailable.');
      const input = parseToolInput('list_proposals', args);
      const actor = this.clients.actor();
      value = this.extension.requests
        .list()
        .filter((proposal) => this.owned.get(proposal.id) === actor || proposal.clientID === actor)
        .reverse()
        .slice(0, input.limit)
        .map((proposal) => ({
          id: proposal.id,
          kind: proposal.kind,
          title: proposal.title,
          status: proposal.status,
          ...(proposal.error ? { error: proposal.error } : {}),
        }));
    } else if (call.name === 'get_proposal' || call.name === 'cancel_proposal') {
      if (!this.extension) throw new Error('Proposal API is unavailable.');
      const input = parseToolInput(call.name, args);
      if (this.owned.get(input.id) !== this.clients.actor())
        throw new Error('Proposal belongs to another actor.');
      if (call.name === 'cancel_proposal') {
        this.extension.requests.cancel(input.id, this.clients.actor());
        value = { id: input.id, status: this.extension.requests.get(input.id).status };
      } else value = this.extension.requests.get(input.id);
    } else if (call.name === 'get_relationships') {
      const input = parseToolInput('get_relationships', args);
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
    } else if (call.name === 'get_context') {
      parseToolInput('get_context', args);
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
    } else if (call.name === 'list_actions') {
      parseToolInput('list_actions', args);
      value = this.settings().recipes.map((recipe) => ({
        id: recipe.id,
        name: recipe.name,
        formats: recipe.formats,
        data: recipe.data,
        kind: recipe.kind,
      }));
    } else if (call.name === 'read_metadata') {
      const input = parseToolInput('read_metadata', args);
      await this.authorize(input.path);
      value = await entry(input.path);
    } else if (call.name === 'read_drawing_geometry') {
      const input = parseToolInput('read_drawing_geometry', args);
      const client = await this.clients.get();
      if (!client)
        throw new Error('Use a named client with content permission for drawing geometry.');
      await this.authorize(input.path);
      const before = await entry(input.path);
      const { path: file, ...options } = input;
      value = await this.files.drawingGeometry(file, options, signal);
      await this.authorize(file);
      if (!sameSourceVersion(sourceVersion(before), sourceVersion(await entry(file))))
        throw new Error('The drawing changed. Read its geometry again.');
    } else if (isToolIn(call.name, ['read_sqlite', 'list_archive', 'read_archive_entry'])) {
      const input = parseToolInput(call.name, args);
      const client = await this.clients.get();
      if (!client)
        throw new Error(
          'Create a named agent client with explicit content permission in Settings.',
        );
      await this.authorize(input.path);
      const before = await entry(input.path);
      if (before.directory || before.kind !== 'file') throw new Error('Choose a regular file.');
      if (call.name === 'read_sqlite') {
        const request =
          'kind' in input && input.kind === 'rows'
            ? sqliteRequestSchema.parse({
                kind: 'rows',
                table: input.table,
                offset: input.offset,
                limit: input.limit,
              })
            : sqliteRequestSchema.parse({ kind: 'tables' });
        const reply = await this.files.sqlite(input.path, request, signal);
        value = { ...reply, path: input.path, version: sourceVersion(before) };
      } else if (call.name === 'list_archive') {
        const listing = await this.files.archiveList(input.path, signal);
        const offset = 'offset' in input ? input.offset : 0;
        const limit = 'limit' in input ? input.limit : 200;
        const entries = listing.entries.slice(offset, offset + limit);
        value = {
          path: input.path,
          version: sourceVersion(before),
          totalEntries: listing.entries.length,
          entries,
          ...(offset + entries.length < listing.entries.length
            ? { nextOffset: offset + entries.length }
            : {}),
          truncated: listing.truncated,
        };
      } else if ('entry' in input) {
        const maxBytes = 'maxBytes' in input ? input.maxBytes : 65536;
        const read = await this.files.archiveReadText(input.path, input.entry, maxBytes, signal);
        value = {
          path: input.path,
          version: sourceVersion(before),
          entry: input.entry,
          ...read,
        };
      }
      await this.authorize(input.path);
      if (!sameSourceVersion(sourceVersion(before), sourceVersion(await entry(input.path))))
        throw new Error('The source changed. Read it again.');
    } else if (isToolIn(call.name, ['inspect_file', 'read_content', 'query_table'])) {
      const input = parseToolInput(call.name, args);
      const client = await this.clients.get();
      if (!client)
        throw new Error(
          'Create a named agent client with explicit content permission in Settings.',
        );
      await this.authorize(input.path);
      const before = await entry(input.path);
      if (before.directory) throw new Error('Choose a file.');
      if (call.name === 'inspect_file')
        value = await this.files.inspect(
          input.path,
          true,
          'ocr' in input && Boolean(input.ocr),
          signal,
        );
      else {
        const document = await this.files.extract(input.path, signal);
        if (call.name === 'query_table') {
          const offset = 'offset' in input ? Number(input.offset) : 0,
            limit = 'limit' in input ? Number(input.limit) : 100;
          if (
            readsOfficeContent(before.extension) &&
            officeFamily(before.extension) === 'workbook' &&
            document.office?.kind === 'workbook'
          ) {
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
              coverage:
                document.truncated || table.malformed || table.truncated ? 'partial' : 'complete',
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
    } else if (call.name === 'search_files') {
      const input = parseToolInput('search_files', args);
      await this.authorize(input.root);
      const client = await this.clients.get();
      if (input.content) {
        await this.clients.require('content');
        if (!client) throw new Error('Use a named client with content permission.');
      }
      const result = await this.files.query(
        {
          ...input,
          content:
            input.content ??
            (client?.capabilities ?? (await this.access.capabilities())).includes('content'),
        } as IndexedQuery,
        signal,
      );
      const entries: typeof result.entries = [];
      for (const item of result.entries) {
        try {
          await this.authorize(item.path);
          entries.push(item);
        } catch {
          /* Filter symlinks crossing grants. */
        }
      }
      if (input.content) await this.clients.require('content');
      value = {
        entries,
        evidence:
          input.content && client
            ? result.evidence?.filter((item) => entries.some((entry) => entry.path === item.path))
            : undefined,
        more: result.more,
        indexed: result.indexed,
        running: result.status.running,
      };
    } else if (call.name === 'run_action') {
      value = await this.admitTask(async () => {
        await this.clients.require('propose');
        const input = parseToolInput('run_action', args);
        for (const file of input.sources) await this.authorize(file);
        const recipe = this.settings().recipes.find((recipe) => recipe.id === input.recipeID);
        if (!recipe || recipeReadsContent(recipe)) await this.clients.require('content');
        const client = await this.clients.get();
        const actor = this.clients.actor();
        const maxTasks = client?.budgets.maxTasks ?? 20;
        const running = (await this.actions.all()).filter(
          (task) =>
            task.context.actor === 'agent' &&
            task.context.clientID === actor &&
            ['planning', 'review', 'applying'].includes(task.status),
        ).length;
        if (running >= maxTasks) throw new Error('Review or stop a task before starting another.');
        const context = this.context();
        if (!context) throw new Error('Open Viewer to review this task.');
        const request: ActionRequest = {
          recipeID: input.recipeID,
          instructions: input.instructions,
          context: {
            ...context,
            actor: 'agent',
            clientID: actor,
            sources: input.sources,
            recursive: input.recursive,
          },
        };
        signal.throwIfAborted();
        const id = await this.actions.start(request, undefined, this.admissions.getStore());
        this.own(id, signal);
        return { id, applyRequiresUserReview: true };
      });
    } else if (call.name === 'list_tasks') {
      const input = parseToolInput('list_tasks', args);
      const actor = this.clients.actor();
      const tasks = (await this.actions.all()).filter(
        (plan) =>
          this.owned.get(plan.id) === actor ||
          (plan.context.actor === 'agent' && plan.context.clientID === actor),
      );
      const visible = [];
      for (const plan of [...tasks].reverse()) {
        if (visible.length >= input.limit) break;
        let covered = true;
        for (const file of plan.context.sources) {
          try {
            await this.authorize(file);
          } catch {
            covered = false;
            break;
          }
        }
        if (!covered) continue;
        visible.push({
          id: plan.id,
          recipeID: plan.recipeID,
          title: plan.title,
          status: plan.status,
          undoable: plan.undoable,
          rowCount: plan.rows.length,
          ...(plan.error ? { error: plan.error } : {}),
        });
      }
      value = visible;
    } else if (call.name === 'get_task' || call.name === 'cancel_task') {
      const input = parseToolInput(call.name, args);
      const plan = await this.actions.get(input.id);
      if (
        this.owned.get(input.id) !== this.clients.actor() &&
        !(plan.context.actor === 'agent' && plan.context.clientID === this.clients.actor())
      )
        throw new Error('This task belongs to another actor.');
      const recipe = this.settings().recipes.find((recipe) => recipe.id === plan.recipeID);
      if (call.name === 'get_task' && (!recipe || recipeReadsContent(recipe)))
        await this.clients.require('content');
      for (const file of plan.context.sources) await this.authorize(file);
      if (call.name === 'cancel_task') {
        this.actions.cancel(input.id);
        value = { cancelled: true };
      } else value = plan;
    } else throw new Error('Unknown agent tool. Call tools/list to see available tools.');
    if (capability) await this.clients.require(capability);
    else await this.clients.get();
    this.checkBudget(call.name, value, await this.clients.get());
    return { content: [{ type: 'text', text: JSON.stringify(value) }] };
  }
  /** A result the agent receives is at most its client's **Maximum returned content**. */
  private checkBudget(tool: string, value: unknown, client: AgentClient | undefined): void {
    const bytes = Buffer.byteLength(JSON.stringify(value) ?? 'null');
    const budget = client?.budgets.maxReadBytes ?? defaultAgentReadBytes;
    if (bytes > budget) throw readBudgetError(tool, bytes, budget, !client);
  }
  /** Records which client may read a proposal or task; bounded like the requests it tracks. */
  private own(id: string, signal?: AbortSignal): void {
    const authority = this.admissions.getStore();
    if (authority?.aborted || signal?.aborted) {
      this.actions.cancel(id);
      if (authority?.aborted) this.extension?.requests.stop(this.clients.actor());
      else if (this.extension?.requests.has(id))
        this.extension.requests.cancel(id, this.clients.actor());
      (authority?.aborted ? authority : signal)!.throwIfAborted();
    }
    this.owned.set(id, this.clients.actor());
    if (this.owned.size <= 1000) return;
    // what is gone goes first; a proposal still kept stays its client's (2026-10-20: the oldest half
    // went, and an agent could no longer read its own proposal under review). Tasks are read by the
    // client recorded on them.
    for (const key of this.owned.keys()) {
      if (this.owned.size <= 500) break;
      if (!this.extension?.requests.has(key)) this.owned.delete(key);
    }
  }
  /** Records why the connection closed, before its socket goes, so a relay started now can tell
   * the person what to do. Only an existing record is rewritten, atomically; without the mark a
   * relay falls back to checking the process it names. */
  private async markClosed(end: AgentConnectionEnd): Promise<void> {
    try {
      const record = await this.connection.load();
      if (!record || (record.closed === end && record.pid === process.pid)) return;
      await this.connection.save({ ...record, pid: process.pid, closed: end });
    } catch {
      // Closing still revokes access when the mark cannot be written.
    }
  }
  /** The private socket folder holds only the socket; it is never removed recursively. */
  private async removeSocketDirectory(): Promise<void> {
    const directory = this.socketDirectory;
    if (!directory) return;
    this.socketDirectory = undefined;
    // Closing the listener still revokes access. Generated acceptance directories are retained
    // until their exact paths have been reviewed for removal under the repository's policy.
    if (process.env.VIEWER_TEST_PRESERVE === '1' || nativeTestRemovalsBlocked()) return;
    await discardOwnTemporaryFile(path.join(directory, 'v.sock'));
    await removeEmptyDirectory(directory).catch(() => {});
  }
  /** Stops the transport: `quit` as Viewer quits, `off` when agent access is turned off. */
  close(end: AgentConnectionEnd = 'quit'): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    const work = this.closeNow(end).finally(() => {
      if (this.closing === work) this.closing = undefined;
    });
    this.closing = work;
    return work;
  }
  private async closeNow(end: AgentConnectionEnd): Promise<void> {
    const stopping = Promise.allSettled([this.stopAll()]);
    await this.starting?.catch(() => {});
    await this.markClosed(end);
    for (const stream of this.streams.keys()) stream.destroy();
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
    this.server = undefined;
    const results = [
      ...(await stopping),
      ...(await Promise.allSettled([
        this.access.flush?.(),
        this.clients.close(),
        this.removeSocketDirectory(),
      ])),
    ];
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
}
