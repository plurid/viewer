import { lazy, Suspense, useEffect } from 'react';
import type { TerminalPane } from '../../domain/contracts';
import { activeWorkspace, useViewer } from '../state/core';
import { useWorkspace } from '../workspace/context';
import { Empty } from '../ui/primitives';
import { DefinitionStartPanel } from './DefinitionStartPanel';
import {
  chooseDefinitionTerminals,
  checkDefinitionTerminal,
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
  useViewer((state) => state.bootstrap.definitions);
  useDefinitionChoices();
  useTerminalAuthority();
  const controller = useWorkspace();
  const choice = definitionChoice(workspace, pane);
  const shown = displayedDefinitionCommand(workspace, pane);
  const request = {
    id: pane.id, workspaceID: workspace.id, rootID: controller.rootID(pane.id) || pane.id,
    cwd: pane.path, profileID: pane.profileID, cols: 80, rows: 24,
  };
  useEffect(() => {
    void checkDefinitionTerminal(workspace, pane, request);
    // A plane's initial identity is checked once per opening, without starting a shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id, workspace.epoch, pane.id]);
  const start = (run: boolean) =>
    chooseDefinitionTerminals(workspace, [
      {
        pane,
        request,
        reference: run ? shown?.reference : undefined,
      },
    ], run ? 'run' : 'shell');
  if (choice.phase === 'checking') return <Empty title="Checking terminal…" />;
  return (
    <div className="definition-terminal">
      {choice.phase === 'starting' || choice.phase === 'started' ? (
        <>
        {choice.error ? <p className="definition-command-error" role="alert">{choice.error}</p> : null}
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
          disabledReason={
            definitionRunReason([pane.id]) ??
            (!shown
              ? 'The definition command is no longer available. Choose Shell only.'
              : undefined)
          }
          onRun={() => start(true)}
          onShellOnly={() => start(false)}
        />
      )}
    </div>
  );
}
