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
