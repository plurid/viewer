/** Shared review envelope for built-in operations, recipes and extension actions. */
export type ChangePlanStatus =
  | 'planning'
  | 'review'
  | 'applying'
  | 'completed'
  | 'partial'
  | 'cancelled'
  | 'failed'
  | 'recovery';
export interface ChangePlan<Row> {
  /** Optional only for compatibility with pre-roadmap callers; new plans emit v1. */
  version?: 1;
  id: string;
  revision: number;
  title: string;
  status: ChangePlanStatus;
  rows: Row[];
  undoable: boolean;
  checkpointID?: string;
}
export interface CheckpointEstimate {
  bytes: number;
  entries: number;
  availableBytes: number;
  supported: boolean;
  issues: string[];
  scope: 'contents-and-mode';
}
export interface CheckpointRecord {
  id: string;
  created: number;
  title: string;
  bytes: number;
  roots: { path: string; slot: string }[];
  scope: 'contents-and-mode';
  status: 'ready' | 'failed';
  manifestVersion?: 1 | 2;
}
export type CheckpointRequest =
  | { kind: 'list' }
  | { kind: 'estimate'; paths: string[] }
  | { kind: 'remove'; id: string }
  | { kind: 'restore'; id: string; destination: string };
export type CheckpointReply =
  | { records: CheckpointRecord[]; budgetBytes: number; usedBytes: number }
  | CheckpointEstimate
  | { jobs: string[] }
  | null;
