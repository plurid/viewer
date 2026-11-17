import type { OperationKind } from '../../domain/contracts';
import type { ExecutionCapability, ProposalStatus } from '../../domain/agents/requests';
import type { ChangePlanStatus } from '../../domain/operations/change-plan';
import type { JobStatus } from '../../domain/operations/jobs';
import type { IndexStatus } from '../../domain/services';
import type { AgentSession } from '../../domain/agents/sessions';

/** A lifecycle state Viewer shows: of a file operation, a reviewed plan, an agent's proposal, a
 * workflow, an index root or a running tool. */
export type ShownStatus =
  | JobStatus
  | ChangePlanStatus
  | ProposalStatus
  | IndexStatus['roots'][number]['status']
  | AgentSession['status']
  | 'paused'
  | 'pending'
  | 'waiting-review'
  | 'starting'
  | 'stopped';

// One word list for every screen, so a state reads the same in Tasks, Operations and Settings and
// no screen prints the stored value. US spelling, as macOS: Canceled.
const statusLabels: Readonly<Record<ShownStatus, string>> = {
  queued: 'Waiting',
  pending: 'Waiting',
  planning: 'Preparing',
  review: 'Needs review',
  'waiting-review': 'Needs review',
  applying: 'Applying',
  running: 'Running',
  starting: 'Starting',
  indexing: 'Indexing',
  collision: 'Name in use',
  paused: 'Paused',
  completed: 'Done',
  ready: 'Ready',
  partial: 'Partly done',
  recovery: 'Needs recovery',
  rejected: 'Rejected',
  cancelled: 'Canceled',
  failed: 'Failed',
  stopped: 'Stopped',
  offline: 'Offline',
  // an external agent's own report of its session
  working: 'Working',
  waiting: 'Waiting',
  done: 'Done',
};

/** A state as people read it: `queued` is "Waiting", `cancelled` is "Canceled". */
export function statusLabel(status: ShownStatus): string {
  return statusLabels[status];
}

/** A finished or running command, as people read its outcome: "Done", "Failed with exit code 127",
 * "Stopped". A run that exited 0 is done, whatever its process status says. */
export function processOutcome(run: {
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  exitCode?: number;
}): string {
  if (run.status === 'running') return 'Running';
  if (run.status === 'interrupted') return 'Interrupted';
  if (run.status === 'cancelled') return 'Stopped';
  if (run.exitCode === 0) return 'Done';
  if (run.exitCode !== undefined) return `Failed with exit code ${run.exitCode}`;
  return run.status === 'failed' ? 'Failed to finish' : 'Done';
}

const operationLabels: Readonly<Record<OperationKind, string>> = {
  copy: 'Copy',
  move: 'Move',
  transfer: 'Transfer',
  duplicate: 'Duplicate',
  alias: 'Make Alias',
  rename: 'Rename',
  mkdir: 'New Folder',
  mkfile: 'New File',
  trash: 'Move to Trash',
  compress: 'Compress',
  extract: 'Extract',
  convert: 'Quick Action',
  rewrite: 'Save',
};

/** A file operation by its menu name: `mkdir` is "New Folder". */
export function operationLabel(kind: OperationKind): string {
  return operationLabels[kind];
}

const capabilityLabels: Readonly<Record<ExecutionCapability, string>> = {
  execute: 'Run programs',
  'terminal-read': 'Read terminal output',
  'terminal-write': 'Type into terminals',
};

/** What an execution grant lets an agent do, in words: `terminal-read` is "Read terminal output". */
export function capabilityLabel(capability: ExecutionCapability): string {
  return capabilityLabels[capability];
}
