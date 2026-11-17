import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { Workspace } from '../../../domain/contracts';
import type { WorkspaceDefinitionReply } from '../../../domain/workspaces/definitions/schema';
import { definitionKeySchema } from '../../../domain/workspaces/definitions/schema';
import type { WorkspaceController } from '../../workspace/context';
import {
  closeDefinedWorkspace,
  resetDefinition,
  saveDefinition,
  workspaceShells,
} from '../../state/definitions';
import { getState } from '../../state/store';
import { Dialog } from '../primitives';
import { errorMessage } from '../../../domain/errors';
import { flushState } from '../../state/persistence';

export type DefinitionDialogKind = 'close' | 'reset' | 'save' | 'save-as';

export function DefinitionDialog({
  kind,
  workspace,
  controller,
  onClose,
}: {
  kind: DefinitionDialogKind;
  workspace: Workspace;
  controller: WorkspaceController;
  onClose(): void;
}) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shells, setShells] = useState(0);
  const [memoryProblem, setMemoryProblem] = useState('');
  const [reply, setReply] = useState<WorkspaceDefinitionReply>();
  const [key, setKey] = useState('');
  const [name, setName] = useState(workspace.name);
  const [error, setError] = useState('');
  const preparation = useRef<Promise<WorkspaceDefinitionReply> | undefined>(undefined);
  const prepare = useEffectEvent(async (alive: () => boolean) => {
    if (kind === 'close') {
      await flushState();
      const info = await window.viewer.workspaceDefinitions({
        kind: 'close-info',
        workspaceID: workspace.id,
      });
      if (info.kind !== 'close-info')
        throw new Error('The workspace could not be prepared for closing.');
      const count = await workspaceShells(workspace);
      if (!alive()) return;
      setMemoryProblem(info.problem ?? '');
      if (!count && !info.problem) {
        const result = await closeDefinedWorkspace(workspace.id);
        if (!alive()) return;
        if (typeof result === 'boolean') {
          onClose();
          return;
        }
        setMemoryProblem(result.problem);
      }
      setShells(count);
    } else if (kind === 'reset') {
      const count = await workspaceShells(workspace);
      if (!alive()) return;
      setShells(count);
    } else if (kind === 'save') {
      const result = await (preparation.current ??= saveDefinition(workspace.id));
      if (!alive()) return;
      if (result.kind === 'saved') {
        onClose();
        return;
      }
      setReply(result);
    } else if (kind === 'save-as') {
      await flushState();
      const result = await (preparation.current ??= window.viewer.workspaceDefinitions({
        kind: 'save-as',
        workspaceID: workspace.id,
        order: workspace.panes.map((pane) => pane.id),
      }));
      if (!alive()) return;
      if (result.kind !== 'proposal') throw new Error('A definition key could not be proposed.');
      setKey(result.key);
      setName(result.name);
    }
    if (alive()) setReady(true);
  });
  useEffect(() => {
    let live = true;
    void prepare(() => live).catch((failure) => {
      if (live) {
        setError(errorMessage(failure));
        setReady(true);
      }
    });
    return () => {
      live = false;
    };
  }, [kind, workspace.id]);
  const definition = getState().bootstrap.definitions?.definitions.find(
    (item) => item.key === workspace.definition?.key,
  );
  const terminals =
    definition?.planes.filter(
      (item) => item.plane.kind === 'terminal' && item.plane.command !== undefined,
    ).length ?? 0;
  const confirmingSave = kind === 'save' && reply?.kind === 'needs-confirmation';
  const title =
    kind === 'close'
      ? 'Close workspace?'
      : kind === 'reset'
        ? 'Reset to definition?'
        : kind === 'save-as'
          ? 'Save as definition'
          : confirmingSave
            ? 'Save over definition?'
            : 'Save to definition';
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (kind === 'close') {
        const result = await closeDefinedWorkspace(workspace.id, !!memoryProblem);
        if (typeof result !== 'boolean') {
          setMemoryProblem(result.problem);
          return;
        }
        if (!result) return;
      } else if (kind === 'reset') {
        if (!(await resetDefinition(controller, workspace.id))) return;
      } else {
        if (kind === 'save-as' && !definitionKeySchema.safeParse(key.trim()).success)
          throw new Error(
            'Use a key with one to eight path segments containing letters, numbers, dots, underscores or hyphens. The segments "." and ".." are not allowed.',
          );
        const result = await saveDefinition(
          workspace.id,
          confirmingSave,
          kind === 'save-as' ? { key: key.trim(), name: name.trim() } : undefined,
        );
        if (result.kind === 'needs-confirmation') {
          setReply(result);
          return;
        }
        if (result.kind !== 'saved') throw new Error('The definition could not be saved.');
      }
      onClose();
    } catch (failure) {
      setReply(undefined);
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={title}
      onClose={() => {
        if (!busy) onClose();
      }}
      className="definition-dialog"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="dialog-copy">
          {!ready && <p role="status">Preparing…</p>}
          {ready && kind === 'close' && (
            <p>
              Close “{workspace.name}”?{' '}
              {shells > 0 && (
                <>
                  Its {shells} {shells === 1 ? 'terminal stops' : 'terminals stop'}.{' '}
                </>
              )}
              {memoryProblem
                ? 'Viewer cannot remember its planes: ' +
                  memoryProblem +
                  '. It opens from its definition next time.'
                : 'Viewer remembers its planes for next time.'}
            </p>
          )}
          {kind === 'reset' && (
            <p>
              {workspace.panes.length}{' '}
              {workspace.panes.length === 1 ? 'plane closes' : 'planes close'};{' '}
              {definition?.planes.length ?? 0} open from the definition.{' '}
              {shells > 0 && (
                <>
                  Its {shells} {shells === 1 ? 'running terminal stops' : 'running terminals stop'}
                  .{' '}
                </>
              )}
              {terminals > 0 && (
                <>
                  {terminals} {terminals === 1 ? 'terminal will' : 'terminals will'} ask before
                  running {terminals === 1 ? 'its command' : 'their command'}.
                </>
              )}
            </p>
          )}
          {kind === 'save' && reply?.kind === 'needs-confirmation' && (
            <p>
              {reply.curated && 'This definition is curated. '}
              {reply.changed &&
                'The definition changed since this workspace opened. Planes present only in the file are kept, including planes closed here. '}
              {reply.dropsCommands && 'This save removes a command from the definition. '}Save the
              current supported planes over the definition?
            </p>
          )}
          {kind === 'save-as' && (
            <>
              <label>
                Key
                <input
                  data-autofocus
                  value={key}
                  maxLength={200}
                  required
                  onChange={(event) => setKey(event.target.value)}
                />
              </label>
              <label>
                Name
                <input
                  value={name}
                  maxLength={100}
                  required
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <p>
                The definition records supported planes, their order and layout. Unsaved text stays
                in Viewer.
              </p>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={
              kind === 'save-as' || (kind === 'save' && !confirmingSave) ? 'primary' : 'danger'
            }
            disabled={!ready || busy || (kind === 'reset' && !definition)}
          >
            {kind === 'close'
              ? 'Close workspace'
              : kind === 'reset'
                ? 'Reset to definition'
                : kind === 'save-as'
                  ? 'Save definition'
                  : confirmingSave
                    ? 'Save over definition'
                    : 'Retry save'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
