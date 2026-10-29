import { z } from 'zod';
import { sessionLinkSchema } from '../agents/sessions';

export const chatDraftLimit = 16_000;

export const chatScopeSchema = z
  .object({
    path: z.string().min(1).max(32768),
    directory: z.boolean(),
    alias: z.string().min(1).max(32768).optional(),
  })
  .strict();

export const chatMessageSchema = z
  .object({
    id: z.uuid(),
    role: z.enum(['user', 'assistant', 'tool']),
    text: z.string().max(131072),
    at: z.number().finite(),
    links: z.array(sessionLinkSchema).max(16).optional(),
    /** Captured when generated; later provider edits cannot rewrite attribution. */
    provider: z
      .object({
        id: z.string().max(200),
        name: z.string().max(200),
        model: z.string().max(1000),
      })
      .strict()
      .optional(),
    proposal: z
      .object({
        kind: z.enum(['agent', 'operation']),
        id: z.uuid(),
        title: z.string().max(200),
      })
      .strict()
      .optional(),
  })
  .strict();

const chatDocumentFields = {
  id: z.uuid(),
  title: z.string().max(200),
  path: z.string().min(1).max(32768),
  providerID: z.string().max(200),
  scopes: z.array(chatScopeSchema).max(100),
  draft: z.string().max(chatDraftLimit),
  draftRevision: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  updated: z.number().finite(),
  status: z.enum(['idle', 'running', 'stopped', 'failed']),
  level: z.enum(['names', 'excerpts']),
  error: z.string().max(2000).optional(),
} as const;

const withinDocumentBudget = (document: unknown) =>
  new TextEncoder().encode(JSON.stringify(document)).length <= 4 * 1024 * 1024;
const documentLimitMessage =
  'This conversation reached its 4 MiB limit. Export it and start a new conversation.';

export const legacyChatDocumentSchema = z
  .object({
    ...chatDocumentFields,
    version: z.literal(1),
    messages: z.array(chatMessageSchema.omit({ provider: true })).max(1000),
  })
  .strict()
  .refine(withinDocumentBudget, { message: documentLimitMessage });

export const chatDocumentSchema = z
  .object({
    ...chatDocumentFields,
    version: z.literal(3),
    messages: z.array(chatMessageSchema).max(1000),
  })
  .strict()
  .refine(withinDocumentBudget, { message: documentLimitMessage });

const chatV2Schema = z
  .object({
    ...chatDocumentFields,
    version: z.literal(2),
    messages: z.array(chatMessageSchema.omit({ links: true })).max(1000),
  })
  .strict()
  .refine(withinDocumentBudget, { message: documentLimitMessage });
export const storedChatDocumentSchema = z.union([
  legacyChatDocumentSchema,
  chatV2Schema,
  chatDocumentSchema,
]);

export type ChatDocument = z.infer<typeof chatDocumentSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatLink = NonNullable<ChatMessage['links']>[number];
export type ChatSummary = Pick<ChatDocument, 'id' | 'title' | 'path' | 'updated'> & {
  problem?: string;
};

const patch = z
  .object({
    path: z.string().min(1).max(200),
    value: z.union([z.string().max(1000), z.number().finite(), z.boolean()]),
  })
  .strict();

/** The same structured turn protocol works with every existing provider adapter. */
export const chatStepSchema = z
  .object({
    kind: z.enum(['reply', 'list', 'search', 'metadata', 'read', 'command', 'settings', 'rename']),
    text: z.string().max(32000),
    path: z.string().max(32768).nullable(),
    query: z.string().max(300).nullable(),
    commandID: z.string().max(200).nullable(),
    patches: z.array(patch).max(20),
    renames: z
      .array(
        z.object({ path: z.string().min(1).max(32768), name: z.string().min(1).max(255) }).strict(),
      )
      .max(100),
    /** With a reply: inspected files worth opening, shown as links under it. */
    files: z.array(z.string().max(32768)).max(12),
  })
  .strict();

export type ChatStep = z.infer<typeof chatStepSchema>;

export const chatRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('list') }).strict(),
  z
    .object({ kind: z.literal('create'), paths: z.array(z.string().min(1).max(32768)).max(100) })
    .strict(),
  z.object({ kind: z.literal('open'), id: z.uuid() }).strict(),
  z
    .object({
      kind: z.literal('attach'),
      id: z.uuid(),
      paths: z.array(z.string().min(1).max(32768)).max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal('draft'),
      id: z.uuid(),
      text: z.string().max(chatDraftLimit),
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('send'),
      id: z.uuid(),
      text: z.string().trim().min(1).max(chatDraftLimit),
      providerID: z.string().max(200),
    })
    .strict(),
  z.object({ kind: z.literal('stop'), id: z.uuid() }).strict(),
]);

export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type ChatReply = ChatDocument | ChatSummary[];
