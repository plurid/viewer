import { useEffect, useRef, useState } from 'react';
import type { BackupRequest, BackupReview } from '../../domain/persistence/backup';
import type { WorkspaceController } from '../workspace/context';
import { errorMessage } from '../../domain/errors';
import { formatBytes } from '../../domain/files/entries';
import { Dialog, Loading, PathField } from '../ui/primitives';
import {
  activeWorkspace,
  changeWorkspace,
  flushState,
  receiveSettings,
  announce,
} from '../state/store';
import { appendRestoredWorkspaces } from '../state/workspaces';
import './backup.css';

export function BackupDialog({
  workspace,
  transition,
  onClose,
}: {
  workspace: WorkspaceController;
  transition(change: () => Promise<void>): Promise<void>;
  onClose(): void;
}) {
  const [review, setReview] = useState<BackupReview>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [preferences, setPreferences] = useState(false);
  const alive = useRef(true),
    pending = useRef(false),
    held = useRef<string | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (held.current)
        void window.viewer.backup({ kind: 'release', id: held.current }).catch(() => {});
    };
  }, []);
  const run = async (request: BackupRequest) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (request.kind === 'prepare-export') {
        if (activeWorkspace().panes.length) {
          const layout = workspace.captureLayout();
          changeWorkspace((space) => ({ ...space, layout }));
        }
        await flushState();
      }
      const reply = await window.viewer.backup(request);
      if (!alive.current) {
        if (reply.kind === 'review')
          await window.viewer.backup({ kind: 'release', id: reply.review.id });
        return;
      }
      if (reply.kind === 'review') {
        held.current = reply.review.id;
        setReview(reply.review);
      } else if (reply.kind === 'written') {
        held.current = undefined;
        announce('Backup saved: ' + reply.name);
        onClose();
      } else if (reply.kind === 'restored') {
        held.current = undefined;
        receiveSettings(reply.settings);
        await transition(() => appendRestoredWorkspaces(reply.state));
        announce('Restored workspaces added. Terminals and servers are stopped.');
        onClose();
      }
    } catch (error) {
      if (alive.current) setError(errorMessage(error));
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <Dialog
      title="Backup and restore"
      wide
      className="backup-dialog"
      onClose={() => {
        if (!pending.current) onClose();
      }}
    >
      <div className="dialog-body backup-body">
        {!review ? (
          <>
            <p>
              Keep your workspaces, notes, checklists, unsaved text, reading positions and editing
              decisions in a portable backup.
            </p>
            <p>
              Import adds independent copies beside your current work. You can choose new locations
              for source folders before restoring.
            </p>
            <div className="backup-choices">
              <button onClick={() => void run({ kind: 'prepare-export' })} disabled={busy}>
                Create backup…
              </button>
              <button onClick={() => void run({ kind: 'choose-import' })} disabled={busy}>
                Open backup…
              </button>
            </div>
          </>
        ) : (
          <>
            <p>
              <strong>
                {review.workspaces.length}{' '}
                {review.workspaces.length === 1 ? 'workspace' : 'workspaces'}
              </strong>{' '}
              · {new Date(review.created).toLocaleString()} · {formatBytes(review.bytes)}
            </p>
            <p>{review.workspaces.join(', ')}</p>
            <dl className="backup-counts">
              {Object.entries(review.documents).map(([kind, count]) => (
                <div key={kind}>
                  <dt>{kind === 'drafts' ? 'Text drafts' : kind}</dt>
                  <dd>{count}</dd>
                </div>
              ))}
            </dl>
            <div className="backup-notices">
              {review.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
            {review.mode === 'import' && (
              <>
                <h3>Source folders</h3>
                <p>
                  Keep the original location, or choose the folder that now contains these files.
                </p>
                <ul className="backup-roots">
                  {review.roots.map((root) => (
                    <li key={root.source}>
                      <div>
                        <PathField
                          path={root.source}
                          onError={(value) => setError(errorMessage(value))}
                        />
                        <small>
                          {root.destination ? (
                            <PathField
                              path={root.destination}
                              label="Copy new location"
                              onError={(value) => setError(errorMessage(value))}
                            />
                          ) : (
                            'Keep original location'
                          )}
                        </small>
                      </div>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run({ kind: 'relink', id: review.id, root: root.source })
                        }
                      >
                        Relink…
                      </button>
                    </li>
                  ))}
                </ul>
                <label className="backup-preferences">
                  <input
                    type="checkbox"
                    checked={preferences}
                    disabled={busy}
                    onChange={(event) => setPreferences(event.target.checked)}
                  />
                  <span>
                    Also restore appearance, shortcuts, tools and recipes
                    <small>
                      Replaces these personal preferences. File and model access must still be
                      granted separately.
                    </small>
                  </span>
                </label>
              </>
            )}
          </>
        )}
        {busy && (
          <Loading
            label={review?.mode === 'import' ? 'Preparing restored work…' : 'Preparing backup…'}
          />
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
      <footer>
        <button disabled={busy} onClick={onClose}>
          Cancel
        </button>
        {review && (
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void run(
                review.mode === 'export'
                  ? { kind: 'write', id: review.id }
                  : { kind: 'restore', id: review.id, preferences },
              )
            }
          >
            {review.mode === 'export' ? 'Save backup…' : 'Restore copies'}
          </button>
        )}
      </footer>
    </Dialog>
  );
}
