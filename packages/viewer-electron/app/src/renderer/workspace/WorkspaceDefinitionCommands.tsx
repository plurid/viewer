import { useEffect } from 'react';
import { activeWorkspace, useViewer, report } from '../state/core';
import { DefinitionCommandsNotice } from './DefinitionCommandsNotice';
import { useWorkspace } from './context';
import {
  chooseDefinitionTerminals,
  checkDefinitionTerminal,
  commandsNoticeHidden,
  displayedDefinitionCommand,
  hideCommandsNotice,
  useDefinitionChoices,
  waitingDefinitionPanes,
} from '../terminals/definition-command-session';
import { definitionRunReason, useTerminalAuthority } from '../terminals/start-authority';
import { focusCommandTerminal } from '../terminals/command-focus';

export function WorkspaceDefinitionCommands({ ready = true }: { ready?: boolean }) {
  const workspace = useViewer(activeWorkspace);
  useViewer((state) => state.bootstrap.definitions);
  useDefinitionChoices();
  useTerminalAuthority();
  const controller = useWorkspace();
  useEffect(() => {
    if (!ready || !workspace.definition) return;
    for (const pane of workspace.panes) {
      if (pane.type !== 'terminal' || pane.definitionPlane === undefined) continue;
      void checkDefinitionTerminal(workspace, pane, {
        id: pane.id, workspaceID: workspace.id, rootID: controller.rootID(pane.id) || pane.id,
        cwd: pane.path, profileID: pane.profileID, cols: 80, rows: 24,
      });
    }
  }, [workspace, controller, ready]);
  const panes = waitingDefinitionPanes(workspace);
  if (commandsNoticeHidden(workspace) || !panes.length) return null;
  return (
    <DefinitionCommandsNotice
      count={panes.length}
      disabledReason={definitionRunReason(panes.map((pane) => pane.id))}
      onNotNow={() => { hideCommandsNotice(workspace); focusCommandTerminal(); }}
      onRunAll={() => {
        const items = panes.map((pane) => ({
          pane,
          request: {
            id: pane.id,
            workspaceID: workspace.id,
            rootID: controller.rootID(pane.id) || pane.id,
            cwd: pane.path,
            profileID: pane.profileID,
            cols: 80,
            rows: 24,
          },
          reference: displayedDefinitionCommand(workspace, pane)?.reference,
        }));
        void chooseDefinitionTerminals(workspace, items).then((started) => {
          const first = started[0];
          if (first) controller.focusPane(first);
          focusCommandTerminal(first);
        }).catch(report);
      }}
    />
  );
}
