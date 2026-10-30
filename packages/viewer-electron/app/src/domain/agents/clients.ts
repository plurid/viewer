import { z } from 'zod';
import type { FinalProposalStatus } from './requests';
export const agentCapabilities = [
  'metadata',
  'content',
  'navigation',
  'propose',
  'execute',
  'terminal-read',
  'terminal-write',
] as const;
export type AgentCapability = (typeof agentCapabilities)[number];
/** The client behind the shared connection token in Settings → Agents. It works inside the
 * Agents folders with every request reviewed; named clients carry their own folders and
 * capabilities. */
export const sharedClientID = 'shared';
/** Stored grants and audit records name the shared client by this earlier ID too. */
export const storedClientID = z
  .string()
  .max(200)
  .transform((value) => (value === 'legacy' ? sharedClientID : value));
const mebibyte = 1024 * 1024;
/** What the shared connection returns at most, and where a new client's budget starts. */
export const defaultAgentReadBytes = 4 * mebibyte;
/** The most a client's **Maximum returned content** may be. More than this is beyond what an agent
 * can use, and each process that relays it holds the whole reply. */
export const maxAgentReadBytes = 8 * mebibyte;
/** One reply line from Viewer to its `--mcp` relay, its newline aside. A result reaches the agent
 * as JSON text inside a JSON string, where each quote and backslash in it is escaped once more: a
 * result within the largest budget takes at most twice its size, and the rest is room for the
 * framing around it. */
export const maxAgentReplyBytes = 2 * maxAgentReadBytes + mebibyte;
/** Named clients Viewer keeps, revoked ones included: each is listed in Settings → Agents. */
export const agentClientLimit = 100;
const size = (bytes: number) =>
  bytes < mebibyte
    ? `${Math.ceil(bytes / 1024).toLocaleString('en-US')} KiB`
    : `${(Math.ceil((bytes / mebibyte) * 10) / 10).toLocaleString('en-US')} MiB`;
/** What to ask for instead of a result that is too large, by tool. */
const smaller: Record<string, string> = {
  query_table: 'Read fewer rows with a smaller limit, or page through them with offset',
  read_drawing_geometry: 'Request fewer entities, or omit points',
  read_content: 'Find the passages you need with search_files and content: true',
  inspect_file: 'Find the passages you need with search_files and content: true',
  search_files: 'Narrow the query, or page through the results with offset',
};
/** The refusal of a result over a client's read budget: its size, the budget, and what to do. */
export function readBudgetError(
  tool: string,
  bytes: number,
  budget: number,
  shared: boolean,
): Error {
  const instead = smaller[tool] ?? 'Ask for a smaller range, fewer files or a summary';
  const owner = shared ? 'the shared connection’s' : 'this client’s';
  const raise =
    bytes > maxAgentReadBytes
      ? `No client can return more than ${size(maxAgentReadBytes)}.`
      : shared
        ? `A named client can return up to ${size(maxAgentReadBytes)}.`
        : `Or ask the person to raise Maximum returned content in Settings → Agents to ` +
          `${Math.ceil(bytes / mebibyte)} MiB.`;
  // sizes that round alike are given exactly: 5 KiB over 5 KiB says nothing
  const [result, limit] =
    size(bytes) === size(budget)
      ? [bytes, budget].map((value) => `${value.toLocaleString('en-US')} bytes`)
      : [size(bytes), size(budget)];
  return new Error(
    `The ${tool} result is ${result}, over ${owner} read budget of ${limit}. ${instead}. ${raise}`,
  );
}
export const agentClientInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    roots: z
      .array(
        z
          .string()
          .min(1)
          .max(32768)
          .refine(
            (value) =>
              (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) && !value.includes('\0'),
          ),
      )
      .min(1)
      .max(100),
    capabilities: z
      .array(z.enum(agentCapabilities))
      .min(1)
      .max(7)
      .refine((items) => new Set(items).size === items.length),
    budgets: z
      .object({
        maxReadBytes: z.number().int().min(1024).max(maxAgentReadBytes),
        maxTasks: z.number().int().min(1).max(20),
      })
      .strict()
      .default({ maxReadBytes: defaultAgentReadBytes, maxTasks: 4 }),
  })
  .strict();
export type AgentClientInput = z.infer<typeof agentClientInputSchema>;
export interface AgentClient extends AgentClientInput {
  id: string;
  revision: number;
  created: number;
  revoked: boolean;
}
export type AgentClientRequest =
  | { kind: 'list' }
  | { kind: 'create'; client: AgentClientInput }
  | { kind: 'update'; id: string; revision: number; client: AgentClientInput }
  | { kind: 'revoke'; id: string; revision: number }
  /** Forgets a revoked client's record. Only the person can, in Settings → Agents. */
  | { kind: 'remove'; id: string; revision: number };
export type AgentClientReply =
  AgentClient[] | AgentClient | { client: AgentClient; token: string; configuration?: string };
/** Why no client can be created while Viewer keeps as many as it holds, with the counts that decide
 * what to do; undefined while there is room. */
export function clientLimitReached(
  clients: readonly Pick<AgentClient, 'revoked'>[],
): string | undefined {
  if (clients.length < agentClientLimit) return undefined;
  const revoked = clients.filter((client) => client.revoked).length;
  return revoked
    ? `Viewer keeps up to ${agentClientLimit} agent clients and has ${clients.length}: ` +
        `${clients.length - revoked} active and ${revoked} revoked. ` +
        'Remove a revoked client, then create this one.'
    : `Viewer keeps up to ${agentClientLimit} agent clients, and all ${clients.length} are ` +
        'active. Revoke one you no longer use and remove it, then create this one.';
}
export interface AgentAudit {
  id: string;
  at: number;
  clientID: string;
  tool: string;
  status: FinalProposalStatus;
  detail: string;
}
/** The shared connection's access: what config.jsonc asks for, as far as the person approved it. */
export interface AgentAccessState {
  /** In effect: config.jsonc asks for it and the person approved it. */
  enabled: boolean;
  /** The approved folders, as config.jsonc names them. */
  roots: string[];
  /** Every folder either side names: agents cannot move one of them to the Trash. */
  protectedRoots: string[];
  /** What config.jsonc asks for beyond the approval, waiting in Settings → Agents. */
  pending: { enable: boolean; roots: string[] };
  /** Only the capabilities explicitly approved for the shared connection. */
  capabilities: AgentCapability[];
  /** Version-1 authority has no reliable consent provenance and needs one native review. */
  requiresReapproval?: boolean;
}
export type AgentAccessRequest =
  | { kind: 'state' }
  | { kind: 'enable'; enabled: boolean }
  | { kind: 'add-folder' }
  | { kind: 'allow'; roots: string[] }
  | { kind: 'remove-folder'; root: string }
  | { kind: 'capabilities'; capabilities: AgentCapability[] };
/** Why the running app's agent connection is closed: it quit, or agent access is off. */
export const agentConnectionEnds = ['quit', 'off'] as const;
export type AgentConnectionEnd = (typeof agentConnectionEnds)[number];
/** `agent-connection-v1.json`: where the running app listens for its `--mcp` relays. The app marks
 * it `closed` before its socket goes, so a relay can say why it cannot connect. */
export const agentConnectionSchema = z.object({
  socket: z.string(),
  pid: z.number(),
  /** The executable of the app that wrote it. */
  executable: z.string().optional(),
  closed: z.enum(agentConnectionEnds).optional(),
});
export type AgentConnection = z.infer<typeof agentConnectionSchema>;
/** Why a relay cannot reach the app: it is not running, access is off, or its listener has gone. */
export type AgentConnectionFailure = AgentConnectionEnd | 'gone';
/** What the person can do when an agent cannot reach Viewer. `app` is the Viewer to open, and
 * `starts` the copy this agent starts when that is another one. */
export function agentConnectionAdvice(
  failure: AgentConnectionFailure,
  app?: string,
  starts?: string,
): string {
  if (failure === 'off')
    return 'Agent access is off in Viewer. Turn on Allow local agent clients in Settings → Agents, then start the agent again.';
  if (failure === 'gone')
    return 'Viewer is running, but its agent connection has closed. Quit and reopen Viewer, then start the agent again.';
  const open = app ? `Open Viewer (${app})` : 'Open Viewer';
  const copy = starts ? ` This agent starts another copy, at ${starts}.` : '';
  return `Viewer is not running. ${open}, then start the agent again.${copy}`;
}
