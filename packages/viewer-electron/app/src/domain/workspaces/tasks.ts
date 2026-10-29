import { z } from 'zod';
import type { Pane } from '../contracts';
import { diffSourceSchema } from '../comparison/diff';
import { commitPattern } from '../comparison/git';
const local = z
  .string()
  .min(1)
  .max(32768)
  .refine((value) => !value.includes('\0') && (/^\//.test(value) || /^[A-Za-z]:[\\/]/.test(value)));
const web = z
  .string()
  .max(8192)
  .url()
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol));
export const taskReferenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('folder'), path: local }).strict(),
  z.object({ kind: z.literal('preview'), path: local }).strict(),
  z.object({ kind: z.literal('note'), documentID: z.uuid(), path: local }).strict(),
  z
    .object({
      kind: z.literal('chat'),
      conversationID: z.uuid(),
      externalSessionID: z.uuid().optional(),
      path: local,
    })
    .strict(),
  z
    .object({
      kind: z.literal('terminal'),
      profileID: z.string().min(1).max(200),
      sessionID: z.string().min(1).max(200),
      path: local,
    })
    .strict(),
  z.object({ kind: z.literal('git-changes'), path: local }).strict(),
  z
    .object({
      kind: z.literal('diff'),
      path: local,
      left: diffSourceSchema,
      right: diffSourceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('browser'),
      path: local,
      url: web,
      serverRuntimeID: z.string().min(1).max(200).optional(),
      serverPath: z.string().max(8192).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('server'),
      path: local,
      runtimeID: z.string().min(1).max(200).optional(),
    })
    .strict(),
  z.object({ kind: z.literal('receipt'), path: local, receiptID: z.uuid() }).strict(),
]);
export type TaskReference = z.infer<typeof taskReferenceSchema>;
export const taskAreaSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(100),
    checkout: z
      .object({
        path: local,
        branch: z.string().max(1024).optional(),
        commit: z.string().regex(commitPattern).optional(),
        observed: z.number().finite(),
        identity: z.string().max(100).optional(),
      })
      .strict(),
    members: z
      .array(
        z
          .object({
            id: z.uuid(),
            title: z.string().max(255),
            reference: taskReferenceSchema,
            views: z.array(z.string().min(1).max(200)).max(16),
          })
          .strict(),
      )
      .max(100),
    created: z.number().finite(),
    updated: z.number().finite(),
  })
  .strict();
export type TaskArea = z.infer<typeof taskAreaSchema>;
export type TaskMember = TaskArea['members'][number];

export function taskReference(pane: Pane): TaskReference | undefined {
  switch (pane.type) {
    case 'folder':
    case 'preview':
    case 'git-changes':
      return { kind: pane.type, path: pane.path };
    case 'note':
      return { kind: 'note', documentID: pane.documentID, path: pane.path };
    case 'chat':
      return {
        kind: 'chat',
        conversationID: pane.conversationID,
        externalSessionID: pane.externalSessionID,
        path: pane.path,
      };
    case 'terminal':
      return pane.gitAction
        ? undefined
        : {
            kind: 'terminal',
            profileID: pane.profileID,
            sessionID: pane.taskSessionID ?? pane.id,
            path: pane.path,
          };
    case 'diff':
      return { kind: 'diff', path: pane.path, left: pane.left, right: pane.right };
    case 'browser':
      return {
        kind: 'browser',
        path: pane.path,
        url: pane.url,
        serverRuntimeID: pane.serverRuntimeID,
        serverPath: pane.serverPath,
      };
    case 'server':
      return { kind: 'server', path: pane.path, runtimeID: pane.runtimeID ?? pane.id };
    case 'receipt':
      return { kind: 'receipt', path: pane.path, receiptID: pane.receiptID };
    default:
      return undefined;
  }
}
export const taskReferenceKey = (reference: TaskReference) => {
  if (reference.kind === 'server')
    return JSON.stringify(['server', reference.runtimeID ?? reference.path]);
  if (reference.kind === 'note') return 'note:' + reference.documentID;
  if (reference.kind === 'chat')
    return reference.externalSessionID
      ? 'agent:' + reference.externalSessionID
      : 'chat:' + reference.conversationID;
  if (reference.kind === 'receipt') return 'receipt:' + reference.receiptID;
  if (reference.kind === 'browser' && reference.serverRuntimeID)
    return JSON.stringify([
      'server-browser',
      reference.serverRuntimeID,
      reference.serverPath ?? '/',
    ]);
  const ordered = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(ordered)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([, item]) => item !== undefined)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([key, item]) => [key, ordered(item)]),
          )
        : value;
  return JSON.stringify(ordered(reference));
};
export function taskPaneTitle(pane: Pane): string {
  if (pane.type === 'note' || pane.type === 'scratch' || pane.type === 'task')
    return pane.title ?? 'Untitled';
  if (pane.type === 'receipt') return 'Command receipt';
  if (pane.type === 'browser') return pane.title ?? pane.url;
  const labels: Partial<Record<Pane['type'], string>> = {
    terminal: 'Terminal',
    chat: 'Conversation',
    'git-changes': 'Git changes',
    diff: 'Diff',
    server: 'Local server',
  };
  return labels[pane.type] ?? pane.path.split(/[\\/]/).at(-1) ?? pane.path;
}
export function attachTaskMember(
  area: TaskArea,
  reference: TaskReference,
  title: string,
  paneID?: string,
): TaskArea {
  const key = taskReferenceKey(reference),
    existing = area.members.find((member) => taskReferenceKey(member.reference) === key);
  if (!existing && area.members.length >= 100)
    throw new Error('A task area supports up to 100 linked tools.');
  const member: TaskMember = existing
    ? {
        ...existing,
        reference,
        title: title.slice(0, 255),
        views: paneID ? [...new Set([...existing.views, paneID])].slice(-16) : existing.views,
      }
    : {
        id: crypto.randomUUID(),
        title: title.slice(0, 255),
        reference,
        views: paneID ? [paneID] : [],
      };
  return {
    ...area,
    updated: Date.now(),
    members: existing
      ? area.members.map((value) => (value.id === existing.id ? member : value))
      : [...area.members, member],
  };
}
