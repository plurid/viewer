import { useEffect, useState } from 'react';
import type { FileRelation, RelationshipsResult } from '../../../domain/files/relationships';
import { sameSourceVersion } from '../../../domain/files/inspection';
import { useWorkspace } from '../../workspace/context';
import { Dialog, Loading } from '../primitives';
import { RelationshipMap } from './RelationshipMap';
import { relationshipBasis as basis } from './relationship-labels';
const filename = (path: string) => path.split('/').pop() ?? path;
export function RelationshipControls() {
  const workspace = useWorkspace();
  const [file, setFile] = useState<string>(),
    [origin, setOrigin] = useState<string>();
  const [result, setResult] = useState<RelationshipsResult>(),
    [content, setContent] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [page, setPage] = useState(0),
    [view, setView] = useState<'list' | 'map'>('list');
  const [target, setTarget] = useState(''),
    [note, setNote] = useState('');
  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent<{ paths: string[]; paneID?: string }>).detail;
      if (!detail?.paths[0]) return;
      setFile(detail.paths[0]);
      setTarget(detail.paths[1] ?? '');
      setNote('');
      setOrigin(detail.paneID);
      setContent(false);
      setPage(0);
      setView('list');
      setError('');
    };
    window.addEventListener('viewer:relationships', show);
    return () => window.removeEventListener('viewer:relationships', show);
  }, []);
  useEffect(() => {
    if (!file) return;
    let alive = true;
    setLoading(true);
    setError('');
    setResult(undefined);
    void window.viewer
      .relationships({ kind: 'read', file, content })
      .then((value) => {
        if (!value || !('relations' in value)) throw new Error('Related files are unavailable.');
        if (alive) setResult(value);
      })
      .catch((error) => {
        if (alive) setError(error.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [file, content, refresh]);
  if (!file) return null;
  const perform = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const select = (path: string) => {
    setFile(path);
    setContent(false);
    setPage(0);
  };
  const currentFiles = new Map(result?.files.map((file) => [file.path, file]) ?? []);
  const status = (node: FileRelation['from']) => {
    const current = currentFiles.get(node.path);
    if (!current || current.status === 'unavailable') return 'Unavailable';
    return !node.version || !current.version
      ? 'Current version unverified'
      : sameSourceVersion(node.version, current.version)
        ? 'Metadata unchanged'
        : 'Changed since record';
  };
  const open = async (path: string) => {
    await workspace.openPath(path, { paneID: origin, linked: !!origin });
    setFile(undefined);
  };
  return (
    <Dialog
      wide
      title="Related files"
      className="relationships-dialog"
      onClose={() => !busy && setFile(undefined)}
    >
      <div className="dialog-body relationships-body">
        <p className="inspection-path muted">{file}</p>
        <div className="settings-actions">
          <button aria-pressed={view === 'list'} onClick={() => setView('list')}>
            List
          </button>
          <button aria-pressed={view === 'map'} onClick={() => setView('map')}>
            Map
          </button>
          <button disabled={busy || loading} onClick={() => setRefresh((value) => value + 1)}>
            Refresh
          </button>
          <label>
            <input
              type="checkbox"
              disabled={busy || loading}
              checked={content}
              onChange={(event) => {
                setContent(event.target.checked);
                setPage(0);
              }}
            />
            Read local references in this file
          </label>
        </div>
        {loading && <Loading label="Reading relationships…" />}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {result && (
          <>
            {!result.relations.length && (
              <p className="muted">No retained relationships for this file.</p>
            )}
            {result.reasons.map((reason) => (
              <p className="muted" key={reason}>
                {reason}
              </p>
            ))}
            {view === 'map' ? (
              <RelationshipMap file={file} relations={result.relations} select={select} />
            ) : (
              <div className="relationship-list">
                {result.relations.slice(page * 50, page * 50 + 50).map((relation) => (
                  <div className="relationship-row" key={relation.id}>
                    <div className="relationship-type">
                      <strong>{relation.kind}</strong>
                      <span className="muted">{basis[relation.basis]}</span>
                    </div>
                    <div className="relationship-files">
                      {[relation.from, relation.to].map((node, index) => (
                        <div key={index}>
                          <button title={node.path} onClick={() => select(node.path)}>
                            {index === 0 ? 'From: ' : 'To: '}
                            {filename(node.path)}
                          </button>
                          <small className="muted">{node.path}</small>
                          <small
                            className={
                              status(node) === 'Changed since record' ? 'inline-warning' : 'muted'
                            }
                          >
                            {status(node)}
                          </small>
                          <button
                            disabled={busy || status(node) === 'Unavailable'}
                            onClick={() => void perform(() => open(node.path))}
                          >
                            Open in plane
                          </button>
                        </div>
                      ))}
                    </div>
                    {relation.note && <p>{relation.note}</p>}
                    {relation.receipt.service === 'note' && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => {
                            await window.viewer.relationships({
                              kind: 'remove-note',
                              id: relation.id,
                            });
                            setRefresh((value) => value + 1);
                          })
                        }
                      >
                        Remove note
                      </button>
                    )}
                  </div>
                ))}
                {result.relations.length > 50 && (
                  <div className="settings-actions">
                    <button disabled={page === 0} onClick={() => setPage(page - 1)}>
                      Previous
                    </button>
                    <span>
                      {page * 50 + 1}–{Math.min(page * 50 + 50, result.relations.length)} of{' '}
                      {result.relations.length}
                    </span>
                    <button
                      disabled={(page + 1) * 50 >= result.relations.length}
                      onClick={() => setPage(page + 1)}
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        <details className="relationship-note">
          <summary>Add a relationship note</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                await window.viewer.relationships({ kind: 'note', from: file, to: target, note });
                setNote('');
                setRefresh((value) => value + 1);
              });
            }}
          >
            <label className="field-label">
              Related file path
              <input
                required
                value={target}
                disabled={busy}
                onChange={(event) => setTarget(event.target.value)}
              />
            </label>
            <label className="field-label">
              Note
              <textarea
                required
                rows={3}
                maxLength={4000}
                value={note}
                disabled={busy}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            <button type="submit" disabled={busy || !target.trim() || !note.trim()}>
              Save relationship note
            </button>
          </form>
        </details>
      </div>
    </Dialog>
  );
}
