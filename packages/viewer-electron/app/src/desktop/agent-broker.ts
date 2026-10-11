import { createServer, type Server, type Socket } from 'node:net';
import { chmod, realpath, mkdtemp, rm } from 'node:fs/promises';
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
const within = (file: string, root: string) =>
  file === root || file.startsWith(root.replace(/\/$/, '') + '/');
const tools = [
  {
    name: 'get_context',
    description: 'Read the active Viewer context within your granted folders.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_actions',
    description: 'List available action recipes and their data requirements.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_metadata',
    description: 'Read metadata for a granted file.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_files',
    description: 'Search an indexed granted folder.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        root: { type: 'string' },
        offset: { type: 'integer' },
      },
      required: ['query', 'root'],
      additionalProperties: false,
    },
  },
  {
    name: 'run_action',
    description: 'Run a recipe to create a proposal. The user must review file changes in Viewer.',
    inputSchema: {
      type: 'object',
      properties: {
        recipeID: { type: 'string' },
        sources: { type: 'array', items: { type: 'string' } },
        instructions: { type: 'string' },
        recursive: { type: 'boolean' },
      },
      required: ['recipeID', 'sources'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_task',
    description: 'Read a task proposal within your granted folders.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'cancel_task',
    description: 'Cancel a task you started.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
];
export class AgentBroker {
  private server?: Server;
  private starting?: Promise<void>;
  private socketDirectory?: string;
  private streams = new Set<Socket>();
  private token = randomBytes(32).toString('hex');
  private owned = new Set<string>();
  private connection: DocumentStore<{ socket: string; pid: number }>;
  private tokenStore: DocumentStore<string>;
  constructor(
    private dataPath: string,
    private settings: () => ApplicationSettings,
    private context: () => ActionContext | undefined,
    private files: FileServices,
    private actions: ActionPlanner,
  ) {
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
      path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'viewer-agent-'),
    );
    await chmod(this.socketDirectory, 0o700);
    const socket = path.join(this.socketDirectory, 'v.sock');
    this.server = createServer((stream) => {
      this.streams.add(stream);
      stream.on('close', () => this.streams.delete(stream));
      const decoder = new StringDecoder('utf8');
      let buffer = '';
      let requests = Promise.resolve();
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
      await rm(this.socketDirectory, { recursive: true, force: true });
      this.socketDirectory = undefined;
      throw error;
    }
  }
  async credential(): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await this.tokenStore.save(token);
    this.token = token;
    this.owned.clear();
    for (const stream of this.streams) stream.destroy();
    return token;
  }
  async authorize(file: string): Promise<string> {
    const actual = await realpath(absolute(file));
    const roots = await Promise.all(
      this.settings().agents.roots.map((root) => realpath(root).catch(() => '')),
    );
    if (!roots.some((root) => root && within(actual, root)))
      throw new Error('This file is outside the agent’s authorized folders.');
    return actual;
  }
  async handle(token: unknown, request: unknown): Promise<unknown> {
    if (
      !this.settings().agents.enabled ||
      typeof token !== 'string' ||
      Buffer.byteLength(token) !== Buffer.byteLength(this.token) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(this.token))
    )
      throw new Error('Agent access is disabled or its token is invalid.');
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
    if (message.method === 'tools/list') return { tools };
    if (message.method !== 'tools/call') throw new Error('Unsupported MCP method.');
    const call = z
      .object({ name: z.string(), arguments: z.record(z.string(), z.unknown()).optional() })
      .parse(message.params);
    const args = call.arguments || {};
    let value: unknown;
    if (call.name === 'get_context') {
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
      const result = await this.files.query(input as IndexedQuery);
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
      const context = this.context();
      if (!context) throw new Error('Open Viewer to review this task.');
      const request: ActionRequest = {
        recipeID: input.recipeID,
        instructions: input.instructions,
        context: { ...context, actor: 'agent', sources: input.sources, recursive: input.recursive },
      };
      const id = await this.actions.start(request);
      this.owned.add(id);
      value = { id, applyRequiresUserReview: true };
    } else if (call.name === 'get_task' || call.name === 'cancel_task') {
      const input = z.object({ id: z.string() }).strict().parse(args);
      if (!this.owned.has(input.id)) throw new Error('This task belongs to another actor.');
      const plan = await this.actions.get(input.id);
      for (const file of plan.context.sources) await this.authorize(file);
      if (call.name === 'cancel_task') {
        this.actions.cancel(input.id);
        value = { cancelled: true };
      } else value = plan;
    } else throw new Error('Unknown tool. Agents cannot apply or delete files.');
    return { content: [{ type: 'text', text: JSON.stringify(value) }] };
  }
  async close(): Promise<void> {
    await this.starting?.catch(() => {});
    for (const stream of this.streams) stream.destroy();
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
    this.server = undefined;
    if (this.socketDirectory) {
      await rm(this.socketDirectory, { recursive: true, force: true });
      this.socketDirectory = undefined;
    }
  }
}
