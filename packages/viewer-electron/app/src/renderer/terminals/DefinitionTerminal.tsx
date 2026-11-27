import { lazy, Suspense, useEffect, useState } from 'react';
import type { TerminalPane } from '../../domain/contracts';
import { activeWorkspace, useViewer } from '../state/core';
import { useWorkspace } from '../workspace/context';
import { Empty } from '../ui/primitives';
import { DefinitionStartPanel } from './DefinitionStartPanel';
import { DefinitionDialog } from '../ui/workspace/DefinitionDialog';
import {
  chooseDefinitionTerminals,
  checkDefinitionTerminal,
  checkDefinitionCommand,
  definitionCommandPresentation,
  definitionChoice,
  displayedDefinitionCommand,
  useDefinitionChoices,
} from './definition-command-session';
import { definitionRunReason, useTerminalAuthority } from './start-authority';

const Terminal = lazy(() =>
  import('./TerminalPlane').then((module) => ({ default: module.TerminalPlane })),
);

export function DefinitionTerminal({ pane }: { pane: TerminalPane }) {
  const workspace = useViewer(activeWorkspace);
  const catalog = useViewer((state) => state.bootstrap.definitions);
  useDefinitionChoices();
  useTerminalAuthority();
  const controller = useWorkspace();
  const [reset, setReset] = useState(false);
  const choice = definitionChoice(workspace, pane);
  const presentation = definitionCommandPresentation(workspace, pane);
  const shown = displayedDefinitionCommand(workspace, pane);
  const request = {
    id: pane.id,
    workspaceID: workspace.id,
    rootID: controller.rootID(pane.id) || pane.id,
    cwd: pane.path,
    profileID: pane.profileID,
    cols: 80,
    rows: 24,
  };
  useEffect(() => {
    void checkDefinitionTerminal(workspace, pane, request);
    // A plane's initial identity is checked once per opening, without starting a shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id, workspace.epoch, pane.id]);
  useEffect(() => {
    void checkDefinitionCommand(workspace, pane, request);
    // A catalog edit invalidates the reviewed folder match before another Run can be offered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id, workspace.epoch, pane.id, pane.path, pane.profileID, catalog]);
  const start = (run: boolean) =>
    chooseDefinitionTerminals(
      workspace,
      [
        {
          pane,
          request,
          reference: run ? shown?.reference : undefined,
        },
      ],
      run ? 'run' : 'shell',
    );
  if (choice.phase === 'checking') return <Empty title="Checking terminal…" />;
  if (choice.phase === 'approval')
    return (
      <Empty title="Waiting for terminal approval…">
        <p role="status">Finish the approval dialog to start this terminal.</p>
      </Empty>
    );
  return (
    <div className="definition-terminal">
      {choice.phase === 'started' ? (
        <>
          {choice.error ? (
            <p className="definition-command-error" role="alert">
              {choice.error}
            </p>
          ) : null}
          <Suspense fallback={<Empty title="Opening terminal…" />}>
            <Terminal pane={pane} />
          </Suspense>
        </>
      ) : (
        <DefinitionStartPanel
          plane={pane.definitionPlane!}
          command={shown?.command}
          cwd={shown?.cwd ?? pane.path}
          pending={choice.phase === 'preparing'}
          failure={choice.error}
          state={presentation.kind}
          onReset={() => setReset(true)}
          disabledReason={
            definitionRunReason([pane.id]) ??
            (presentation.kind === 'checking'
              ? 'Checking the terminal folder…'
              : presentation.kind === 'folder-unavailable'
                ? 'The terminal folder is missing or cannot be accessed.'
                : presentation.kind === 'unavailable'
                  ? 'This terminal’s command is no longer in the definition. Choose Shell only.'
                  : undefined)
          }
          onRun={() => start(true)}
          onShellOnly={() => start(false)}
        />
      )}
      {reset ? (
        <DefinitionDialog
          kind="reset"
          workspace={workspace}
          controller={controller}
          onClose={() => setReset(false)}
        />
      ) : null}
    </div>
  );
}
