import type { CapturedTarget } from './automation';
import type { SettingsPatch } from './services';
export interface CommandDescriptor {
  id: string;
  label: string;
  group: string;
  aliases: string[];
  shortcut?: string;
}
export interface AgentProposal {
  id: string;
  kind: 'command' | 'configuration' | 'terminal-write';
  title: string;
  target?: CapturedTarget;
  commandID?: string;
  patches?: SettingsPatch[];
  revision?: number;
  terminalID?: string;
  data?: string;
  detail: string;
  status: 'review' | 'running' | 'completed' | 'rejected' | 'failed' | 'cancelled';
  taskID?: string;
  task?: import('./automation').ExecutionTask;
  error?: string;
}
export interface ExecutionGrant {
  id: string;
  actionID: string;
  root: string;
  fingerprint: string;
  capability: 'execute' | 'terminal-read' | 'terminal-write';
}
