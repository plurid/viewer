import { z } from 'zod';
import { worksheetDocumentRequestSchema } from './office';
import { mailboxLimits, mailboxMessageRequestSchema } from '../mail/mailbox';

/** What one document read asks for: a page of a worksheet, or a message of a mailbox. */
export const documentRequestSchema = z.union([
  mailboxMessageRequestSchema,
  worksheetDocumentRequestSchema,
]);
export type DocumentRequest = z.input<typeof documentRequestSchema>;
/** A mailbox message by its place in the mailbox's list. */
export const mailboxMessageSchema = z
  .number()
  .int()
  .min(0)
  .max(mailboxLimits.messages - 1);
