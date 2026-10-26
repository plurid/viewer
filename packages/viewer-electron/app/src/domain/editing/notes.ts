import { z } from 'zod';
import { MAX_TEXT_BYTES } from './documents';

export const noteKindSchema = z.enum(['note', 'checklist']);
export type NoteKind = z.infer<typeof noteKindSchema>;
export const noteTextSchema = z
  .string()
  .refine(
    (value) => new TextEncoder().encode(value).length <= MAX_TEXT_BYTES,
    'Notes support up to 4 MiB of text.',
  );
export const noteSchema = z
  .object({
    id: z.uuid(),
    kind: noteKindSchema,
    title: z.string().trim().min(1).max(255),
    directory: z.string().min(1).max(32768),
    text: noteTextSchema,
    revision: z.number().int().nonnegative(),
    updated: z.number().finite(),
    recoveredFrom: z.uuid().optional(),
  })
  .strict();
export type NoteDocument = z.infer<typeof noteSchema>;
export type NoteSummary = Omit<NoteDocument, 'text'>;
export const noteRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('list') }).strict(),
  z.object({ kind: z.literal('read'), id: z.uuid() }).strict(),
  z
    .object({ kind: z.literal('trash'), id: z.uuid(), revision: z.number().int().nonnegative() })
    .strict(),
  z
    .object({
      kind: z.literal('create'),
      format: noteKindSchema,
      directory: z.string().min(1).max(32768),
    })
    .strict(),
  z
    .object({
      kind: z.literal('write'),
      id: z.uuid(),
      revision: z.number().int().nonnegative(),
      title: z.string().trim().min(1).max(255),
      text: noteTextSchema,
    })
    .strict(),
]);
export type NoteRequest = z.infer<typeof noteRequestSchema>;
export type NoteReply =
  | { kind: 'list'; notes: NoteSummary[]; problems: string[] }
  | { kind: 'trashed'; id: string }
  | { kind: 'document'; document: NoteDocument };

/** Checklist editing changes Markdown source lines, preserving all surrounding prose. */
export function checklistItems(text: string): { line: number; checked: boolean; text: string }[] {
  return text.split('\n').flatMap((line, index) => {
    const match = /^\s*[-*+] \[([ xX])\] (.*)$/.exec(line);
    return match
      ? [{ line: index, checked: match[1]!.toLowerCase() === 'x', text: match[2]! }]
      : [];
  });
}
export function editChecklist(
  text: string,
  line: number,
  update: { checked?: boolean; text?: string },
): string {
  const lines = text.split('\n');
  const match = /^(\s*[-*+] \[)([ xX])(\] )(.*)$/.exec(lines[line] ?? '');
  if (!match) throw new Error('This checklist item changed. Try again.');
  lines[line] =
    `${match[1]}${update.checked === undefined ? match[2] : update.checked ? 'x' : ' '}${match[3]}${update.text ?? match[4]}`;
  return lines.join('\n');
}
export function reorderChecklist(text: string, from: number, to: number): string {
  const lines = text.split('\n');
  if (
    !checklistItems(text).some((item) => item.line === from) ||
    !checklistItems(text).some((item) => item.line === to)
  )
    return text;
  const first = lines[from]!,
    second = lines[to]!;
  lines[from] = second;
  lines[to] = first;
  return lines.join('\n');
}
export function removeChecklistItem(text: string, line: number): string {
  if (!checklistItems(text).some((item) => item.line === line))
    throw new Error('This checklist item changed. Try again.');
  return text
    .split('\n')
    .filter((_, index) => index !== line)
    .join('\n');
}
