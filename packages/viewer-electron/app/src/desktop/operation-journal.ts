import path from 'node:path';
import { createHash } from 'node:crypto';
import { lstat, readdir, readlink } from 'node:fs/promises';
import { z } from 'zod';
import { DocumentStore } from './document-store';
import { sourceVersionSchema } from '../domain/inspection';

const file = z
  .string()
  .min(1)
  .max(32768)
  .refine((value) => path.isAbsolute(value) && !value.includes('\0'));
const kind = z.enum([
  'copy',
  'move',
  'transfer',
  'duplicate',
  'alias',
  'rename',
  'mkdir',
  'trash',
  'compress',
  'extract',
]);
const count = z.number().nonnegative().finite();
export const undoStepSchema = z
  .object({
    from: file,
    to: z.string().max(32768),
    identity: z.string().max(200),
    modified: count,
    size: count,
    caseOnly: z.boolean().optional(),
    remove: z.boolean().optional(),
    proof: z.string().length(64).optional(),
    trash: z.boolean().optional(),
    bookmark: z.string().min(1).max(65536).optional(),
    directory: z.boolean().optional(),
  })
  .strict();
const job = z
  .object({
    id: z.uuid(),
    revision: count,
    kind,
    status: z.enum(['queued', 'running', 'collision', 'completed', 'cancelled', 'failed']),
    sources: z.array(file).max(10000),
    destination: file.optional(),
    current: file.optional(),
    bytesDone: count,
    bytesTotal: count,
    itemsDone: count,
    itemsTotal: count,
    completed: z
      .array(z.object({ source: z.string().max(32768), destination: file.optional() }).strict())
      .max(10000),
    errors: z
      .array(z.object({ path: z.string().max(32768), message: z.string().max(4000) }).strict())
      .max(10000),
    errorCount: count,
    collision: z
      .object({ source: file, destination: file, replaceable: z.boolean().optional() })
      .optional(),
    undoable: z.boolean(),
    recovery: z
      .object({
        source: z.string().max(32768),
        destination: file.optional(),
        staging: file.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const record = z
  .object({
    job,
    request: z
      .object({
        kind,
        sources: z.array(file).max(10000),
        destination: file.optional(),
        name: z.string().max(255).optional(),
        expectedSources: z
          .array(z.object({ path: file, version: sourceVersionSchema }).strict())
          .max(10000)
          .optional(),
      })
      .strict(),
    undo: z.array(undoStepSchema).max(10000),
    intent: z
      .object({
        source: z.string().max(32768),
        destination: file.optional(),
        staging: file.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const document = z.object({ version: z.literal(1), records: z.array(record).max(100) }).strict();
export type OperationReceipt = z.infer<typeof record>;
export const operationJournal = (dataPath: string) =>
  new DocumentStore(path.join(dataPath, 'operation-journal-v1.json'), (value) =>
    document.parse(value),
  );

/** Compare the entire owned output before an Undo that removes it. Large trees
 * remain valid outputs but are ineligible for automatic removal by Undo. */
export async function outputProof(root: string): Promise<string | undefined> {
  const hash = createHash('sha256');
  const queue = [''];
  let count = 0;
  while (queue.length) {
    if (++count > 10000) return undefined;
    const relative = queue.pop()!;
    const file = path.join(root, relative);
    const info = await lstat(file);
    hash.update(
      JSON.stringify([
        relative,
        info.dev,
        info.ino,
        info.size,
        info.mtimeMs,
        info.ctimeMs,
        info.mode,
        info.isSymbolicLink() ? await readlink(file) : '',
      ]),
    );
    if (info.isDirectory())
      for (const name of (await readdir(file)).sort().reverse())
        queue.push(path.join(relative, name));
  }
  return hash.digest('hex');
}
