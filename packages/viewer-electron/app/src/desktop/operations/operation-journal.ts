import path from 'node:path';
import { imageConversions } from '../../domain/contracts';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, readlink, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { optimizationOutcomeSchema } from '../../domain/operations/optimization-target';
import { transformPlanSchema } from '../../domain/operations/transforms';
import { DocumentStore } from '../persistence/document-store';
import { discardOwnTemporaryFile, removePrivateData } from './removal';
import { sourceVersionSchema } from '../../domain/files/inspection';
import { jobStatuses } from '../../domain/operations/jobs';

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
  'mkfile',
  'trash',
  'compress',
  'extract',
  'convert',
  'rewrite',
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
    status: z.enum(jobStatuses),
    sources: z.array(file).max(10000),
    destination: file.optional(),
    current: file.optional(),
    bytesDone: count,
    progress: z.number().finite().min(0).max(1).optional(),
    detail: z.string().max(500).optional(),
    bytesTotal: count,
    itemsDone: count,
    itemsTotal: count,
    completed: z
      .array(
        z
          .object({
            source: z.string().max(32768),
            destination: file.optional(),
            inputBytes: count.optional(),
            outputBytes: count.optional(),
            optimized: z.boolean().optional(),
            targetSize: optimizationOutcomeSchema.optional(),
          })
          .strict(),
      )
      .max(10000),
    errors: z
      .array(z.object({ path: z.string().max(32768), message: z.string().max(4000) }).strict())
      .max(10000),
    errorCount: count,
    collision: z
      .object({ source: file, destination: file, replaceable: z.boolean().optional() })
      .optional(),
    undoable: z.boolean(),
    redoable: z.boolean().optional(),
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
const intent = z
  .object({
    source: z.string().max(32768),
    destination: file.optional(),
    staging: file.optional(),
  })
  .strict();
const completedItem = job.shape.completed.element;
const errorItem = job.shape.errors.element;
const record = z
  .object({
    job,
    request: z
      .object({
        kind,
        sources: z.array(file).max(10000),
        destination: file.optional(),
        name: z.string().max(255).optional(),
        conversion: z.enum(imageConversions).optional(),
        transform: transformPlanSchema.optional(),
        reviewedDestination: z
          .object({ path: file, identity: z.string().max(300) })
          .strict()
          .optional(),
        preparedTransforms: z
          .array(z.object({ path: file, id: z.string().uuid() }).strict())
          .max(1000)
          .optional(),
        expectedSources: z
          .array(z.object({ path: file, version: sourceVersionSchema }).strict())
          .max(10000)
          .optional(),
        expectedContents: z
          .array(z.object({ path: file, proof: z.string().length(64) }).strict())
          .max(10000)
          .optional(),
        textSHA256: z
          .string()
          .regex(/^[0-9a-f]{64}$/)
          .optional(),
        textBytes: count.optional(),
      })
      .strict(),
    // Replace adds a Trash step beside each item's own step.
    undo: z.array(undoStepSchema).max(30000),
    intent: intent.optional(),
  })
  .strict();
const document = z.object({ version: z.literal(1), records: z.array(record).max(100) }).strict();
export type OperationReceipt = z.infer<typeof record>;
export const operationJournal = (dataPath: string) =>
  new DocumentStore(path.join(dataPath, 'operation-journal-v1.json'), (value) =>
    document.parse(value),
  );

/** The most items an output may hold for Undo to remove it. */
export const outputProofLimit = 10000;
/** Compare the entire owned output before an Undo that removes it. Large trees
 * remain valid outputs but are ineligible for automatic removal by Undo. */
export async function outputProof(root: string): Promise<string | undefined> {
  const hash = createHash('sha256');
  const queue = [''];
  let count = 0;
  while (queue.length) {
    if (++count > outputProofLimit) return undefined;
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

/** One append-only line in a job's log. Replaying them rebuilds the receipt. */
const event = z.discriminatedUnion('t', [
  z.object({ t: z.literal('start'), sequence: count, receipt: record }).strict(),
  // Sources and destination never change after the start line, so updates omit them.
  z
    .object({
      t: z.literal('job'),
      job: job.omit({ completed: true, errors: true, sources: true, destination: true }),
    })
    .strict(),
  z.object({ t: z.literal('completed'), items: z.array(completedItem).max(10000) }).strict(),
  z.object({ t: z.literal('errors'), items: z.array(errorItem).max(10000) }).strict(),
  z.object({ t: z.literal('undo'), steps: z.array(undoStepSchema).max(30000) }).strict(),
  z.object({ t: z.literal('undo-set'), undo: z.array(undoStepSchema).max(30000) }).strict(),
  z.object({ t: z.literal('intent'), intent: intent.nullable() }).strict(),
]);
type LogEvent = z.infer<typeof event>;
interface Written {
  file: string;
  sequence: number;
  completed: number;
  errors: number;
  undo: number;
  lastUndo?: object;
  meta: string;
  intent: string;
}
const metaOf = (receipt: OperationReceipt) => {
  const {
    completed: _completed,
    errors: _errors,
    sources: _sources,
    destination: _destination,
    ...meta
  } = receipt.job;
  return meta;
};
async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await open(directory, constants.O_RDONLY | (constants.O_DIRECTORY || 0));
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Durable operation receipts as one append-only log per job. Each checkpoint
 * appends only what changed and is synced, so a long job costs linear rather than
 * quadratic writes; a finished job is compacted to a single line. A torn final
 * line (a crash during its write) is ignored because nothing acted on it; any
 * other unreadable log is renamed aside, never deleted or replayed.
 */
export class OperationLog {
  readonly directory: string;
  private written = new Map<string, Written>();
  private writes: Promise<void> = Promise.resolve();
  private sequence = Date.now() * 1000;
  constructor(private dataPath: string) {
    this.directory = path.join(dataPath, 'operation-journal-v2');
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const task = this.writes.catch(() => {}).then(work);
    this.writes = task.then(
      () => {},
      () => {},
    );
    return task;
  }
  flush(): Promise<void> {
    return this.writes;
  }
  /** Reads every job log, migrating a version 1 journal first. */
  load(): Promise<{ receipts: OperationReceipt[]; notices: string[] }> {
    return this.serial(async () => {
      const notices: string[] = [];
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await this.migrate(notices);
      const loaded: { sequence: number; receipt: OperationReceipt }[] = [];
      for (const name of await readdir(this.directory)) {
        if (!name.endsWith('.jsonl')) continue;
        const file = path.join(this.directory, name);
        const entry = await this.read(file).catch(async (error: Error) => {
          const kept = `${file}.unreadable-${Date.now()}`;
          await rename(file, kept);
          notices.push(
            `A file operation record could not be read, so its Undo is unavailable. It was kept at ${kept}. (${error.message})`,
          );
          return undefined;
        });
        if (entry) loaded.push(entry);
      }
      loaded.sort((a, b) => a.sequence - b.sequence);
      return { receipts: loaded.map((entry) => entry.receipt), notices };
    });
  }
  private async read(file: string): Promise<{ sequence: number; receipt: OperationReceipt }> {
    const info = await lstat(file);
    if (!info.isFile() || info.size > 256 * 1024 * 1024)
      throw new Error('The record is not a regular file or exceeds its size limit.');
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    let text: string;
    try {
      text = await handle.readFile('utf8');
    } finally {
      await handle.close();
    }
    const lines = text.split('\n');
    // Only an unterminated final line can be a torn write.
    const complete = lines.slice(0, -1);
    let start: Extract<LogEvent, { t: 'start' }> | undefined;
    let receipt: OperationReceipt | undefined;
    for (const line of complete) {
      if (!line) continue;
      const value = event.parse(JSON.parse(line));
      if (value.t === 'start') {
        start = value;
        receipt = structuredClone(value.receipt);
        continue;
      }
      if (!receipt) throw new Error('The record does not begin with its job.');
      // A status line is complete: cleared optional fields must not linger.
      if (value.t === 'job')
        receipt.job = {
          ...value.job,
          sources: receipt.job.sources,
          ...(receipt.job.destination ? { destination: receipt.job.destination } : {}),
          completed: receipt.job.completed,
          errors: receipt.job.errors,
        };
      else if (value.t === 'completed') receipt.job.completed.push(...value.items);
      else if (value.t === 'errors') receipt.job.errors.push(...value.items);
      else if (value.t === 'undo') receipt.undo.push(...value.steps);
      else if (value.t === 'undo-set') receipt.undo = value.undo;
      else receipt.intent = value.intent ?? undefined;
    }
    if (!start || !receipt) throw new Error('The record is empty.');
    const parsed = record.parse(receipt);
    // A torn final line is skipped above, but the next append would follow its bytes and turn
    // them into a complete, unreadable line. The record is rewritten whole first; if that fails,
    // it still loads now.
    if (lines.at(-1)) await this.rewrite(file, start.sequence, parsed).catch(() => {});
    this.written.set(parsed.job.id, {
      file,
      sequence: start.sequence,
      ...this.counts(parsed),
    });
    return { sequence: start.sequence, receipt: parsed };
  }
  private counts(receipt: OperationReceipt) {
    return {
      completed: receipt.job.completed.length,
      errors: receipt.job.errors.length,
      undo: receipt.undo.length,
      lastUndo: receipt.undo.at(-1),
      meta: JSON.stringify(metaOf(receipt)),
      intent: JSON.stringify(receipt.intent ?? null),
    };
  }
  /** Version 1 kept every receipt in one document; it is converted once and kept. */
  private async migrate(notices: string[]): Promise<void> {
    const previous = operationJournal(this.dataPath);
    let document;
    try {
      document = await previous.load();
    } catch (error) {
      if (!(error instanceof SyntaxError || error instanceof z.ZodError)) throw error;
      const kept = `${previous.file}.unreadable-${Date.now()}`;
      await rename(previous.file, kept);
      notices.push(
        `Recent file operation history could not be read, so earlier Undo is unavailable. It was kept at ${kept}.`,
      );
      return;
    }
    if (!document) return;
    for (const [index, receipt] of document.records.entries()) {
      const file = this.fileFor(receipt.job.id);
      // An earlier, interrupted migration may already have written this job.
      if (
        await lstat(file).then(
          () => true,
          () => false,
        )
      )
        continue;
      await this.writeCompact(file, index, receipt, 'wx');
    }
    await rename(previous.file, `${previous.file}.migrated-${Date.now()}`);
  }
  private fileFor(id: string): string {
    return path.join(this.directory, `${id}.jsonl`);
  }
  /** Appends what changed since the job's last record, then syncs it. */
  /**
   * Appends what changed. `durable` syncs it, as an intent must be before the change it covers;
   * a record of what is already done may wait for the next sync, which carries it too.
   */
  record(receipt: OperationReceipt, durable = true): Promise<void> {
    return this.serial(async () => {
      const written = this.written.get(receipt.job.id);
      if (!written) {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const file = this.fileFor(receipt.job.id),
          sequence = this.sequence++;
        await this.writeCompact(file, sequence, receipt, 'wx');
        this.written.set(receipt.job.id, { file, sequence, ...this.counts(receipt) });
        return;
      }
      const events: LogEvent[] = [];
      const meta = JSON.stringify(metaOf(receipt));
      if (meta !== written.meta) events.push({ t: 'job', job: metaOf(receipt) });
      if (receipt.job.completed.length > written.completed)
        events.push({ t: 'completed', items: receipt.job.completed.slice(written.completed) });
      if (receipt.job.errors.length > written.errors)
        events.push({ t: 'errors', items: receipt.job.errors.slice(written.errors) });
      const undoKept =
        receipt.undo.length >= written.undo &&
        (written.undo === 0 || receipt.undo[written.undo - 1] === written.lastUndo);
      if (!undoKept) events.push({ t: 'undo-set', undo: receipt.undo });
      else if (receipt.undo.length > written.undo)
        events.push({ t: 'undo', steps: receipt.undo.slice(written.undo) });
      const intentText = JSON.stringify(receipt.intent ?? null);
      if (intentText !== written.intent)
        events.push({ t: 'intent', intent: receipt.intent ?? null });
      if (!events.length) return;
      const text = events.map((item) => JSON.stringify(event.parse(item))).join('\n') + '\n';
      await this.append(written.file, text, durable);
      Object.assign(written, this.counts(receipt));
    });
  }
  /** Rewrites a finished job's log as one line, atomically. */
  compact(receipt: OperationReceipt): Promise<void> {
    return this.serial(async () => {
      const written = this.written.get(receipt.job.id);
      if (!written) return;
      await this.rewrite(written.file, written.sequence, receipt);
      Object.assign(written, this.counts(receipt));
    });
  }
  /** Replaces a log with one complete line, atomically. */
  private async rewrite(file: string, sequence: number, receipt: OperationReceipt): Promise<void> {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await this.writeCompact(temporary, sequence, receipt, 'wx');
      await rename(temporary, file);
      await syncDirectory(this.directory);
    } finally {
      await discardOwnTemporaryFile(temporary);
    }
  }
  /** Drops a job that left the bounded history; logs are private application data. */
  forget(id: string): Promise<void> {
    return this.serial(async () => {
      const written = this.written.get(id);
      if (!written) return;
      await removePrivateData(this.directory, written.file);
      this.written.delete(id);
    });
  }
  /** The one place log bytes reach disk; tests replace it to simulate failures. */
  protected async append(file: string, text: string, durable = true): Promise<void> {
    const handle = await open(file, 'a', 0o600);
    try {
      await handle.writeFile(text);
      if (durable) await handle.sync();
    } finally {
      await handle.close();
    }
  }
  private async writeCompact(
    file: string,
    sequence: number,
    receipt: OperationReceipt,
    flag: 'wx',
  ): Promise<void> {
    const text = JSON.stringify(event.parse({ t: 'start', sequence, receipt })) + '\n';
    const handle = await open(file, flag, 0o600);
    try {
      await handle.writeFile(text);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncDirectory(this.directory);
  }
}
