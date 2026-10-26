import { z } from 'zod';
export const receiptSchema = z
  .object({
    id: z.uuid(),
    title: z.string().max(100),
    command: z.string().min(1).max(16000),
    directory: z.string().min(1).max(32768),
    folderIdentity: z.string().max(100).optional(),
    started: z.number().finite(),
    ended: z.number().finite().optional(),
    status: z.enum(['running', 'completed', 'failed', 'cancelled', 'interrupted']),
    output: z.string().max(300000),
    truncated: z.boolean().optional(),
    exitCode: z.number().int().optional(),
    error: z.string().max(16000).optional(),
    workspaceID: z.string().min(1).max(200),
    paneID: z.string().min(1).max(200),
  })
  .strict();
export type CommandReceipt = z.infer<typeof receiptSchema>;
export function receiptMarkdown(receipt: CommandReceipt): string {
  const code = (value: string, language = '') => {
    let length = 3;
    for (const match of value.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
    const fence = '`'.repeat(length);
    return `${fence}${language}\n${value}\n${fence}`;
  };
  return `# Command receipt\n\n${receipt.status}${receipt.exitCode !== undefined ? ' · exit ' + receipt.exitCode : ''}\n\nStarted: ${new Date(receipt.started).toISOString()}\n${receipt.ended !== undefined ? 'Ended: ' + new Date(receipt.ended).toISOString() + '\n' : ''}\n## Folder\n\n${code(receipt.directory)}\n\n## Command\n\n${code(receipt.command, 'sh')}\n\n## Output${receipt.truncated ? ' (last 256 KiB)' : ''}\n\n${code(receipt.output)}\n`;
}
export type ReceiptSummary = Omit<CommandReceipt, 'command' | 'output'>;
export const receiptRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('read'), id: z.uuid() }).strict(),
  z.object({ kind: z.literal('summary'), id: z.uuid() }).strict(),
  z.object({ kind: z.literal('list') }).strict(),
]);
export type ReceiptRequest = z.infer<typeof receiptRequestSchema>;
export type ReceiptReply =
  | { kind: 'receipt'; receipt: CommandReceipt }
  | { kind: 'summary'; receipt: ReceiptSummary }
  | { kind: 'list'; receipts: ReceiptSummary[]; problems: string[] };
