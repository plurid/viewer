import { useState } from 'react';
import type { ComparisonResult, ComparisonRow } from '../../../domain/comparison/folders';
import type { OperationIntent } from '../../../domain/operations/operation-plan';
import { sourceVersion } from '../../../domain/files/inspection';
import { formatBytes } from '../../../domain/files/entries';
import { useWorkspace } from '../../workspace/context';
import { Dialog, Loading } from '../primitives';
import { Disclosure } from '../Disclosure';
import { prepareOperationReview } from '../operations/OperationReview';
import { errorMessage } from '../../../domain/errors';
import { useWindowEvent } from '../../app/window-events';
const labels: Record<ComparisonRow['status'], string> = {
  'left-only': 'Only on left',
  'right-only': 'Only on right',
  different: 'Different',
  same: 'Equal SHA-256',
  'same-metadata': 'Matching metadata',
  unknown: 'Unknown',
};
export function ComparisonControls() {
  const workspace = useWorkspace();
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [hashes, setHashes] = useState(false);
  const [result, setResult] = useState<ComparisonResult>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState('');
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  useWindowEvent('viewer:compare', (files) => {
    setOpen(true);
    setError('');
    if (files.length) {
      setLeft(files[0] ?? '');
      setRight(files[1] ?? '');
    }
  });
  if (!open) return null;
  const close = () => {
    if (running) void window.viewer.compare({ kind: 'cancel', id: running });
    setOpen(false);
  };
  const choose = async (side: 'left' | 'right') => {
    const root = await window.viewer.chooseFolder();
    if (root) {
      (side === 'left' ? setLeft : setRight)(root);
      setResult(undefined);
    }
  };
  const compare = async () => {
    const id = crypto.randomUUID();
    setRunning(id);
    setError('');
    try {
      const value = await window.viewer.compare({ kind: 'run', id, left, right, hashes });
      if (value) {
        setResult(value);
        setSelected(
          new Set(
            value.rows
              .filter((row) => row.left && row.status === 'left-only')
              .map((row) => row.path),
          ),
        );
        setPage(0);
      }
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setRunning('');
    }
  };
  const reconcile = async () => {
    if (!result) return;
    setError('');
    try {
      const chosen = result.rows.filter(
        (row) =>
          selected.has(row.path) && row.left && row.status !== 'unknown' && row.status !== 'same',
      );
      const roots = chosen.filter(
        (row) =>
          !chosen.some(
            (parent) =>
              parent !== row &&
              parent.left?.kind === 'directory' &&
              row.path.startsWith(parent.path + '/'),
          ),
      );
      if (
        roots.some((row) =>
          result.rows.some(
            (child) => child.path.startsWith(row.path + '/') && child.status === 'unknown',
          ),
        )
      )
        throw new Error(
          'A selected folder contains unknown files. Resolve them before copying the folder.',
        );
      const intents: OperationIntent[] = roots.map((row) => ({
        kind: 'copy',
        sources: [row.left!.path],
        expectedSources: result.rows
          .filter((child) => child.left && (child === row || child.path.startsWith(row.path + '/')))
          .map((child) => ({ path: child.left!.path, version: sourceVersion(child.left!) })),
        ...(row.path === '.' ? { name: row.right!.name } : {}),
        destination:
          row.path === '.'
            ? result.right.substring(0, result.right.lastIndexOf('/'))
            : result.right + '/' + row.path.split('/').slice(0, -1).join('/'),
      }));
      await prepareOperationReview('Copy selected changes from left to right', intents);
      setOpen(false);
    } catch (error) {
      setError(errorMessage(error));
    }
  };
  const start = page * 100;
  return (
    <Dialog wide title="Compare locations" onClose={close}>
      <div className="dialog-body comparison-body">
        <div className="comparison-locations">
          {(['left', 'right'] as const).map((side) => (
            <label key={side}>
              <span>
                {side === 'left' ? 'Left location' : 'Right location'} ·{' '}
                {(side === 'left' ? left : right).split('/').filter(Boolean).at(-1) ||
                  'Choose a location'}
              </span>
              <input
                aria-label={side + ' location'}
                title={side === 'left' ? left : right}
                onBlur={(event) => {
                  event.currentTarget.scrollLeft = event.currentTarget.scrollWidth;
                }}
                disabled={!!running}
                value={side === 'left' ? left : right}
                onChange={(event) => {
                  (side === 'left' ? setLeft : setRight)(event.target.value);
                  setResult(undefined);
                }}
              />
              <button
                disabled={!!running}
                onClick={() => void choose(side).catch((error: Error) => setError(error.message))}
              >
                Choose folder…
              </button>
            </label>
          ))}
        </div>
        <label className="review-checkpoint">
          <input
            type="checkbox"
            checked={hashes}
            disabled={!!running}
            onChange={(event) => setHashes(event.target.checked)}
          />
          <span>
            Read file contents to compare SHA-256
            <small>
              May download files stored in iCloud or another provider. Metadata comparison keeps
              content unread.
            </small>
          </span>
        </label>
        {running && <Loading label="Comparing locations…" />}
        {result && (
          <>
            <p className="muted">
              {result.rows.length} entries ·{' '}
              {result.coverage === 'complete' ? 'Complete traversal' : 'Partial coverage'} ·{' '}
              {selected.size} selected
            </p>
            {result.errors.length > 0 && (
              <Disclosure
                variant="inline"
                summary={`${result.errors.length} unreadable or changed ${result.errors.length === 1 ? 'location' : 'locations'}`}
              >
                {result.errors.slice(0, 100).map((issue, index) => (
                  <p className="error" key={index}>
                    {issue.path}: {issue.message}
                  </p>
                ))}
              </Disclosure>
            )}
            <div
              className="comparison-table"
              role="table"
              aria-label="Comparison results"
              aria-rowcount={result.rows.length + 1}
            >
              <div className="comparison-row comparison-heading" role="row">
                <span role="columnheader" aria-label="Select changes" />
                <span role="columnheader">Relative path</span>
                <span role="columnheader">Left size</span>
                <span role="columnheader">Right size</span>
                <span role="columnheader">Status</span>
              </div>
              {result.rows.slice(start, start + 100).map((row) => (
                <div className="comparison-row" role="row" key={row.path} title={row.reason}>
                  <span role="cell">
                    <input
                      aria-label={'Copy ' + row.path + ' from left to right'}
                      type="checkbox"
                      disabled={!row.left || row.status === 'unknown' || row.status === 'same'}
                      checked={selected.has(row.path)}
                      onChange={(event) => {
                        const next = new Set(selected);
                        if (event.target.checked) next.add(row.path);
                        else next.delete(row.path);
                        setSelected(next);
                      }}
                    />
                  </span>
                  <span className="comparison-name" role="cell">
                    {row.path}
                    <span className="settings-actions">
                      {(row.left?.kind === 'file' || row.right?.kind === 'file') && (
                        <button
                          onClick={() => {
                            workspace.openDiff(
                              row.left?.kind === 'file'
                                ? { kind: 'file', path: row.left.path }
                                : { kind: 'empty', name: 'Absent on left' },
                              row.right?.kind === 'file'
                                ? { kind: 'file', path: row.right.path }
                                : { kind: 'empty', name: 'Absent on right' },
                            );
                            close();
                          }}
                        >
                          Open diff
                        </button>
                      )}
                      {row.left?.kind === 'file' && (
                        <button
                          onClick={() => workspace.open(row.left!, undefined, { another: true })}
                        >
                          Open left
                        </button>
                      )}
                      {row.right?.kind === 'file' && (
                        <button
                          onClick={() => workspace.open(row.right!, undefined, { another: true })}
                        >
                          Open right
                        </button>
                      )}
                    </span>
                  </span>
                  <span role="cell">
                    {row.left?.kind === 'file'
                      ? formatBytes(row.left.size)
                      : row.left
                        ? 'Folder'
                        : ''}
                  </span>
                  <span role="cell">
                    {row.right?.kind === 'file'
                      ? formatBytes(row.right.size)
                      : row.right
                        ? 'Folder'
                        : ''}
                  </span>
                  <span role="cell">{labels[row.status]}</span>
                </div>
              ))}
            </div>
            {result.rows.length > 100 && (
              <div className="settings-actions">
                <button disabled={!page} onClick={() => setPage(page - 1)}>
                  Previous
                </button>
                <span>
                  {start + 1}–{Math.min(start + 100, result.rows.length)} of {result.rows.length}
                </span>
                <button
                  disabled={start + 100 >= result.rows.length}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer>
        {running ? (
          <button onClick={() => void window.viewer.compare({ kind: 'cancel', id: running })}>
            Stop
          </button>
        ) : (
          <button onClick={close}>Close</button>
        )}
        <button disabled={!left || !right || !!running} onClick={() => void compare()}>
          Compare
        </button>
        <button
          className="primary"
          disabled={!result || !selected.size || !!running || result.coverage !== 'complete'}
          onClick={() => void reconcile()}
        >
          Review copy to right…
        </button>
      </footer>
    </Dialog>
  );
}
