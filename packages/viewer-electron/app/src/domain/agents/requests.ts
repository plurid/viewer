import type { CapturedTarget, ExecutionTask } from '../automation/actions';
import type { SettingsPatch } from '../services';
import type { Pane, ViewMode, FileEntry, OperationJob } from '../contracts';
import type { TransformPlan } from '../operations/transforms';
import type { SpeechSetup } from '../speech/models';
import type { AgentTaskSetup, AgentTaskResult } from './task-workflow';

/** What a terminal read grant shows an agent: the last characters each terminal showed. */
export const terminalReadCharacters = 128_000;
/** What an execution grant allows: running a program, or reading or typing into its terminal. */
export const executionCapabilities = ['execute', 'terminal-read', 'terminal-write'] as const;
export type ExecutionCapability = (typeof executionCapabilities)[number];

/** A proposal's outcome, once it no longer waits for review or runs. */
export const finalProposalStatuses = ['completed', 'failed', 'rejected', 'cancelled'] as const;
export type FinalProposalStatus = (typeof finalProposalStatuses)[number];
export type ProposalStatus = 'review' | 'running' | FinalProposalStatus;
export function isFinalProposalStatus(status: ProposalStatus): status is FinalProposalStatus {
  return (finalProposalStatuses as readonly string[]).includes(status);
}
/** Live navigation discovery excludes history, camera/layout and unrelated preferences. */
export interface AgentPlane {
  id: string;
  type: Pane['type'];
  path: string;
  mode?: ViewMode;
  allLocations?: boolean;
}
export interface AgentWorkspace {
  id: string;
  name: string;
  panes: AgentPlane[];
  roots: string[];
  tasks?: { id: string; name: string; path: string; branch?: string; commit?: string }[];
}
export interface AgentWorkspaceSnapshot {
  activeWorkspace: string;
  workspaces: AgentWorkspace[];
}
export type AgentNavigation =
  | { kind: 'open-path'; path: string; placement: 'current' | 'root' | 'linked' }
  | { kind: 'select-files'; files: FileEntry[] }
  | { kind: 'focus-plane'; pane: AgentPlane }
  | { kind: 'switch-workspace'; workspace: AgentWorkspace };
export interface CommandDescriptor {
  id: string;
  label: string;
  group: string;
  aliases: string[];
  shortcut?: string;
}
export const agentProposalKinds = [
  'command',
  'configuration',
  'terminal-write',
  'navigation',
  'transform',
  'speech',
  'task-workflow',
] as const;
export type AgentProposalKind = (typeof agentProposalKinds)[number];
/** Commands, configuration, speech setup and tasks can alter files or later execution, so the
 * desktop asks again in a system dialog after the review. Navigation changes only the view, and an
 * export only adds a new file: their review is the approval. Terminal input never runs. */
export function needsNativeConfirmation(proposal: Pick<AgentProposal, 'kind'>): boolean {
  return (
    proposal.kind === 'command' ||
    proposal.kind === 'configuration' ||
    proposal.kind === 'speech' ||
    proposal.kind === 'task-workflow'
  );
}
export interface AgentProposal {
  id: string;
  clientID?: string;
  kind: AgentProposalKind;
  taskSetup?: AgentTaskSetup;
  taskResult?: AgentTaskResult;
  speech?: SpeechSetup;
  transform?: { plan: TransformPlan; destination: string; name: string };
  title: string;
  target?: CapturedTarget;
  commandID?: string;
  removal?: 'trash';
  navigation?: AgentNavigation;
  patches?: SettingsPatch[];
  revision?: number;
  terminalID?: string;
  data?: string;
  detail: string;
  status: ProposalStatus;
  taskID?: string;
  task?: ExecutionTask;
  operationID?: string;
  operation?: OperationJob;
  error?: string;
}
export interface ExecutionGrant {
  id: string;
  clientID?: string;
  actionID: string;
  /** The granted folder, links resolved. */
  root: string;
  /** The folder as it was chosen, when that was a link or alias to `root`. */
  chosen?: string;
  fingerprint: string;
  capability: ExecutionCapability;
}
