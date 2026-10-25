import { z } from 'zod';

export const journalSources = ['files', 'git', 'chat', 'workspace', 'server'] as const;
export const journalLevels = ['info', 'warning', 'error'] as const;
export const journalPhases = ['started', 'waiting', 'succeeded', 'cancelled', 'failed'] as const;

/** Closed vocabulary: credentials, arguments, paths and provider responses have no field here. */
export const journalActions = [
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
  'status',
  'log',
  'stage-selected',
  'stage-all',
  'commit',
  'pull',
  'push',
  'send',
  'save',
  'start',
  'stop',
  'restart',
  'close',
] as const;

const identifier = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_:@.-]+$/);
export const journalOriginSchema = z
  .object({
    windowID: identifier.optional(),
    workspaceID: identifier.optional(),
    planeID: identifier.optional(),
  })
  .strict();

export const journalRecordSchema = z
  .object({
    version: z.literal(1),
    id: z.uuid(),
    sessionID: z.uuid(),
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    at: z.number().finite().nonnegative(),
    producer: z.literal('desktop'),
    source: z.enum(journalSources),
    action: z.enum(journalActions),
    phase: z.enum(journalPhases),
    level: z.enum(journalLevels),
    origin: journalOriginSchema,
    traceID: z.uuid(),
    taskID: identifier.optional(),
    durationMs: z.number().finite().nonnegative().optional(),
    count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    exitCode: z.number().int().min(-2147483648).max(2147483647).optional(),
  })
  .strict();

export const journalFilterSchema = z
  .object({
    source: z.enum(journalSources).optional(),
    level: z.enum(journalLevels).optional(),
    phase: z.enum(journalPhases).optional(),
    workspaceID: identifier.optional(),
    planeID: identifier.optional(),
    traceID: z.uuid().optional(),
    since: z.number().finite().nonnegative().optional(),
    until: z.number().finite().nonnegative().optional(),
    search: z.string().trim().max(200).optional(),
  })
  .strict()
  .refine(
    (value) => value.since === undefined || value.until === undefined || value.since <= value.until,
    'The end of the time range must follow its start.',
  );

export const journalQuerySchema = z
  .object({
    filter: journalFilterSchema,
    through: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    before: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    limit: z.number().int().min(1).max(500).default(200),
  })
  .strict();

export type JournalRecord = z.infer<typeof journalRecordSchema>;
export type JournalOrigin = z.infer<typeof journalOriginSchema>;
export type JournalFilter = z.infer<typeof journalFilterSchema>;
export type JournalQuery = z.input<typeof journalQuerySchema>;
export type JournalSource = JournalRecord['source'];
export type JournalAction = JournalRecord['action'];
export type JournalPhase = JournalRecord['phase'];

export interface JournalStatus {
  generation: string;
  latest: number;
  stored: number;
  bytes: number;
  byteLimit: number;
  recordLimit: number;
  dropped: number;
  state: 'ready' | 'full' | 'unavailable' | 'clearing';
}

export interface JournalPage {
  records: JournalRecord[];
  through: number;
  nextBefore?: number;
  matched: number;
  status: JournalStatus;
}

export interface JournalExportPreview {
  id: string;
  count: number;
  bytes: number;
  text: string;
  truncated: boolean;
}

const actionLabels: Record<JournalAction, string> = {
  copy: 'Copy',
  move: 'Move',
  transfer: 'Transfer',
  duplicate: 'Duplicate',
  alias: 'Create alias',
  rename: 'Rename',
  mkdir: 'Create folder',
  mkfile: 'Create file',
  trash: 'Move to Trash',
  compress: 'Compress',
  extract: 'Extract',
  convert: 'Convert',
  rewrite: 'Save file',
  status: 'Status',
  log: 'History',
  'stage-selected': 'Stage selected',
  'stage-all': 'Stage all',
  commit: 'Commit',
  pull: 'Pull',
  push: 'Push',
  send: 'Model request',
  save: 'Save workspace',
  start: 'Start server',
  stop: 'Stop server',
  restart: 'Restart server',
  close: 'Close server',
};
const phaseLabels: Record<JournalPhase, string> = {
  started: 'started',
  waiting: 'waiting for a decision',
  succeeded: 'completed',
  cancelled: 'cancelled',
  failed: 'failed',
};

export function journalSummary(record: Pick<JournalRecord, 'action' | 'phase'>): string {
  return `${actionLabels[record.action]} ${phaseLabels[record.phase]}`;
}

export function matchesJournal(record: JournalRecord, filter: JournalFilter): boolean {
  if (filter.source && record.source !== filter.source) return false;
  if (filter.level && record.level !== filter.level) return false;
  if (filter.phase && record.phase !== filter.phase) return false;
  if (filter.workspaceID && record.origin.workspaceID !== filter.workspaceID) return false;
  if (filter.planeID && record.origin.planeID !== filter.planeID) return false;
  if (filter.traceID && record.traceID !== filter.traceID) return false;
  if (filter.since !== undefined && record.at < filter.since) return false;
  if (filter.until !== undefined && record.at > filter.until) return false;
  const search = filter.search?.toLocaleLowerCase();
  return (
    !search ||
    [
      journalSummary(record),
      record.source,
      record.id,
      record.traceID,
      record.taskID ?? '',
      ...Object.values(record.origin),
    ].some((value) => value.toLocaleLowerCase().includes(search))
  );
}
