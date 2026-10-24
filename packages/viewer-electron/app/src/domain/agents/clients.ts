import { z } from 'zod';
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
        maxReadBytes: z
          .number()
          .int()
          .min(1024)
          .max(64 * 1024 * 1024),
        maxTasks: z.number().int().min(1).max(20),
      })
      .strict()
      .default({ maxReadBytes: 4 * 1024 * 1024, maxTasks: 4 }),
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
  | { kind: 'revoke'; id: string; revision: number };
export type AgentClientReply =
  AgentClient[] | AgentClient | { client: AgentClient; token: string; configuration?: string };
export interface AgentAudit {
  id: string;
  at: number;
  clientID: string;
  tool: string;
  status: 'completed' | 'failed' | 'rejected' | 'cancelled';
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
