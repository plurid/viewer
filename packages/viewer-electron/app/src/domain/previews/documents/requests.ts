import { z } from 'zod';
import { worksheetDocumentRequestSchema } from './office';
import { mailboxLimits, mailboxMessageRequestSchema } from '../mail/mailbox';

/** A cancellable whole-document read (such as Word Reading view or email). */
export const documentReadRequestSchema = z
  .object({
    requestID: z.string().min(1).max(200),
  })
  .strict();

/** What one document read asks for: a page of a worksheet, a message of a mailbox, or a cancellable read. */
export const documentRequestSchema = z.union([
  mailboxMessageRequestSchema,
  worksheetDocumentRequestSchema,
  documentReadRequestSchema,
]);
export type DocumentRequest = z.input<typeof documentRequestSchema>;
/** A mailbox message by its place in the mailbox's list. */
export const mailboxMessageSchema = z
  .number()
  .int()
  .min(0)
  .max(mailboxLimits.messages - 1);
