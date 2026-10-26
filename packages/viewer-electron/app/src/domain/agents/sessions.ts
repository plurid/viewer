import { z } from 'zod';

const local = z
  .string()
  .max(32768)
  .refine((value) => value.startsWith('/') && !value.includes('\0'));
export const sessionLinkSchema = z
  .object({
    kind: z.enum(['file', 'git-diff']),
    path: local,
    line: z.number().int().min(1).max(10_000_000).optional(),
  })
  .strict();
export const sessionEntrySchema = z
  .object({
    id: z.string().min(1).max(128),
    role: z.enum(['user', 'assistant', 'tool']),
    text: z.string().max(8000),
    links: z.array(sessionLinkSchema).max(16).optional(),
  })
  .strict();
export const sessionReportSchema = z
  .object({
    sessionID: z.string().min(1).max(128),
    directory: local,
    title: z.string().trim().min(1).max(200),
    sequence: z.number().int().positive(),
    status: z.enum(['working', 'waiting', 'done', 'failed']),
    entries: z.array(sessionEntrySchema).max(8).default([]),
  })
  .strict()
  .refine((value) => JSON.stringify(value).length <= 48000, 'Report at most 48 KB at a time.');
export type SessionReport = z.infer<typeof sessionReportSchema>;
export const agentSessionSchema = z
  .object({
    id: z.uuid(),
    clientID: z.string().max(200),
    clientName: z.string().max(200),
    externalID: z.string().max(128),
    directory: local,
    identity: z.string().max(100),
    title: z.string().max(200),
    sequence: z.number().int().positive(),
    status: z.enum(['working', 'waiting', 'done', 'failed']),
    updated: z.number().finite(),
    reportHash: z.string().length(64),
    entries: z.array(sessionEntrySchema).max(500),
  })
  .strict();
export type AgentSession = z.infer<typeof agentSessionSchema>;
export type AgentSessionSummary = Omit<
  AgentSession,
  'entries' | 'reportHash' | 'identity' | 'externalID'
>;
export type SessionRequest = { kind: 'list'; directory?: string } | { kind: 'read'; id: string };
export type SessionReply =
  { kind: 'list'; sessions: AgentSessionSummary[] } | { kind: 'session'; session: AgentSession };
export const sessionSummary = ({
  entries: _entries,
  reportHash: _hash,
  identity: _identity,
  externalID: _external,
  ...summary
}: AgentSession): AgentSessionSummary => summary;
