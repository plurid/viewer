import { useState } from 'react';
import type { DuplicateGroup, DuplicateResult } from '../../../domain/comparison/duplicates';
import { sourceVersion } from '../../../domain/files/inspection';
import { formatBytes } from '../../../domain/files/entries';
import { Dialog, Loading } from '../primitives';
import { prepareOperationReview } from '../operations/OperationReview';
import { errorMessage } from '../../../domain/errors';
import { useWindowEvent } from '../../app/window-events';

const page = 100;
const reclaimable = (groups: readonly DuplicateGroup[], chosen?: ReadonlySet<string>) =>
  groups.reduce(
    (total, group) =>
      total +
      group.size *
        (chosen
          ? group.files.filter((file) => chosen.has(file.path)).length
          : group.files.length - 1),
    0,
  );

/** Finds identical files and prepares a reviewed move to Trash for chosen copies. Nothing
 * is selected at first, and every group always keeps at least one copy. */
export function DuplicateControls() {
  const [open, setOpen] = useState(false);
  const [roots, setRoots] = useState<string[]>([]);
  const [running, setRunning] = useState('');
  const [result, setResult] = useState<DuplicateResult>();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(page);
  const [error, setError] = useState('');
  useWindowEvent('viewer:duplicates', (folders) => {
    setRoots(folders);
    setResult(undefined);
    setChosen(new Set());
    setShown(page);
    setError('');
    setOpen(true);
  });
  if (!open) return null;
  const close = () => {
    if (running) void window.viewer.duplicates({ kind: 'cancel', id: running });
    setOpen(false);
  };
  const search = async () => {
    const id = crypto.randomUUID();
    setRunning(id);
    setError('');
    setResult(undefined);
    setChosen(new Set());
    try {
      const value = await window.viewer.duplicates({ kind: 'run', id, roots });
      if (value) setResult(value);
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setRunning('');
    }
  };
  const choose = async () => {
    const folder = await window.viewer.chooseFolder();
    if (folder) {
      setRoots([folder]);
      setResult(undefined);
    }
  };
  const toggle = (group: DuplicateGroup, path: string) => {
    const next = new Set(chosen);
    if (next.has(path)) next.delete(path);
    // The last unchosen copy of a group is never offered.
    else if (group.files.filter((file) => !next.has(file.path)).length > 1) next.add(path);
    setChosen(next);
  };
  const allButOldest = () =>
    setChosen(
      new Set(result?.groups.flatMap((group) => group.files.slice(1).map((file) => file.path))),
    );
  const review = async () => {
    if (!result) return;
    const files = result.groups.flatMap((group) =>
      group.files.filter((file) => chosen.has(file.path)),
    );
    try {
      await prepareOperationReview('Move duplicate files to Trash', [
        {
          kind: 'trash',
          sources: files.map((file) => file.path),
          expectedSources: files.map((file) => ({ path: file.path, version: sourceVersion(file) })),
        },
      ]);
      setOpen(false);
    } catch (value) {
      setError(errorMessage(value));
    }
  };
  return (
    <Dialog wide title="Find duplicates" onClose={close}>
      <div className="dialog-body duplicates-body">
        <p className="muted">
          Searches {roots.length ? roots.join(', ') : 'no folder yet'} for files with identical
          contents (SHA-256). Links are not followed and nothing is changed by searching.
        </p>
        <div className="project-control-row">
          <button disabled={!!running} onClick={() => void choose()}>
            Choose folder…
          </button>
          {running ? (
            <button onClick={() => void window.viewer.duplicates({ kind: 'cancel', id: running })}>
              Cancel search
            </button>
          ) : (
            <button className="primary" disabled={!roots.length} onClick={() => void search()}>
              Find duplicates
            </button>
          )}
        </div>
        {running && <Loading label="Comparing file contents…" />}
        {error && <p role="alert">{error}</p>}
        {result && (
          <>
            <p role="status">
              {result.groups.length
                ? `${result.groups.length.toLocaleString()} groups of identical files among ${result.scanned.toLocaleString()} checked; ${formatBytes(reclaimable(result.groups))} could be reclaimed.`
                : `No identical files among ${result.scanned.toLocaleString()} checked.`}
              {result.coverage === 'partial' &&
                ` Some items could not be read (${result.errors.length}), so the search is incomplete.`}
            </p>
            {result.groups.length > 0 && (
              <div className="project-control-row">
                <button onClick={allButOldest}>Choose all but the oldest copy</button>
                <button disabled={!chosen.size} onClick={() => setChosen(new Set())}>
                  Clear choices
                </button>
              </div>
            )}
            <div className="duplicate-groups">
              {result.groups.slice(0, shown).map((group) => (
                <fieldset key={group.hash + group.size} className="duplicate-group">
                  <legend>
                    {group.files.length} identical files · {formatBytes(group.size)} each
                  </legend>
                  {group.files.map((file) => {
                    const last =
                      !chosen.has(file.path) &&
                      group.files.filter((item) => !chosen.has(item.path)).length === 1;
                    return (
                      <label key={file.path} className="duplicate-file" title={file.path}>
                        <input
                          type="checkbox"
                          checked={chosen.has(file.path)}
                          disabled={last}
                          onChange={() => toggle(group, file.path)}
                        />
                        <span>{file.path}</span>
                        <small className="muted">{new Date(file.modified).toLocaleString()}</small>
                      </label>
                    );
                  })}
                </fieldset>
              ))}
            </div>
            {result.groups.length > shown && (
              <button onClick={() => setShown(shown + page)}>
                Show more groups ({(result.groups.length - shown).toLocaleString()} remaining)
              </button>
            )}
          </>
        )}
      </div>
      <footer>
        <button onClick={close}>Close</button>
        <button className="danger" disabled={!chosen.size} onClick={() => void review()}>
          Review moving {chosen.size.toLocaleString()} to Trash ·{' '}
          {formatBytes(result ? reclaimable(result.groups, chosen) : 0)}
        </button>
      </footer>
    </Dialog>
  );
}
