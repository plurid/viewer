import { z } from 'zod';
import type { Pane } from '../contracts';
import type { WorktreeCreation } from '../comparison/worktrees';
import { validBranchName } from '../comparison/worktrees';
import type { TaskArea } from '../workspaces/tasks';
import type { NoteDocument } from '../editing/notes';
import type { AgentWorkspace, AgentWorkspaceSnapshot } from './requests';

const local = z
  .string()
  .min(1)
  .max(32768)
  .refine((value) => !value.includes('\0') && (/^\//.test(value) || /^[A-Za-z]:[\\/]/.test(value)));
export const taskWorkflowInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((value) => !/[\u0000-\u001f\u007f]/.test(value)),
    repo: local,
    path: local,
    branch: z.string().max(1024).refine(validBranchName, 'Use a valid local branch name.'),
    base: z.string().min(1).max(1024).optional(),
    existing: z.boolean().default(false),
    workspace: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine((value) => !(value.existing && value.base), {
    message: 'Choose --existing or --base, not both.',
  });
export type TaskWorkflowInput = z.infer<typeof taskWorkflowInputSchema>;

/** IDs win over exact normalized names; ambiguity never picks an arbitrary workspace. */
export function selectAgentWorkspace(
  state: AgentWorkspaceSnapshot | undefined,
  selector?: string,
): AgentWorkspace {
  if (!state) throw new Error('Open a workspace in Viewer first.');
  const id = selector ?? state.activeWorkspace;
  const matches = state.workspaces.filter((space) => space.id === id);
  if (!matches.length && selector)
    matches.push(
      ...state.workspaces.filter(
        (space) => space.name.normalize('NFC') === selector.normalize('NFC'),
      ),
    );
  if (matches.length !== 1)
    throw new Error(
      matches.length
        ? 'The workspace name is ambiguous. Use its ID.'
        : 'That workspace is unavailable. Use workspace list.',
    );
  return matches[0]!;
}

export interface AgentTaskSetup {
  id: string;
  name: string;
  workspaceID: string;
  workspaceName: string;
  repo: string;
  destination: string;
  branch: string;
  commit: string;
  catalogID: string;
  checkout: WorktreeCreation['checkout'];
}
export interface AgentTaskResult {
  workspaceID: string;
  taskID: string;
  path: string;
  branch: string;
  commit: string;
  terminal: 'stopped';
  /** A partial result identifies a retained checkout even if opening the task fails. */
  stage: 'worktree-pending' | 'worktree-created' | 'ready';
  planeIDs?: string[];
}
export interface AgentTaskBundle {
  workspaceID: string;
  area: TaskArea;
  /** The newly created blank note, never an existing private document. */
  note: NoteDocument;
  panes: Extract<Pane, { type: 'task' | 'folder' | 'note' | 'terminal' | 'git-changes' }>[];
}
