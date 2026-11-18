import { useEffect, useState } from 'react';
import type { CapturedTarget } from '../../domain/automation/actions';
import type { ReceiptSummary } from '../../domain/automation/receipts';
import { errorMessage } from '../../domain/errors';
import { activeWorkspace, useViewer } from '../state/store';
import type { WorkspaceController } from '../workspace/context';
import { ChoiceButton } from '../ui/ChoiceMenu';
import { Dialog } from '../ui/primitives';
import { PathLabel, useHome } from '../ui/PathLabel';
import { pathText } from '../../domain/files/path-label';
import { baseName } from '../../domain/workspaces/planes';
import { plural } from '../../domain/plural';
import { receiptOutcome } from './ReceiptPlane';
import './tasks.css';
export function TasksDialog({
  workspace,
  target,
  onClose,
}: {
  workspace: WorkspaceController;
  target?: CapturedTarget;
  onClose(): void;
}) {
  const space = useViewer(activeWorkspace),
    folders = space.panes.filter((pane) => pane.type === 'folder');
  const home = useHome();
  const [creating, setCreating] = useState(!!target),
    [name, setName] = useState(''),
    [folderID, setFolderID] = useState(target?.paneID ?? folders[0]?.id ?? ''),
    [query, setQuery] = useState(''),
    [history, setHistory] = useState(false),
    [receipts, setReceipts] = useState<ReceiptSummary[]>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!history) return;
    let live = true;
    void window.viewer
      .receipts({ kind: 'list' })
      .then((reply) => {
        if (live && reply.kind === 'list') {
          setReceipts(reply.receipts);
          if (reply.problems.length) setError(reply.problems.join(' '));
        }
      })
      .catch((value) => {
        if (live) setError(errorMessage(value));
      });
    return () => {
      live = false;
    };
  }, [history, refresh]);
  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const pane = folders.find((pane) => pane.id === folderID);
      if (!pane) throw new Error('Choose an open files plane.');
      const rootID = workspace.rootID(pane.id);
      if (!rootID) throw new Error('The folder is still opening. Try again.');
      await workspace.newTaskArea(
        target?.paneID === pane.id
          ? target
          : {
              workspaceID: space.id,
              rootID,
              paneID: pane.id,
              panePath: pane.path,
              directory: pane.path,
              selection: [],
            },
        name,
      );
      onClose();
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  };
  const term = query.trim().toLocaleLowerCase(),
    areas =
      space.taskAreas?.filter(
        (area) =>
          !term ||
          (area.name + ' ' + area.checkout.path + ' ' + (area.checkout.branch ?? ''))
            .toLocaleLowerCase()
            .includes(term),
      ) ?? [];
  const filtered = receipts
    ?.filter(
      (receipt) =>
        !term || (receipt.title + ' ' + receipt.directory).toLocaleLowerCase().includes(term),
    )
    .slice(0, 100);
  return (
    <Dialog
      title="Tasks"
      onClose={() => {
        if (!busy) onClose();
      }}
      className="tasks-dialog"
    >
      <div className="tasks-dialog-body">
        <div className="tasks-dialog-tabs">
          <button
            aria-pressed={!history}
            onClick={() => {
              setHistory(false);
              setError('');
            }}
          >
            Task Areas
          </button>
          <button
            aria-pressed={history}
            onClick={() => {
              setHistory(true);
              setCreating(false);
              setError('');
            }}
          >
            Command History
          </button>
          <span className="toolbar-spacer" />
          {!history ? (
            <button
              disabled={busy || !folders.length}
              onClick={() => setCreating((value) => !value)}
            >
              New Task…
            </button>
          ) : (
            <button disabled={busy} onClick={() => setRefresh((value) => value + 1)}>
              Refresh
            </button>
          )}
        </div>
        <input
          className="tasks-search"
          type="search"
          data-autofocus
          placeholder={history ? 'Find command or folder' : 'Find task, branch or folder'}
          aria-label={history ? 'Find command receipt' : 'Find task area'}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {creating && !history && (
          <form
            className="task-create-form"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <label>
              Task name
              <input
                aria-label="New task name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                required
              />
            </label>
            {/* a div: a click on its words would open the menu. Each folder by its own name, its
                path under it with home as ~ */}
            <div className="task-checkout-field">
              <span>Checkout folder</span>
              <ChoiceButton
                label="Task checkout folder"
                value={folderID}
                choices={folders.map((pane) => ({
                  value: pane.id,
                  label: baseName(pane.path) || pane.path,
                  detail: pathText(pane.path, home),
                }))}
                onChoose={setFolderID}
              />
            </div>
            <div className="task-create-actions">
              <button type="button" disabled={busy} onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button className="primary" disabled={busy || !name.trim() || !folderID}>
                {busy ? 'Creating…' : 'Create Task Area'}
              </button>
            </div>
          </form>
        )}
        {!history && areas.length === 0 && !creating && (
          <p className="muted">
            {query
              ? 'No matching task areas.'
              : folders.length
                ? 'Create a task from an open folder, then link its notes, conversations, terminals and review tools.'
                : 'Open a files plane, then create a task from it.'}
          </p>
        )}
        {!history && !folders.length && areas.length > 0 && (
          <p className="muted">Open a files plane to create a task.</p>
        )}
        {history && !receipts && !error && (
          <p className="muted" role="status">
            Reading saved receipts…
          </p>
        )}
        {history && filtered?.length === 0 && (
          <p className="muted">
            {query ? 'No matching commands.' : 'Commands you run from a folder are listed here.'}
          </p>
        )}
        <div className="tasks-list">
          {history
            ? filtered?.map((receipt) => (
                <button
                  key={receipt.id}
                  onClick={() => {
                    workspace.openReceipt(receipt.id, receipt.directory);
                    onClose();
                  }}
                >
                  <strong>{receipt.title}</strong>
                  <small>
                    {receiptOutcome(receipt)} · {new Date(receipt.started).toLocaleString()}
                  </small>
                  <small>
                    <PathLabel path={receipt.directory} />
                  </small>
                </button>
              ))
            : areas.map((area) => (
                <button
                  key={area.id}
                  onClick={() => {
                    workspace.openTaskArea(area.id);
                    onClose();
                  }}
                >
                  <strong>{area.name}</strong>
                  <small>
                    {area.checkout.branch ?? 'Folder'} ·{' '}
                    {plural(area.members.length, 'linked tool')}
                  </small>
                  <small>
                    <PathLabel path={area.checkout.path} />
                  </small>
                </button>
              ))}
        </div>
        {history && receipts && receipts.length > 100 && (
          <p className="muted">Showing the first 100 commands.</p>
        )}
      </div>
      <footer>
        <button disabled={busy} onClick={onClose}>
          Done
        </button>
      </footer>
    </Dialog>
  );
}
