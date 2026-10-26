import { useMemo, useState } from 'react';
import {
  validBranchName,
  worktreeDestination,
  type WorktreeCatalog,
  type WorktreeCreation,
} from '../../../domain/comparison/worktrees';
import { ChoiceButton } from '../../ui/ChoiceMenu';
import { errorMessage } from '../../../domain/errors';

export function CreateWorktree({
  catalog,
  busy,
  create,
  show,
  cancel,
  task,
}: {
  catalog: WorktreeCatalog;
  busy: boolean;
  create(checkout: WorktreeCreation['checkout'], destination: string): Promise<void>;
  show(id: string): void;
  cancel(): void;
  task?: { name: string; change(name: string): void };
}) {
  const branches = useMemo(() => catalog.branches ?? [], [catalog.branches]);
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [name, setName] = useState('feature/new-task');
  const [baseID, setBaseID] = useState(catalog.defaultBaseID ?? branches[0]?.id ?? '');
  const [existingID, setExistingID] = useState(
    branches.find((branch) => branch.branch && !branch.worktreeID)?.id ??
      branches.find((branch) => branch.branch)?.id ??
      '',
  );
  const selected = branches.find((branch) => branch.id === (mode === 'new' ? baseID : existingID));
  const suggested = worktreeDestination(
    catalog.repository,
    mode === 'new' ? name : (selected?.branch ?? 'task'),
  );
  const [customDestination, setCustomDestination] = useState<string>();
  const destination = customDestination ?? suggested;
  const [error, setError] = useState('');
  const occupied = mode === 'existing' && selected?.worktreeID;
  const existingName = mode === 'new' && branches.some((branch) => branch.branch === name);
  const invalidName = mode === 'new' && !!name && !validBranchName(name);
  const valid =
    selected && (mode !== 'new' || (validBranchName(name) && !existingName)) && destination.trim();
  return (
    <form
      className="worktree-create"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !busy && !occupied && (!task || task.name.trim()))
          void create(
            mode === 'new'
              ? { kind: 'new', name, baseID }
              : { kind: 'existing', branchID: existingID },
            destination,
          );
      }}
    >
      {task && (
        <label>
          Task name
          <input
            aria-label="Branch task name"
            value={task.name}
            maxLength={100}
            required
            disabled={busy}
            onChange={(event) => task.change(event.target.value)}
          />
        </label>
      )}
      <div className="worktree-create-mode" role="group" aria-label="Worktree branch">
        <button
          type="button"
          aria-pressed={mode === 'new'}
          disabled={busy}
          onClick={() => setMode('new')}
        >
          New branch
        </button>
        <button
          type="button"
          aria-pressed={mode === 'existing'}
          disabled={busy}
          onClick={() => setMode('existing')}
        >
          Existing branch
        </button>
      </div>
      {mode === 'new' && (
        <label>
          Branch name
          <input
            autoFocus
            aria-label="New branch name"
            aria-invalid={invalidName || undefined}
            aria-describedby={invalidName ? 'worktree-branch-error' : undefined}
            value={name}
            maxLength={200}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
      )}
      {existingName && (
        <p className="worktree-create-warning">
          That branch already exists. Choose Existing branch to use it.
        </p>
      )}
      {invalidName && (
        <p className="worktree-create-warning" id="worktree-branch-error">
          Remove spaces or unsupported symbols; for example, feature/my-task.
        </p>
      )}
      <label>
        {mode === 'new' ? 'Start from' : 'Branch'}
        <ChoiceButton
          label={mode === 'new' ? 'Base branch' : 'Existing branch'}
          value={mode === 'new' ? baseID : existingID}
          disabled={busy}
          choices={branches
            .filter((branch) => mode === 'new' || branch.branch)
            .map((branch) => ({
              value: branch.id,
              label: branch.name + (branch.worktreeID ? ' · checked out' : ''),
            }))}
          onChoose={mode === 'new' ? setBaseID : setExistingID}
        />
      </label>
      {selected && (
        <p className="worktree-create-revision">{selected.commit.slice(0, 12)} · pinned revision</p>
      )}
      {occupied ? (
        <div className="worktree-create-occupied">
          <p>
            This branch already has a checkout at{' '}
            {catalog.worktrees.find((tree) => tree.id === occupied)?.path}.
          </p>
          <button
            type="button"
            disabled={busy || (!!task && !task.name.trim())}
            onClick={() => show(occupied)}
          >
            {task ? 'Use checkout for task' : 'Show worktree'}
          </button>
        </div>
      ) : (
        <>
          <label>
            Destination
            <div className="worktree-create-destination">
              <input
                aria-label="Worktree destination"
                disabled={busy}
                maxLength={32768}
                value={destination}
                onChange={(event) => setCustomDestination(event.target.value)}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void window.viewer
                    .chooseFolder(catalog.repository)
                    .then((parent) => {
                      if (parent)
                        setCustomDestination(
                          parent.replace(/[\\/]+$/, '') + '/' + destination.split(/[\\/]/).at(-1),
                        );
                    })
                    .catch((value) => setError(errorMessage(value)));
                }}
              >
                Choose parent…
              </button>
            </div>
          </label>
          <p className="worktree-create-hint">
            {task
              ? 'Opens the checkout, notes, terminal and Git changes together. '
              : 'Creates a separate checkout. '}
            The destination must be a new folder.
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="worktree-create-warning">
          {error}
        </p>
      )}
      <footer>
        <button type="button" disabled={busy} onClick={cancel}>
          Back
        </button>
        <button
          type="submit"
          className="primary"
          disabled={busy || !valid || !!occupied || (!!task && !task.name.trim())}
        >
          {busy ? 'Creating…' : task ? 'Create task' : 'Create and open'}
        </button>
      </footer>
    </form>
  );
}
