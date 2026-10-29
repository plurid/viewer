import type { CapturedTarget, ExecutionTask } from '../automation/actions';
import type { SettingsPatch } from '../services';
import type { Pane, ViewMode, FileEntry, OperationJob } from '../contracts';
import type { TransformPlan } from '../operations/transforms';
import type { SpeechSetup } from '../speech/models';
import type { AgentTaskSetup, AgentTaskResult } from './task-workflow';

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
export interface AgentProposal {
  id: string;
  clientID?: string;
  kind:
    | 'command'
    | 'configuration'
    | 'terminal-write'
    | 'navigation'
    | 'transform'
    | 'speech'
    | 'task-workflow';
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
  capability: 'execute' | 'terminal-read' | 'terminal-write';
}
