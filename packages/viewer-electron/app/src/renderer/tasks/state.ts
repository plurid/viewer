import type { CapturedTarget, ExecutionTask } from '../../domain/automation/actions';
import type { Pane } from '../../domain/contracts';
import {
  attachTaskMember,
  taskReference,
  taskPaneTitle,
  type TaskArea,
  type TaskReference,
} from '../../domain/workspaces/tasks';
import { changeWorkspace, getState, update } from '../state/core';

export function changeTaskArea(id: string, change: (area: TaskArea) => TaskArea): void {
  changeWorkspace((space) => ({
    ...space,
    taskAreas: space.taskAreas?.map((area) => (area.id === id ? change(area) : area)),
  }));
}
export function renameTaskArea(id: string, name: string): void {
  const title = name.trim().slice(0, 100);
  if (!title) throw new Error('Give the task a name.');
  changeWorkspace((space) => ({
    ...space,
    taskAreas: space.taskAreas?.map((area) =>
      area.id === id ? { ...area, name: title, updated: Date.now() } : area,
    ),
    panes: space.panes.map((pane) =>
      pane.type === 'task' && pane.areaID === id ? { ...pane, title } : pane,
    ),
  }));
}
export function attachTaskPlane(areaID: string, pane: Pane): void {
  const reference = taskReference(pane);
  if (!reference)
    throw new Error('This plane has no durable task reference. Save scratch text as a note first.');
  changeTaskArea(areaID, (area) => attachTaskMember(area, reference, taskPaneTitle(pane), pane.id));
}
export function attachTaskReference(
  areaID: string,
  reference: TaskReference,
  title: string,
  viewID?: string,
): void {
  changeTaskArea(areaID, (area) => attachTaskMember(area, reference, title, viewID));
}
/** Association follows explicit source-view membership, never a guessed command meaning. */
export function attachCommandReceipt(
  target: CapturedTarget,
  task: Pick<ExecutionTask, 'id' | 'title' | 'directory'>,
): void {
  const state = getState();
  if (
    !state?.saved.workspaces.some(
      (space) =>
        space.id === target.workspaceID &&
        space.taskAreas?.some((area) =>
          area.members.some((member) => member.views.includes(target.paneID)),
        ),
    )
  )
    return;
  update(
    {
      ...state,
      saved: {
        ...state.saved,
        workspaces: state.saved.workspaces.map((space) =>
          space.id === target.workspaceID
            ? {
                ...space,
                taskAreas: space.taskAreas?.map((area) =>
                  area.members.some((member) => member.views.includes(target.paneID))
                    ? attachTaskMember(
                        area,
                        {
                          kind: 'receipt',
                          path: task.directory ?? target.directory,
                          receiptID: task.id,
                        },
                        task.title,
                      )
                    : area,
                ),
              }
            : space,
        ),
      },
    },
    true,
  );
}
