import { useEffect, useRef, useState } from 'react';
import { taskWorkflowInputSchema, type AgentTaskResult } from '../../domain/agents/task-workflow';
import type { TaskWorkflowDraft } from '../../domain/command-line/task';
import { errorMessage } from '../../domain/errors';
import { ChoiceButton } from '../ui/ChoiceMenu';
import { Dialog } from '../ui/primitives';
import { announce, useViewer } from '../state/store';
import './tasks.css';

/** Model output fills ordinary fields. Only a validated typed request reaches desktop;
 * the form yields its modal before the native confirmation and live canvas handoff. */
export function TaskRequestDialog({
  initial,
  onClose,
  openFolder,
}: {
  initial: TaskWorkflowDraft;
  onClose(): void;
  openFolder(path: string): Promise<void>;
}) {
  const workspaces = useViewer((state) => state.saved.workspaces);
  const [draft, setDraft] = useState<TaskWorkflowDraft>(() => {
    const matches = workspaces.filter(
      (space) =>
        space.id === initial.workspace ||
        space.name.normalize('NFC') === initial.workspace?.normalize('NFC'),
    );
    const exact = workspaces.find((space) => space.id === initial.workspace);
    return {
      ...initial,
      workspace: exact?.id ?? (matches.length === 1 ? matches[0]!.id : initial.workspace),
    };
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [partial, setPartial] = useState<AgentTaskResult>();
  const submitting = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const change = (patch: TaskWorkflowDraft) => {
    setDraft((value) => ({ ...value, ...patch }));
    setError('');
  };
  const valid = taskWorkflowInputSchema.safeParse(draft);
  const validation =
    !valid.success &&
    draft.name?.trim() &&
    draft.repo?.trim() &&
    draft.branch?.trim() &&
    draft.path?.trim()
      ? valid.error.issues[0]?.message
      : undefined;
  const submit = async () => {
    if (!valid.success || submitting.current || partial) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      // The desktop may deliver the task to this window. Leave no open modal in its way.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const result = await window.viewer.createTask(valid.data);
      if (!mounted.current) return;
      if (result.kind === 'created') {
        announce(`Created task “${valid.data.name}”. Its terminal is stopped.`);
        onClose();
      } else if (result.kind === 'failed') {
        setError(result.error);
        setPartial(result.result);
      } else setError('Creation cancelled. Your parameters are still here to edit.');
    } catch (error) {
      if (mounted.current) setError(errorMessage(error));
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  if (busy)
    return (
      <p className="task-request-progress" role="status">
        Preparing branch task… Review the desktop confirmation to continue.
      </p>
    );
  const choices = workspaces.map((space) => ({
    value: space.id,
    label: space.name,
    detail: space.id,
  }));
  if (draft.workspace && !workspaces.some((space) => space.id === draft.workspace))
    choices.unshift({
      value: draft.workspace,
      label: `Unavailable: ${draft.workspace}`,
      detail: 'Choose an available workspace',
    });
  return (
    <Dialog title="Create branch task" onClose={onClose} className="task-request-dialog">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="task-request-fields">
          <p className="muted">
            Review the parameters. Viewer will create a worktree and arrange its folder, note,
            terminal and Git changes.
          </p>
          <label className="field-label">
            Task name
            <input
              data-autofocus
              aria-label="Task name"
              value={draft.name ?? ''}
              maxLength={100}
              required
              disabled={!!partial}
              onChange={(event) => change({ name: event.target.value })}
            />
          </label>
          <label className="field-label">
            Repository
            <input
              aria-label="Task repository"
              value={draft.repo ?? ''}
              maxLength={32768}
              required
              spellCheck={false}
              disabled={!!partial}
              onChange={(event) => change({ repo: event.target.value })}
            />
          </label>
          <div className="field-label">
            <span>Workspace</span>
            <ChoiceButton
              label="Task workspace"
              value={draft.workspace ?? ''}
              choices={choices}
              disabled={!!partial}
              onChoose={(workspace) => change({ workspace })}
            />
          </div>
          <div className="task-actions" role="group" aria-label="Task branch mode">
            <button
              type="button"
              aria-pressed={!draft.existing}
              disabled={!!partial}
              onClick={() => change({ existing: false })}
            >
              New branch
            </button>
            <button
              type="button"
              aria-pressed={!!draft.existing}
              disabled={!!partial}
              onClick={() => change({ existing: true, base: undefined })}
            >
              Existing branch
            </button>
          </div>
          <label className="field-label">
            {draft.existing ? 'Existing branch name' : 'New branch name'}
            <input
              aria-label="Task branch"
              value={draft.branch ?? ''}
              maxLength={1024}
              required
              spellCheck={false}
              disabled={!!partial}
              onChange={(event) => change({ branch: event.target.value })}
            />
          </label>
          {!draft.existing && (
            <label className="field-label">
              Base branch
              <input
                aria-label="Task base branch"
                value={draft.base ?? ''}
                placeholder="HEAD"
                maxLength={1024}
                spellCheck={false}
                disabled={!!partial}
                onChange={(event) => change({ base: event.target.value || undefined })}
              />
              <small className="muted">
                Leave empty to use the repository’s current revision. Choose a local branch by name.
              </small>
            </label>
          )}
          <label className="field-label">
            New worktree folder
            <input
              aria-label="Task worktree folder"
              value={draft.path ?? ''}
              maxLength={32768}
              required
              spellCheck={false}
              disabled={!!partial}
              onChange={(event) => change({ path: event.target.value })}
            />
            <small className="muted">
              Use an absolute path to a new folder inside an existing parent.
            </small>
          </label>
          <p className="muted">
            The terminal stays stopped. Load Git review when you are ready. Creation does not run
            repository hooks or filters.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {!error && validation && (
            <p className="error" role="status">
              {validation}
            </p>
          )}
          {partial && (
            <div className="task-request-recovery">
              <strong>Inspect the retained worktree before trying again</strong>
              <p>{partial.path}</p>
              <p>
                Setup stopped at{' '}
                {partial.stage === 'worktree-created'
                  ? 'opening the task'
                  : 'creating the worktree'}
                . Viewer keeps any files already created.
              </p>
            </div>
          )}
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            {partial ? 'Close' : 'Cancel'}
          </button>
          {partial?.stage === 'worktree-created' ? (
            <button
              type="button"
              onClick={() =>
                void openFolder(partial.path)
                  .then(onClose)
                  .catch((error: unknown) => setError(errorMessage(error)))
              }
            >
              Open retained folder
            </button>
          ) : (
            !partial && (
              <button type="submit" className="primary" disabled={!valid.success}>
                Create task…
              </button>
            )
          )}
        </footer>
      </form>
    </Dialog>
  );
}
