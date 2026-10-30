/** Email files: a message, Apple Mail's message, and a mailbox of messages. */
export const mailFormats: readonly string[] = ['eml', 'emlx', 'mbox'];
/** The messages a mailbox lists and the attachments a message lists. A saved attachment is named
 * by its place in these lists, so the plan that saves one is checked without the readers. */
export const mailListLimits = { messages: 10_000, attachments: 500 } as const;
