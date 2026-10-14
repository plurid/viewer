import type { CapturedTarget, ExecutionTask } from './automation';
import type { SettingsPatch } from './services';
import type { Pane, ViewMode, FileEntry, OperationJob } from './contracts';
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
  kind: 'command' | 'configuration' | 'terminal-write' | 'navigation';
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
  status: 'review' | 'running' | 'completed' | 'rejected' | 'failed' | 'cancelled';
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
  root: string;
  fingerprint: string;
  capability: 'execute' | 'terminal-read' | 'terminal-write';
}
